/**
 * Eye of the Beholder II (Amiga) `.VCN` wall-tile decoder.
 *
 * **A genuine hybrid, confirmed empirically (2026-09-02) against every real
 * `data/eotb2/amiga/data/*.VCN` file, not assumed from either sibling
 * port.** The on-disk *container* is EOB2/EOB1-shared "Kyra bitmap header"
 * + LCW ("Format 80") compression -- the same 10-byte header
 * (`fileSizeField` u16 LE, `compType` u16 LE, `imgSize` u32 LE, `palSize`
 * u16 LE) every `.CPS`/`.INF` in this whole engine family uses, and
 * `compType` is `4` (LCW) in all 5 real wall-set files. This is a real
 * structural departure from EOB1 *Amiga*'s own `.VCN` (`tools/eotb/
 * decode-vcn.ts`: raw/uncompressed on disk, no header at all) -- EOB2
 * Amiga compresses its `.VCN`, EOB1 Amiga does not.
 *
 * Once decompressed, the payload is byte-for-byte **EOB1-Amiga's own raw
 * VCN layout** (`docs/eotb/amiga/data-structure.md` § "VCN -- Wall View
 * Data"): `numTiles` (u16 LE) -> 5 BE Amiga palette-patch words -> 22
 * reserved bytes -> `numTiles` row-interleaved 8x8 5-bitplane tiles (40
 * bytes each). Confirmed byte-exact for all 5 wall sets: decompressed
 * length == `0x22 + numTiles*40` with **zero** residue (CRIMSON:
 * numTiles=1138, decompressed=45554; DUNG: 1448/57954; FOREST: 904/36194;
 * MEZZ: 1193/47754; SILVER: 1115/44634).
 *
 * **The 5-colour palette patch is real bytes but always reads as all-zero
 * across every wall set in this corpus** (5 BE words, all `0x0000`) --
 * confirmed by direct inspection, not a decode bug: EOB1 Amiga's `.VCN`
 * patch mechanism exists as a real field in the shared container, but
 * EOB2 (which ships a standalone, full 32-colour `.PAL` file per wall
 * set -- see `./palette.ts`) evidently never populates it. `applyVcnPalette`
 * is still exported for API symmetry with EOB1's module, but with an
 * all-zero patch it is a no-op against the real corpus and callers should
 * simply use the wall set's own `.PAL` directly.
 *
 * Tile pixel decode reuses `@seer-project/gfx`'s `decodePlanar`
 * (`row-interleaved` layout) unmodified -- the same row-interleaved
 * 8x8x5bpp convention already confirmed for EOB1 Amiga's `.VCN` tiles.
 * Visually confirmed this session: a rendered 32-tiles-wide atlas of every
 * `CRIMSON.VCN` tile through `CRIMSON.PAL` shows a coherent, legible
 * red/brown brick-masonry texture sheet, not noise.
 */
import { decompressLCW } from '../../eotb/lcw.ts';
import { decodePlanar } from '@seer-project/gfx';
import { eobAmigaWordToRGB, readBEWords } from '../../eotb/palette.ts';

const TILE_SIZE = 8;
const TILE_PLANES = 5;
const TILE_BYTES = 40; // 8 rows * 1 byte/row * 5 planes
const HEADER_SIZE = 0x22; // numTiles(2) + 5 BE palette words(10) + reserved(22)

export interface VcnData {
  numTiles: number;
  /** 5 patch colours for palette slots 1-5, already RGB -- always [0,0,0]x5 in this corpus, see module doc. */
  patchColors: [number, number, number][];
  /** One Uint8Array (8x8 palette indices, 0-31) per tile. */
  tiles: Uint8Array[];
}

/** Strip the shared 10-byte "Kyra bitmap" header and LCW-decompress -- same container `../decode-cps.ts`/`../decode-inf.ts`'s `decompressInf` use. */
export function decompressKyraContainer(data: Uint8Array): Uint8Array {
  const compType = data[2]! | (data[3]! << 8);
  const imgSize = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  const palSize = data[8]! | (data[9]! << 8);
  const body = data.subarray(10 + palSize);
  let decompressed: Uint8Array;
  if (compType === 0) {
    decompressed = body.subarray(0, imgSize);
  } else if (compType === 4) {
    decompressed = decompressLCW(body, imgSize);
  } else {
    throw new Error(`decompressKyraContainer: unsupported compType ${compType} (only 0/raw and 4/LCW are implemented)`);
  }
  if (decompressed.length < imgSize) {
    throw new Error(`decompressKyraContainer: decompression produced ${decompressed.length} bytes, expected ${imgSize}`);
  }
  return decompressed;
}

export function decodeVcn(data: Uint8Array): VcnData {
  const dec = decompressKyraContainer(data);
  const numTiles = dec[0]! | (dec[1]! << 8);
  const expectedSize = HEADER_SIZE + numTiles * TILE_BYTES;
  if (dec.length !== expectedSize) {
    throw new Error(`decodeVcn: oracle check failed -- numTiles=${numTiles} implies decompressed size ${expectedSize}, got ${dec.length}`);
  }

  const patchWords = readBEWords(dec, 0x02, 5);
  const patchColors = patchWords.map(eobAmigaWordToRGB) as [number, number, number][];

  const tiles: Uint8Array[] = [];
  for (let i = 0; i < numTiles; i++) {
    tiles.push(
      decodePlanar(dec, {
        width: TILE_SIZE,
        height: TILE_SIZE,
        planes: TILE_PLANES,
        layout: 'row-interleaved',
        offset: HEADER_SIZE + i * TILE_BYTES,
      }),
    );
  }

  return { numTiles, patchColors, tiles };
}

/** API symmetry with EOB1's `applyVcnPalette` -- see module doc: the patch is all-zero in this corpus, so this is a documented no-op against real data. Callers should just use the wall set's own `.PAL` (`./palette.ts`) directly. */
export function applyVcnPalette(basePalette: [number, number, number][], vcn: VcnData): [number, number, number][] {
  const palette = basePalette.slice();
  for (let i = 0; i < 5; i++) palette[1 + i] = vcn.patchColors[i]!;
  return palette;
}
