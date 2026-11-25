/**
 * Headless Wizardry 6 combat simulator. It composes the harness-verified pieces of combat.ts
 * (attack resolver, weapon on-hit effects, SetStatus and kill cleanup, XP pool) over a synthetic party and
 * monster groups held in the game's own memory layout, and drives them with a round loop.
 *
 * Pass 3: {@link CombatWorld.gameRound} runs the game's own round (verified planner LAB_0C96 + round driver
 * LAB_102D / executor LAB_0FF9, attacks through the verified resolver). The older {@link CombatWorld.round} stays
 * as the hypothesis loop. What is verified and what is not (see docs/wizardry6/amiga/game-rules.md section 8):
 *  - verified against the game (harness): every single attack, including its weapon effects, kills and
 *    XP pool credit, on arbitrary states (3,000-vector sweeps, combat.test.ts);
 *  - NOT verified (hyp): the round loop. Order of play, who attacks whom and which action is chosen are
 *    stand-ins documented on each method, because the planner (CODE+0x1e21a), the party menu and the
 *    monster AI are not yet harnessed. Spells are not cast here.
 */
import { Mem, resolveAttack } from './combat.ts';
import type { Effect } from './combat.ts';
import { planMonsters } from './planner.ts';
import { runRound } from './round.ts';
import { W6Rng } from './rules.ts';
import { castAction, loadSpellTable, makeEngines } from './spellrun.ts';
import { castEffect } from './spells.ts';
import { removeItem } from './inventory.ts';
import { postCombat, swapParty, useItem, type ItemRec } from './itemuse.ts';
import { hide, run as runAway } from './flee.ts';
import { breath } from './breath.ts';
import { startEncounter, type EncounterIO } from './encounter.ts';

export const LAYOUT = { a4: 0x167ffe, memBase: 0x400000, memStride: 0x400, recBase: 0x420000, recStride: 0x400 } as const;

export interface WeaponSpec {
  /** damage = base + n x (Random(sides)+1) */
  base: number; n: number; sides: number;
  /** to-hit bonus byte (block +14) */
  hitBonus?: number;
  /** eight on-hit effect percentages (block +4..+11), see weaponProc */
  procs?: number[];
  /** item subtype byte (+5): picks the skill, see weaponSkill */
  subtype?: number;
}

export interface PartySpec {
  hp: number; stamina: number; level: number;
  /** member-struct armour byte (+0x26): lower is better */
  ac: number;
  weapon?: WeaponSpec;
  /** skill values by skill index (0..29) */
  skills?: Record<number, number>;
  /** carried weight / capacity */
  weight?: number; capacity?: number;
  /** caster data: class id (record +415), spell points per realm [cur, max] x 6 (record +40 + 4*realm), luck (+307) */
  cls?: number; sp?: [number, number][]; luck?: number;
}

/** What a party member does this round (the game reads it from the menus; the sim takes a policy). */
export type PartyPlan =
  | { act: 'attack'; tg?: number; ti?: number }
  | { act: 'cast'; spell: number; power: number; tg: number; ti: number }
  | { act: 'run' } | { act: 'hide' }
  /** use the item in inventory slot `slot` (its effect word names a spell; harness-verified LAB_0F8A) */
  | { act: 'useitem'; slot: number; tg?: number; ti?: number }
  /** move this member to position `to` (LAB_0FDB, takes effect when the action fires) */
  | { act: 'swap'; to: number };

export interface MonsterSpec {
  hp: number;
  /** member word +0: used as a level-like strength in several formulas */
  strength: number;
  /** record armour (+0xbe) */
  ac: number;
  /** attack slots: up to four, each a weapon block plus its attack kind byte */
  attacks: { weapon: WeaponSpec; kind?: number }[];
  /** record +212 level class (strike count) and +0x86 attack bonus, +0x87..+0x89 power bytes */
  levelClass?: number; bonus?: number; power?: number;
  /** XP credited on death (+0x40) */
  xp: number;
  /** resist percentages, record +0x94 + index */
  resist?: Record<number, number>;
  /** spell ids the planner may pick (record +138..), chance percent per turn (+168), breath chance (+170) */
  spells?: number[]; spellChance?: number; breathChance?: number;
  /** record +208 monster type (0x14/0x15 undead..., 3/4/5/13 are un-silenceable) */
  type?: number;
}

export interface CastLog { actor: string; spell: number; power: number; target: string; fizzled: boolean; backfired: boolean; cost: number }
export interface RoundLog { actor: string; target: string; kind: number; hpBefore: number; hpAfter: number; killed: boolean }

export class CombatWorld {
  readonly mem = new Mem({}, true);
  readonly rng: W6Rng;
  readonly partySize: number;
  groupSizes: number[];
  log: RoundLog[] = [];
  /** encounter start results: the groups the evasion check disengaged (hyp: they take no part) */
  evaded: number[] = [];
  /** monster ids per group as created by {@link CombatWorld.fromEncounter} */
  groupIds: number[] = [];
  /** monster loader for summons (set by {@link CombatWorld.fromEncounter}) */
  io?: EncounterIO;
  casts: CastLog[] = [];
  breaths: { actor: string; type: number; target: string; cost: number }[] = [];
  flee: { actor: string; act: string; ok: boolean }[] = [];
  /** engine side effects (party panel syncs) of every cast */
  castFx: Effect[] = [];
  /** party policy, called once per living member per round */
  partyPolicy?: (w: CombatWorld, i: number) => PartyPlan;
  /** scenario item records (section 1, 74 bytes at 0x380 + id*74): needed by use-item; absent = every item inert */
  itemRec: (id: number) => ItemRec = () => ({ w28: 0, b60: 0, b69: 0 });
  /** item uses and swaps taken, in order */
  actions: { actor: string; act: string; fx: Effect[] }[] = [];

  constructor(party: PartySpec[], groups: MonsterSpec[][], seed: [number, number, number]) {
    this.rng = new W6Rng(seed);
    this.partySize = party.length;
    this.groupSizes = groups.map((g) => g.length);
    const { a4 } = LAYOUT;
    const m = this.mem;
    const w16 = (a: number, v: number) => m.w16(a, v);
    for (let g = 0; g < 6; g++) {
      m.w16(a4 - 15266 + 4 * g, LAYOUT.memBase >> 16); m.w16(a4 - 15264 + 4 * g, (LAYOUT.memBase + g * LAYOUT.memStride) & 0xffff);
      m.w16(a4 - 15294 + 4 * g, LAYOUT.recBase >> 16); m.w16(a4 - 15292 + 4 * g, (LAYOUT.recBase + g * LAYOUT.recStride) & 0xffff);
    }
    w16(a4 - 15306, party.length);
    party.forEach((p, i) => this.buildParty(i, p));
    groups.forEach((g, gi) => g.forEach((mon, i) => this.buildMonster(gi + 1, i, mon)));
    // the party's pseudo record: AC base and resist table stay zero (open: derived elsewhere)
  }

  private mb(g: number) { return LAYOUT.memBase + g * LAYOUT.memStride; }
  private mr(g: number) { return LAYOUT.recBase + g * LAYOUT.recStride; }
  private pr(i: number) { return LAYOUT.a4 - 17922 + i * 0x1b0; }

  private writeBlock(addr: number, w: WeaponSpec) {
    const m = this.mem;
    m.w16(addr, w.base); m.w8(addr + 2, w.n); m.w8(addr + 3, w.sides);
    (w.procs ?? []).forEach((p, k) => m.w8(addr + 4 + k, p));
    m.w8(addr + 14, w.hitBonus ?? 0);
  }

  private buildParty(i: number, p: PartySpec) {
    const m = this.mem; const { a4 } = LAYOUT; const r = this.pr(i); const D = this.mb(0) + i * 44;
    m.w16(D, p.level); m.w16(D + 2, p.hp); m.w16(D + 4, p.hp); m.w16(D + 6, p.stamina); m.w16(D + 8, p.stamina);
    m.w8(D + 0x26, p.ac); m.w8(D + 0x2a, 0xff);
    m.w16(r + 24, p.hp); m.w16(r + 26, p.hp); m.w16(r + 28, p.stamina); m.w16(r + 30, p.stamina);
    m.w16(r + 32, p.weight ?? 0); m.w16(r + 34, p.capacity ?? 300); m.w16(r + 36, p.level);
    for (const [k, v] of Object.entries(p.skills ?? {})) m.w8(r + 308 + Number(k), v);
    m.w8(r + 272, 0xff); m.w8(r + 273, 0xff);
    m.w8(r + 415, p.cls ?? 0); m.w8(r + 307, p.luck ?? 10);
    (p.sp ?? []).forEach(([cur, max], k) => { m.w16(r + 40 + 4 * k, cur); m.w16(r + 42 + 4 * k, max); });
    if (p.weapon) {
      m.w8(r + 272, 0);
      m.w16(r + 64, 1); m.w8(r + 68, 1); m.w8(r + 69, p.weapon.subtype ?? 1);
      m.w8(r + 428, 1);
      this.writeBlock(r + 240, p.weapon);
    }
    void a4;
  }

  private buildMonster(g: number, i: number, s: MonsterSpec) {
    const m = this.mem; const D = this.mb(g) + i * 44; const R = this.mr(g);
    m.w16(D, s.strength); m.w16(D + 2, s.hp); m.w16(D + 4, s.hp); m.w16(D + 6, 50); m.w16(D + 8, 50);
    m.w8(D + 0x2a, 0xff);
    if (i === 0) {
      s.attacks.slice(0, 4).forEach((a, h) => {
        this.writeBlock(R + 0x44 + 16 * h, a.weapon);
        m.w8(R + 0x80 + h, 0); m.w8(R + 0x83 + h, a.kind ?? 0);
      });
      m.w8(R + 0xbe, s.ac); m.w8(R + 212, s.levelClass ?? 2); m.w8(R + 0x86, s.bonus ?? 0);
      for (let k = 0; k < 3; k++) m.w8(R + 0x87 + k, s.power ?? 0);
      m.w32(R + 0x40, s.xp);
      for (let j = 0; j < 8; j++) { m.w8(R + 0xae + j, j === 4 ? 100 : 0); m.w8(R + 0xb6 + j, j === 4 ? 100 : 0); }
      for (const [k, v] of Object.entries(s.resist ?? {})) m.w8(R + 0x94 + Number(k), v);
      { const sl = s.spells ?? []; for (let k = 0; k < 11; k++) m.w8(R + 138 + k, sl.length ? sl[Math.min(k, sl.length - 1)] : 0); }
      m.w8(R + 168, s.spellChance ?? 0); m.w8(R + 170, s.breathChance ?? 0); m.w8(R + 208, s.type ?? 0);
    }
  }

  // --- state readers ---------------------------------------------------
  hp(g: number, i: number): number { return this.mem.s16(this.mb(g) + i * 44 + 2); }
  state(g: number, i: number): number { return this.mem.u8(this.mb(g) + i * 44 + 0x22); }
  alive(g: number, i: number): boolean { return this.state(g, i) < 3 && this.hp(g, i) > 0; }
  living(g: number): number[] {
    const n = g === 0 ? this.partySize : this.groupSizes[g - 1];
    return Array.from({ length: n }, (_, i) => i).filter((i) => this.alive(g, i));
  }
  /** XP pool credited by kills so far (-15300(A4), CODE+0x22c36). */
  get xpPool(): number { return this.mem.u32(LAYOUT.a4 - 15300); }
  skill(i: number, k: number): number { return this.mem.u8(this.pr(i) + 308 + k); }

  /**
   * One attack through the game's resolver (verified). `ag/ai` attack `tg/ti` with weapon `hand` and attack `kind`
   * (0 swing .. 8 shoot). The attacker's member struct records its target, as the game does.
   */
  attack(ag: number, ai: number, tg: number, ti: number, hand: number, kind: number): Effect[] {
    const { a4 } = LAYOUT; const m = this.mem;
    m.w16(a4 - 15138, ag); m.w16(a4 - 15136, ai);
    const A = this.mb(ag) + ai * 44;
    m.w8(A + 0x1f, tg); m.w8(A + 0x20, ti);
    return resolveAttack(m, this.rng, { a4, attacker: A, hand, kind, exec: true, itemCastWord: () => 0 });
  }

  /**
   * One round. HYP, not verified against the game: every living combatant acts once, highest
   * `Random(10) + 1` first (the planner CODE+0x1e21a is only partly read); party members swing at the first
   * living monster; monsters use their first attack on a random living party member.
   */
  round(): void {
    const actors: { g: number; i: number; roll: number }[] = [];
    for (let g = 0; g <= this.groupSizes.length; g++) for (const i of this.living(g)) actors.push({ g, i, roll: this.rng.random(10) + 1 });
    actors.sort((a, b) => b.roll - a.roll || a.g - b.g || a.i - b.i);
    for (const a of actors) {
      if (!this.alive(a.g, a.i)) continue;
      const enemyGroups = a.g === 0 ? this.groupSizes.map((_, k) => k + 1) : [0];
      const cands = enemyGroups.flatMap((g) => this.living(g).map((i) => ({ g, i })));
      if (cands.length === 0) return;
      const t = a.g === 0 ? cands[0] : cands[this.rng.random(cands.length)];
      const before = this.hp(t.g, t.i);
      this.attack(a.g, a.i, t.g, t.i, 0, 0);
      this.log.push({ actor: `${a.g}.${a.i}`, target: `${t.g}.${t.i}`, kind: 0, hpBefore: before, hpAfter: this.hp(t.g, t.i), killed: !this.alive(t.g, t.i) });
    }
  }

  /**
   * Switch the world to the game's own round: write the fields the verified planner (LAB_0C63) reads that the
   * hypothesis round never needed. Monsters: `R+211` initiative bonus, `R+213` attack count, `R+128+h` attack slot
   * valid, `R+83+16h` attack-kind mask (bit 0 = swing). Spell/breath chance bytes stay 0.
   */
  private setupPointers(): void {
    const { a4 } = LAYOUT; const m = this.mem;
    for (let g = 0; g < 7; g++) {
      m.w16(a4 - 15266 + 4 * g, LAYOUT.memBase >> 16); m.w16(a4 - 15264 + 4 * g, (LAYOUT.memBase + g * LAYOUT.memStride) & 0xffff);
      m.w16(a4 - 15294 + 4 * g, LAYOUT.recBase >> 16); m.w16(a4 - 15292 + 4 * g, (LAYOUT.recBase + g * LAYOUT.recStride) & 0xffff);
    }
  }

  /**
   * Build the monster side from the game's own encounter start (LAB_0A31, harness-verified) and the real monster
   * records of scenario.dbs (section 4, 250 x 222 bytes at 0x154e8): group 1 is monster `id`, companion groups follow by
   * the record's own chances. `level` is the dungeon level (-18340), `scripted` the map-event flag (-15100). The party
   * structs come from the party records the constructor wrote. Formation slots and monster pictures are presentation
   * and are not modelled (every member keeps cell 0xff).
   */
  static fromEncounter(party: PartySpec[], id: number, seed: [number, number, number], opts: { scenario: Uint8Array; level: number; scripted?: boolean }): CombatWorld {
    const w = new CombatWorld(party, [], seed);
    const sc = opts.scenario;
    w.itemRec = (iid) => ({ w28: (sc[0x380 + iid * 74 + 28] << 8) | sc[0x380 + iid * 74 + 29], b60: sc[0x380 + iid * 74 + 60], b69: sc[0x380 + iid * 74 + 69] });
    const { a4 } = LAYOUT; const m = w.mem;
    w.setupPointers();
    m.w8(a4 - 15305, party.length);
    m.w16(a4 - 15102, id); m.w16(a4 - 15100, opts.scripted ? 1 : 0); m.w16(a4 - 18340, opts.level);
    const rec = (i: number) => opts.scenario.subarray(0x154e8 + i * 222, 0x154e8 + (i + 1) * 222);
    const ids: number[] = [];
    const io: EncounterIO = {
      loadMonster: (mid, dest) => { ids.push(mid); rec(mid).forEach((b, k) => m.w8(dest + k, b)); },
      formation: () => 0, picture: () => undefined,
    };
    w.io = io;
    startEncounter({ m, rng: w.rng, a4 }, io);
    const ng = m.s16(a4 - 15140);
    w.groupSizes = Array.from({ length: ng }, (_, k) => m.u8(w.mb(k + 1) + 413));
    w.groupIds = ids;
    w.evaded = Array.from({ length: ng }, (_, k) => k + 1).filter((g) => m.u8(w.mb(g) + 412) === 0);
    m.w16(a4 - 18610, 0xd);
    loadSpellTable({ m, rng: w.rng, a4 });
    return w;
  }

  enableGameRound(): void {
    const { a4 } = LAYOUT; const m = this.mem;
    this.setupPointers();
    m.w16(a4 - 15140, this.groupSizes.length);
    m.w8(a4 - 15305, this.partySize);
    m.w8(this.mb(0) + 413, this.partySize);
    this.groupSizes.forEach((n, k) => {
      const g = k + 1; const R = this.mr(g);
      m.w8(this.mb(g) + 413, n);
      const na = Math.max(1, [0, 1, 2, 3].filter((h) => m.u16(R + 0x44 + 16 * h) !== 0 || m.u8(R + 0x44 + 16 * h + 3) !== 0).length);
      m.w8(R + 213, na); m.w8(R + 211, 0);
      for (let h = 0; h < 3; h++) { m.w8(R + 128 + h, h < na ? 1 : 0); m.w8(R + h * 16 + 83, 1); }
      m.w8(R + 128, 1);
    });
    m.w16(a4 - 18610, 0xd);
    loadSpellTable({ m, rng: this.rng, a4 });
  }

  /**
   * One round through the game's own code: the monster planner (LAB_0C96) and order of play / executor
   * (LAB_102D / LAB_0FF9), with attacks executed inline by the verified resolver. The party's plan is a POLICY
   * (the game takes it from the UI): each living member swings its first hand at the first living monster.
   * Spell, breath, hide, run and item actions are not wired here (monsters in this sim never pick them).
   */
  gameRound(): Effect[] {
    const { a4 } = LAYOUT; const m = this.mem; const ctx = { m, rng: this.rng, a4 };
    m.w16(a4 - 18610, 0xd);
    // party plan (policy): the game reads it from the menus; default = swing at the first living monster
    const tgt = this.groupSizes.map((_, k) => k + 1).find((g) => this.living(g).length > 0);
    if (tgt === undefined) return [];
    for (const i of this.living(0)) {
      const A = this.mb(0) + i * 44;
      const plan: PartyPlan = this.partyPolicy ? this.partyPolicy(this, i) : { act: 'attack' };
      const roll = this.rng.random(10) + 1;
      for (let k = 0; k < 4; k++) m.w8(A + 24 + k, k === 0 ? roll : 0);
      m.w8(A + 28, 0); m.w8(A + 29, 0); m.w16(A + 12, 0xffff); m.w8(A + 33, 0); m.w8(A + 36, 0);
      if (plan.act === 'cast') {
        m.w8(A + 30, 3); m.w16(A + 10, plan.power * 256 + plan.spell); m.w8(A + 31, plan.tg); m.w8(A + 32, plan.ti);
      } else if (plan.act === 'useitem') {
        m.w8(A + 30, 4); m.w16(A + 10, plan.slot); m.w8(A + 31, plan.tg ?? 0); m.w8(A + 32, plan.ti ?? i);
      } else if (plan.act === 'swap') {
        m.w8(A + 30, 5); m.w16(A + 10, plan.to); m.w8(A + 31, 0); m.w8(A + 32, i);
      } else if (plan.act === 'run' || plan.act === 'hide') {
        m.w8(A + 30, plan.act === 'run' ? 7 : 6); m.w16(A + 10, 0); m.w8(A + 31, 0); m.w8(A + 32, i);
      } else {
        const g2 = plan.tg ?? tgt; const ti = plan.ti ?? this.living(g2)[0] ?? 0;
        m.w8(A + 30, 0); m.w8(A + 31, g2); m.w8(A + 32, ti); m.w16(A + 10, 0);
      }
    }
    planMonsters(ctx);
    const ret = { cast: 0, breath: 0 };
    return runRound(ctx, ret, (e) => {
      if (e[0] === 'cast') {
        const A = parseInt(e[1], 16);
        const g = m.u16(a4 - 15138), i = m.s16(a4 - 15136);
        const w = m.s16(A + 10);
        ret.cast = castAction(ctx, A, this.castFx, this.io);
        const t = `${m.u8(A + 31)}.${m.u8(A + 32)}`;
        this.casts.push({ actor: `${g}.${i}`, spell: w & 0xff, power: w >> 8, target: t, fizzled: m.s16(a4 - 10482) === 1, backfired: m.s16(a4 - 10484) === 1, cost: ret.cast });
        return;
      }
      if (e[0] === 'breath') {
        const A = parseInt(e[1], 16);
        const g = m.u16(a4 - 15138), i = m.s16(a4 - 15136);
        ret.breath = breath(ctx, A, this.castFx);
        this.breaths.push({ actor: `${g}.${i}`, type: m.s16(A + 10), target: `${m.u8(A + 31)}`, cost: ret.breath });
        return;
      }
      if (e[0] === 'useitem') {
        const A = parseInt(e[1], 16);
        const fx: Effect[] = [];
        useItem(ctx, A, this.itemRec, fx);
        const eng = makeEngines(ctx, this.castFx, this.io);
        for (const f of fx) {
          if (f[0] === 'use_ammo') removeItem(ctx, parseInt(f[1], 16), this.castFx);
          else if (f[0] === 'spell_effect') castEffect(ctx, parseInt(f[1].slice(0, 8), 16), parseInt(f[1].slice(8, 12), 16), parseInt(f[1].slice(12, 16), 16), eng);
        }
        this.actions.push({ actor: `${m.u16(a4 - 15138)}.${m.s16(a4 - 15136)}`, act: 'useitem', fx });
        return;
      }
      if (e[0] === 'swap') {
        const fx: Effect[] = [];
        swapParty(ctx, parseInt(e[1].slice(0, 4), 16), parseInt(e[1].slice(4, 8), 16), fx);
        this.actions.push({ actor: `0.${parseInt(e[1].slice(0, 4), 16)}`, act: 'swap', fx });
        return;
      }
      if (e[0] === 'hide' || e[0] === 'run') {
        const A = parseInt(e[1], 16);
        const ok = (e[0] === 'hide' ? hide : runAway)(ctx, A);
        this.flee.push({ actor: `${m.u16(a4 - 15138)}.${m.s16(a4 - 15136)}`, act: e[0], ok });
        return;
      }
      if (e[0] !== 'attack') return;
      const A = parseInt(e[1].slice(0, 8), 16); const hand = parseInt(e[1].slice(8, 12), 16); const kind = parseInt(e[1].slice(12, 16), 16);
      const g = m.u16(a4 - 15138), i = m.s16(a4 - 15136);
      const t = { g: m.u8(A + 0x1f), i: m.u8(A + 0x20) };
      const before = this.hp(t.g, t.i);
      resolveAttack(m, this.rng, { a4, attacker: A, hand, kind, exec: true, itemCastWord: () => 0 });
      this.log.push({ actor: `${g}.${i}`, target: `${t.g}.${t.i}`, kind, hpBefore: before, hpAfter: this.hp(t.g, t.i), killed: !this.alive(t.g, t.i) });
    });
  }

  /** End-of-fight check LAB_0A03 (CODE+0x17814, harness-verified as postCombat): sorts the party by condition; a flagged-2 member (a successful run) gives game state 0x17, everyone down gives 8. */
  hasFled(): boolean {
    const { a4 } = LAYOUT;
    postCombat({ m: this.mem, rng: this.rng, a4 }, []);
    return this.mem.u16(a4 - 18608) === 0x17;
  }

  /** Fight with {@link gameRound} until one side is gone (the round driver ends combat itself by leaving state 0xd). */
  runGame(maxRounds = 50): { winner: 'party' | 'monsters' | 'fled' | 'none'; rounds: number; xpPool: number; xpEach: number } {
    let r = 0;
    for (; r < maxRounds; r++) {
      if (!this.groupSizes.some((_, k) => this.living(k + 1).length > 0) || this.living(0).length === 0) break;
      this.gameRound();
      if (this.hasFled()) return { winner: 'fled', rounds: r + 1, xpPool: this.xpPool, xpEach: 0 };
    }
    const monstersLeft = this.groupSizes.some((_, k) => this.living(k + 1).length > 0);
    const partyLeft = this.living(0).length;
    const winner = !monstersLeft && partyLeft > 0 ? 'party' : monstersLeft && partyLeft === 0 ? 'monsters' : 'none';
    return { winner, rounds: r, xpPool: this.xpPool, xpEach: winner === 'party' ? Math.trunc(this.xpPool / partyLeft) : 0 };
  }

  run(maxRounds = 50): { winner: 'party' | 'monsters' | 'none'; rounds: number; xpPool: number; xpEach: number } {
    let r = 0;
    for (; r < maxRounds; r++) {
      const monstersLeft = this.groupSizes.some((_, k) => this.living(k + 1).length > 0);
      if (!monstersLeft || this.living(0).length === 0) break;
      this.round();
    }
    const monstersLeft = this.groupSizes.some((_, k) => this.living(k + 1).length > 0);
    const partyLeft = this.living(0).length;
    const winner = !monstersLeft && partyLeft > 0 ? 'party' : monstersLeft && partyLeft === 0 ? 'monsters' : 'none';
    // victory flow (game-rules 2.1, code): every living member earns pool / living, signed 32-bit divide
    const xpEach = winner === 'party' ? Math.trunc(this.xpPool / partyLeft) : 0;
    return { winner, rounds: r, xpPool: this.xpPool, xpEach };
  }
}
