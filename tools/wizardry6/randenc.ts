/**
 * Wizardry 6 (Amiga) random-encounter pick, ported from the game's 68k code and diffed against it under Unicorn
 * (oracle/combat4.py encpick -> oracle/encpick-vectors.json, __tests__/randenc.test.ts).
 *
 *   encounterGroup  LAB_0732 (`Bane` CODE+0x1017a): level -> region group nibble. Roll Random(100) against the level's
 *                   chance byte (table block +1334+level): at or above it picks the second of the level's two group
 *                   nibbles (+1322, 4 bits each, index level*2 + pick).
 *   encounterMonster LAB_072E (CODE+0x1010a): group -> monster id: column Random(100)%4, tier by Random(100)
 *                   (< 74 tier 0, < 92 tier 1, else 2), id = table block byte [group*12 + column*3 + tier].
 *   getField        JT -32478 (LAB_0190, CODE+0x29d6): `width`-bit field `idx` of a little-endian packed bit array.
 *
 * The block is the level-table structure behind -18462(A4); its fields were located earlier (data-structure.md).
 * The step trigger (which cell starts an encounter) is documented in game-rules.md section 10.
 */
import { type Ctx } from './planner.ts';

/** Packed bit-array field read (JT -32478): LE 16-bit window at byte (width*idx)>>3, shifted by (width*idx)&7. */
export function getField(c: Ctx, ptr: number, idx: number, width: number): number {
  const pos = (width * idx) & 0xffff;
  const a = ptr + (pos >>> 3);
  const w = (c.m.u8(a + 1) << 8) | c.m.u8(a);
  return ((w >>> (pos & 7)) & (0xffff >>> (16 - width))) & 0xffff;
}

export function encounterGroup(c: Ctx, level: number): number {
  const base = c.m.u32(c.a4 - 18462);
  const roll = c.rng.random(100);
  const pick = roll >= c.m.u8(base + 1334 + level) ? 1 : 0;
  return getField(c, base + 1322, level * 2 + pick, 4);
}

export function encounterMonster(c: Ctx, group: number): number {
  const base = c.m.u32(c.a4 - 18462);
  const col = c.rng.random(100) % 4;
  const r = c.rng.random(100);
  const tier = r < 74 ? 0 : r < 92 ? 1 : 2;
  return c.m.u8(base + group * 12 + col * 3 + tier);
}
