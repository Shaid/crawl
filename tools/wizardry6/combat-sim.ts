/**
 * Headless Wizardry 6 combat simulator. It composes the harness-verified pieces of combat.ts
 * (attack resolver, weapon on-hit effects, SetStatus and kill cleanup, XP pool) over a synthetic party and
 * monster groups held in the game's own memory layout, and drives them with a round loop.
 *
 * What is verified and what is not (see docs/wizardry6/amiga/game-rules.md section 8):
 *  - verified against the game (harness): every single attack, including its weapon effects, kills and
 *    XP pool credit, on arbitrary states (3,000-vector sweeps, combat.test.ts);
 *  - NOT verified (hyp): the round loop. Order of play, who attacks whom and which action is chosen are
 *    stand-ins documented on each method, because the planner (CODE+0x1e21a), the party menu and the
 *    monster AI are not yet harnessed. Spells are not cast here.
 */
import { Mem, resolveAttack } from './combat.ts';
import type { Effect } from './combat.ts';
import { W6Rng } from './rules.ts';

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
}

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
}

export interface RoundLog { actor: string; target: string; kind: number; hpBefore: number; hpAfter: number; killed: boolean }

export class CombatWorld {
  readonly mem = new Mem({}, true);
  readonly rng: W6Rng;
  readonly partySize: number;
  readonly groupSizes: number[];
  log: RoundLog[] = [];

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
