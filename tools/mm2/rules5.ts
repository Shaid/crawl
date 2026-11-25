/**
 * Might & Magic II (Amiga) game rules, pass 4: the overlay hunk (character creation) and world rules.
 * Ported from the overlay's 68000 code (hunk at file 0x28854, 0xF2E longs, SAS/C, position independent) and diffed against the
 * retail executable under Unicorn (tools/mm2/rules_oracle/rules5.py); see docs/mm2/amiga/game-rules.md section 14.
 * Overlay offsets are `OVL+0xNNNN`. Conventions as in rules.ts.
 */
import { type Mem, g } from './rules-mem.ts';
import { charPtr, randRange } from './rules.ts';
import { type CastIo, type Calls, confirmNc, pickMemberNc } from './rules4.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

/** OVL+0x181E: first free slot of the creation screen's 24 x 0x82 B roster (in use = byte +0x0B != 0), 0xFFFF when full. */
export function chargenSlot(m: Mem, o: { n23?: boolean } = {}): number {
  let k = 0;
  for (; k < (o.n23 ? 23 : 24); k++) if (m.r8(g(-10814 + 11) + 130 * k) === 0) break;
  return k === (o.n23 ? 23 : 24) ? 0xffff : k;
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

/* ------------------------------------------------------------ paying for a cast */

/**
 * CODE+0x6DC6: after a spell resolves the caster (pointer A4-18380) pays: gems (+0x5C, 16 bit, may wrap) lose A4-16136 unconditionally; spell points (+0x58) lose
 * A4-16138 only when `SP >= cost` (unsigned); both cost words are cleared; unless A4-31210 is set the 'redraw' flag A4-31208 becomes 1.
 * (The costs are computed before the cast by CODE+0x4BEC / 0x7960 / 0x79A0, section 12.4; the gate for gems is `gems >= cost`, so the unconditional gem charge never wraps in play.)
 */
export function chargeCast(m: Mem, o: { sameGate?: boolean } = {}): void {
  const ch = m.r32(g(-18380));
  m.w16(ch + 0x5c, m.r16(ch + 0x5c) - m.r16(g(-16136)));
  const sp = m.r16(ch + 0x58);
  if (sp >= m.r16(g(-16138)) || o.sameGate) m.w16(ch + 0x58, m.r16(ch + 0x58) - m.r16(g(-16138)));
  m.w16(g(-16138), 0);
  m.w16(g(-16136), 0);
  if (m.r8(g(-31210)) === 0) m.w8(g(-31208), 1);
}

/* ------------------------------------------------------------ shop prices */

/**
 * CODE+0x1BF16 item price of shop slot `slot` (0-5; A4-23052[slot] = stocked, A4-23070[slot] & 0x3F = enchant/plus count, A4-23046[slot] = item record pointer,
 * A4-23102 = the buyer, A4-23248 = shop mode). Returns the price in gold (32 bit):
 * - not stocked: 0. Mode 6 (flat list): 10 when the plus count is 0, else count * 100.
 * - otherwise base = items.dat gold word (+0x12); a non-zero plus count first doubles it (and spends one count), every further count adds 1000.
 * - the buyer 'matches' when CODE+0x45C4 finds `10` in the low or high nibble of its byte +0x50 (matches = number of nibbles equal to 10, 0..2).
 *   Mode 5 (selling to the shop): price / 2, and halved again when the buyer does NOT match. Any other mode: halved when the buyer matches.
 */
export function shopPrice(m: Mem, slot: number, o: { noMatchHalf?: boolean } = {}): number {
  const s = s16(slot);
  if (m.r8(g(-23052) + s) === 0) return 0;
  let n = m.r8(g(-23070) + s) & 0x3f;
  const mode = s16(m.r16(g(-23248)));
  let price: number;
  if (mode === 6) return n === 0 ? 10 : (n * 100) >>> 0;
  price = m.r16(m.r32(g(-23046) + 4 * s) + 18);
  if (n !== 0) { price = (price * 2) >>> 0; n--; }
  while (n !== 0) { price = (price + 1000) >>> 0; n--; }
  const b = m.r32(g(-23102));
  const nib = m.r8(b + 0x50);
  const matches = ((nib & 0xf) === 10 ? 1 : 0) + ((nib >> 4) === 10 ? 1 : 0);
  const half = (v: number) => Math.trunc(v / 2) >>> 0;
  if (mode === 5) {
    price = half(price);
    if (matches === 0 && !o.noMatchHalf) price = half(price);
  } else if (matches !== 0) price = half(price);
  return price;
}

/**
 * CODE+0x1BE44 buy shop slot `slot`: the buyer is A4-23102. Refused (message 8) when its condition byte +0x26 is set; the first free pack slot is the first of the six bytes at
 * +0x3A that is 0 (none: message 2); the price is the displayed price table entry A4-23094[slot] (a long filled by CODE+0x1BF16 whenever the shop is drawn -- so a price is
 * paid as shown, not recomputed) and CODE+0x1BDD6 pays it only when the buyer's gold (long, +0x66) is `>=` it (else message 4); on success the stock byte A4-23052[slot] (item id),
 * A4-23064[slot] (charges) and A4-23070[slot] (flags, incl. the plus count) are copied to pack slot k's id (+0x3A), charges (+0x40) and flags (+0x46), message 0.
 * The messages go through the stubbed CODE+0x1C432.
 */
export function buyItem(m: Mem, slot: number, o: { noPay?: boolean } = {}): number[] {
  const msgs: number[] = [];
  const buyer = m.r32(g(-23102));
  if (m.r8(buyer + 0x26) !== 0) return [8];
  let k = 0;
  for (;;) {
    if (m.r8(m.r32(g(-23102)) + 0x3a + k) === 0) break;
    k++;
    if (k >= 6) break;
  }
  if (k === 6) return [2];
  const price = m.r32(g(-23094) + 4 * s16(slot));
  const who = m.r32(g(-23102));
  const gold = m.r32(who + 0x66);
  if (gold < price) return [4];
  if (!o.noPay) m.w32(who + 0x66, gold - price);
  const b2 = m.r32(g(-23102));
  m.w8(b2 + 0x3a + k, m.r8(g(-23052) + s16(slot)));
  m.w8(b2 + 0x40 + k, m.r8(g(-23064) + s16(slot)));
  m.w8(b2 + 0x46 + k, m.r8(g(-23070) + s16(slot)));
  msgs.push(0);
  return msgs;
}

/* ------------------------------------------------------------ the remaining non-combat spell handlers (13.4 OPEN rows) */

const ESC = 0x1b;
const done = (m: Mem) => m.w8(g(-31064), 1); // CODE+0xCADE 'spell done' (the UI text is not modelled)
export const NC_SPELLS2 = [71, 72, 80, 91, 94, 95, 34, 37, 47, 38, 1, 5, 10, 12, 15, 30, 57, 87];

/**
 * CODE+0xB56E item picker used by Recharge / Duplication / Enchant / Uncurse: keys 'A'..'F' (case folded by CODE+0x2408E) pick one of the six pack slots of the caster
 * (A4-18380, ids at +0x3A); only a slot holding an item is accepted, other keys are ignored and the prompt repeats; ESC cancels (returns 0x1B and zeroes the SP/gem costs
 * A4-16138/-16136). A pick sets the 'done' flag A4-31064 (for the cast command) and returns the slot 0..5. On an anti-magic square (A4-21974 bit 1) it returns ESC anyway.
 */
export function pickItemSlot(m: Mem, keys: number[]): number {
  let k: number;
  for (;;) {
    const raw = keys.length ? keys.shift()! : ESC;
    const b = raw & 0xff;
    k = b > 0x60 && b <= 0x7a ? b - 0x20 : b;
    if (k === ESC) break;
    if (k >= 0x41 && k <= 0x46 && m.r8(m.r32(g(-18380)) + (k - 0x41) + 0x3a) !== 0) break;
  }
  if (k !== ESC) {
    k -= 0x41;
    m.w8(g(-31064), 1);
  } else {
    m.w16(g(-16138), 0);
    m.w16(g(-16136), 0);
  }
  if (m.r8(g(-21974)) & 2) k = ESC;
  return k;
}

/**
 * The ten handlers (spell numbers as in 13.4):
 * 71 Restore Alignment (0xB26A): the picked member's alignment byte +0x6A := its base +0x0D.
 * 72 Surface (0xB2B2): confirm; fails when A4-22016 bit 6 is set or the recall coordinate A4-22020 (attrib +0x16) is 0; else x = A4-22020 & 15, y = A4-22020 >> 4, screen = A4-22018 (attrib +0x18), reload flags A4-31204 = A4-31210 = 1.
 * 80 Rejuvenate (0xB332): picked member; r1 = rand(1,10), r2 = rand(1,100): when r2 < 50 and age (+0x21) >= 18 the age drops by r1 (byte), otherwise it rises by r1 (cap 200, CODE+0x4C60) and the spell fails.
 * 91 Town Portal (0xB3E6): confirm, not in a no-teleport square (A4-22016 bit 6), key '1'-'5' = town screen: A4-31218 = key - 0x31, position (0xFF, 0xFF), reload flags.
 * 94 Resurrection (0xB492): picked member must be dead (+0x26 >= 0x80); the caster ages 1 year and the target 5; the target's Endurance (+0x27) must be > 0 and drops by one (into +0x73 as well); condition cleared.
 * 95 Uncurse Item (0xB524): item picker; an item whose flag byte (+0x40+slot) is 0xFF is not uncursable, otherwise it becomes 1.
 * 34 Recharge Item (0xAEAC): item picker; the slot's charge byte (+0x40) must be non-zero; it gains rand(1,6) (byte).
 * 37 Duplication (0xAF02): item picker; the item id must be < 0xD0, there must be a free pack slot (first zero id byte); id, charges and flags are copied there; on success A4-31208 = 1.
 * 47 Enchant Item (0xB050): item picker; flag byte (+0x46+slot): plus count = low 6 bits, high bits kept; SP cost = 50 * count -> A4-16138 (the cast command charges it) and the caster needs `SP >= cost`; the count rises by one.
 * 38 Etherealize (0xAFFA): confirm; fails when A4-22016 bit 5 is set; else the party steps one square in its facing (A4-31153 'E' x+1, 'N' y+1, 'S' y-1, 'W' x-1; both coordinates & 15).
 */
export function castNonCombat2(m: Mem, spell: number, io: CastIo & { ikeys: number[] }, o: { noAge?: boolean; noEndurance?: boolean; mut?: string } = {}): Calls {
  const calls: Calls = [];
  const mut = o.mut;
  const caster = () => m.r32(g(-18380));
  const ok = () => confirmNc(m, io, calls);
  const ageAdd = (c: number, n: number) => {
    m.w8(c + 0x21, m.r8(c + 0x21) + n);
    if (m.r8(c + 0x21) > 0xc8) m.w8(c + 0x21, 0xc8);
  };
  switch (spell) {
    case 71: {
      const k = pickMemberNc(m, io, calls);
      if (k === ESC) break;
      const c = charPtr(m, k);
      m.w8(c + 0x6a, mut === 'v71' ? m.r8(c + 0x6a) ^ 1 : m.r8(c + 0x0d));
      done(m);
      if (m.r32(g(-18380)) === c) m.w8(g(-31208), 1);
      break;
    }
    case 72: {
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & 0x40) fail++;
      else if (m.r8(g(-22020)) === 0 && mut !== 'v72') fail++;
      else {
        m.w8(g(-31217), m.r8(g(-22020)) & 0xf);
        m.w8(g(-31216), m.r8(g(-22020)) >> 4);
        m.w8(g(-31218), m.r8(g(-22018)));
        m.w8(g(-31204), 1);
        m.w8(g(-31210), 1);
      }
      if (!fail) done(m);
      break;
    }
    case 80: {
      const k = pickMemberNc(m, io, calls);
      if (k === ESC) break;
      const c = charPtr(m, k);
      const r1 = randRange(m, 1, 10) & 0xff;
      const r2 = randRange(m, 1, 100) << 16 >> 16;
      if (r2 < 50 && m.r8(c + 0x21) >= 0x12 && !o.noAge) {
        m.w8(c + 0x21, m.r8(c + 0x21) - r1);
        done(m);
      } else ageAdd(c, r1);
      break;
    }
    case 91: {
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & 0x40 && mut !== 'v91') fail++;
      else {
        const p = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
        calls.push(['pick', [0x31, 0x35]]);
        if (p === ESC) fail++;
        else {
          m.w8(g(-31218), p - 0x31);
          m.w8(g(-31216), 0xff);
          m.w8(g(-31217), 0xff);
          m.w8(g(-31204), 1);
          m.w8(g(-31210), 1);
        }
      }
      if (!fail) done(m);
      break;
    }
    case 94: {
      const k = pickMemberNc(m, io, calls);
      if (k === ESC) break;
      const c = charPtr(m, k);
      if (m.r8(c + 0x26) < 0x80) break;
      ageAdd(caster(), 1);
      ageAdd(c, 5);
      let en = m.r8(c + 0x27);
      if (en === 0 && !o.noEndurance) break;
      en = (en - 1) & 0xff;
      m.w8(c + 0x73, en);
      m.w8(c + 0x27, en);
      m.w8(c + 0x26, 0);
      done(m);
      break;
    }
    case 95: {
      const k = pickItemSlot(m, io.ikeys);
      if (k === ESC) break;
      const c = caster() + k;
      if (m.r8(c + 0x40) === 0xff && mut !== 'v95') break;
      m.w8(c + 0x40, 1);
      done(m);
      break;
    }
    case 34: {
      const k = pickItemSlot(m, io.ikeys);
      if (k === ESC) break;
      const c = caster() + k;
      if (m.r8(c + 0x40) === 0 && mut !== 'v34') break;
      m.w8(c + 0x40, m.r8(c + 0x40) + (randRange(m, 1, 6) & 0xff));
      done(m);
      break;
    }
    case 37: {
      const k = pickItemSlot(m, io.ikeys);
      let fail = 0;
      if (k !== ESC) {
        const base = caster();
        if (m.r8(base + k + 0x3a) === 0) fail++;
        else {
          let j = 0;
          for (;;) {
            if (m.r8(caster() + j + 0x3a) === 0) break;
            j++;
            if (j >= 6) break;
          }
          if (j === 6) fail++;
          else {
            const id = m.r8(caster() + k + 0x3a);
            if (id >= 0xd0 && mut !== 'v37') fail++;
            else {
              m.w8(caster() + j + 0x3a, id);
              m.w8(caster() + j + 0x40, m.r8(caster() + k + 0x40));
              m.w8(caster() + j + 0x46, m.r8(caster() + k + 0x46));
            }
          }
        }
      }
      if (!fail && k !== ESC) { done(m); m.w8(g(-31208), 1); }
      break;
    }
    case 47: {
      const k = pickItemSlot(m, io.ikeys);
      if (k === ESC) break;
      const c = caster() + k;
      const hi = m.r8(c + 0x46) & 0xc0;
      let lo = m.r8(c + 0x46) & 0x3f;
      const cost = (lo * (mut === 'v47' ? 25 : 50)) & 0xffff;
      m.w16(g(-16138), cost);
      if (m.r16(caster() + 0x58) < cost) break;
      if (lo <= 0x3f) lo++;
      lo = (lo | hi) & 0xff;
      m.w8(c + 0x46, lo);
      done(m);
      break;
    }
    case 38: {
      if (!ok()) break;
      if (m.r8(g(-22016)) & 0x20 && mut !== 'v38') break;
      const d = m.r8(g(-31153));
      let dx = 0, dy = 0;
      if (d === 0x45) dx = 1;
      else if (d === 0x4e) dy = 1;
      else if (d === 0x53) dy = 0xff;
      else if (d === 0x57) dx = 0xff;
      m.w8(g(-31217), (m.r8(g(-31217)) + dx) & 0xf);
      m.w8(g(-31216), (m.r8(g(-31216)) + dy) & 0xf);
      m.w8(g(-31210), 1);
      m.w8(g(-31204), 0);
      done(m);
      break;
    }
    case 1: { // Detect Magic: confirm, show the pack charges, wait for any key (0 = no key yet), done
      if (!ok() && mut !== 'v1') break;
      for (;;) {
        const k = io.ikeys.length ? io.ikeys.shift()! : ESC;
        if ((k & 0xffff) !== 0) break;
      }
      done(m);
      break;
    }
    case 5: // Location: confirm, show the position screen (CODE+0x223A, UI), reload flags; no 'done' flag
      if (!ok()) break;
      m.w8(g(-31210), 1);
      m.w8(g(-31204), mut === 'v5' ? 1 : 0);
      break;
    case 10: { // Jump: two squares forward over a wall-less step: cell and target must be open
      if (!ok()) break;
      let fail = 0;
      const mask = () => m.r8(g(-21976));
      const idx = (y: number, x: number) => (y << 4) + x;
      if (m.r8(g(-31202)) === 1) fail++;
      else if ((m.r8(g(-21946) + idx(m.r8(g(-31216)), m.r8(g(-31217)))) & mask()) !== 0) fail++;
      else if ((m.r8(g(-21974)) & mask() & 0x55) !== 0) fail++;
      let x1 = 0, y1 = 0, dx = 0, dy = 0;
      if (!fail) {
        [dx, dy] = dirVec(m);
        x1 = (m.r8(g(-31217)) + dx) & 0xf;
        y1 = (m.r8(g(-31216)) + dy) & 0xf;
        if ((m.r8(g(-21946) + idx(y1, x1)) & mask()) !== 0 && mut !== 'v10') fail++;
        else if ((m.r8(g(-21690) + idx(y1, x1)) & mask() & 0x55) !== 0) fail++;
      }
      if (!fail) {
        m.w8(g(-31204), 1);
        m.w8(g(-31210), 1);
        done(m);
        m.w8(g(-31217), (x1 + dx) & 0xf);
        m.w8(g(-31216), (y1 + dy) & 0xf);
      }
      break;
    }
    case 12: { // Lloyd's Beacon: key 1 sets the beacon (screen A4-31128, position A4-31127), key 2 returns to it
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & 0x40) fail++;
      else {
        const k = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
        calls.push(['pick', [0x31, 0x32]]);
        if (k === ESC) fail++;
        else if (k === (mut === 'v12' ? 0x32 : 0x31)) {
          m.w8(g(-31128), m.r8(g(-31218)));
          m.w8(g(-31127), ((m.r8(g(-31216)) << 4) + m.r8(g(-31217))) & 0xff);
        } else {
          m.w8(g(-31218), m.r8(g(-31128)));
          m.w8(g(-31217), m.r8(g(-31127)) & 0xf);
          m.w8(g(-31216), m.r8(g(-31127)) >> 4);
          m.w8(g(-31204), 1);
          m.w8(g(-31210), 1);
        }
      }
      if (!fail) done(m);
      break;
    }
    case 15: { // Fly: letter A-E (region) then 1-4 (spot): screen A4-28976[(region*4) + spot]
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & 0x40) fail++;
      else {
        let k: number;
        for (;;) {
          const raw = (io.ikeys.length ? io.ikeys.shift()! : ESC) & 0xff;
          k = raw > 0x60 && raw <= 0x7a ? raw - 0x20 : raw;
          if (k === ESC || (k >= 0x41 && k <= 0x45)) break;
        }
        if (k === ESC) fail++;
        else {
          const p = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
          calls.push(['pick', [0x31, 0x34]]);
          if (p === ESC) fail++;
          else {
            m.w8(g(-31216), 0xff);
            m.w8(g(-31217), 0xff);
            m.w8(g(-31218), m.r8(g(-28976) + (k - 0x41) * (mut === 'v15' ? 3 : 4) + (p - 0x31)));
            m.w8(g(-31204), 1);
            m.w8(g(-31210), 1);
          }
        }
      }
      if (!fail) done(m);
      break;
    }
    case 30: { // Teleport: key 1-9 = squares ahead (no wall test; refused on A4-22016 bit 4 squares); reload flags only on success
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & (mut === 'v30' ? 0x20 : 0x10)) fail++;
      else {
        const p = (io.picks.length ? io.picks.shift()! : ESC) & 0xff;
        calls.push(['pick', [0x31, 0x39]]);
        if (p === ESC) fail++;
        else {
          // the 68k keeps the count in a 16-bit word: a key below '0' wraps to ~65,000 one-square steps. Both coordinates are taken & 15 every
          // step, so only the count mod 16 matters (the walk is done in one go; the bytes are written even for a zero count, as the game's last step would).
          const n = (p - 0x30) & 0xffff;
          const [dx, dy] = dirVec(m);
          const steps = n % 16;
          const sd = (v: number) => (v === 0xff ? -1 : v);
          if (n !== 0) {
            m.w8(g(-31217), (m.r8(g(-31217)) + sd(dx) * steps) & 0xf);
            m.w8(g(-31216), (m.r8(g(-31216)) + sd(dy) * steps) & 0xf);
          }
          m.w8(g(-31204), 1);
          m.w8(g(-31210), 1);
        }
      }
      if (!fail) done(m);
      break;
    }
    case 57: { // Nature's Gate (0xB0EA): only on the overland map (A4-31158 == 9) and off no-teleport squares; the calendar word picks one of 13 gates
      if (!ok()) break;
      let fail = 0;
      if (m.r8(g(-22016)) & 0x40) fail++;
      else if (m.r16(g(-31158)) !== 9 && mut !== 'v57') fail++;
      else {
        const d = m.r16(g(-31180));
        let i = 12;
        if (d & 1) {
          i = 0;
          for (;;) {
            if (s16(d) < s16(m.r16(g(-28956) + 2 * i))) break;
            i++;
            if (i >= 13) break;
          }
        }
        if (s16(d) >= 0x96) {
          m.w16(g(-31158), 8);
          i = 11;
        }
        m.w8(g(-31218), m.r8(g(-28930) + i));
        const b = m.r8(g(-28917) + i);
        m.w8(g(-31217), b & 0xf);
        m.w8(g(-31216), b >> 4);
        m.w8(g(-31056), 1);
        m.w8(g(-31210), 1);
      }
      if (!fail) done(m);
      break;
    }
    case 87: { // Raise Dead (0xC9B6): the target must be dead (0x81); both age one year; d100 < 11 fails (a 10 erases the body: 0xFF); else condition 0 and 1 hit point
      const k = pickMemberNc(m, io, calls);
      if (k === ESC) break;
      const c = charPtr(m, k);
      if (m.r8(c + 0x26) !== 0x81) break;
      ageAdd(caster(), 1);
      if (mut !== 'v87') ageAdd(c, 1);
      const r = s16(randRange(m, 1, 100));
      if (r < 11) {
        if (r === 10) m.w8(c + 0x26, 0xff);
        break;
      }
      m.w8(c + 0x26, 0);
      m.w16(c + 0x5e, 1);
      done(m);
      break;
    }
    default:
      throw new Error('spell ' + spell + ' not modelled');
  }
  return calls;
}

/** CODE+0x5692: the facing byte A4-31153 ('E' 0x45, 'N' 0x4E, 'S' 0x53, 'W' 0x57) to the (dx, dy) byte step; any other value leaves the caller's locals untouched (not modelled). */
function dirVec(m: Mem): [number, number] {
  const d = m.r8(g(-31153));
  if (d === 0x45) return [1, 0];
  if (d === 0x4e) return [0, 1];
  if (d === 0x53) return [0, 0xff];
  if (d === 0x57) return [0xff, 0];
  throw new Error('facing byte not E/N/S/W');
}

/**
 * OVL+0x201A exchange stats (pass 6): the UI prompts for a letter A..G naming the second stat; `nextKey()` is the game's key reader (range-limited
 * to 'A'..'G' or ESC in the real UI; here it is scripted and may return anything). The letter goes through the C-library toupper (CODE+0x2408E, a-z only);
 * ESC leaves, a value above 0x47 asks again, the same stat leaves, otherwise the two stat bytes are swapped, the class flags are recomputed (0x1DF4)
 * and the stats screen is redrawn (UI). Returns true when it swapped.
 */
export function exchangeStats(m: Mem, idx: number, st: number, fl: number, nextKey: () => number, o: { noUpper?: boolean; noFlags?: boolean } = {}): boolean {
  let k: number;
  for (;;) {
    let c = nextKey() & 0xff;
    if (!o.noUpper && c > 0x60 && c <= 0x7a) c -= 0x20;
    k = c;
    if (k === 0x1b || k <= 0x47) break;
  }
  if (k === 0x1b) return false;
  k -= 0x41;
  if (s8(idx & 0xff) === k) return false;
  const t = m.r8(st + k);
  m.w8(st + k, m.r8(st + s8(idx & 0xff)));
  m.w8(st + s8(idx & 0xff), t);
  if (!o.noFlags) chargenFlags(m, st, fl);
  return true;
}

const inParty = (m: Mem, x: number): boolean => {
  let k = 0;
  for (; k < 8; k++) if (m.r16(g(-31082) + 2 * k) === (x & 0xffff)) break;
  return k !== 8;
};
/** CODE+0x362C: remove roster entry `x` from the party table (8 words at A4-31082, 0xFFFF empty): the entries behind it move up, the last word is cleared, party size (A4-31066) decrements. */
export function partyRemove(m: Mem, x: number, o: { noShift?: boolean } = {}): void {
  if (!inParty(m, x)) return;
  let k = -1;
  for (;;) { k++; if (m.r16(g(-31082) + 2 * k) === (x & 0xffff)) break; }
  m.w16(g(-31082) + 2 * k, 0xffff);
  while (k < 7) { if (!o.noShift) m.w16(g(-31082) + 2 * k, m.r16(g(-31082) + 2 * (k + 1))); k++; }
  m.w16(g(-31068), 0xffff);
  m.w16(g(-31066), (m.r16(g(-31066)) - 1) & 0xffff);
}
/**
 * CODE+0x6E0 roster screen toggle (idx 0..23 = characters, 24..47 = hirelings): a member of the party is removed; otherwise a character joins when the
 * count of characters (u8 A4-24162) is below 6 and characters + hirelings (A4-24161) is not 8, a hireling when that total is not 8 and its slot flag
 * `u8 A4-31115[idx-24]` is set. A joiner is appended at party[size], size++. (Screen output is UI.) Returns 1 when it changed the party.
 */
export function rosterToggle(m: Mem, idx: number, o: { sixLimit?: number; noHireFlag?: boolean } = {}): number {
  let off = 0; idx = s16(idx);
  if (idx >= 24) { off = 24; idx -= 24; }
  if (inParty(m, idx + off)) { partyRemove(m, idx + off); return 1; }
  let add = 0;
  if (off === 0) {
    if (m.r8(g(-24162)) < (o.sixLimit ?? 6) && m.r8(g(-24162)) + m.r8(g(-24161)) !== 8) add = 1;
  } else {
    add = m.r8(g(-24162)) + m.r8(g(-24161)) !== 8 ? 1 : 0;
    if (add && !o.noHireFlag) add = m.r8(g(-31115) + idx) !== 0 ? 1 : 0;
  }
  if (!add) return 0;
  const sz = m.r16(g(-31066));
  m.w16(g(-31066), (sz + 1) & 0xffff);
  m.w16(g(-31082) + 2 * s16(sz), idx + off);
  return 1;
}
