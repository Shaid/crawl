/**
 * Black Crypt character creation (game-rules 1.3 and 8.9). The party is the four fixed classes (Fighter, Cleric, Magic User, Druid; the record slot is the class index);
 * creation edits each one's name, five stats and portrait. Pure code, no retail data: the templates are the numbers of game-rules section 1.3 (the same ones
 * `combat-sim.startingParty` uses), and the allocation rules are the ones read from bcdfp `+0x1996` (raise) and `+0x1A46` (lower).
 *
 * Grades: stat range [class minimum, 20], pool 25, name <= 12 characters, 9 portraits per class: **code** (game-rules 8.9). Not decoded (**hyp**): whether the real screen
 * demands the pool be fully spent before it accepts the party (we accept leftover points), and which characters the name field allows (we allow printable ASCII).
 */

/** stats in the template (creation screen) order */
export const STAT_NAMES = ['STR', 'INT', 'WIS', 'DEX', 'CON'] as const;
export type Stats = [number, number, number, number, number];
export const CLASS_NAMES = ['FIGHTER', 'CLERIC', 'MAGIC USER', 'DRUID'] as const;

export interface ClassTemplate { name: string; start: Stats; min: Stats; spare: number; portraitBase: number; portraits: number }
export const STAT_MAX = 20, NAME_MAX = 12, SPARE_POINTS = 25;
export const CLASS_TEMPLATES: ClassTemplate[] = [
  { name: 'FIGHTER', start: [14, 8, 6, 12, 10], min: [14, 8, 6, 12, 10], spare: SPARE_POINTS, portraitBase: 0, portraits: 9 },
  { name: 'CLERIC', start: [12, 8, 14, 6, 10], min: [12, 8, 14, 6, 10], spare: SPARE_POINTS, portraitBase: 9, portraits: 9 },
  { name: 'MAGIC USER', start: [8, 14, 6, 12, 10], min: [8, 14, 6, 12, 10], spare: SPARE_POINTS, portraitBase: 18, portraits: 9 },
  { name: 'DRUID', start: [6, 8, 12, 10, 14], min: [6, 8, 12, 10, 14], spare: SPARE_POINTS, portraitBase: 27, portraits: 9 },
];
/** record bytes the template words land in: STR +0x64, INT +0x66, WIS +0x65, DEX +0x68, CON +0x67 */
export const STAT_RECORD_SLOTS = [0x64, 0x66, 0x65, 0x68, 0x67] as const;
/** the spell book page each class opens on (+0x46 copied to +0x47): Fighter 0, Cleric 0, Magic User 5, Druid 10 (code, meaning of the bytes hyp) */
export const CLASS_FIRST_PAGE = [0, 0, 5, 10] as const;

export interface CharDraft { name: string; stats: Stats; /** 0..8 within the class */ portrait: number }

export const defaultDraft = (cls: number): CharDraft => ({ name: CLASS_NAMES[cls], stats: [...CLASS_TEMPLATES[cls].start] as Stats, portrait: 0 });
export const defaultParty = (): CharDraft[] => [0, 1, 2, 3].map(defaultDraft);
export const pointsSpent = (cls: number, stats: Stats) => stats.reduce((n, v, i) => n + (v - CLASS_TEMPLATES[cls].min[i]), 0);
/** absolute portrait index into the 36 portraits (bcdfo) */
export const portraitIndex = (cls: number, d: CharDraft) => CLASS_TEMPLATES[cls].portraitBase + d.portrait;

/** every reason a draft cannot be accepted; empty = valid */
export function checkDraft(cls: number, d: CharDraft): string[] {
  const t = CLASS_TEMPLATES[cls], bad: string[] = [];
  if (!t) return [`no class ${cls}`];
  if (d.name.length < 1) bad.push('name is empty');
  if (d.name.length > NAME_MAX) bad.push(`name is longer than ${NAME_MAX}`);
  if (/[^\x20-\x7e]/.test(d.name)) bad.push('name has non-printable characters');
  STAT_NAMES.forEach((n, i) => {
    const v = d.stats[i];
    if (!Number.isInteger(v)) bad.push(`${n} is not a whole number`);
    else if (v < t.min[i]) bad.push(`${n} ${v} is below the ${t.name} minimum ${t.min[i]}`);
    else if (v > STAT_MAX) bad.push(`${n} ${v} is above ${STAT_MAX}`);
  });
  if (pointsSpent(cls, d.stats) > t.spare) bad.push(`${pointsSpent(cls, d.stats)} points spent, only ${t.spare} to spend`);
  if (!Number.isInteger(d.portrait) || d.portrait < 0 || d.portrait >= t.portraits) bad.push(`portrait ${d.portrait} is not one of the ${t.portraits}`);
  return bad;
}

/** the creation screen's point allocation for one character: raise while below 20 and the pool is above 0, lower while above the class minimum (bcdfp +0x1996 / +0x1A46) */
export class StatPool {
  readonly cls: number; stats: Stats; pool: number;
  constructor(cls: number, stats?: Stats) { this.cls = cls; this.stats = [...(stats ?? CLASS_TEMPLATES[cls].start)] as Stats; this.pool = CLASS_TEMPLATES[cls].spare - pointsSpent(cls, this.stats); }
  raise(i: number): boolean { if (this.stats[i] >= STAT_MAX || this.pool <= 0) return false; this.stats[i]++; this.pool--; return true; }
  lower(i: number): boolean { if (this.stats[i] <= CLASS_TEMPLATES[this.cls].min[i]) return false; this.stats[i]--; this.pool++; return true; }
}
