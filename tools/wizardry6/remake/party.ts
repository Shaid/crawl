/**
 * Starting party for a new game. The real game builds its party in the character-creation screens (race, class, the bonus-point pool; game-rules 1.2-1.4), and where a
 * new character's starting HP, stamina and skills are written was never found (game-rules 1.4, open). So this is the engine's STAND-IN, graded `stub` in coverage():
 * attributes = race base (1.2) raised to the class minimum (1.3) plus a fixed spread of the bonus pool, HP / stamina from the class table's maximum roll plus a fixed margin, equipment through the verified give-item routine (divvy.ts), the equip copy (item bytes +24..+39 -> record +240) is a hypothesis read off the data
 * (the weapon block layout matches exactly). Writes the game's own 432-byte record layout into memory; no retail value is stored in the repository.
 */
import type { Ctx } from '../planner';
import { giveItem } from '../divvy';
import { HP_DICE } from '../rules';
import type { LootItem } from '../endcombat';
import { A4 } from './image';

export const CLASS_NAMES = ['FIGHTER', 'MAGE', 'PRIEST', 'THIEF', 'RANGER', 'ALCHEMIST', 'BARD', 'PSIONIC', 'VALKYRIE', 'BISHOP', 'LORD', 'SAMURAI', 'MONK', 'NINJA'] as const;
export const RACE_NAMES = ['HUMAN', 'ELF', 'DWARF', 'GNOME', 'HOBBIT', 'FAERIE', 'LIZARDMAN', 'DRACON', 'FELPURR', 'RAWULF', 'MOOK'] as const;
export const ATTR_NAMES = ['STR', 'INT', 'PIE', 'VIT', 'DEX', 'SPD', 'PER', 'KAR'] as const;
const RACE_BASE: number[][] = [
  [9, 8, 8, 9, 9, 8, 8, 0], [7, 10, 10, 7, 9, 9, 8, 0], [11, 6, 10, 12, 7, 7, 7, 0], [10, 7, 13, 10, 8, 6, 6, 0], [8, 7, 6, 9, 10, 7, 13, 0], [5, 11, 6, 6, 10, 14, 12, 0],
  [12, 5, 5, 14, 8, 10, 3, 0], [10, 7, 6, 12, 10, 8, 6, 0], [7, 10, 7, 7, 10, 12, 10, 0], [8, 6, 12, 10, 8, 8, 10, 0], [10, 10, 6, 10, 7, 7, 9, 0]];
const CLASS_MIN: number[][] = [
  [12, 0, 0, 0, 0, 0, 0, 0], [0, 12, 0, 0, 0, 0, 0, 0], [0, 0, 12, 0, 0, 0, 8, 0], [0, 0, 0, 0, 12, 8, 0, 0], [10, 8, 8, 11, 10, 8, 8, 0], [0, 13, 0, 0, 13, 0, 0, 0], [0, 10, 0, 0, 12, 8, 12, 0],
  [10, 14, 0, 14, 0, 0, 10, 0], [10, 0, 11, 11, 10, 11, 8, 0], [0, 15, 15, 0, 0, 0, 8, 0], [12, 9, 12, 12, 9, 9, 14, 0], [12, 11, 0, 9, 12, 14, 8, 0], [13, 8, 13, 0, 10, 13, 8, 0], [12, 10, 10, 12, 12, 12, 0, 0]];

export interface CharTemplate {
  name: string; cls: number; race: number; gender: 0 | 1;
  /** item ids carried; the first is wielded when it is a melee weapon (category 0) */
  items: number[];
  /** spell ids known (record +392 bit set) */
  spells?: number[];
  /** spell-point pools [cur, max] per realm 0..5 */
  sp?: number[];
}
/** item ids are scenario section-1 indices (the same ids the game's loot tables use) */
export const STARTER_PARTY: CharTemplate[] = [
  { name: 'ROLAND', cls: 0, race: 2, gender: 0, items: [3, 120, 121] },
  { name: 'ELDRIC', cls: 10, race: 0, gender: 0, items: [8, 120, 121] },
  { name: 'MORGAINE', cls: 1, race: 1, gender: 1, items: [1, 122, 123], spells: [0, 1, 2, 9, 10], sp: [6, 6, 4, 4, 0, 0] },
  { name: 'BRIDGET', cls: 2, race: 3, gender: 1, items: [2, 122, 123], spells: [20, 21, 22], sp: [0, 0, 0, 0, 6, 6] },
  { name: 'SILK', cls: 3, race: 4, gender: 0, items: [1, 120, 121] },
  { name: 'FINN', cls: 4, race: 8, gender: 0, items: [3, 120, 121] },
];

export function characterAttrs(race: number, cls: number, gender: number): number[] {
  const a = RACE_BASE[race].slice();
  if (gender === 1) { a[0] -= 2; a[6] += 1; a[7] += 1; }
  for (let k = 0; k < 8; k++) if (a[k] < CLASS_MIN[cls][k]) a[k] = CLASS_MIN[cls][k];
  // a fixed share of the bonus pool: the class's two best attributes
  const order = [0, 1, 2, 3, 4, 5, 6].sort((x, y) => CLASS_MIN[cls][y] - CLASS_MIN[cls][x] || x - y);
  for (let p = 0, k = 0; p < 7; p++, k = (k + 1) % 3) a[order[k]] = Math.min(18, a[order[k]] + 1);
  return a;
}

const P = (i: number): number => A4 - 17922 + i * 0x1b0;

/** write character `i`; `item` reads a scenario item record (for the equip copy) */
export function writeCharacter(c: Ctx, i: number, t: CharTemplate, itemRec: (id: number) => Uint8Array, lootItem: (id: number) => LootItem): void {
  const m = c.m;
  const r = P(i);
  for (let k = 0; k < 432; k++) m.w8(r + k, 0);
  for (let k = 0; k < t.name.length && k < 9; k++) { m.w8(r + k, t.name.charCodeAt(k)); m.w8(r + 98 + k, t.name.charCodeAt(k)); }
  const attrs = characterAttrs(t.race, t.cls, t.gender);
  attrs.forEach((v, k) => m.w8(r + 300 + k, v));
  const d = HP_DICE[t.cls];
  const str = attrs[0], vit = attrs[3];
  let hp = d.bonus + d.die + 8; if (vit < 8) hp--; if (vit > 15) hp++; if (vit > 17) hp++;
  const stam = 40 + Math.trunc((str + vit) / 6);
  m.w16(r + 24, hp); m.w16(r + 26, hp); m.w16(r + 28, stam); m.w16(r + 30, stam);
  m.w16(r + 36, 1); m.w32(r + 12, 0); m.w32(r + 20, 100);
  m.w16(r + 34, 100 + str * 10);
  m.w8(r + 413, t.race); m.w8(r + 414, t.gender); m.w8(r + 415, t.cls); m.w8(r + 412, i);
  m.w8(r + 272, 0xff); m.w8(r + 273, 0xff);
  m.w8(r + 307, 8);                                  // luck stays a fixed 8 (KAR is not rolled)
  // skills: the weapon skills and the ones the verified rules read, set to a fixed beginner level
  for (let k = 0; k < 30; k++) m.w8(r + 308 + k, 10);
  if ([0, 4, 8, 10, 11, 12, 13].includes(t.cls)) { m.w8(r + 308 + 1, 40); m.w8(r + 308 + 9, 30); }
  (t.sp ?? []).forEach((v, k) => { m.w16(r + 40 + 4 * k, v); m.w16(r + 42 + 4 * k, v); m.w8(r + 284 + k, 3); });
  for (const s of t.spells ?? []) m.w8(r + 392 + (s >> 3), m.u8(r + 392 + (s >> 3)) | (1 << (s & 7)));
  m.w8(r + 416, 0);
  m.w8(r + 422, 1); m.w8(r + 423, 5);                // camp hit-point die and stamina regeneration percent (read by the verified rest)
  // equipment through the game's own give-item (a one-entry found-item list), then the equip copy
  for (const id of t.items) {
    m.w16(A4 - 5446, id); m.w16(A4 - 8674, 1);
    giveItem(c, i, 0, lootItem);
  }
  const first = t.items[0];
  if (first !== undefined) {
    const rec = itemRec(first);
    if (rec[60] === 0) { for (let k = 0; k < 16; k++) m.w8(r + 240 + k, rec[24 + k]); m.w8(r + 272, 0); }
  }
  m.w8(r + 417, 0);
}
