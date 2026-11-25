/**
 * Might & Magic II (Amiga) game rules, pass 3: spell dispatch and the effect engine.
 * Ported from the game's 68000 code and diffed against the retail executable under Unicorn
 * (tools/mm2/rules_oracle/rules4.py); see docs/mm2/amiga/game-rules.md section 13. Conventions as in rules.ts.
 */
import { type Mem, g } from './rules-mem.ts';
import { charPtr, monsterSpellDamage, randRange, unpackMonster } from './rules.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
import { spellCombatGate, spellLocationGate } from './rules3.ts';

export type Calls = [string, number[]][];

/**
 * Spell number (0 = Sorcerer 'Awaken' ... 47, Cleric 48..95) -> CODE offset of the handler the dispatchers jump to
 * (CODE+0xCD90 'non-combat' table at CODE+0xCEF6, CODE+0xCFD0 'combat' table at CODE+0xD186, both 16-bit relative jump tables).
 * Each spell is in exactly one of them; null = the dispatcher's default (do nothing).
 */
export const SPELL_HANDLER_NC: (number | null)[] = [0x0c740, 0x0a812, null, null, 0x0a8ca, 0x0a8fa, null, 0x0a91c, null, null, 0x0a974, 0x0aaae, 0x0aadc, 0x0c7a2, null, 0x0abcc, null, null, null, 0x0ad22, null, null, null, 0x0ad7a, null, null, null, null, null, 0x0ada8, 0x0add6, null, null, null, 0x0aeac, null, null, 0x0af02, 0x0affa, null, null, null, null, null, null, null, null, 0x0b050, null, 0x0c740, null, 0x0c7d0, 0x0a8ca, 0x0c7e2, null, 0x0c822, null, 0x0b0ea, null, 0x0c834, null, null, null, 0x0b1be, 0x0c862, null, 0x0b1f2, 0x0b22c, null, 0x0b250, 0x0c8bc, 0x0b26a, 0x0b2b2, null, null, null, null, null, 0x0c916, 0x0b318, 0x0b332, 0x0c96e, null, 0x0b3b2, null, null, null, 0x0c9b6, null, 0x0b3cc, null, 0x0b3e6, null, null, 0x0b492, 0x0b524];
export const SPELL_HANDLER_CB: (number | null)[] = [null, null, 0x0b644, 0x0b684, null, null, 0x0b6cc, null, 0x0b718, 0x0b760, null, null, null, null, 0x0b982, null, 0x0b9c4, 0x0b9ee, 0x0ba30, null, 0x0ba8c, 0x0bacc, 0x0bb0a, null, 0x0bb5c, 0x0bb86, 0x0bbb2, 0x0bbfa, 0x0bc3a, null, null, 0x0bc7a, 0x0bcb8, 0x0bce4, null, 0x0bd34, 0x0bd74, null, null, 0x0bda6, 0x0be02, 0x0be44, 0x0be78, 0x0beba, 0x0bee4, 0x0bf1c, 0x0bf50, null, 0x0bf92, null, 0x0bfc4, null, null, null, 0x0bfee, null, 0x0c12a, null, 0x0c162, null, 0x0c1a8, 0x0c1f4, 0x0c224, null, null, 0x0c26e, null, null, 0x0c2ae, null, null, null, null, 0x0c308, 0x0c332, 0x0c376, 0x0c3ae, 0x0c462, null, null, null, null, 0x0c494, null, 0x0c4da, 0x0c520, 0x0c566, null, 0x0c620, null, 0x0c666, null, 0x0c6ae, 0x0c72a, null, null];

/** CODE+0xCD90 / 0xCFD0: the handler a dispatcher calls for `spell` (word, taken as unsigned like the 68k CMP.L after EXT.L: out of range = none). */
export function dispatchSpell(which: 'nc' | 'cb', spell: number): number | null {
  const s = (((spell & 0xffff) << 16) >> 16) >>> 0; // EXT.L then unsigned compare
  if (which === 'nc') return s < 0x60 ? SPELL_HANDLER_NC[s] : null;
  const k = (s - 2) >>> 0;
  return k < 0x5c ? SPELL_HANDLER_CB[k + 2] : null;
}

/**
 * CODE+0x13708: 1 when `spell` is one of the 12 words at A4-28040 (the spells that are cast through the non-combat handlers
 * even in a fight: the 12 spells whose spells.dat class is 'anywhere').
 */
export function anywhereSpell(m: Mem, spell: number): number {
  let k = 0;
  for (; k < 12; k++) if (m.r16(g(-28040) + 2 * k) === (spell & 0xffff)) break;
  return k === 12 ? 0 : 1;
}

/** CODE+0x1338E dice(sides, bonus): A4-1342 = sum over the caster's level (+0x71) of (rand(1, sides) if sides != 0) + bonus (byte arithmetic, summed in 16 bits). */
export function diceDamage(m: Mem, sides: number, bonus: number): void {
  const ch = m.r32(g(-18380));
  m.w16(g(-1342), 0);
  const level = m.r8(ch + 113);
  for (let i = 0; i < level; i++) {
    let r = sides & 0xff;
    if (r !== 0) r = randRange(m, 1, r) & 0xff;
    m.w16(g(-1342), (m.r16(g(-1342)) + r + (bonus & 0xff)) & 0xffff);
  }
}

/** CODE+0x1333A maximum number of monsters a group spell hits: caster level + 4 below level 7; otherwise 10, plus one when level >= min(monster count, 10). */
export function maxTargets(m: Mem): number {
  let r = 10;
  let mc = m.r8(g(-30654));
  if (mc > 10) mc = 10;
  const level = m.r8(m.r32(g(-18380)) + 113);
  if (level < 7) r = (level + 4) & 0xff;
  else if (level >= mc) r = (r + 1) & 0xff;
  return r;
}

/**
 * CODE+0x13AE2 cast(ch, spellByte): spell number = (spellByte & 0x7f) - 1; combat gate, location gate, then the 'anywhere' set
 * selects the non-combat dispatcher (0xCD90) over the combat one (0xCFD0). Sets A4-18380 = caster, A4-16140 = 1, A4-31209 = 1,
 * A4-1342 = 0, A4-1339 = 0 for the handler and afterwards A4-16140 = A4-31064, A4-31209 = 0.
 */
export function castSpell(m: Mem, ch: number, spellByte: number, o: { noGates?: boolean; swap?: boolean } = {}): Calls {
  const calls: Calls = [];
  const spell = ((spellByte & 0x7f) - 1) & 0xff;
  const rec = g(-11006) + 2 * spell;
  if (!o.noGates) {
    const a = spellCombatGate(m, rec);
    calls.push(...a.calls);
    if (!a.ok) return calls;
    const b = spellLocationGate(m, rec);
    calls.push(...b.calls);
    if (!b.ok) return calls;
  }
  m.w32(g(-18380), ch);
  m.w8(g(-16140), 1);
  m.w8(g(-31209), 1);
  m.w16(g(-1342), 0);
  m.w8(g(-1339), 0);
  calls.push([(anywhereSpell(m, spell) !== 0) !== !!o.swap ? 'dispNC' : 'dispCB', [spell]]);
  m.w8(g(-16140), m.r8(g(-31064)));
  m.w8(g(-31209), 0);
  return calls;
}

/**
 * CODE+0x10894 partyEffect(count, firstSlot, element): applies the pending spell effect to up to `count` monsters starting at
 * `firstSlot`. The effect is in A4-1339 (0 = damage A4-1342, 1 = condition A4-1340, 2 = a monster's lingering effect, treated as
 * damage). For each monster: a magic-resistance roll (rand(caster level, 90) below the record's tier A4-4527), the element
 * immunity flag A4-4522[element-1], and a save (rand(1,191) <= the monster's record index halves damage; for conditions
 * resists below 9, else 50 damage). Damage goes through damage_monster (stub 'dmgMon', which may kill: A4-3852 = 0xFFFF and
 * the slot is revisited); conditions < 7 set a status bit, 7+ kill ('killMon', A4-1310 = 1).
 */
export function partyEffect(m: Mem, args: [number, number, number], kills: number[], o: { noMres?: boolean; noHalve?: boolean } = {}): Calls {
  const calls: Calls = [];
  let count = args[0] & 0xff;
  let slot = args[1] & 0xff;
  const elem = args[2] & 0xff;
  let done = 0;
  let limit = 10;
  const mc0 = m.r8(g(-30654));
  if (count > mc0) count = mc0;
  if (m.r8(g(-1312)) !== 0) limit++;
  if (m.r8(g(-1339)) === 2) m.w8(g(-1339), 0);
  const saveDmg = m.r16(g(-1342));
  const saveMode = m.r8(g(-1339));
  do {
    m.w8(g(-1309), slot);
    let resisted = 0;
    unpackMonster(m, m.r8(g(-1309)));
    if (m.r8(g(-1307)) === 0) {
      if (m.r8(g(-4527)) !== 0) {
        const lvl = m.r8(m.r32(g(-18380)) + 113);
        const d = randRange(m, lvl, 0x5a) & 0xff;
        if (d < m.r8(g(-4527)) && !o.noMres) resisted++;
      }
      if (resisted === 0 && elem !== 0) if (m.r8(g(-4522) + ((elem - 1) & 0xff)) !== 0) resisted = 1;
      if (resisted === 0) {
        const d = randRange(m, 1, 0xbf) & 0xff;
        if (d <= m.r8(g(-4574) + slot)) {
          const mode = m.r8(g(-1339));
          if (mode === 0) {
            if (!o.noHalve) m.w16(g(-1342), m.r16(g(-1342)) >>> 1);
          } else if (mode === 1) {
            if (m.r8(g(-1340)) < 9) resisted++;
            else {
              m.w16(g(-1342), 50);
              m.w8(g(-1339), 0);
            }
          }
        }
      }
    }
    if (resisted === 0 && m.r8(g(-1339)) === 0 && m.r16(g(-1342)) === 0) resisted++;
    if (resisted) {
      /* "is not affected" */
    } else if (m.r8(g(-1339)) === 0) {
      m.w16(g(-3852), m.r16(g(-1342)));
      calls.push(['dmgMon', []]);
      if (kills.shift()) m.w16(g(-3852), 0xffff);
      if (m.r16(g(-3852)) === 0xffff) slot = (slot - 1) & 0xff;
    } else {
      m.w8(g(-1340), (m.r8(g(-1340)) - 1) & 0xff);
      const cond = m.r8(g(-1340));
      if (cond < 7) m.w8(g(-1305) + slot, m.r8(g(-1305) + slot) | m.r8(g(-28462) + cond));
      if (cond >= 7) {
        m.w8(g(-1310), 1);
        calls.push(['killMon', []]);
        m.w8(g(-1310), 0);
        slot = (slot - 1) & 0xff;
      }
      m.w8(g(-1340), (m.r8(g(-1340)) + 1) & 0xff);
    }
    m.w16(g(-1342), saveDmg);
    m.w8(g(-1339), saveMode);
    count = (count - 1) & 0xff;
    slot = (slot + 1) & 0xff;
    if (count === 0) done++;
    if (slot === limit) done++;
    if (slot >= m.r8(g(-30654))) done++;
  } while (done === 0);
  m.w8(g(-1312), 0);
  m.w8(g(-1309), 0);
  return calls;
}

/* ------------------------------------------------ combat spell handlers */

/** Scripted answers for the UI the handlers wait on: key presses (CODE+0x97A2), the character-number prompt (CODE+0x42AA), and whether each damage_monster call kills. */
export interface CastIo {
  keys: number[];
  picks: number[];
  kills: number[];
}
const ESC = 0x1b;
const flag = (m: Mem) => m.w8(g(-31064), 1);

/** CODE+0xD390 'cast on everything' confirm: 1 unless the square forbids area spells (A4-21974 bit 1). The key prompt it has when A4-16140 == 0 is unreachable from the cast command. */
export function confirmAll(m: Mem): number {
  if (m.r8(g(-16140)) === 0) throw new Error('interactive confirm not modelled');
  return m.r8(g(-21974)) & 2 ? 0 : 1;
}

/** CODE+0xD43C pick a monster group: returns 0x1b (cancel) or the group index (0..); a single group is confirmed through confirmAll; the square's antimagic flag (A4-21974 bit 1) turns a pick into a cancel. */
export function pickGroup(m: Mem, io: CastIo, calls: Calls): number {
  m.w8(g(-31064), 0);
  let k: number;
  const n = m.r8(g(-30654));
  if (n === 1) k = confirmAll(m) ? 0x41 : ESC;
  else {
    const lim = (Math.min(n, 10) + 0x40) & 0xff;
    // the prompt string in the CODE hunk is patched with the letter range here (UI only, not modelled)
    for (;;) {
      const raw = io.keys.length ? io.keys.shift()! : ESC;
      calls.push(['key', []]);
      k = raw & 0xff;
      if (k > 0x60 && k <= 0x7a) k -= 0x20;
      if (k === ESC || (k >= 0x41 && k <= lim)) break;
    }
  }
  if (k !== ESC) {
    k = (k - 0x41) & 0xff;
    m.w8(g(-31064), 1);
  }
  if (m.r8(g(-31064)) !== 0 && m.r8(g(-21974)) & 2) k = ESC;
  return k;
}

/** CODE+0xD2EA pick a party member (word): 0x1b cancels; party of one is confirmed through confirmAll. */
export function pickMember(m: Mem, io: CastIo, calls: Calls): number {
  m.w8(g(-31064), 0);
  let k: number;
  if (m.r16(g(-31066)) === 1) k = confirmAll(m) ? 0x31 : ESC;
  else {
    k = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
    calls.push(['pick', [0x31, (m.r16(g(-31066)) + 0x30) & 0xff]]);
  }
  if (k !== ESC) {
    k = (k - 0x31) & 0xffff;
    m.w8(g(-31064), 1);
  }
  if (m.r8(g(-31064)) !== 0 && m.r8(g(-21974)) & 2) k = ESC;
  return k & 0xffff;
}

const eff = (m: Mem, io: CastIo, calls: Calls, a: number, b: number, c: number) => calls.push(...partyEffect(m, [a, b, c], io.kills));
const w16 = (m: Mem, d: number, v: number) => m.w16(g(d), v & 0xffff);
const randSet = (m: Mem, lo: number, hi: number, add: number) => w16(m, -1342, (randRange(m, lo, hi) + add) & 0xffff);

/** one monster-pick spell: [pick] -> prepare(t) -> (optional range check) -> effect */
function monsterSpell(m: Mem, io: CastIo, calls: Calls, early: boolean, check: boolean, run: (t: number) => void): void {
  const t = pickGroup(m, io, calls);
  if (t === ESC) return;
  if (early) flag(m);
  if (check && t < m.r8(g(-1316))) return; // CODE+0xD29C 'cannot' message
  run(t);
  if (!early) flag(m);
}
/** (monster pick) spells that add a group-size count: Sleep, Web, ... */
const cond = (m: Mem, c: number) => {
  m.w8(g(-1340), c);
  m.w8(g(-1339), 1);
};

/** Increment-a-party-flag spells (Bless-like): byte at `d` capped at 0xFF, then the OK message (which sets A4-31064). */
function bumpFlag(m: Mem, d: number): void {
  if (confirmAll(m) === 0) return;
  if (m.r8(g(d)) < 0xff) {
    m.w8(g(d), m.r8(g(d)) + 1);
    flag(m); // CODE+0xD25A
  }
  flag(m);
}

/** the spell numbers `castCombat` implements */
export const CB_SPELLS = [2, 3, 6, 8, 9, 14, 16, 17, 18, 20, 21, 22, 24, 25, 26, 27, 28, 31, 32, 33, 35, 36, 39, 40, 41, 42, 43, 44, 45, 46, 48, 50, 56, 58, 60, 61, 62, 65, 68, 73, 74, 75, 76, 77, 82, 84, 85, 86, 88, 90, 92];

/**
 * The handlers of the combat dispatcher (CODE+0xB644..0xC72A), spell numbers as in spells.dat order. A4-31064 = 1 marks a
 * successful cast. Effects on monsters go through partyEffect(count, firstGroup, element); `dice(s, b)` = diceDamage.
 */
export function castCombat(m: Mem, spell: number, io: CastIo, o: { noRangeCheck?: boolean } = {}): Calls {
  const calls: Calls = [];
  const E = (a: number, b: number, c: number) => eff(m, io, calls, a, b, c);
  const chk = !o.noRangeCheck;
  const all = (run: () => void, early = false) => {
    if (confirmAll(m) === 0) return;
    if (early) flag(m);
    run();
    if (!early) flag(m);
  };
  switch (spell) {
    case 2: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 5, 1); E(1, t, 0); }); break; // Energy Blast
    case 3: monsterSpell(m, io, calls, false, false, (t) => { randSet(m, 1, 5, 3); E(1, t, 1); }); break; // Flame Arrow
    case 6: monsterSpell(m, io, calls, false, false, (t) => { const n = maxTargets(m); cond(m, 4); E(n, t, 5); }); break; // Sleep
    case 8: monsterSpell(m, io, calls, false, false, (t) => { randSet(m, 1, 9, 7); E(1, t, 2); }); break; // Electric Arrow
    case 14: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 5, 3); E(1, t, 4); }); break; // Acid Stream
    case 17: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 5, 1); E(4, t, 2); }); break; // Lightning Bolt
    case 18: monsterSpell(m, io, calls, true, chk, (t) => { const n = maxTargets(m); cond(m, 5); E(n, t, 6); }); break; // Web
    case 20: monsterSpell(m, io, calls, true, false, (t) => { diceDamage(m, 0, 6); E(1, t, 3); }); break; // Cold Beam
    case 21: monsterSpell(m, io, calls, true, false, (t) => { cond(m, 6); E(5, t, 0); }); break; // Feeble Mind
    case 22: monsterSpell(m, io, calls, true, chk, (t) => { diceDamage(m, 5, 1); E(6, t, 1); }); break; // Fire Ball
    case 26: monsterSpell(m, io, calls, true, chk, (t) => { w16(m, -1342, 100); E(1, t, 0); }); break; // Disrupt
    case 27: monsterSpell(m, io, calls, false, false, (t) => { cond(m, 8); E(3, t, 6); }); break; // Fingers of Death
    case 28: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 7, 1); E(10, t, 0); }); break; // Sand Storm
    case 31: monsterSpell(m, io, calls, false, false, (t) => { cond(m, 9); E(3, t, 0); }); break; // Disintegration
    case 33: monsterSpell(m, io, calls, true, chk, (t) => { diceDamage(m, 0, 10); E(3, t, 3); }); break; // Fantastic Freeze
    case 35: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 0, 20); E(1, t, 2); }); break; // Super Shock
    case 40: monsterSpell(m, io, calls, false, false, (t) => { diceDamage(m, 21, 19); E(1, t, 1); }); break; // Incinerate
    case 44: monsterSpell(m, io, calls, false, false, (t) => { w16(m, -1342, 1000); E(1, t, 0); }); break; // Implosion
    case 58: monsterSpell(m, io, calls, false, false, (t) => { randSet(m, 1, 12, 3); E(1, t, 0); }); break;
    case 60: monsterSpell(m, io, calls, false, false, (t) => { const n = maxTargets(m); cond(m, 1); E(n, t, 6); }); break;
    case 62: monsterSpell(m, io, calls, true, chk, (t) => { w16(m, -1342, 25); E(5, t, 3); }); break;
    case 65: monsterSpell(m, io, calls, true, false, (t) => { cond(m, 5); E(5, t, 6); }); break;
    case 68: monsterSpell(m, io, calls, true, chk, (t) => { randSet(m, 1, 49, 11); E(3, t, 4); }); break;
    case 74: monsterSpell(m, io, calls, false, false, (t) => { m.w8(g(-1313), 1); cond(m, 7); E(1, t, 0); }); break;
    case 82: monsterSpell(m, io, calls, false, false, (t) => { m.w8(g(-1313), 2); cond(m, 7); E(1, t, 3); }); break;
    case 84: monsterSpell(m, io, calls, false, false, (t) => { m.w8(g(-1313), 3); cond(m, 7); E(1, t, 4); }); break;
    case 85: monsterSpell(m, io, calls, false, false, (t) => { randSet(m, 255, 400, 0); E(1, t, 1); }); break;
    case 88: monsterSpell(m, io, calls, true, false, (t) => { m.w8(g(-1313), 4); cond(m, 7); E(1, t, 1); }); break;
    case 90: monsterSpell(m, io, calls, true, false, (t) => { w16(m, -1342, m.r16(g(-1338) + 2 * t) >>> 1); E(2, t, 0); }); break; // Mass Distortion
    case 9: { // Identify Monster: shows the record, waits for a key
      const t = pickGroup(m, io, calls);
      if (t === ESC) break;
      unpackMonster(m, t);
      calls.push(['key', []]);
      io.keys.shift();
      flag(m);
      break;
    }
    case 16: bumpFlag(m, -31132); break;
    case 24: bumpFlag(m, -31131); break;
    case 43: bumpFlag(m, -31130); break;
    case 50: bumpFlag(m, -31133); break;
    case 25: case 32: {
      if (confirmAll(m) === 0) break;
      flag(m);
      const bit = spell === 25 ? 8 : 1;
      const d = spell === 25 ? -1315 : -1314;
      if (m.r8(g(-22016)) & bit) break;
      m.w8(g(d), m.r8(g(d)) + 1);
      flag(m);
      break;
    }
    case 36: all(() => { diceDamage(m, 11, 1); E(10, 0, 0); }); break;
    case 39: all(() => { const r = randRange(m, 1, 9) & 0xff; if (r === 7) m.w8(g(-1313), randRange(m, 1, 4)); m.w8(g(-1340), r); m.w8(g(-1339), 1); E(10, 0, 0); }); break; // Prismatic Light
    case 41: all(() => { diceDamage(m, 9, 7); E(10, 0, 2); }); break;
    case 42: all(() => { randSet(m, 1, 21, 24); m.w8(g(-1312), m.r8(g(-1312)) + 1); E(m.r8(g(-30654)), 0, 0); }); break; // Meteor Shower
    case 45: all(() => { diceDamage(m, 16, 4); E(10, 0, 1); }); break;
    case 46: all(() => { randSet(m, 1, 161, 39); m.w8(g(-1312), m.r8(g(-1312)) + 1); E(m.r8(g(-30654)), 0, 0); }); break; // Star Burst
    case 48: all(() => { cond(m, 3); E(10, 0, 6); }); break;
    case 61: all(() => { cond(m, 2); E(10, 0, 0); }); break;
    case 75: all(() => { randSet(m, 1, 33, 7); E(10, 0, 0); }); break;
    case 77: all(() => { cond(m, 5); E(10, 0, 6); }); break;
    case 73: {
      if (confirmAll(m) === 0) break;
      const lvl = m.r8(m.r32(g(-18380)) + 113);
      m.w8(g(-31129), (m.r8(g(-31129)) + (lvl >> 1)) & 0xff);
      flag(m); // CODE+0xD25A
      flag(m);
      break;
    }
    case 56: { // Heroism: +6 levels on the chosen member
      const k = pickMember(m, io, calls);
      if (k === ESC) break;
      flag(m);
      const c = charPtr(m, k);
      m.w8(c + 113, m.r8(c + 113) + 6);
      flag(m);
      break;
    }
    case 76: { // sacrifice: the chosen member's life force becomes damage to everything
      const k = pickMember(m, io, calls);
      if (k === ESC) break;
      flag(m);
      const c = charPtr(m, k);
      if (m.r8(g(-1308)) !== 0) break;
      m.w8(g(-1308), m.r8(g(-1308)) + 1);
      if (m.r8(c + 38) !== 0) break;
      m.w8(c + 38, 0x40);
      if (m.r8(c + 115) === 0) break;
      m.w8(c + 115, m.r8(c + 115) - 1);
      m.w16(c + 94, 0);
      const d = (m.r8(c + 76) + m.r8(c + 77) + 10) & 0xffff;
      w16(m, -1342, d);
      w16(m, -1342, d * 2);
      m.w8(g(-1307), m.r8(g(-1307)) + 1);
      E(10, 0, 0);
      break;
    }
    case 86: { // Moon Ray: damages every monster group, heals every living member
      if (confirmAll(m) === 0) break;
      flag(m);
      randSet(m, 1, 91, 9);
      E(10, 0, 0);
      for (let i = 0; i < s16(m.r16(g(-31066))); i++) {
        const c = charPtr(m, i);
        randSet(m, 1, 91, 9);
        if (m.r8(c + 38) < 0x80) {
          m.w8(c + 38, m.r8(c + 38) & 0x2f);
          m.w16(c + 94, m.r16(c + 94) + m.r16(g(-1342)));
          if (m.r16(c + 94) > m.r16(c + 116)) m.w16(c + 94, m.r16(c + 116));
        }
      }
      break;
    }
    case 92: { // Divine Intervention: once per fight, ages the caster 5 years, clears every condition except 0xFF and refills everyone's HP
      if (confirmAll(m) === 0) break;
      flag(m);
      if (m.r8(g(-1306)) !== 0) break;
      m.w8(g(-1306), m.r8(g(-1306)) + 1);
      const ch = m.r32(g(-18380));
      m.w8(ch + 33, m.r8(ch + 33) + 5);
      if (m.r8(ch + 33) > 200) m.w8(ch + 33, 200);
      for (let i = 0; i < s16(m.r16(g(-31066))); i++) {
        const c = charPtr(m, i);
        if (m.r8(c + 38) !== 0xff) m.w8(c + 38, 0); // an erased member stays erased but is still topped up
        m.w16(c + 94, m.r16(c + 116));
      }
      break;
    }
    default:
      throw new Error('spell ' + spell + ' not modelled');
  }
  return calls;
}

/* ------------------------------------------- non-combat spell handlers */

/** CODE+0xCCE8 confirm: A4-16140 != 0 accepts silently, else the player answers a prompt (CODE+0x42AA, accepted by key 13); the antimagic flag (A4-21974 bit 1) then refuses with the 'fizzle' message. */
export function confirmNc(m: Mem, io: CastIo, calls: Calls, noAntimagic = false): number {
  let ok: number;
  if (m.r8(g(-16140)) !== 0) ok = 1;
  else {
    const k = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
    calls.push(['pick', [13, 13]]);
    if (k === 13) {
      m.w8(g(-31064), 1);
      ok = 1;
    } else {
      m.w8(g(-31064), 0);
      ok = 0;
    }
  }
  if (ok && !noAntimagic && m.r8(g(-21974)) & 2) ok = 0;
  return ok;
}

/** CODE+0xCC18 pick a party member for a non-combat spell; cancelling (0x1b) zeroes the pending SP and gem costs A4-16138 / A4-16136 so the cast is free. */
export function pickMemberNc(m: Mem, io: CastIo, calls: Calls): number {
  m.w8(g(-31064), 0);
  let k: number;
  if (m.r16(g(-31066)) === 1) k = confirmNc(m, io, calls) ? 0x31 : ESC;
  else {
    k = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
    calls.push(['pick', [0x31, (m.r16(g(-31066)) + 0x30) & 0xff]]);
  }
  if (k === ESC) {
    m.w16(g(-16138), 0);
    m.w16(g(-16136), 0);
  } else {
    k = (k - 0x31) & 0xffff;
    m.w8(g(-31064), 1);
  }
  if (m.r8(g(-31064)) !== 0 && m.r8(g(-21974)) & 2) k = ESC;
  return k & 0xffff;
}

/** CODE+0xCA58 heal(amount): the chosen member (not dead/stoned: condition < 0x80) loses condition bits 0xD0, gains `amount` HP up to the maximum (+0x74). */
function healMember(m: Mem, io: CastIo, calls: Calls, amount: number): void {
  const k = pickMemberNc(m, io, calls);
  if (k === ESC) return;
  const c = charPtr(m, k);
  if (m.r8(c + 38) >= 0x80) return; // fizzle message
  m.w8(c + 38, m.r8(c + 38) & 0x2f);
  m.w16(c + 94, m.r16(c + 94) + (amount & 0xffff));
  if (m.r16(c + 94) > m.r16(c + 116)) m.w16(c + 94, m.r16(c + 116));
  if (c === m.r32(g(-18380))) m.w8(g(-31208), 1);
  flag(m); // CODE+0xCADE
}

export const NC_SPELLS = [0, 49, 4, 52, 7, 11, 13, 19, 23, 29, 59, 63, 66, 67, 69, 79, 83, 89, 51, 53, 55, 64, 70, 78, 81];

/** The non-combat dispatcher's handlers (CODE+0xA812..0xC9B6) that only touch party state. CODE+0xCADE ('done') sets A4-31064 = 1. */
export function castNonCombat(m: Mem, spell: number, io: CastIo, o: { noAntimagic?: boolean } = {}): Calls {
  const calls: Calls = [];
  const level = () => m.r8(m.r32(g(-18380)) + 113);
  const ok = () => confirmNc(m, io, calls, o.noAntimagic);
  const buff = (d: number, cap: number, flags: [number, number][]) => {
    if (!ok()) return;
    if (m.r8(g(d)) < cap) m.w8(g(d), m.r8(g(d)) + 1);
    for (const [a, v] of flags) m.w8(g(a), v);
    flag(m);
  };
  const setb = (d: number, v: number | (() => number), flags: [number, number][]) => {
    if (!ok()) return;
    m.w8(g(d), typeof v === 'function' ? v() : v);
    for (const [a, x] of flags) m.w8(g(a), x);
    flag(m);
  };
  const cure = (and: number | null, only?: number) => {
    const k = pickMemberNc(m, io, calls);
    if (k === ESC) return;
    const c = charPtr(m, k);
    const cd = m.r8(c + 38);
    if (only !== undefined) {
      if (cd !== only) return;
      m.w8(c + 38, 0);
      flag(m);
      return;
    }
    if (cd >= 0x80) return;
    if (and === null) m.w8(c + 38, 0);
    else m.w8(c + 38, cd & and);
    if (c === m.r32(g(-18380))) m.w8(g(-31208), 1);
    flag(m);
  };
  switch (spell) {
    case 0: case 49: { // Awaken
      if (!ok()) break;
      for (let i = 0; i < s16(m.r16(g(-31066))); i++) {
        const c = charPtr(m, i);
        const cd = m.r8(c + 38);
        if (cd < 0x80) m.w8(c + 38, cd & 0x6f);
      }
      m.w8(g(-31208), 1);
      flag(m);
      break;
    }
    case 4: case 52: buff(-31147, 0xfe, [[-31204, 1], [-31210, 1]]); break; // Light
    case 7: case 19: { // Eagle Eye, Wizard Eye: a counter above 0xFA is clamped to 0xFF, then +5 per caster level while it is below 0xFA
      if (!ok()) break;
      const d = spell === 7 ? -31136 : -31135;
      let lv = level();
      if (m.r8(g(d)) > 0xfa) m.w8(g(d), 0xff);
      while (lv !== 0) {
        lv = (lv - 1) & 0xff;
        if (m.r8(g(d)) < 0xfa) m.w8(g(d), m.r8(g(d)) + 5);
      }
      m.w8(g(-31210), 1);
      m.w8(g(-31204), 0);
      flag(m);
      break;
    }
    case 11: buff(-31144, 0xff, [[-31210, 1], [-31204, 0]]); break; // Levitate
    case 23: buff(-31142, 0xff, [[-31210, 1], [-31204, 0]]); break; // Guard Dog
    case 29: buff(-31084, 0xff, [[-31210, 1], [-31204, 0]]); break; // Shelter
    case 13: setb(-31146, () => (level() + 10) & 0xff, [[-31210, 1], [-31204, 0]]); break;
    case 59: setb(-31145, () => (level() + 20) & 0xff, [[-31210, 1], [-31204, 0]]); break;
    case 66: { // Lasting Light: +20 to the light counter, 255 when it would overflow
      if (!ok()) break;
      if (m.r8(g(-31147)) > 0xeb) m.w8(g(-31147), 0xff);
      else m.w8(g(-31147), m.r8(g(-31147)) + 0x14);
      m.w8(g(-31204), 1);
      m.w8(g(-31210), 1);
      flag(m);
      break;
    }
    case 63: { // +8 to the caster's byte +0x25 below 0x28
      if (!ok()) break;
      const ch = m.r32(g(-18380));
      if (m.r8(ch + 37) >= 0x28) break;
      m.w8(ch + 37, m.r8(ch + 37) + 8);
      flag(m);
      m.w8(g(-31208), 1);
      break;
    }
    case 67: setb(-31143, 1, [[-31210, 1], [-31204, 0]]); break;
    case 69: setb(-31139, 1, []); break;
    case 79: setb(-31137, 1, []); break;
    case 83: setb(-31140, 1, []); break;
    case 89: setb(-31138, 1, []); break;
    case 51: healMember(m, io, calls, 8); break; // First Aid
    case 55: healMember(m, io, calls, 15); break; // Cure Wounds
    case 53: { // Power Cure: sum of rand(1,10) over the caster's level
      let sum = 0;
      let lv = level();
      while (lv !== 0) {
        lv = (lv - 1) & 0xff;
        sum = (sum + randRange(m, 1, 10)) & 0xffff;
      }
      healMember(m, io, calls, sum);
      break;
    }
    case 64: cure(0x77); break; // Cure Poison
    case 70: cure(0x7b); break; // Cure Disease
    case 78: cure(null); break; // Remove Condition
    case 81: cure(null, 0x82); break; // Stone to Flesh
    default:
      throw new Error('spell ' + spell + ' not modelled');
  }
  return calls;
}

/* ------------------------------------------------ monster spell verbs */

/**
 * CODE+0x1FB4E monster_spell(spell): copies three per-spell bytes (A4-26218/-26186/-26154 [spell], the last minus 0x11) to the
 * message state A4-22064..-22062, then applies the verb. Spells 0-1, 3-8, 0x18 and 0x1F are breaths: damage = the caster's HP,
 * halved when its record index is below 0xB3 (at least 1), to one party member ('spray1'). The others are a jump table over
 * spell 2..30: 2 counts up A4-31141 (max 255); the rest call leaf verbs: `spray1` / `sprayAll` (damage to one / every member,
 * `A4-3852` = damage), `cond(c)` / `cond2(c)` (a condition applied to the party), `v140E`..`v141F` (other effects, not yet derived).
 */
export function monsterSpellVerb(m: Mem, spell: number, o: { noHalve?: boolean } = {}): Calls {
  const calls: Calls = [];
  spell &= 0xff;
  m.w8(g(-22064), m.r8(g(-26218) + spell));
  m.w8(g(-22063), m.r8(g(-26186) + spell));
  m.w8(g(-22062), (m.r8(g(-26154) + spell) - 0x11) & 0xff);
  let breath = 0;
  if (spell < 2) breath++;
  if (spell >= 3 && spell <= 8) breath++;
  if (spell === 0x18 || spell === 0x1f) breath++;
  if (breath) {
    const cur = m.r8(g(-1271));
    m.w16(g(-3852), m.r16(g(-1338) + 2 * cur));
    if (m.r8(g(-4574) + cur) < 0xb3 && !o.noHalve) m.w16(g(-3852), m.r16(g(-3852)) >>> 1);
    if (m.r16(g(-3852)) === 0) m.w16(g(-3852), 1);
    calls.push(['spray1', []]);
    return calls;
  }
  switch (spell) {
    case 2: if (m.r8(g(-31141)) !== 0xff) m.w8(g(-31141), m.r8(g(-31141)) + 1); break;
    case 9: calls.push(['v140E', []]); break;
    case 10: calls.push(['cond', [0x82]]); break;
    case 11: calls.push(['v140F', []]); break;
    case 12: calls.push(['v1412', []]); break;
    case 13: calls.push(['v1416', []]); break;
    case 14: calls.push(['v141B', []]); break;
    case 15: monsterSpellDamage(m, 6); calls.push(['sprayAll', []]); break;
    case 16: calls.push(['cond', [0x10]]); break;
    case 17: case 18: monsterSpellDamage(m, 6); calls.push(['spray1', []]); break;
    case 19: calls.push(['cond2', [0x81]]); break;
    case 20: calls.push(['cond2', [0xff]]); break;
    case 21: monsterSpellDamage(m, 0x28); calls.push(['sprayAll', []]); break;
    case 22: monsterSpellDamage(m, 0xc); calls.push(['spray1', []]); break;
    case 23: monsterSpellDamage(m, 0x32); calls.push(['sprayAll', []]); break;
    case 25: m.w16(g(-3852), 1000); calls.push(['sprayAll', []]); break;
    case 26: monsterSpellDamage(m, 0x14); calls.push(['spray1', []]); break;
    case 27: m.w16(g(-3852), randRange(m, 1, 15) + 1); calls.push(['sprayAll', []]); break;
    case 28: calls.push(['cond', [2]]); break;
    case 29: calls.push(['v141F', []]); break;
    case 30: calls.push(['cond', [0x20]]); break;
    default: break;
  }
  return calls;
}

/* ---------------------------------------------------------- item use */

/** stat byte offsets an item's use power selects with bits 4-6 (CODE+0x13B80 jump table): +0x75, might working copy, speed, accuracy, +0x6A, level, spell level, SP */
export const ITEM_BOOST_STAT = [0x75, 0x6b, 0x6e, 0x6f, 0x6a, 0x71, 0x72, 0x58] as const;

/** CODE+0x13B80 + CODE+0x4552: a non-spell use power adds (the slot's enchant byte + low nibble) to the selected byte of the character, saturating at 255. */
export function itemBoost(m: Mem, ch: number, power: number, slot: number, o: { noEnchant?: boolean } = {}): void {
  let amt = slot < 6 ? m.r8(ch + 0x34 + slot) : m.r8(ch + 0x46 + slot - 6);
  if (o.noEnchant) amt = 0;
  amt = (amt + (power & 0x0f)) & 0xff;
  const p = ch + ITEM_BOOST_STAT[(power >> 4) & 7];
  if (m.r8(p) > 255 - amt) m.w8(p, 0xff);
  else m.w8(p, m.r8(p) + amt);
}

/**
 * CODE+0x137E0 (backpack, ids +0x3A, charges +0x40, flags +0x46) and CODE+0x13896 (equipped, ids +0x28, charges +0x2E, flags +0x34)
 * use an item: no charges -> message 0x10; otherwise one charge is spent and at zero the item vanishes (id 0xFF, flag 0); then
 * the items.dat record's `+0x0F` use power: >= 0x80 casts spell (power & 0x7F) - 1 through the cast command CODE+0x13AE2 (which leaves A4-16140 = A4-31064; no message), below 0x80 is the stat boost above, then message 0x11 and A4-16140 = 1.
 */
export function useItem(m: Mem, kind: 'pack' | 'equip', ch: number, rec: number, slot: number, o: { noCharge?: boolean } = {}): Calls {
  const calls: Calls = [];
  const chg = ch + (kind === 'pack' ? 0x40 : 0x2e) + slot;
  if (m.r8(chg) === 0) {
    calls.push(['msg', [0x10]]);
    return calls;
  }
  if (!o.noCharge) m.w8(chg, m.r8(chg) - 1);
  if (m.r8(chg) === 0) {
    m.w8(ch + (kind === 'pack' ? 0x3a : 0x28) + slot, 0xff);
    m.w8(ch + (kind === 'pack' ? 0x46 : 0x34) + slot, 0);
    if (kind === 'equip') return calls; // quirk: an equipped item's last charge just destroys it, no effect
  }
  const power = m.r8(rec + 15);
  if (power >= 0x80) {
    calls.push(['cast', [ch >>> 16, ch & 0xffff, power]]);
    return calls;
  }
  itemBoost(m, ch, power, kind === 'pack' ? slot + 6 : slot);
  calls.push(['msg', [0x11]]);
  m.w8(g(-16140), 1);
  return calls;
}
