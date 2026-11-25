/**
 * Might & Magic II (Amiga) game rules, pass 4: the overlay hunk (character creation) and world rules.
 * Ported from the overlay's 68000 code (hunk at file 0x28854, 0xF2E longs, SAS/C, position independent) and diffed against the
 * retail executable under Unicorn (tools/mm2/rules_oracle/rules5.py); see docs/mm2/amiga/game-rules.md section 14.
 * Overlay offsets are `OVL+0xNNNN`. Conventions as in rules.ts.
 */
import { type Mem, g } from './rules-mem.ts';
import { randRange } from './rules.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

/** OVL+0x181E: first free slot of the creation screen's 24 x 0x82 B roster (in use = byte +0x0B != 0), 0xFFFF when full. */
export function chargenSlot(m: Mem): number {
  let k = 0;
  for (; k < 24; k++) if (m.r8(g(-10814 + 11) + 130 * k) === 0) break;
  return k === 24 ? 0xffff : k;
}

/**
 * OVL+0x1DF4: which of the 8 classes the 7 rolled stats qualify for (flags[class] = 0/1; bytes compared as SIGNED, short-circuit order matters
 * for the footprint). Stat byte order is the character record's +0x6B.. working order as built by 0x185A: [0]=+0x6B, [1]=+0x6C, [2]=+0x6D, [3]=+0x73, [4]=+0x6E, [5]=+0x6F, [6]=+0x70.
 * class 0: s0 >= 15; 1: s0,s2,s3 >= 13; 2: s1,s5 >= 13; 3: s2 >= 13; 4: s1 >= 13; 5: s6 >= 13; 6: s4,s5 >= 13; 7: s3 >= 15.
 */
export function chargenFlags(m: Mem, st: number, fl: number, o: { unsigned?: boolean } = {}): void {
  const ge = (i: number, t: number) => (o.unsigned ? m.r8(st + i) : s8(m.r8(st + i))) >= t;
  for (let c = 0; c < 8; c++) {
    let v: boolean;
    switch (c) {
      case 0: v = ge(0, 15); break;
      case 1: v = ge(0, 13) && ge(2, 13) && ge(3, 13); break;
      case 2: v = ge(1, 13) && ge(5, 13); break;
      case 3: v = ge(2, 13); break;
      case 4: v = ge(1, 13); break;
      case 5: v = ge(6, 13); break;
      case 6: v = ge(4, 13) && ge(5, 13); break;
      default: v = ge(3, 15);
    }
    m.w8(fl + c, v ? 1 : 0);
  }
}

/**
 * OVL+0x1F84: roll the stats: clear 7 bytes, then three passes over the 7 stats each adding rand(10,79)/10 (low byte, unsigned divide), so every stat
 * is 3..21 (bell shaped); then the eligibility flags (display screen 0x1D42 is a UI call).
 */
export function chargenRoll(m: Mem, st: number, fl: number, o: { passes?: number } = {}): void {
  for (let i = 0; i < 7; i++) m.w8(st + i, 0);
  for (let p = 0; p < (o.passes ?? 3); p++) {
    for (let i = 0; i < 7; i++) {
      const r = randRange(m, 10, 79) & 0xff;
      m.w8(st + i, m.r8(st + i) + Math.floor(r / 10));
    }
  }
  chargenFlags(m, st, fl);
}

const STAT_SLOTS: [number, number][] = [[0x6b, 0x10], [0x6c, 0x11], [0x6d, 0x12], [0x73, 0x27], [0x6e, 0x13], [0x6f, 0x14], [0x70, 0x15]];

/**
 * OVL+0x185A build_character(class, race, alignment, sex, name*, stats*): clear the first free roster record, fill it. Field meaning follows
 * game-rules 5/12 (+0x21 age, +0x25 food, +0x5E HP, +0x60 base max HP, +0x74 max HP, +0x58/+0x5A SP, +0x71 level, +0x72 spell level).
 * Tables (A4 displacements): per-race resist bytes -30626 + 5*i (i<8, stride 5 bytes, indexed by race), class byte -0x777A, class base HP words -0x7772,
 * stat-bonus words -0x7762 (indexed stat-2; shared by HP, SP and starting item), SP words -0x7736, AC-ish byte table -0x770A (indexed stat4-1), starting item table -0x76F4.
 */
export function buildCharacter(m: Mem, cls: number, race: number, align: number, sex: number, nameAt: (k: number) => number, st: number, o: { noMax?: boolean } = {}): void {
  cls &= 0xff; race &= 0xff; align &= 0xff; sex &= 0xff;
  const slot = chargenSlot(m);
  const rec = g(-10814) + 130 * s16(slot);
  // memset(rec, 0, 0x82) (CODE+0x24034)
  for (let k = 0; k < 0x82; k++) m.w8(rec + k, 0);
  for (let k = 0; k < 11; k++) m.w8(rec + k, nameAt(k));
  m.w8(rec + 0x0b, 1);
  m.w8(rec + 0x0c, sex);
  m.w8(rec + 0x0e, race);
  m.w8(rec + 0x0f, cls);
  m.w8(rec + 0x6a, align);
  m.w8(rec + 0x0d, align);
  for (let i = 0; i < 7; i++) {
    m.w8(rec + STAT_SLOTS[i][0], m.r8(st + i));
    m.w8(rec + STAT_SLOTS[i][1], m.r8(st + i));
  }
  m.w8(rec + 0x71, 1);
  m.w8(rec + 0x20, 1);
  for (let i = 0; i < 8; i++) m.w8(rec + 0x16 + i, m.r8(g(-0x77a2 + 5 * i) + race));
  m.w8(rec + 0x1e, m.r8(g(-0x777a) + cls));
  const hp = (m.r16(g(-0x7772) + 2 * cls) + m.r16(g(-0x7762) + 2 * (s8(m.r8(st + 3)) - 2))) & 0xffff;
  m.w16(rec + 0x5e, hp);
  m.w16(rec + 0x74, m.r16(rec + 0x5e));
  m.w16(rec + 0x60, m.r16(rec + 0x5e));
  if (cls === 3 || cls === 4) {
    m.w8(rec + 0x72, 1);
    m.w8(rec + 0x23, 1);
    const sIdx = cls === 3 ? 2 : 1;
    const sp = m.r16(g(-0x7736) + 2 * (s8(m.r8(st + sIdx)) - 2));
    m.w16(rec + 0x58, sp);
    m.w16(rec + 0x5a, m.r16(g(-0x7736) + 2 * (s8(m.r8(st + sIdx)) - 2)));
    m.w8(rec + 0x51, cls === 3 ? 0x5c : 0x3a);
  }
  m.w8(rec + 0x21, 0x12);
  m.w8(rec + 0x24, m.r8(g(-0x770a) + (s8(m.r8(st + 4)) - 1)));
  m.w8(rec + 0x25, 0x0a);
  // UI scratch word A4-31054 (a menu parameter, not a character field): ((rec[0x0B] << 7) * rec[0x25] >> 2) + rec[0x21]
  let x = (m.r8(rec + 0x0b) << 7) & 0xffff;
  x = (s16(m.r8(rec + 0x25) * s16(x))) & 0xffff;
  x = (s16(x) >> 2) & 0xffff;
  x = (x + m.r8(rec + 0x21)) & 0xffff;
  const w = m.r16(g(-0x7762) + 2 * (s8(m.r8(st + 6)) - 2));
  if (w === 0) m.w8(rec + 0x3a, 1);
  else {
    const idx = (((w - 1) << 3) + cls) & 0xffff;
    m.w8(rec + 0x3a, m.r8(g(-0x76f4) + idx));
  }
  m.w8(rec + 0x26, 0);
  m.w16(g(-31054), x);
  void o;
}

export interface MakeScript { keys: number[]; name: number[] }

/**
 * OVL+0x214E the 'create a character of class c' dialogue: if the class qualifies (flags[c]) pick a race ('1'-'5'; ESC aborts), add that race's 7 stat modifiers
 * (table A4-0x7698 + 7*race, byte add), alignment ('1'-'3'), sex ('1'-'2'), name (<= 10 chars, padded with blanks to 10; an empty name aborts). On success the
 * record is built and the stats are rerolled for the next character (the UI scratch word A4-31054 loses 23 per name character, i.e. 230); on any abort
 * after the stats were read the 7 stats are restored from a backup. Key input (CODE+0x42AA) and text entry (CODE+0x3E32) come from `script`.
 */
export function createCharacter(m: Mem, cls: number, st: number, fl: number, script: MakeScript, o: { noRestore?: boolean; noPad?: boolean } = {}): { keysUsed: number } {
  const keys = [...script.keys];
  const backup: number[] = [];
  for (let i = 0; i < 7; i++) backup.push(m.r8(st + i));
  let used = 0;
  const key = () => { used++; return keys.length ? keys.shift()! : 0x1b; };
  let created = false;
  let race = 0, align = 0, sex = 0;
  const name: number[] = new Array(11).fill(0);
  run: {
    if (m.r8(fl + (cls & 0xffff)) === 0) break run;
    const kr = key();
    if (kr === 0x1b) break run;
    race = (kr - 0x31) & 0xff;
    for (let i = 0; i < 7; i++) m.w8(st + i, m.r8(st + i) + m.r8(g(-0x7698) + ((race * 7) & 0xffff) + i));
    const ka = key();
    if (ka === 0x1b) break run;
    align = (ka - 0x31) & 0xff;
    const ks = key();
    if (ks === 0x1b) break run;
    sex = (ks - 0x31) & 0xff;
    const len = script.name.length;
    if (len === 0) break run;
    created = true;
    for (let i = 0; i < len; i++) name[i] = script.name[i];
    if (!o.noPad) for (let i = len; i < 10; i++) name[i] = 0x20;
    name[10] = 0;
  }
  if (created) {
    buildCharacter(m, cls & 0xff, race, align, sex, (k) => name[k], st);
  } else if (!o.noRestore) {
    for (let i = 0; i < 7; i++) m.w8(st + i, backup[i]);
  }
  if (created) {
    chargenRoll(m, st, fl);
    m.w16(g(-31054), m.r16(g(-31054)) - 10 * 0x17);
  }
  return { keysUsed: used };
}

/* ------------------------------------------------------------ overlay file loaders (startup function OVL+0x242) */

export type LoaderKind = 'items' | 'spells' | 'monsters';

/**
 * The three table loaders inside the overlay's startup routine, with the libc layer (CODE+0x2117E read_file(name, buf, offset, len), CODE+0x23E5C alloc) modelled
 * by the caller (`file` = the bytes read, `buf` = the allocation for monsters.dat):
 * - items.dat  OVL+0x6C4: read 0x1400 B (256 records x 20 B) to A4-0x3EFE, then for every record swap the two bytes of the 16-bit word at +0x12 (CODE+0x8192): the file is little-endian there;
 * - spells.dat OVL+0x712: read 0xC0 B (96 x 2) raw to A4-0x2AFE;
 * - monsters.dat OVL+0xD1C: alloc 0x1A00 B (256 x 26), pointer to A4-30658, read the file into it, raw.
 * Everything else in those files is consumed as read (items.ts, spells.ts, monsters.ts).
 */
export function loadTable(m: Mem, kind: LoaderKind, file: number[], buf = 0, o: { noSwap?: boolean } = {}): void {
  const put = (at: number, size: number) => {
    const n = Math.min(file.length, size);
    for (let i = 0; i < n; i++) m.w8(at + i, file[i]);
  };
  if (kind === 'items') {
    const base = g(-0x3efe);
    put(base, 0x1400);
    if (o.noSwap) return;
    for (let k = 0; k < 256; k++) {
      const a = base + 20 * k + 0x12;
      const w = m.r16(a);
      m.w16(a, ((w & 0xff) << 8) | (w >> 8));
    }
  } else if (kind === 'spells') put(g(-0x2afe), 0xc0);
  else {
    m.w32(g(-30658), buf);
    put(buf, 0x1a00);
  }
}

/* ------------------------------------------------------------ doors: unlock (CODE+0x20CA2) and bash (CODE+0x9B48) */

export type DoorCalls = [string, number[]][];
/** scripted answers of the UI / world callees (stubs in the harness) */
export interface DoorScript { pickfx: number; member?: number }

const u8 = (v: number) => v & 0xff;
/** the facing map cell: byte at A4-21946 + (y << 4) + x with y = A4-31216, x = A4-31217 */
const cellAddr = (m: Mem) => g(-21946) + (m.r8(g(-31216)) << 4) + m.r8(g(-31217));
const lsrW = (v: number, count: number) => ((v & 0xffff) >>> (count & 63)) & 0xffff; // LSR.W Dn,Dm: count mod 64, shifts >= 16 give 0
/** CODE+0x5918 message(id): reads the id's string pointer, sets the 'message shown' flag A4-31205 (UI inside is not modelled) */
const message = (m: Mem, id: number) => {
  m.r32(g(-29750) + 4 * s16(id));
  m.w8(g(-31205), 1);
};
/** CODE+0x4B06: the facing cell's door bits are cleared into the second map layer at A4-21690 and the cell mirror A4-21974 */
const openDoor = (m: Mem) => {
  let b = m.r8(cellAddr(m)) & m.r8(g(-21976));
  b >>= 1;
  b ^= m.r8(g(-21974));
  m.w8(g(-21690) + (m.r8(g(-31216)) << 4) + m.r8(g(-31217)), b);
  m.w8(g(-21974), b);
};
const charPtr5 = (m: Mem, slot: number) => g(-10814) + 130 * s16(m.r16(g(-31082) + 2 * s16(slot)));
/** the trap branch shared by both commands: CODE+0x1A9A6 picks the effect (UI + random), 0x1A90E applies it, A4-31056 = 3, redraw */
const trapFx = (m: Mem, s: DoorScript, calls: DoorCalls) => {
  calls.push(['F1A9A6', []]);
  const fx = s.pickfx & 0xff;
  calls.push(['F1A90E', [fx, 0]]);
  m.w8(g(-31056), 3);
  calls.push(['F171AC', []]);
};

/**
 * CODE+0x20CA2 unlock the facing door: only with A4-31202 == 0 and a cell whose door field ((cell & A4-21976) >> A4-21975) is 2 (locked) and whose
 * (mask >> 1) intersects A4-21974; member pick (ESC = 0x1B cancels); the member's skill byte +0x1E (the thief skill the creation table seeds)
 * is the percentage chance: d = rand(1,100); `d < 0x60 && skill >= d` opens the door (0x4B06, message 4). Otherwise the trap roll: d2 = rand(1,100),
 * trap strength A4-22023 (attrib door_trap) `< d2` springs the trap (effect picker, apply, flag A4-31056 = 3), else message 2.
 */
export function unlockDoor(m: Mem, s: DoorScript, o: { lenient?: boolean } = {}): DoorCalls {
  const calls: DoorCalls = [];
  if (m.r8(g(-31202)) !== 0) return calls;
  const b = u8(m.r8(cellAddr(m)) & m.r8(g(-21976)));
  if (lsrW(b, m.r8(g(-21975))) !== 2) return calls;
  if ((lsrW(b, 1) & m.r8(g(-21974))) === 0) { message(m, 3); return calls; }
  const sel = (s.member ?? 0x1b) & 0xffff;
  calls.push(['pickmember', []]);
  if (sel === 0x1b) { calls.push(['F560A', []]); return calls; }
  const d = randRange(m, 1, 100) & 0xff;
  const skill = m.r8(charPtr5(m, sel) + 0x1e);
  if (d < 0x60 && (o.lenient ? skill + 10 >= d : skill >= d)) { openDoor(m); message(m, 4); return calls; }
  const d2 = randRange(m, 1, 100) & 0xff;
  if (m.r8(g(-22023)) < d2) trapFx(m, s, calls);
  else message(m, 2);
  return calls;
}

/**
 * CODE+0x9B48 bash the facing door: A4-31202 != 1, door field ((cell >> A4-21975) & 3) != 0 and (A4-21974 & A4-21976 & 0x55) != 0, else 'nothing to bash'
 * (message 0xF2, one tick). A field other than 2 (a wall/secret door) gives message 1. A locked door (2): strength = Might (+0x6B) of the first two members
 * (byte sum) + q where q = rand(10,109)/10 (q == 5 always breaks it, 'lucky'); the door gives way when that is >= door strength A4-22024. No break: message 2.
 * Broken: rand(1,100) < 0x33 springs the door trap (effect picker, apply, flag, redraw), otherwise the door opens (0x4B06), message 0xF2, one tick.
 */
export function bashDoor(m: Mem, s: DoorScript, o: { noLucky?: boolean } = {}): DoorCalls {
  const calls: DoorCalls = [];
  const v = lsrW(m.r8(cellAddr(m)), m.r8(g(-21975))) & 3;
  if (m.r8(g(-31202)) === 1 || v === 0 || (m.r8(g(-21974)) & m.r8(g(-21976)) & 0x55) === 0) {
    calls.push(['msg036D', [0xf2]]); calls.push(['advance', [1]]);
    return calls;
  }
  if (v !== 2) { message(m, 1); return calls; }
  let sum = m.r8(charPtr5(m, 0) + 0x6b);
  if (s16(m.r16(g(-31066))) > 1) sum = u8(sum + m.r8(charPtr5(m, 1) + 0x6b));
  const q = Math.floor((randRange(m, 10, 0x6d) & 0xff) / 10);
  let broke = 0;
  if (q === 5 && !o.noLucky) broke++;
  else {
    sum = u8(sum + q);
    if (sum >= m.r8(g(-22024))) broke++;
  }
  if (broke === 0) { message(m, 2); return calls; }
  const r = randRange(m, 1, 100) & 0xff;
  if (r >= 0x33) {
    openDoor(m);
    calls.push(['msg036D', [0xf2]]); calls.push(['advance', [1]]);
  } else trapFx(m, s, calls);
  return calls;
}

/* ------------------------------------------------------------ the per-screen attrib record (A4-22042) */

/**
 * CODE+0x923E: the 64-byte attrib.dat record of the current screen (A4-31218, record = screen << 6) is copied to A4-22042 -- from the resident table whose
 * pointer is A4-31222, or (pointer 0) read from the file 'attrib.dat' (`file` = the 64 bytes at that offset). This is how the per-map bytes get into the
 * globals the rules read: A4-22032 = record +0x0A (monster-count limit), -22031 = +0x0B (tier ceiling), -22030 = +0x0C (tier floor), -22029 = +0x0D (run /
 * member-flee chance %), -22025 = +0x11 (bribe threshold), -22024 = +0x12 (door strength), -22023 = +0x13 (door trap).
 */
export function loadAttribRecord(m: Mem, file: number[], o: { noTable?: boolean } = {}): void {
  const dst = g(-22042);
  const off = s16(m.r8(g(-31218)) << 6);
  const tbl = m.r32(g(-31222));
  if (tbl !== 0 && !o.noTable) for (let k = 0; k < 64; k++) m.w8(dst + k, m.r8(tbl + off + k));
  else for (let k = 0; k < Math.min(64, file.length); k++) m.w8(dst + k, file[k]);
}
