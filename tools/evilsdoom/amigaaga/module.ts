/**
 * Evil's Doom (Amiga AGA): reads the walker-relevant tables out of an unpacked per-dungeon
 * program module `PRG/{BEL,CLL,IOW,MIN,MYT}.dat`.
 *
 * The modules are raw (no HUNK header; file offset = load offset). Globals are A6-relative and
 * A6 is set by `LEA d16(PC),A6 / RTS` (BEL.dat +0xFB8E -> A6 = file +0x12D26). Every table below
 * is located by an instruction pattern rather than a hardcoded offset, because the A6 layout
 * shifts between the five modules; the BEL.dat offsets are cited for each.
 * Spec: docs/evilsdoom/amigaaga/data-structure.md § "Dungeon state block" / "First-person view".
 */

export interface WallSlot {
  /** Byte offset into the concatenated `WAL/<dng>.DT0` + `.DT1` buffer (A6+$9DE; DT1 follows DT0). */
  src: number;
  /** Destination x/y in the 368-px-wide (46 B/row) view buffer, from the blit's dest byte offset. */
  x: number;
  y: number;
  /** Width in 16-px words, height in rows, source modulo in bytes (A modulo of the blit). */
  w: number;
  h: number;
  mod: number;
}

export interface ModuleTables {
  a6: number;
  /** A6 offset of the per-dungeon state block saved as `SAVE/<slot>/.<DNG>` and its size. */
  stateBase: number;
  stateSize: number;
  /** 10 level slots: state-block offsets of each level's 30x30 grid (null = dummy slot). */
  gridOffsets: (number | null)[];
  /** State-block offset of the party pose words (level, facing, x, y). */
  poseOffset: number;
  /** 25 wall slots (A6+$15DE, 16 B each). */
  slots: WallSlot[];
  /** View palette (A6+$77E in BEL.dat), 16 x 12-bit $0RGB words. */
  palette: number[];
}

const VIEW_ROW_BYTES = 46; // 0x2E: the blit dest modulo base in the cmd-3 handler (BEL +0xCCE6)

function u16(d: Uint8Array, o: number): number { return (d[o] << 8) | d[o + 1]; }
function s16(d: Uint8Array, o: number): number { const v = u16(d, o); return v >= 0x8000 ? v - 0x10000 : v; }
function u32(d: Uint8Array, o: number): number { return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0; }

function find(d: Uint8Array, pat: (number | null)[], from = 0): number {
  outer: for (let i = from; i + pat.length <= d.length; i++) {
    for (let k = 0; k < pat.length; k++) if (pat[k] !== null && d[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

/** `LEA d16(PC),A6 / RTS` (BEL +0xFB8E): A6 = pc + 2 + d16. */
function findA6(d: Uint8Array): number {
  const i = find(d, [0x4d, 0xfa, null, null, 0x4e, 0x75]);
  if (i < 0) throw new Error('evilsdoom: A6 setup (LEA d16(PC),A6 / RTS) not found');
  return i + 2 + s16(d, i + 2);
}

/**
 * Save routine (BEL +0xF0D8): `LEA base(A6),A0 / MOVE.L #'.BEL',(A3) / MOVE.L #size,D0`.
 * `tag` is the 4-byte extension ('.BEL'); the second occurrence of `MOVE.L #tag,(A3)` is the one
 * preceded by the LEA (the first is in the filename table builder).
 */
function findState(d: Uint8Array, tag: string): { base: number; size: number } {
  const t = Array.from(tag, (c) => c.charCodeAt(0));
  for (let i = 0; (i = find(d, [0x26, 0xbc, ...t], i)) >= 0; i++) {
    if (d[i - 4] === 0x41 && d[i - 3] === 0xee && d[i + 6] === 0x20 && d[i + 7] === 0x3c) {
      return { base: u16(d, i - 2), size: u32(d, i + 8) };
    }
  }
  throw new Error(`evilsdoom: state-block save for ${tag} not found`);
}

/**
 * Level setup routines (BEL +0xE3AA.. reached via the BRA table at +0x80A4..+0x80C8): five
 * pointers are stored per level, the first being the 30x30 grid (`MOVE.L A0,$450E(A6)` in BEL,
 * read by the grid accessor at +0x9CCA: `grid + y*30 + x`). Levels 0-6 use `LEA d16(A6),A0`,
 * levels 7-9 `LEA (A6),A0 / ADDA.L #d32,A0`. A level whose five pointers are all equal is a dummy.
 */
function findGridPointers(d: Uint8Array, stateBase: number): (number | null)[] {
  const out: (number | null)[] = [];
  // short form: 5 x (41 EE d16 / 2D 48 g16)
  for (let i = 0; i + 40 <= d.length; i++) {
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) ok = d[i + k * 8] === 0x41 && d[i + k * 8 + 1] === 0xee && d[i + k * 8 + 4] === 0x2d && d[i + k * 8 + 5] === 0x48;
    if (!ok) continue;
    const ptrs = Array.from({ length: 5 }, (_, k) => u16(d, i + k * 8 + 2));
    const regs = Array.from({ length: 5 }, (_, k) => u16(d, i + k * 8 + 6));
    if (!regs.every((r, k) => r === regs[0] + 4 * k)) continue;
    out.push(ptrs.every((p) => p === ptrs[0]) ? null : ptrs[0] - stateBase);
    i += 39;
  }
  // long form: 5 x (41 D6 / D1 FC d32 / 2D 48 g16)
  for (let i = 0; i + 60 <= d.length; i++) {
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) {
      const o = i + k * 12;
      ok = d[o] === 0x41 && d[o + 1] === 0xd6 && d[o + 2] === 0xd1 && d[o + 3] === 0xfc && d[o + 8] === 0x2d && d[o + 9] === 0x48;
    }
    if (!ok) continue;
    const ptrs = Array.from({ length: 5 }, (_, k) => u32(d, i + k * 12 + 4));
    out.push(ptrs.every((p) => p === ptrs[0]) ? null : ptrs[0] - stateBase);
    i += 59;
  }
  if (out.length !== 10) throw new Error(`evilsdoom: expected 10 level setup blocks, found ${out.length}`);
  return out;
}

/** Grid accessor `MOVEQ #$1E,D0 / MULU.W y(A6),D0 / ADD.W x(A6),D0` (BEL +0x2BB2): x at $47D8, y at $47DA. */
function findPose(d: Uint8Array, stateBase: number): number {
  const i = find(d, [0x70, 0x1e, 0xc0, 0xee, null, null, 0xd0, 0x6e, null, null]);
  if (i < 0) throw new Error('evilsdoom: grid accessor not found');
  const y = u16(d, i + 4), x = u16(d, i + 8);
  if (y !== x + 2) throw new Error('evilsdoom: x/y globals not adjacent');
  // level index at x-4 (`CMPI.W #n,$47D4(A6)`, BEL +0x171A..), facing at x-2 (turns at BEL +0x91B4/+0x91CA)
  return x - 4 - stateBase;
}

/** cmd-3 (wall piece) handler `LSL.W #4,D0 / LEA d16(A6),A4` (BEL +0xCCC2): the 16-B slot table. */
function findSlots(d: Uint8Array, a6: number): WallSlot[] {
  const i = find(d, [0xe9, 0x48, 0x49, 0xee]);
  if (i < 0) throw new Error('evilsdoom: wall-slot handler not found');
  const base = a6 + u16(d, i + 4);
  return Array.from({ length: 25 }, (_, s) => {
    const o = base + s * 16;
    const dst = u16(d, o + 4);
    return { src: u32(d, o), x: (dst % VIEW_ROW_BYTES) * 8, y: Math.floor(dst / VIEW_ROW_BYTES), w: u16(d, o + 6), h: u16(d, o + 8), mod: u16(d, o + 10) };
  });
}

/**
 * View palette. Per frame the renderer points the fade source (BEL A6+$946) at A6+$77E
 * (`LEA $77E(A6),A0 / MOVE.L A0,$946(A6)`, BEL +0x721A) unless a timed spell (A6+$4644, set at
 * +0x5D0E) is running, which selects $7A0/$8B0 instead (+0xA9EA). Found here as the `LEA`
 * immediately following the routine that calls the frame's draw-list interpreter
 * (`MOVEA.L list(A6),A0 / BSR / BSR / LEA pal(A6),A0 / MOVE.L A0,ptr(A6)`), which is the same in
 * all five modules. The table is $0RGB words terminated by $7890.
 */
function findPalette(d: Uint8Array, a6: number): number[] {
  // MOVEA.L $1588(A6),A0 / BSR 0xC528 (list run) / BSR 0xc4a6 / LEA pal(A6),A0 / MOVE.L A0,ptr(A6) / MOVE.W #$FFFF,...
  const i = find(d, [0x20, 0x6e, null, null, 0x61, 0x00, null, null, 0x61, 0x00, null, null, 0x41, 0xee, null, null, 0x2d, 0x48, null, null, 0x3d, 0x7c, 0xff, 0xff]);
  if (i < 0) throw new Error('evilsdoom: view palette select not found');
  let o = a6 + u16(d, i + 14);
  const pal: number[] = [];
  while (u16(d, o) !== 0x7890 && pal.length < 32) { pal.push(u16(d, o)); o += 2; }
  if (pal.length !== 16) throw new Error(`evilsdoom: palette length ${pal.length}`);
  return pal;
}

export function readModule(d: Uint8Array, tag: string): ModuleTables {
  const a6 = findA6(d);
  const st = findState(d, tag);
  return {
    a6,
    stateBase: st.base,
    stateSize: st.size,
    gridOffsets: findGridPointers(d, st.base),
    poseOffset: findPose(d, st.base),
    slots: findSlots(d, a6),
    palette: findPalette(d, a6),
  };
}
