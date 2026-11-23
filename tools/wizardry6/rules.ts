/**
 * Wizardry 6 (Amiga) game rules ported from the game's own 68k routines.
 * Every function here cites the `Bane` CODE offset it implements and is diffed
 * against the real routine run under Unicorn (tools/wizardry6/oracle/rules.py,
 * vectors in tools/wizardry6/oracle/rules-vectors.json, test rules.test.ts).
 * See docs/wizardry6/amiga/game-rules.md for evidence grades.
 *
 * Original TypeScript; derived from disassembly, not from any other port.
 */

/** 16-bit signed truncating division remainder (68000 DIVS): remainder takes the dividend's sign. */
const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;

/**
 * Three-word generator (CODE+0x1728 state, step CODE+0x21b6 LAB_0148, output CODE+0x2138 LAB_0147,
 * Random(n) wrapper CODE+0xb9c LAB_0063). A Wichmann-Hill style combiner done in 16-bit
 * 68000 arithmetic; the output is the sum of three terms each below ~10000, so it is NOT
 * uniform over its 19-bit range (triangular-ish). Random(n) is raw % n.
 */
export class W6Rng {
  s: [number, number, number];
  constructor(seed: [number, number, number]) {
    this.s = [...seed] as [number, number, number];
  }
  private static readonly P = [
    { q: 177, m: 2, k: 171, mod: 30269 },
    { q: 176, m: 35, k: 172, mod: 30307 },
    { q: 178, m: 63, k: 170, mod: 30323 },
  ];
  /** LAB_0148: advance the three words. */
  step(): void {
    for (let i = 0; i < 3; i++) {
      const { q, m, k, mod } = W6Rng.P[i];
      const x = s16(this.s[i]);
      const quot = Math.trunc(x / q);
      const rem = x % q; // sign of dividend, same as DIVS
      const d2 = s16(quot * m);
      let d0 = s16(k * rem - d2);
      if (d0 < 0) d0 = s16(d0 + mod);
      this.s[i] = d0 & 0xffff;
    }
  }
  /** LAB_0147: raw 19-bit output (after one step). */
  raw(): number {
    this.step();
    const mods = [30269, 30307, 30323];
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      const m = mods[i];
      const w = this.s[i] & 0xffff;
      const rem = w % m; // DIVU: rem in low word after SWAP
      const prod = (rem * 10000) >>> 0; // MULU
      const qq = Math.floor(prod / m) & 0xffff;
      const rr = prod % m;
      let t = (((rr & 0xffff) << 16) | qq) >>> 0; // DIVU result: remainder:quotient
      t &= 0x7ffff;
      acc = i === 0 ? t : (acc + t) & 0x7ffff;
    }
    return acc;
  }
  /** Random(n) (CODE+0xb9c): 0 for n <= 0, else signed-word remainder of the raw output. */
  random(n: number): number {
    const nn = s16(n);
    if (nn <= 0) return 0;
    const r = s16(this.raw());
    return r % nn;
  }
}

/** HP gain per level for each class 0..13: Random(die) + bonus (CODE+0x3db86 jump table at 0x3dc50). */
export const HP_DICE: ReadonlyArray<{ die: number; bonus: number }> = [
  { die: 5, bonus: 6 }, // 0 FIGHTER
  { die: 3, bonus: 2 }, // 1 MAGE
  { die: 4, bonus: 4 }, // 2 PRIEST
  { die: 4, bonus: 3 }, // 3 THIEF
  { die: 5, bonus: 6 }, // 4 RANGER
  { die: 4, bonus: 4 }, // 5 ALCHEMIST
  { die: 3, bonus: 3 }, // 6 BARD
  { die: 3, bonus: 3 }, // 7 PSIONIC
  { die: 5, bonus: 5 }, // 8 VALKYRIE
  { die: 3, bonus: 3 }, // 9 BISHOP
  { die: 5, bonus: 6 }, // 10 LORD
  { die: 5, bonus: 5 }, // 11 SAMURAI
  { die: 4, bonus: 4 }, // 12 MONK
  { die: 5, bonus: 4 }, // 13 NINJA
];

/**
 * LAB_16B3 (CODE+0x3db86): HP and stamina gained on one level-up. Consumes exactly two
 * Random calls, class die first, stamina die (Random(4)) second.
 * `levelAfterIncrement` is the character's level word at the time of the call (LevelUp
 * increments it first). `reroll431` is record byte +431 (the level held before a
 * profession change; while level < it, the gain is the fixed 1/1).
 */
export function levelUpHpStamina(
  rng: W6Rng,
  cls: number,
  str: number,
  vit: number,
  levelAfterIncrement: number,
  reroll431: number,
): { hp: number; stamina: number } {
  const d = HP_DICE[cls];
  let hp = rng.random(d.die) + d.bonus;
  let stamina = rng.random(4) + Math.trunc((str + vit) / 6);
  if (vit < 8) hp -= 1;
  if (vit > 15) hp += 1;
  if (vit > 17) hp += 1;
  if (hp < 1) hp = 1;
  if (levelAfterIncrement < reroll431) {
    hp = 1;
    stamina = 1;
  }
  return { hp, stamina };
}

/**
 * LAB_16EA (CODE+0x3e688): each level-up raises one or more of the first seven attributes
 * (STR INT PIE VIT DEX SPD PER; KARMA, index 7, is never picked) by 1, cap 18. Up to 3
 * Random(7) tries to find an unraised attribute below 18; then Random(2) decides whether to
 * go round again (50%). Mutates `attrs` (8 entries) and returns the indices raised.
 */
export function levelUpAttributes(rng: W6Rng, attrs: number[]): number[] {
  const raised = new Array<number>(8).fill(0);
  const out: number[] = [];
  for (;;) {
    let attempts = 0;
    let idx = 0;
    for (;;) {
      idx = rng.random(7);
      attempts++;
      if (attrs[idx] < 18 && raised[idx] === 0) break;
      if (attempts >= 3) break;
    }
    if (attrs[idx] < 18 && raised[idx] === 0) {
      raised[idx] = 1;
      attrs[idx]++;
      out.push(idx);
    }
    if (rng.random(2) === 0) break;
  }
  return out;
}

/** Character levels at which the spell-realm tier (record +416) steps up (LAB_16F1, CODE+0x3e86e). */
export const SPELL_TIER_LEVELS = [2, 4, 7, 10, 14, 18, 24] as const;
export function spellTierAfterLevel(level: number, current: number): number {
  const n = SPELL_TIER_LEVELS.filter((l) => level >= l).length;
  return current < n ? n : current;
}

/**
 * XP needed to leave `level` (LAB_16FE, CODE+0x3eade): the class's section-0 table indexed by
 * level-1 up to level 15; from level 16 on, table[15] + (level-16) * (table[15]-table[14]).
 * The class table index is the record's class byte (+415) directly.
 */
export function xpToAdvance(table: readonly number[], level: number): number {
  if (level < 16) return table[level - 1];
  return (table[15] + Math.imul(level - 16, table[15] - table[14])) | 0;
}
/** CheckLevelUp (LAB_16FE): number of levels gained: loops while xp >= xpToAdvance(level). */
export function levelsGained(table: readonly number[], level: number, xp: number): number {
  let n = 0;
  while (xp >= xpToAdvance(table, level + n)) n++;
  return n;
}
