/**
 * AGOS "game database" (`gameamiga`, `tablesNN`, `xtableNN`) reader for the
 * Horrorsoft titles that share ScummVM's `AGOSEngine_Elvira2` loader:
 * **Waxworks** and **Elvira II**. Original code written against the byte
 * layout (docs/waxworks/amiga/data-structure.md §5); ScummVM's `res.cpp`
 * (`readItemFromGamePc`/`readItemChildren`), `subroutine.cpp`
 * (`readSubroutineBlock`/`readSingleOpcode`) and `rooms.cpp` were used as a
 * behaviour oracle only (GPL: nothing translated, no code copied). The
 * opcode argument grammar below is a description of the on-disk record shape
 * (one letter per operand), re-expressed here; it is checked by consuming
 * every shipped database/table file to exactly its last byte (a wrong
 * entry desynchronises the walk).
 *
 * Layout of the decompressed `gameamiga` (all big-endian; `simon_decr`-packed
 * on disk for Waxworks, see `simonDecr`):
 *
 *   u32 itemCount-2   u32 0x80 (runtime-database marker)   u32 initedCount-2
 *   u32 stringCount
 *   u32 textSize, textSize bytes of NUL-terminated strings
 *   (initedCount items: record 2 .. initedCount+1)
 *   subroutine block
 *
 * Item record (Waxworks): u16 adjective, u16 noun, u16 state, u32 next,
 * u32 child, u32 parent (item refs: 0xFFFFFFFF = none, else +2), u16 unused,
 * u16 classFlags, u32 (non-zero iff children follow), then `u16 type` child
 * blocks until `type == 0`. Child types: 1 room (u16 subroutine id, u16 exit
 * state word = 2 bits/direction x6, then one u32 item ref per direction whose
 * 2-bit state is non-zero), 2 object, 4 super-room (Elvira II), 7 container,
 * 8 chain, 9 user flags, 255 inherit.
 */

export type GamePcVariant = 'waxworks' | 'elvira2';

/** Opcode operand grammar (see `readGrammarFromExe`). */
export type OpcodeGrammar = string[];

class Reader {
  readonly b: Uint8Array;
  p: number;
  constructor(b: Uint8Array, p = 0) {
    this.b = b;
    this.p = p;
  }
  u8(): number {
    if (this.p >= this.b.length) throw new Error(`agos-gamepc: read past end at 0x${this.p.toString(16)}`);
    return this.b[this.p++];
  }
  u16(): number {
    const v = (this.u8() << 8) | this.u8();
    return v;
  }
  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }
  /** Item reference: 0xFFFFFFFF -> 0 (none), else value + 2. */
  itemRef(): number {
    const v = this.u32();
    return v === 0xffffffff ? 0 : v + 2;
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const ROOM_DIRS = 6;

export interface RoomChild {
  kind: 'room';
  subroutineId: number;
  /** 2 bits per direction (0 = no exit, 1 = open, 2/3 = closed/locked; see `rooms.cpp` door states). */
  exitStates: number;
  /** One entry per direction with a non-zero state. `dest` is an item id. */
  exits: Array<{ dir: number; dest: number }>;
}
export interface ObjectChild {
  kind: 'object';
  flags: number;
  values: number[];
  name: number;
}
export interface SuperRoomChild {
  kind: 'superroom';
  subroutineId: number;
  x: number;
  y: number;
  z: number;
  exitStates: number[];
}
export type ItemChild =
  | RoomChild
  | ObjectChild
  | SuperRoomChild
  | { kind: 'container'; volume: number; flags: number }
  | { kind: 'chain'; chained: number }
  | { kind: 'userflags'; flags: number[] }
  | { kind: 'inherit'; master: number };

export interface AgosItem {
  id: number;
  itemName: number;
  adjective: number;
  noun: number;
  state: number;
  next: number;
  child: number;
  parent: number;
  classFlags: number;
  children: ItemChild[];
}

function readItem(r: Reader, id: number, variant: GamePcVariant): AgosItem {
  const it: AgosItem = { id, itemName: 0, adjective: 0, noun: 0, state: 0, next: 0, child: 0, parent: 0, classFlags: 0, children: [] };
  if (variant === 'elvira2') {
    it.itemName = r.u32() & 0xffff;
    it.adjective = r.u16();
    it.noun = r.u16();
    it.state = r.u16();
    it.next = r.itemRef();
    it.child = r.itemRef();
    it.parent = r.itemRef();
    r.u16();
    it.classFlags = r.u16();
  } else {
    it.adjective = r.u16();
    it.noun = r.u16();
    it.state = r.u16();
    it.next = r.itemRef();
    it.child = r.itemRef();
    it.parent = r.itemRef();
    r.u16();
    it.classFlags = r.u16();
  }
  let type = r.u32();
  while (type) {
    type = r.u16();
    if (type === 0) break;
    it.children.push(readChild(r, type, variant));
  }
  return it;
}

function readChild(r: Reader, type: number, variant: GamePcVariant): ItemChild {
  switch (type) {
    case 1: {
      const subroutineId = r.u16();
      const exitStates = r.u16();
      const exits: RoomChild['exits'] = [];
      for (let d = 0; d < ROOM_DIRS; d++) if ((exitStates >> (d * 2)) & 3) exits.push({ dir: d, dest: r.itemRef() });
      return { kind: 'room', subroutineId, exitStates, exits };
    }
    case 2: {
      const flags = r.u32();
      const values: number[] = [];
      if (flags & 1) values.push(r.u32() & 0xffff);
      for (let i = 1; i < 16; i++) if (flags & (1 << i)) values.push(r.u16());
      const name = variant === 'elvira2' ? 0 : r.u32() & 0xffff;
      return { kind: 'object', flags, values, name };
    }
    case 4: {
      if (variant !== 'elvira2') throw new Error('agos-gamepc: super-room child outside Elvira II');
      const subroutineId = r.u16();
      const x = r.u16();
      const y = r.u16();
      const z = r.u16();
      const exitStates: number[] = [];
      for (let i = 0; i < x * y * z; i++) exitStates.push(r.u16());
      return { kind: 'superroom', subroutineId, x, y, z, exitStates };
    }
    case 7:
      return { kind: 'container', volume: r.u16(), flags: r.u16() };
    case 8:
      return { kind: 'chain', chained: r.itemRef() };
    case 9: {
      const flags = [r.u16(), r.u16(), r.u16(), r.u16()];
      return { kind: 'userflags', flags };
    }
    case 255:
      return { kind: 'inherit', master: r.itemRef() };
    default:
      throw new Error(`agos-gamepc: invalid item child type ${type} at 0x${(r.p - 2).toString(16)}`);
  }
}

// ---------------------------------------------------------------------------
// Subroutines (script bytecode, parsed into operand lists)
// ---------------------------------------------------------------------------

/** Operand kinds after parsing. `b`: byte/var operand (0xFFxx = indirect var xx), `i`: item ref (negative = special -1/-3/-5/-7/-9), `t`: text id (-1/-3 special), `w`: raw word. */
export interface Operand {
  k: 'w' | 'b' | 'i' | 't';
  v: number;
}
export interface ScriptOp {
  op: number;
  args: Operand[];
}
export interface ScriptLine {
  /** Only for subroutine id 0 (the verb table): [verb, noun1, noun2]. */
  verbs?: [number, number, number];
  ops: ScriptOp[];
}
export interface Subroutine {
  id: number;
  lines: ScriptLine[];
}

/**
 * Operand grammar per opcode, one letter per operand: `F N S a n p v 3` raw
 * u16; `B` byte (an 0xFF escape byte is followed by a variable number);
 * `I` item (u16: 1/3/5/7/9 = special markers, else followed by a u32 ref);
 * `T` text (u16: 0 / 3 = specials, else followed by a u32 string id).
 * Empty = no operands. Opcode 0 is the "invert the next condition" prefix.
 *
 * The table is **read from the game's own executable** (`runit`): the
 * original interpreter keeps it as NUL-terminated, space-terminated strings
 * ("IB \0") padded to even length, one per opcode, in a run that starts at
 * opcode 0 (an empty " \0") and is followed by a binary table. Nothing is
 * transcribed from third-party sources.
 */
export function readGrammarFromExe(exe: Uint8Array): string[] {
  // Signature of opcodes 0..3: " \0", "I \0\0", "I \0\0", "I \0\0" (one-operand item opcodes).
  const sig = [0x20, 0, 0x49, 0x20, 0, 0, 0x49, 0x20, 0, 0, 0x49, 0x20, 0, 0];
  let start = -1;
  for (let i = 0; i + sig.length < exe.length; i += 2) {
    if (sig.every((v, k) => exe[i + k] === v)) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error('agos-gamepc: opcode grammar table not found in executable');
  const out: string[] = [];
  let p = start;
  for (;;) {
    let s = '';
    let q = p;
    while (q < exe.length && exe[q] !== 0 && /[A-Za-z0-9 ]/.test(String.fromCharCode(exe[q]))) s += String.fromCharCode(exe[q++]);
    if (exe[q] !== 0 || !s.endsWith(' ')) break;
    out.push(s.trimEnd());
    q++;
    if (q & 1) q++; // entries are padded to an even length
    p = q;
  }
  return out;
}

function readOp(r: Reader, grammar: string[]): ScriptOp {
  const op = r.u8();
  const g = grammar[op];
  if (g === undefined) throw new Error(`agos-gamepc: opcode ${op} has no grammar entry (at 0x${(r.p - 1).toString(16)})`);
  const args: Operand[] = [];
  for (const c of g) {
    switch (c) {
      case 'F':
      case 'N':
      case 'S':
      case 'a':
      case 'n':
      case 'p':
      case 'v':
      case '3':
        args.push({ k: 'w', v: r.u16() });
        break;
      case 'B': {
        let v = r.u8();
        if (v === 0xff) v = 0xff00 | r.u8();
        args.push({ k: 'b', v });
        break;
      }
      case 'I': {
        const v = r.u16();
        if (v === 1 || v === 3 || v === 5 || v === 7 || v === 9) args.push({ k: 'i', v: -v });
        else args.push({ k: 'i', v: r.itemRef() });
        break;
      }
      case 'T': {
        const v = r.u16();
        if (v === 0) args.push({ k: 't', v: -1 });
        else if (v === 3) args.push({ k: 't', v: -3 });
        else args.push({ k: 't', v: r.u32() & 0xffff });
        break;
      }
      default:
        throw new Error(`agos-gamepc: bad grammar letter ${c}`);
    }
  }
  return { op, args };
}

/**
 * Parse a subroutine block starting at `offset`. Stops at the first
 * non-zero block marker or at end of buffer. Returns the position reached,
 * which for every shipped file equals the file length.
 */
export function readSubroutineBlock(buf: Uint8Array, offset: number, grammar: OpcodeGrammar): { subs: Subroutine[]; end: number } {
  const r = new Reader(buf, offset);
  const subs: Subroutine[] = [];
  while (r.p < buf.length && r.u16() === 0) {
    const sub: Subroutine = { id: r.u16(), lines: [] };
    while (r.u16() === 0) {
      const line: ScriptLine = { ops: [] };
      if (sub.id === 0) line.verbs = [r.u16(), r.u16(), r.u16()];
      for (;;) {
        const next = buf[r.p];
        if (next === undefined) throw new Error('agos-gamepc: subroutine line ran off the end');
        if (next === 0xff) {
          r.p++;
          break;
        }
        if (next === 87) {
          // "comment" opcode: swallow its single word (kept out of the op list)
          r.p++;
          r.u16();
          continue;
        }
        line.ops.push(readOp(r, grammar));
      }
      sub.lines.push(line);
    }
    subs.push(sub);
  }
  return { subs, end: r.p };
}

// ---------------------------------------------------------------------------
// Whole database
// ---------------------------------------------------------------------------

export interface GamePcDatabase {
  variant: GamePcVariant;
  itemCount: number;
  stringCount: number;
  /** NUL-separated text block, split (index = string id, as the item/script text ids index it). */
  text: Uint8Array;
  items: Map<number, AgosItem>;
  subroutines: Map<number, Subroutine>;
  /** Byte offset where the in-file subroutine block ended; equals the buffer length when fully consumed. */
  end: number;
}

/** Parse an already-decompressed `gameamiga`. */
export function readGamePc(buf: Uint8Array, variant: GamePcVariant, grammar: OpcodeGrammar): GamePcDatabase {
  const r = new Reader(buf);
  let itemArraySize = r.u32();
  const version = r.u32();
  let inited = r.u32();
  const stringCount = r.u32();
  if (version !== 0x80) throw new Error(`agos-gamepc: not a runtime database (marker 0x${version.toString(16)})`);
  if (variant === 'elvira2') {
    itemArraySize += 2;
    inited = itemArraySize;
  } else {
    inited += 2;
    itemArraySize += 2;
  }
  const textSize = r.u32();
  const text = buf.subarray(r.p, r.p + textSize);
  r.p += textSize;
  const items = new Map<number, AgosItem>();
  for (let id = 2; id < inited; id++) items.set(id, readItem(r, id, variant));
  const { subs, end } = readSubroutineBlock(buf, r.p, grammar);
  const subroutines = new Map<number, Subroutine>();
  for (const s of subs) subroutines.set(s.id, s);
  return { variant, itemCount: inited, stringCount, text, items, subroutines, end };
}

/** Rooms only: item id -> its room child. */
export function roomsOf(db: GamePcDatabase): Map<number, RoomChild> {
  const out = new Map<number, RoomChild>();
  for (const it of db.items.values()) {
    const room = it.children.find((c): c is RoomChild => c.kind === 'room');
    if (room) out.set(it.id, room);
  }
  return out;
}

/** Back exit of a direction (`rooms.cpp getBackExit`): N<->S, E<->W, up<->down. */
export const BACK_DIR = [2, 3, 0, 1, 5, 4];

/**
 * Parse the `tbllist` / `xtbllist` index: NUL-terminated file names, each
 * followed by (u16 min, u16 max) id ranges ending in a 0 min.
 * Returns file name -> list of [min,max].
 */
export function readTableList(buf: Uint8Array): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  let p = 0;
  while (p < buf.length && buf[p] !== 0) {
    let name = '';
    while (buf[p] !== 0) name += String.fromCharCode(buf[p++]);
    p++;
    const ranges: Array<[number, number]> = [];
    for (;;) {
      const min = (buf[p] << 8) | buf[p + 1];
      p += 2;
      if (min === 0) break;
      const max = (buf[p] << 8) | buf[p + 1];
      p += 2;
      ranges.push([min, max]);
    }
    out.set(name, ranges);
  }
  return out;
}
