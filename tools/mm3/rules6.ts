/**
 * Might & Magic III (Amiga) rules ports, pass 6 (2026-11-26): the party skill check. docs/mm3/amiga/game-rules.md section 20.
 * Method as rules.ts: strict sparse memory seeded only with the bytes the real routine read under Unicorn
 * (tools/mm3/rules_oracle/rules6.py).
 */
import { type Mem, g } from './rules-mem.ts';
import { CHAR0, CHAR_SIZE } from './rules.ts';

/** Skill numbers = the byte index `+0x27+k` of the character record (18 skills). The group rule of the party check, by skill. */
export type SkillRule = 'any' | 'two' | 'all';
export const SKILL_RULE: readonly SkillRule[] = [
  'any', 'any', 'any', 'any', 'any', 'all', 'any', 'any', 'any', 'two', 'two', 'two', 'any', 'any', 'all', 'any', 'any', 'any',
];

/**
 * OV4+0x102B6 `partySkill(k)` (jump-table stub `OV4_2B6`): scans party slots 0..size-1 directly (character index, not the order table); a member whose
 * byte `+0x27+k` is non-zero is counted. `any` skills return 1 at the first such member, `two` skills (9 Mountaineer, 10 Navigator, 11 Path Finder)
 * return 1 when the count reaches exactly 2 (it is tested after each member, so a count of 2 is hit in passing), `all` skills (5 Crusader,
 * 14 Swimmer) when the count equals the party size at that member. A skill number >= 0x12 never succeeds. Returns 0 or 1.
 */
export function partySkill(m: Mem, k: number, o: { allIsAny?: boolean; twoIsAny?: boolean } = {}): number {
  k &= 0xffff;
  const size = m.r8(g(-0x1672));
  let count = 0;
  for (let i = 0; i < size; i++) {
    if (m.r8(g(CHAR0) + CHAR_SIZE * i + 0x27 + ((k << 16) >> 16)) === 0) continue;
    count++;
    if (k >= 0x12) continue;
    const r = o.allIsAny && SKILL_RULE[k] === 'all' ? 'any' : o.twoIsAny && SKILL_RULE[k] === 'two' ? 'any' : SKILL_RULE[k];
    if (r === 'any') return 1;
    if (r === 'two') { if (count === 2) return 1; } else if (count === size) return 1;
  }
  return 0;
}
