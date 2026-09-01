/**
 * Ishar-engine (Silmarils "ALIS") world-region grid decoder.
 *
 * Ground truth: a `re-oracle` escalation this session (2026-09-01) traced
 * the real loader bytecode in each title's `MAIN.DO` (`cfopen`/`cfreadb`/
 * `cfclose`, opcodes 0x70/0x77/0x71) and the game's own `cdim` array-
 * dimension declarations. See `docs/ishar-container-format.md` §9 for the
 * full derivation (byte-exact `MAIN.bin` offsets, opcode traces) and this
 * session's own independent re-verification (an ASCII/PNG render of the
 * decoded grid shows unmistakable coherent world content — coastline
 * borders, village/building compounds, road lines — not noise).
 *
 * **Format**: `CONT<n>.FIC` (one file per world region, "contrée") is a
 * RAW, HEADERLESS, UNCOMPRESSED row-major byte grid — NOT wrapped in the
 * `.DO`/`.CO` container/codec (`docs/ishar-container-format.md` §2). Loaded
 * directly by the ALIS VM's file-I/O opcodes, not through `adresdes()`.
 * Ishar 1 stores one layer per file; Ishar 2/3 store two layers
 * concatenated (a dense terrain layer + a much sparser second layer — an
 * object/overlay layer per the re-oracle report, CONFIRMED sparse for
 * Ishar 2 at ~1.6% nonzero this session's independent check, though Ishar
 * 3's second layer measured denser at ~11% nonzero -- the "sparse overlay"
 * read may not generalize as cleanly to Ishar 3, an honest open point).
 *
 * `cell = grid[y * width + x]` (row-major, `y` outer) — confirmed against a
 * hand-decoded `GERDEP.bin` (movement handler) statement:
 * `grid[byteVar(0x3fd0) * width + byteVar(0x137d)]`.
 *
 * **Walkability (HYPOTHESIS, not confirmed)**: `tabchar()` reads cells
 * sign-extended (`(s8)xread8`), making "cell < 0" (raw byte >= 0x80) the
 * natural blocked/special test — the high-bit value classes (`0xCC`-`0xCE`
 * coastline/borders, `0xE1`/`0xE5`/`0xE6` forest/mountain) are exactly the
 * classes that render as the map's walls/obstacles in a visual inspection.
 * This module's `isBlocked()` implements that hypothesis; it is NOT traced
 * to a confirmed collision-check opcode.
 */

export interface IsharRegionLayout {
  /** Row width in cells (also the `cdim`-declared stride). */
  width: number;
  height: number;
  /** Number of concatenated layers per file (1 for Ishar 1, 2 for Ishar 2/3). */
  layers: number;
}

/** Per-title `CONT*.FIC` grid layout, from `docs/ishar-container-format.md` §9.1. */
export const ISHAR_REGION_LAYOUT: Record<'ishar' | 'ishar2' | 'ishar3', IsharRegionLayout> = {
  ishar: { width: 90, height: 54, layers: 1 },
  ishar2: { width: 60, height: 90, layers: 2 },
  ishar3: { width: 57, height: 82, layers: 2 },
};

export interface IsharRegionGrid {
  name: string;
  width: number;
  height: number;
  /** One or two row-major byte layers; layer 0 is always the dense terrain layer. */
  layers: Uint8Array[];
}

/** Split a raw `CONT<n>.FIC` file's bytes into its declared layer(s). Throws if the size doesn't match exactly (this format has no header/length field to fall back on). */
export function decodeIsharRegion(name: string, data: Uint8Array, layout: IsharRegionLayout): IsharRegionGrid {
  const cellCount = layout.width * layout.height;
  const expected = cellCount * layout.layers;
  if (data.length !== expected) {
    throw new Error(`${name}: expected ${expected} bytes (${layout.width}x${layout.height}x${layout.layers}), got ${data.length}`);
  }
  const layers: Uint8Array[] = [];
  for (let i = 0; i < layout.layers; i++) {
    layers.push(data.subarray(i * cellCount, (i + 1) * cellCount));
  }
  return { name, width: layout.width, height: layout.height, layers };
}

/** HYPOTHESIS (see module doc): sign-extended cell value < 0 = blocked/impassable. */
export function isBlocked(cellValue: number): boolean {
  return (cellValue & 0x80) !== 0;
}
