/**
 * Extracts the SNES ROM's full-body creature/monster sprite bank (see
 * docs/wizardry6/snes/data-structure.md section 3.11). Closes the long-open
 * `snes-full-body-sprites` item -- four bounded checks across three prior
 * sessions failed to find this.
 *
 * Found via a `re-codebreaker` escalation, then the palette/pose format
 * solved by a `re-oracle` escalation, **both independently re-verified from
 * scratch** (fresh TypeScript/Python re-derivation, never either
 * escalation's own script -- see
 * game-re-lessons/verify-escalation-artifacts-not-just-claims.md):
 *   - Master table (251 x 4-byte entries, file 0x200000 = CPU $C0:8000):
 *     independently confirmed 100 distinct `recordPtr` values, all congruent
 *     mod 7 to the claimed pool base 0x83EC, and `min(recordPtr) === 0x83EC`
 *     exactly.
 *   - Record pool (100 x 7-byte entries, file 0x2003EC): independently
 *     confirmed the pool's own end (`0x2003EC + 100*7 = 0x2006A8`) equals the
 *     lowest resolved `ptrA` file offset across all 100 records, byte-exact.
 *   - LZSS decode: independently confirmed all 100 records decompress
 *     cleanly (zero overrun) to a whole number of 4bpp tiles (8192B/256
 *     tiles x91, 16384B/512 tiles x8, 10240B/320 tiles x1 -- exact match).
 *   - `ptrB == ptrA + 2 + lzssStreamLength` holds for 84/100 records
 *     (re-derived independently, reproducing the escalation's own count).
 *   - **Palette formula**: re-derived byte-for-byte from a fresh hex dump at
 *     the cited consumer address (file 0x05f651: `a2 40 01 a4 40 a9 40 22 a0
 *     86 82` = `LDX #$0140; LDY $40; LDA #$40; JSL $8286A0`, matching the
 *     claimed disassembly exactly) and cross-checked against the confirmed
 *     CGRAM-DMA dispatch table (section 3.3 method: `$ca=30` ->
 *     `CGADD=0xA0, src=$7e:3940, size=0x40`, matching the call's own
 *     operands). Independently confirmed the "zero BGR555 high-bit" invariant
 *     across all 4,160 words in the palette region (0x10764-0x127e4).
 *   - **Frame/pose format**: re-implemented the 5-byte-header + linked
 *     `[u16 nextPtr][4-byte OAM entries][0xFF]` frame-chain walk from
 *     scratch and composed real frames with the palette above -- produced
 *     an unmistakable armoured knight (record 1), winged purple demon
 *     (record 61), and horned red demon (record 92), matching the
 *     escalation's own descriptions exactly. This is the decisive render
 *     oracle this session's re-verification rests on.
 *
 * **Format**: master table `[u16 recordPtr][u16 palOfs]` x251 (file
 * 0x200000, CPU bank $C0) indexes into a `[3-byte ptrA][3-byte ptrB][u8
 * flag]` x100 record pool (file 0x2003EC). `ptrA` -> `[u16 type][LZSS
 * stream]`; `type` in {0,1,2,3,4}. `ptrB` -> a 5-byte header (byte 0 =
 * randomized-start-frame modulus, bytes 1-4 still open) then a linked list
 * of frames: `[u16 nextFrameAddr (same bank as ptrB)][OAM entries...][0xFF
 * terminator]`. Each OAM entry is `[attr][tile][x][y]`: `attr` bit0 = tile
 * bit8, bit1 = palette row (0 or 1) within the record's 2-row CGRAM
 * allocation, bit4 = 16x16 (vs 8x8) size, bit5/6 = h/v flip. `palOfs` (the
 * master table's second word, previously mislabelled a VRAM "dest") is a
 * byte offset into the shared CGRAM colour-group table (file 0x10764, see
 * section 3.3) -- `file 0x10764 + palOfs`, 64 bytes = two 16-colour BGR555
 * rows. Multiple master-table slots can reference the same pool record with
 * different `palOfs` values (palette-swapped monster families sharing one
 * CHR bank).
 *
 * **This extractor composes each record's first animation frame** (a
 * static pose, correctly coloured and positioned via the OAM entries) --
 * not the full animation (frame *count* and the primary `palOfs` are
 * recorded in the JSON sidecar so a future pass can render every frame /
 * every palette-swap variant). Some records' frame chains loop (animation
 * cycles) -- this extractor walks with a visited-address guard and simply
 * stops there, since only frame 0 is rendered.
 *
 * **Palette -- confirmed** (see docs/wizardry6/snes/data-structure.md
 * section 3.11). Baked into the PNG.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-creature-sprites.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile4bpp, bgr555ToRGB } from '../../shared/snes-ppu';
import { decodeLzss } from '../../shared/snes-lzss';
import { shelfPack, type PackInput } from '../../shared/atlas-pack';

const TABLE_OFFSET = 0x200000; // file offset, CPU $C0:8000
const TABLE_ENTRIES = 251;
const POOL_STRIDE = 7;
const ATLAS_MAX_WIDTH = 1400; // px, shelf-packing width budget for the combined atlas
const PALETTE_TABLE_BASE = 0x10764; // file offset, CPU $82:8764 -- confirmed shared CGRAM colour-group table (section 3.3)
const PALETTE_ROW_BYTES = 32; // 16 BGR555 colours/row
const MAX_FRAME_ENTRIES = 128; // safety cap -- real records top out well under this
const MAX_CHAIN_HOPS = 200; // safety cap for the frame-chain walk (matches this session's Python probe)

function loromToFile(bank: number, addr: number): number | null {
  const b = bank & 0x7f;
  if (addr < 0x8000) return null;
  return b * 0x8000 + (addr - 0x8000);
}

interface OamEntry {
  attr: number;
  tile: number;
  x: number; // signed
  y: number; // signed
}

/** Parse the OAM entry list of the frame whose `[u16 nextPtr]` header sits at `frameOff`. */
function parseFrameEntries(data: Uint8Array, frameOff: number): OamEntry[] {
  const entries: OamEntry[] = [];
  let p = frameOff + 2; // skip this frame's own [u16 nextPtr]
  for (let i = 0; i < MAX_FRAME_ENTRIES; i++) {
    if (p >= data.length) break;
    const attr = data[p];
    if (attr === 0xff) break;
    if (p + 3 >= data.length) break;
    const txRaw = data[p + 2];
    const tyRaw = data[p + 3];
    entries.push({
      attr,
      tile: data[p + 1],
      x: txRaw >= 128 ? txRaw - 256 : txRaw,
      y: tyRaw >= 128 ? tyRaw - 256 : tyRaw,
    });
    p += 4;
  }
  return entries;
}

/** Walk the full frame chain starting at `fileB + 5` (visited-guarded -- chains legitimately loop), returning each frame's file offset in chain order. */
function walkFrames(data: Uint8Array, fileB: number, bank: number): number[] {
  let cur = fileB + 5;
  const seen = new Set<number>();
  const out: number[] = [];
  for (let hop = 0; hop < MAX_CHAIN_HOPS; hop++) {
    if (seen.has(cur) || cur + 1 >= data.length) break;
    seen.add(cur);
    out.push(cur);
    const nextAddr = data[cur] | (data[cur + 1] << 8);
    const nextFile = loromToFile(bank, nextAddr);
    if (nextFile === null) break;
    cur = nextFile;
  }
  return out;
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-creature-sprites.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  // Master table: [u16 recordPtr][u16 palOfs] x251.
  const masterEntries: { recordPtrAddr: number; palOfs: number }[] = [];
  for (let i = 0; i < TABLE_ENTRIES; i++) {
    const off = TABLE_OFFSET + i * 4;
    masterEntries.push({
      recordPtrAddr: data[off] | (data[off + 1] << 8),
      palOfs: data[off + 2] | (data[off + 3] << 8),
    });
  }
  const distinctPtrs = Array.from(new Set(masterEntries.map((e) => e.recordPtrAddr))).sort((a, b) => a - b);
  const poolBaseAddr = distinctPtrs[0];
  const poolBaseFile = loromToFile(0xc0, poolBaseAddr);
  if (poolBaseFile === null) {
    console.error('Oracle check FAILED: pool base address resolves outside the ROM window. Not writing output.');
    process.exit(1);
  }
  console.log(
    `Oracle check: master table (251 entries) resolves to ${distinctPtrs.length} distinct pool records, base CPU $C0:${poolBaseAddr
      .toString(16)
      .padStart(4, '0')} -> file 0x${poolBaseFile.toString(16)}.`,
  );

  const recordCount = distinctPtrs.length;

  interface Record {
    index: number;
    ptrA: number;
    ptrB: number;
    flag: number;
    fileA: number | null;
    typeField: number;
    lzssStreamLength: number;
    ptrBMatchesFormula: boolean;
    tileCount: number;
    chr: Uint8Array;
    /** Per-frame OAM entry lists, full animation chain (frame 0 first). */
    frames: OamEntry[][];
    frameCount: number;
    palOfsPrimary: number | null;
    palOfsAlternates: number[];
  }
  const records: Record[] = [];

  for (let i = 0; i < recordCount; i++) {
    const off = poolBaseFile + i * POOL_STRIDE;
    const ptrA = data[off] | (data[off + 1] << 8) | (data[off + 2] << 16);
    const ptrB = data[off + 3] | (data[off + 4] << 8) | (data[off + 5] << 16);
    const flag = data[off + 6];
    const fileA = loromToFile((ptrA >> 16) & 0xff, ptrA & 0xffff);
    const fileB = loromToFile((ptrB >> 16) & 0xff, ptrB & 0xffff);

    const matchingPalOfs = masterEntries.filter((e) => e.recordPtrAddr === distinctPtrs[i]).map((e) => e.palOfs);

    if (fileA === null || fileB === null) {
      records.push({
        index: i,
        ptrA,
        ptrB,
        flag,
        fileA,
        typeField: -1,
        lzssStreamLength: 0,
        ptrBMatchesFormula: false,
        tileCount: 0,
        chr: new Uint8Array(0),
        frames: [],
        frameCount: 0,
        palOfsPrimary: matchingPalOfs[0] ?? null,
        palOfsAlternates: matchingPalOfs.slice(1),
      });
      continue;
    }

    const typeField = data[fileA] | (data[fileA + 1] << 8);
    const { data: chr, streamLength } = decodeLzss(data, fileA + 2);
    const tileCount = Math.floor(chr.length / 32);
    const ptrBMatchesFormula = fileB === fileA + 2 + streamLength;

    const bank = (ptrB >> 16) & 0xff;
    const frameOffsets = walkFrames(data, fileB, bank);
    const frames = frameOffsets.map((fo) => parseFrameEntries(data, fo));
    const frameCount = frames.length;

    records.push({
      index: i,
      ptrA,
      ptrB,
      flag,
      fileA,
      typeField,
      lzssStreamLength: streamLength,
      ptrBMatchesFormula,
      tileCount,
      chr,
      frames,
      frameCount,
      palOfsPrimary: matchingPalOfs[0] ?? null,
      palOfsAlternates: matchingPalOfs.slice(1),
    });
  }

  const matchCount = records.filter((r) => r.ptrBMatchesFormula).length;
  console.log(`ptrB == ptrA + 2 + lzssStreamLength holds for ${matchCount}/${recordCount} records (expected ~84/100).`);

  // Compose EVERY frame of each record: per-frame tight bounding box, then draw.
  interface Composed {
    index: number;
    frame: number;
    width: number;
    height: number;
    pixels: Uint8ClampedArray; // RGBA, width*height*4
  }
  const composed: Composed[] = [];

  for (const r of records) {
    if (r.frames.length === 0 || r.palOfsPrimary === null) continue;

    const paletteBase = PALETTE_TABLE_BASE + r.palOfsPrimary;
    if (paletteBase + PALETTE_ROW_BYTES * 2 > data.length) continue;
    const rows: [number, number, number][][] = [[], []];
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < 16; c++) {
        const wOff = paletteBase + row * PALETTE_ROW_BYTES + c * 2;
        const word = data[wOff] | (data[wOff + 1] << 8);
        rows[row].push(bgr555ToRGB(word));
      }
    }

    for (let fi = 0; fi < r.frames.length; fi++) {
    const frameEntries = r.frames[fi]!;
    if (frameEntries.length === 0) continue;
    // Bounding box across all entries (accounting for 8px vs 16px sprite size).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const e of frameEntries) {
      const size = (e.attr >> 4) & 1 ? 16 : 8;
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + size);
      maxY = Math.max(maxY, e.y + size);
    }
    if (!Number.isFinite(minX)) continue;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    if (width > 512 || height > 512) continue; // sanity guard against a malformed chain producing an absurd canvas

    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const e of frameEntries) {
      const size16 = (e.attr >> 4) & 1;
      const palRow = (e.attr >> 1) & 1;
      const hflip = (e.attr >> 5) & 1;
      const vflip = (e.attr >> 6) & 1;
      const fullTileRaw = ((e.attr & 1) << 8) | e.tile;
      const fullTile = r.tileCount > 0 ? fullTileRaw % r.tileCount : 0;
      const subTiles: [number, number, number][] = size16
        ? [
            [fullTile, 0, 0],
            [fullTile + 1, 8, 0],
            [fullTile + 16, 0, 8],
            [fullTile + 17, 8, 8],
          ]
        : [[fullTile, 0, 0]];

      for (const [tnum, dx, dy] of subTiles) {
        if ((tnum + 1) * 32 > r.chr.length) continue;
        const tile = decodeTile4bpp(r.chr, tnum * 32);
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const idx = tile[row * 8 + col];
            if (idx === 0) continue;
            const [rr, gg, bb] = rows[palRow][idx];
            const px = e.x - minX + dx + (hflip ? 7 - col : col);
            const py = e.y - minY + dy + (vflip ? 7 - row : row);
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const o = (py * width + px) * 4;
            pixels[o] = rr;
            pixels[o + 1] = gg;
            pixels[o + 2] = bb;
            pixels[o + 3] = 255;
          }
        }
      }
    }
    composed.push({ index: r.index, frame: fi, width, height, pixels });
    }
  }

  const recordsComposed = new Set(composed.map((c) => c.index)).size;
  console.log(`Composed ${composed.length} frames across ${recordsComposed}/${recordCount} records (full animation chains, primary palette).`);

  const frameName = (c: Composed) => `creature_${String(c.index).padStart(3, '0')}_f${String(c.frame).padStart(2, '0')}`;
  const packItems: PackInput[] = composed.map((c) => ({ name: frameName(c), width: c.width, height: c.height }));
  const packed = shelfPack(packItems, ATLAS_MAX_WIDTH, 2);
  const frameByName = new Map(packed.frames.map((f) => [f.name, f]));

  const rgba = new Uint8Array(packed.width * packed.height * 4);
  for (const c of composed) {
    const frame = frameByName.get(frameName(c));
    if (!frame) continue;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const src = (y * c.width + x) * 4;
        const dst = ((frame.y + y) * packed.width + (frame.x + x)) * 4;
        rgba[dst] = c.pixels[src];
        rgba[dst + 1] = c.pixels[src + 1];
        rgba[dst + 2] = c.pixels[src + 2];
        rgba[dst + 3] = c.pixels[src + 3];
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/creature-sprites.png'), rgba, packed.width, packed.height);
  writeJson(resolve(outDir, 'sprites/creature-sprites.json'), {
    width: packed.width,
    height: packed.height,
    recordCount,
    composedCount: composed.length,
    confidence: 'confirmed',
    note:
      'creature_NNN_fFF = record NNN, animation frame FF -- the FULL frame chain of every record is composed ' +
      '(real poses, real CGRAM palette baked in). palOfsAlternates lists other confirmed palette-swap variants of ' +
      'the same CHR (not separately rendered -- swap the two 16-colour rows at paletteFileOffset). ' +
      'typeField semantics (confirmed, $00:F58E dispatch): 0/1 = formation-slot position (table $00:F3D8) + ' +
      'randomized animation start frame; 2/3 = position from the frame-list header bytes; 4 = fixed position 0xF0. ' +
      'See docs/wizardry6/snes/data-structure.md section 3.11.',
    frames: packed.frames.map((f) => {
      const idx = Number(f.name.slice('creature_'.length, 'creature_'.length + 3));
      const r = records.find((rec) => rec.index === idx)!;
      return {
        name: f.name,
        x: f.x,
        y: f.y,
        w: f.width,
        h: f.height,
        recordIndex: r.index,
        frameIndex: Number(f.name.slice(-2)),
        ptrA: `0x${r.ptrA.toString(16)}`,
        ptrB: `0x${r.ptrB.toString(16)}`,
        fileOffsetA: r.fileA,
        typeField: r.typeField,
        flag: r.flag,
        tileCount: r.tileCount,
        frameCount: r.frameCount,
        ptrBMatchesFormula: r.ptrBMatchesFormula,
        palOfs: r.palOfsPrimary,
        palOfsAlternates: r.palOfsAlternates,
        paletteFileOffset: r.palOfsPrimary === null ? null : PALETTE_TABLE_BASE + r.palOfsPrimary,
      };
    }),
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => e.name !== 'creature-sprites');
  withoutOld.push({
    name: 'creature-sprites',
    group: 'sprites',
    png: 'sprites/creature-sprites.png',
    atlas: 'sprites/creature-sprites.json',
    palette: null, // colours baked into the PNG, same convention as portraits/ui-icons
    sprites: composed.length,
  });
  writeJson(manifestPath, withoutOld);

  console.log(`Wrote a ${packed.width}x${packed.height} atlas of ${composed.length} posed, coloured creature animation frames (full chains).`);
  console.log('Wrote public/assets/wizardry6/snes/sprites/creature-sprites.png, creature-sprites.json, and updated manifest.json');
}

main();
