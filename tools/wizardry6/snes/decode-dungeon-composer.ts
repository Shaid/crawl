/**
 * Extracts the SNES ROM's first-person dungeon-view compose-piece
 * libraries -- the addressing/placement structure that selects and
 * positions tiles from the confirmed dungeon-art tile pool (banks
 * `$10`-`$19`, see decode-dungeon-art.ts) into the first-person corridor
 * view. See docs/wizardry6/snes/data-structure.md section 3.14 (full spec)
 * and the corrected section 6.5.
 *
 * This is the SNES analog of the Amiga port's `DrawMazePiece` + 366-record
 * compose list (docs/wizardry6/amiga/data-structure.md sections 4.1-4.4).
 *
 * Found via a `re-codebreaker` escalation this session. **Independently
 * re-verified from scratch** (fresh Python, never opened the escalation's
 * own script -- see game-re-lessons/verify-escalation-artifacts-not-just-claims.md):
 * - Hand-disassembled every cited address (`$82:F810` view reset, the
 *   `$83:EB2C` row-base table, the cell-word bit-decode at `$03:E336`, the
 *   painter's-algorithm branch targets at `$03:E386`/`$03:E388`) directly
 *   against raw ROM bytes -- all match byte-for-byte, including the branch
 *   *target addresses* recomputed from the encoded displacement bytes.
 * - Re-derived the piece-library table lengths independently: library
 *   `$C1` is self-describing (first pointer `$89DE` -> 1263 entries);
 *   library `$C2`'s length isn't self-describing the same way -- this
 *   session found its true boundary by hand (the raw pointer stream stops
 *   forming a monotonic run of valid CPU addresses at table index 632,
 *   after which the bytes are piece *payload* data misread as pointers).
 *   That gives 632 slots / 630 non-null, matching the escalation's own
 *   count.
 * - Re-implemented the viewport-fit invariant from scratch: 1263/1263 (C1)
 *   and 630/630 (C2) records fit the 18x15 viewport, 0 violations combined
 *   across all 1893 records -- reproduces the escalation's own numbers.
 * - Re-rendered library `$C2` index 267 (CPU `$C2:D546`, the "backdrop"
 *   piece filling the entire 18x15 viewport) from scratch with a
 *   from-scratch 4bpp tile decoder and got the *same* decisive image the
 *   escalation described: a carved stone portal with an interlace-knotwork
 *   lintel, flanking pilasters, two standing wall-torches, ashlar masonry,
 *   and a checkerboard floor in perspective.
 *
 * **Format:**
 * - Two u16 LE pointer tables, file `0x208000` (CPU `$C1:8000`, 1263
 *   entries) and `0x210000` (CPU `$C2:8000`, 632 slots / 630 non-null).
 *   Each table entry is a direct CPU address (`$8000`-`$FFFF`) within its
 *   own bank pointing at a piece record; `0xFFFF` = unused slot.
 * - Piece record: `[x][y][w][h]` (destination cell column/row/width/height
 *   in the 18x15 viewport), then either the `w*h` cell words directly, or
 *   one of two redirect headers before them:
 *     - `0xFFFF` + u16 `newPtr`: cells live at `newPtr` instead (shared/
 *       reused block), tightly packed, no extra per-row stride.
 *     - `0xFFFE` + u16 `word` + u16 `newPtr`: cells live at `newPtr`, a
 *       sub-window of a wider shared 2D source. **Confirmed by disassembly**
 *       this session (`$03:E29B`-`$03:E2E4`, file `0x01e29b`-`0x01e2e4`):
 *       `word`'s **high byte is the starting byte offset** into the
 *       redirected cell array (`Y` is seeded from it, `A5 07; TAY`, before
 *       the column loop -- lets a piece start mid-row/mid-column of the
 *       shared source), and the **low byte is added to the row cursor
 *       after each row** in addition to the `w*2` bytes the column loop
 *       already consumed (`TYA; CLC; ADC $06; TAY` at `$03:E2E0`-`$03:E2E4`,
 *       with the high byte zeroed via `STZ $07` right after it was copied
 *       to `Y`, so this add is effectively 8-bit). I.e. the implied source
 *       row width in cells is `w + lowByte/2`, and the piece reads
 *       `highByte/2` cells into that row before its own `w`-cell window
 *       starts. This directly refutes the doc's prior "constant 6 bytes/
 *       row" guess (only 9/134 records actually had that literal value;
 *       the field ranges over at least 8 distinct low-byte values 2-22)
 *       and refines "startHi/strideLo" from a naming guess to a
 *       disassembly-derived split. Verified structurally: of 65
 *       shared-`newPtr` redirect-target groups, the 63 with >1 record all
 *       imply a single self-consistent source row width per w/h-shape
 *       subgroup (65/65 once the one apparent exception is split by shape
 *       -- see the doc's §3.14.3 for the full breakdown), and mirrored
 *       left/right piece pairs decode to physically sensible mirrored
 *       sub-window offsets into the same shared source (e.g. a 4-cell-wide
 *       shared block read as cells 0-2 by a right-side piece and cells
 *       1-3 by its left-side mirror). Everything else (plain records,
 *       1371/1893, and the simple `0xFFFF` redirect, 388/1893) remains
 *       confirmed as before.
 * - Cell word bits (confirmed, `$03:E336`-`$03:E34D`): bits 0-9 = `tile`
 *   index into the confirmed dungeon-art pool; bits 10-13 = bank selector,
 *   `bank = 0x90 + selector` (mirrors of ROM banks `$10`-`$19`); bit 15 =
 *   alpha/transparency hint (not needed for a static single-piece render);
 *   word `0x0000` = empty cell (nothing drawn).
 * - Source tile file offset = `(bank & 0x7F) * 0x8000 + tile * 32`.
 *
 * **Palette -- confirmed (`re-codebreaker`, docs section 3.14.10),
 * independently re-verified this session.** The view renders through BG
 * sub-palette 2 (CGRAM colours 32-47), swapped **per dungeon region**
 * among 12 confirmed palette groups (40-52, file `0x10764 + group*32`,
 * 16 BGR555 colours each). Verified 100.00% (3,349/3,349 unblended
 * pixels) against two real Super Famicom screenshots for group 40. This
 * extractor renders every piece with **group 40** (`$094c=0x50`, file
 * `0x10C64`) -- the first/most common dungeon palette (levels 2, 5, 6,
 * 12, 13) -- as a representative colouring; the *real* per-piece palette
 * depends on which dungeon region the party is in when a piece is drawn,
 * which this extractor (a static per-piece atlas, not a live maze walk)
 * has no way to resolve. All 12 confirmed groups are also exported as
 * standalone palette assets.
 *
 * This extractor renders each **individual piece** as its own small sprite
 * (shelf-packed atlas) rather than composing a full corridor -- composing a
 * real corridor from the maze data (`$7E:4540` cell values, the confirmed
 * `$80:DD4B` frustum offset table, docs section 3.14.7/3.14.8) is a further
 * step not yet done by this extractor. It additionally renders the one piece that is a
 * complete standalone first-person view by itself (library `$C2` index 267,
 * the "backdrop" piece, 18x15 cells = the full viewport) as a decisive
 * single screen asset.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-dungeon-composer.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile4bpp, TILE_BYTES_4BPP, TILE_SIZE_PX, decodeCgramPalette } from '../../shared/snes-ppu';
import { shelfPack, type PackInput } from '../../shared/atlas-pack';

// Confirmed dungeon-region CGRAM palette groups (docs section 3.14.10),
// file 0x10764 + group*32, 16 BGR555 colours/group. $094c value -> group.
const PALETTE_TABLE_BASE = 0x10764;
const DUNGEON_PALETTE_GROUPS: Record<number, number> = {
  0x50: 40,
  0x52: 41,
  0x54: 42,
  0x56: 43,
  0x58: 44,
  0x5a: 45,
  0x5c: 46,
  0x5e: 47,
  0x60: 48,
  0x62: 49,
  0x66: 51,
  0x68: 52,
};
const DEFAULT_PALETTE_SELECTOR = 0x50; // group 40 -- most common (levels 2,5,6,12,13)

function loadPaletteRGB(data: Uint8Array, selector: number): number[] {
  const group = DUNGEON_PALETTE_GROUPS[selector];
  const offset = PALETTE_TABLE_BASE + group * 32;
  return decodeCgramPalette(data, offset, 16); // flat [r,g,b, r,g,b, ...] x16
}

export const C1_BASE = 0x208000; // file offset, CPU $C1:8000
export const C2_BASE = 0x210000; // file offset, CPU $C2:8000
export const C2_TABLE_LEN = 632; // re-derived this session -- see header comment; 630 non-null
const VIEWPORT_W = 18;
const VIEWPORT_H = 15;
const DECISIVE_TABLE = 'C2';
const DECISIVE_INDEX = 267; // CPU $C2:8216 -- the full-viewport "backdrop" piece

export function u16(data: Uint8Array, off: number): number {
  return data[off] | (data[off + 1] << 8);
}

export interface CellRef {
  tile: number;
  bank: number;
  sourceOffset: number;
  /** Cell word bit 15 -- "tile contains transparent pixels" (§3.14.2): later pieces may still merge behind this cell in the painter's algorithm. */
  hasAlpha: boolean;
}

export interface PieceRecord {
  table: 'C1' | 'C2';
  index: number;
  cpuAddr: number; // address of the table slot itself
  recordCpuAddr: number; // address the slot points to
  fileOffset: number;
  x: number;
  y: number;
  w: number;
  h: number;
  extType: 'plain' | 'redirect' | 'redirect-strided';
  cells: (CellRef | null)[]; // row-major, length w*h
}

/** Parse one piece record body at `recOff` (already resolved from a table slot's pointer) -- shared by `parseLibrary` (iterating every table slot) and `resolveComposeWord` (resolving one arbitrary compose-list word, e.g. a raw byte read straight out of the bank-`$89` per-depth wallValue tables, docs §3.14.5). */
function parsePieceAt(data: Uint8Array, table: 'C1' | 'C2', base: number, index: number, ptr: number, recOff: number): PieceRecord {
  const x = data[recOff];
  const y = data[recOff + 1];
  const w = data[recOff + 2];
  const h = data[recOff + 3];
  const marker = u16(data, recOff + 4);

  let cellBase: number;
  let rowStrideExtra = 0;
  let startByteOffset = 0;
  let extType: PieceRecord['extType'] = 'plain';
  if (marker === 0xfffe) {
    // Confirmed this session ($03:E29B-$03:E2E4): the word at recOff+6 is
    // [strideExtraLo][startOffsetHi] LE -- high byte seeds the initial
    // byte cursor into the redirected array, low byte is added to the
    // row cursor after each row on top of the w*2 the column loop already
    // consumed. See the header comment for full derivation + verification.
    const word = u16(data, recOff + 6);
    startByteOffset = (word >> 8) & 0xff;
    rowStrideExtra = word & 0xff;
    const newPtr = u16(data, recOff + 8);
    cellBase = base + (newPtr - 0x8000);
    extType = 'redirect-strided';
  } else if (marker === 0xffff) {
    const newPtr = u16(data, recOff + 6);
    cellBase = base + (newPtr - 0x8000);
    extType = 'redirect';
  } else {
    cellBase = recOff + 4;
  }

  const rowBytes = w * 2 + rowStrideExtra;
  const cells: (CellRef | null)[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const wordOff = cellBase + startByteOffset + row * rowBytes + col * 2;
      if (wordOff < 0 || wordOff + 2 > data.length) {
        cells.push(null);
        continue;
      }
      const word = u16(data, wordOff);
      if (word === 0) {
        cells.push(null);
        continue;
      }
      const tile = word & 0x03ff;
      const bankSel = ((word >> 8) & 0x3c) >> 2;
      const bank = 0x90 + bankSel;
      const sourceOffset = (bank & 0x7f) * 0x8000 + tile * TILE_BYTES_4BPP;
      cells.push({ tile, bank, sourceOffset, hasAlpha: (word & 0x8000) !== 0 });
    }
  }

  return {
    table,
    index,
    cpuAddr: 0x8000 + index * 2,
    recordCpuAddr: ptr,
    fileOffset: recOff,
    x,
    y,
    w,
    h,
    extType,
    cells,
  };
}

export function parseLibrary(data: Uint8Array, base: number, n: number, table: 'C1' | 'C2'): PieceRecord[] {
  const out: PieceRecord[] = [];
  for (let i = 0; i < n; i++) {
    const slotOff = base + i * 2;
    const ptr = u16(data, slotOff);
    if (ptr === 0xffff || ptr < 0x8000) continue; // unused slot
    const recOff = base + (ptr - 0x8000);
    out.push(parsePieceAt(data, table, base, i, ptr, recOff));
  }
  return out;
}

/**
 * Resolve one raw **compose-list word** (bit 15 selects `C1`/`C2`, the low
 * 15 bits are a byte offset into that table -- docs §3.14.3) directly into
 * a `PieceRecord`, without needing a pre-built library array. This is what
 * the per-depth/per-direction wallValue tables in bank `$89` (§3.14.5) and
 * `$80:CC40`/`$80:CC72`'s "append `table[wallValue]` to the compose list"
 * mechanism (§3.14.5, §3.14.7) actually store per entry -- confirmed this
 * session by resolving all 15 of the doc's cited front/left/right per-depth
 * table addresses' own index-1 entry and finding every one lands on the
 * *exact* `(x,y,w,h)` placement §3.14.5's table already cites, 15/15 (see
 * `docs/wizardry6/snes/data-structure.md` §3.14.11). Returns `null` for the
 * unused-slot sentinel (`0xFFFF`, or a target pointer `< 0x8000`) exactly
 * like `parseLibrary` does for a table slot.
 */
export function resolveComposeWord(data: Uint8Array, word: number): PieceRecord | null {
  const table: 'C1' | 'C2' = word & 0x8000 ? 'C2' : 'C1';
  const base = table === 'C2' ? C2_BASE : C1_BASE;
  const byteOffset = word & 0x7fff;
  const slotOff = base + byteOffset;
  if (slotOff + 2 > data.length) return null;
  const ptr = u16(data, slotOff);
  if (ptr === 0xffff || ptr < 0x8000) return null;
  const recOff = base + (ptr - 0x8000);
  return parsePieceAt(data, table, base, byteOffset / 2, ptr, recOff);
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-dungeon-composer.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  // Oracle check: library C1's table length is self-describing (first
  // pointer implies where the table ends / payload begins) -- re-derive it
  // rather than trusting a hard-coded constant.
  const c1First = u16(data, C1_BASE);
  const n1 = (c1First - 0x8000) / 2;
  if (!Number.isInteger(n1) || n1 <= 0) {
    console.error(`Oracle check FAILED: C1's first table entry (0x${c1First.toString(16)}) doesn't imply a whole entry count.`);
    process.exit(1);
  }
  console.log(`Oracle check: C1 table is self-describing -- first pointer 0x${c1First.toString(16)} implies ${n1} entries.`);

  const records = [...parseLibrary(data, C1_BASE, n1, 'C1'), ...parseLibrary(data, C2_BASE, C2_TABLE_LEN, 'C2')];

  // Structural invariant: every piece must fit the 18x15 viewport.
  const violations = records.filter((r) => r.x + r.w > VIEWPORT_W || r.y + r.h > VIEWPORT_H);
  console.log(
    `Viewport-fit invariant: ${records.length - violations.length}/${records.length} records fit an 18x15 viewport, ${violations.length} violations.`,
  );
  if (violations.length > 0) {
    console.error('Oracle check FAILED: unexpected viewport violations, not writing output.');
    console.error(violations.slice(0, 5));
    process.exit(1);
  }

  const plain = records.filter((r) => r.extType === 'plain').length;
  const redirect = records.filter((r) => r.extType === 'redirect').length;
  const strided = records.filter((r) => r.extType === 'redirect-strided').length;
  console.log(`Record shapes: ${plain} plain, ${redirect} simple-redirect, ${strided} strided-redirect (all confirmed).`);

  // Pool cross-check: what fraction of non-zero cell words resolve into the
  // confirmed dungeon-art pool banks ($90-$99, mirrors of $10-$19)?
  let nonZero = 0;
  let inPool = 0;
  for (const r of records) {
    for (const c of r.cells) {
      if (!c) continue;
      nonZero++;
      if (c.bank >= 0x90 && c.bank <= 0x99) inPool++;
    }
  }
  console.log(`Pool cross-check: ${inPool}/${nonZero} non-zero cell words (${((100 * inPool) / nonZero).toFixed(1)}%) resolve into banks $90-$99 (the confirmed dungeon-art pool).`);

  // Confirmed dungeon-view palette (docs section 3.14.10): render with the
  // default/most common region palette (group 40).
  const palette = loadPaletteRGB(data, DEFAULT_PALETTE_SELECTOR);

  // Render each piece as its own sprite.
  const packItems: PackInput[] = records.map((r) => ({
    name: `${r.table}_${String(r.index).padStart(4, '0')}`,
    width: Math.max(1, r.w) * TILE_SIZE_PX,
    height: Math.max(1, r.h) * TILE_SIZE_PX,
  }));
  const packed = shelfPack(packItems, 64 * TILE_SIZE_PX, 1);
  const rgba = new Uint8Array(packed.width * packed.height * 4);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const frame = packed.frames[i];
    for (let row = 0; row < r.h; row++) {
      for (let col = 0; col < r.w; col++) {
        const cell = r.cells[row * r.w + col];
        if (!cell) continue;
        const tile = decodeTile4bpp(data, cell.sourceOffset);
        for (let ty = 0; ty < TILE_SIZE_PX; ty++) {
          for (let tx = 0; tx < TILE_SIZE_PX; tx++) {
            const idx = tile[ty * TILE_SIZE_PX + tx];
            const px = ((frame.y + row * TILE_SIZE_PX + ty) * packed.width + (frame.x + col * TILE_SIZE_PX + tx)) * 4;
            rgba[px] = palette[idx * 3];
            rgba[px + 1] = palette[idx * 3 + 1];
            rgba[px + 2] = palette[idx * 3 + 2];
            rgba[px + 3] = idx === 0 ? 0 : 255;
          }
        }
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });
  mkdirSync(resolve(outDir, 'screens'), { recursive: true });
  mkdirSync(resolve(outDir, 'data'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/dungeon-view-pieces.png'), rgba, packed.width, packed.height);
  writeJson(resolve(outDir, 'sprites/dungeon-view-pieces.json'), {
    frames: packed.frames.map((f, i) => ({
      name: f.name,
      x: f.x,
      y: f.y,
      w: f.width,
      h: f.height,
      table: records[i].table,
      tableIndex: records[i].index,
      viewportX: records[i].x,
      viewportY: records[i].y,
      viewportW: records[i].w,
      viewportH: records[i].h,
      cpuAddr: `$${records[i].table === 'C1' ? 'C1' : 'C2'}:${records[i].cpuAddr.toString(16).toUpperCase()}`,
      recordCpuAddr: `$${records[i].table === 'C1' ? 'C1' : 'C2'}:${records[i].recordCpuAddr.toString(16).toUpperCase()}`,
      extType: records[i].extType,
      confidence: 'confirmed',
    })),
    width: packed.width,
    height: packed.height,
    viewportCells: { w: VIEWPORT_W, h: VIEWPORT_H },
    note:
      'View compose-piece libraries (banks $41/$42, file 0x208000/0x210000) -- individual pieces, not a composed scene. ' +
      'Each piece is a rectangular block of cells placed at (viewportX,viewportY) in an 18x15 first-person view grid. ' +
      'Which pieces get selected per dungeon cell is decoded separately -- see docs/wizardry6/snes/data-structure.md ' +
      'section 3.14.7/3.14.8. Coloured with the confirmed default dungeon palette (group 40, $094c=0x50, section 3.14.10) -- ' +
      'the real per-piece palette varies by dungeon region (12 confirmed groups, see palettes/dungeon-region-*.json). ' +
      `Record shapes: ${plain} plain, ${redirect} simple-redirect, ${strided} strided-redirect -- all confirmed (0x03:E29B-0x03:E2E4).`,
  });

  // Export all 12 confirmed dungeon-region palettes as standalone assets.
  mkdirSync(resolve(outDir, 'palettes'), { recursive: true });
  for (const [selectorStr, group] of Object.entries(DUNGEON_PALETTE_GROUPS)) {
    const selector = Number(selectorStr);
    const rgb = loadPaletteRGB(data, selector);
    const colors = [];
    for (let i = 0; i < 16; i++) colors.push({ r: rgb[i * 3], g: rgb[i * 3 + 1], b: rgb[i * 3 + 2] });
    writeJson(resolve(outDir, `palettes/dungeon-region-${group}.json`), {
      colors,
      selector: `0x${selector.toString(16)}`,
      group,
      sourceFileOffset: `0x${(PALETTE_TABLE_BASE + group * 32).toString(16)}`,
      note: 'CGRAM sub-palette 2 (colours 32-47) contents for one dungeon region -- see docs/wizardry6/snes/data-structure.md section 3.14.10.',
    });
  }

  // Decisive single-piece render: the one library $C2 record that is a
  // complete standalone first-person view by itself (fills the whole 18x15
  // viewport) -- see docs/wizardry6/snes/data-structure.md section 3.14.6.
  const decisive = records.find((r) => r.table === DECISIVE_TABLE && r.index === DECISIVE_INDEX);
  if (!decisive) {
    console.error(`Oracle check FAILED: decisive record ${DECISIVE_TABLE} index ${DECISIVE_INDEX} not found.`);
    process.exit(1);
  }
  if (decisive.w !== VIEWPORT_W || decisive.h !== VIEWPORT_H) {
    console.error(
      `Oracle check FAILED: decisive record's dimensions (${decisive.w}x${decisive.h}) don't fill the full ${VIEWPORT_W}x${VIEWPORT_H} viewport as expected.`,
    );
    process.exit(1);
  }
  const dW = decisive.w * TILE_SIZE_PX;
  const dH = decisive.h * TILE_SIZE_PX;
  const dRgba = new Uint8Array(dW * dH * 4);
  for (let row = 0; row < decisive.h; row++) {
    for (let col = 0; col < decisive.w; col++) {
      const cell = decisive.cells[row * decisive.w + col];
      if (!cell) continue;
      const tile = decodeTile4bpp(data, cell.sourceOffset);
      for (let ty = 0; ty < TILE_SIZE_PX; ty++) {
        for (let tx = 0; tx < TILE_SIZE_PX; tx++) {
          const idx = tile[ty * TILE_SIZE_PX + tx];
          const px = ((row * TILE_SIZE_PX + ty) * dW + (col * TILE_SIZE_PX + tx)) * 4;
          dRgba[px] = palette[idx * 3];
          dRgba[px + 1] = palette[idx * 3 + 1];
          dRgba[px + 2] = palette[idx * 3 + 2];
          dRgba[px + 3] = idx === 0 ? 0 : 255;
        }
      }
    }
  }
  writePNG(resolve(outDir, 'screens/dungeon-view-sample.png'), dRgba, dW, dH);
  writeJson(resolve(outDir, 'screens/dungeon-view-sample.json'), {
    width: dW,
    height: dH,
    table: DECISIVE_TABLE,
    tableIndex: DECISIVE_INDEX,
    cpuAddr: `$C2:${decisive.cpuAddr.toString(16).toUpperCase()}`,
    note:
      'Decisive render oracle -- a single compose-piece library record that fills the entire 18x15 first-person view viewport by ' +
      'itself: a carved stone portal with a knotwork lintel, flanking pilasters, two standing wall-torches, ashlar masonry, and a ' +
      'checkerboard floor in perspective. See docs/wizardry6/snes/data-structure.md section 3.14.6. Coloured with the confirmed ' +
      'default dungeon palette (group 40, $094c=0x50, section 3.14.10).',
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => e.name !== 'dungeon-view-pieces' && e.name !== 'dungeon-view-sample');
  withoutOld.push({
    name: 'dungeon-view-pieces',
    group: 'sprites',
    png: 'sprites/dungeon-view-pieces.png',
    atlas: 'sprites/dungeon-view-pieces.json',
    palette: null,
    sprites: records.length,
  });
  withoutOld.push({
    name: 'dungeon-view-sample',
    group: 'screens',
    png: 'screens/dungeon-view-sample.png',
    atlas: 'screens/dungeon-view-sample.json',
    palette: null,
    sprites: 1,
  });
  writeJson(manifestPath, withoutOld);

  console.log(`Decoded ${records.length} view compose-piece records (${packed.width}x${packed.height} atlas) and the decisive sample view.`);
  console.log(
    'Wrote public/assets/wizardry6/snes/sprites/dungeon-view-pieces.png/.json, screens/dungeon-view-sample.png/.json, and updated manifest.json',
  );
}

// Guarded per `cli-script-main-fires-on-import.md` -- `export-dungeon-view.ts`
// imports `resolveComposeWord`/`parseLibrary` from this module and must not
// re-trigger this file's own CLI pipeline as a side effect of that import.
const isStandalone =
  process.argv[1]?.endsWith('decode-dungeon-composer.ts') || process.argv[1]?.endsWith('decode-dungeon-composer');

if (isStandalone) main();
