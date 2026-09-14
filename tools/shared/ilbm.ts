/**
 * IFF `ILBM`/`PBM ` bitmap decode — a thin, reusable wrapper over
 * `@seer-project/iff`'s generic chunk walker + ByteRun1 codec, composed with
 * this project's own row-interleaved planar decoder (`amiga-planar.ts`).
 *
 * EA IFF-85 is a public, well-documented format (not game-specific); this
 * module exists because no game in this repo had needed a full ILBM reader
 * before Elvira 2's `Pics/` directory (plain, uncompressed-container
 * ILBM level-map pictures — see `docs/elvira2/amiga/data-structure.md`).
 * Reuse for any future Amiga ILBM/PBM asset rather than re-deriving BMHD/
 * CMAP/BODY parsing inline.
 *
 * Row-interleaved plane decode is `@seer-project/gfx`'s `decodePlanar`,
 * which requires `width % 8 === 0` (real Elvira 2 `Pics/` widths are all
 * 640, so this holds for every asset in this corpus).
 */
import { parseIff, findChunk, decodeByteRun1, type IffForm } from '@seer-project/iff';
import { decodePlanar } from '@seer-project/gfx';
import { indicesToPaletteRGBA, type RGB } from './amiga-planar.ts';

export interface IlbmBitmap {
  width: number;
  height: number;
  planes: number;
  compression: number;
  masking: number;
  palette: RGB[];
  indices: Uint8Array;
}

/** Parse an ILBM/PBM `FORM`. Returns null if not a recognizable bitmap FORM. */
export function decodeIlbm(data: Uint8Array): IlbmBitmap | null {
  const form = parseIff(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  if (!form || (form.type !== 'ILBM' && form.type !== 'PBM ')) return null;
  return decodeIlbmForm(form);
}

export function decodeIlbmForm(form: IffForm): IlbmBitmap | null {
  const bmhd = findChunk(form, 'BMHD');
  if (!bmhd || bmhd.data.length < 20) return null;

  const view = new DataView(bmhd.data.buffer, bmhd.data.byteOffset, bmhd.data.byteLength);
  const width = view.getUint16(0, false);
  const height = view.getUint16(2, false);
  const planes = bmhd.data[8];
  const masking = bmhd.data[9];
  const compression = bmhd.data[10];

  const cmap = findChunk(form, 'CMAP');
  const palette: RGB[] = [];
  if (cmap) {
    for (let i = 0; i + 2 < cmap.data.length; i += 3) {
      palette.push({ r: cmap.data[i], g: cmap.data[i + 1], b: cmap.data[i + 2] });
    }
  }

  const body = findChunk(form, 'BODY');
  if (!body) return null;

  const rowBytes = Math.ceil(width / 8);
  const isPBM = form.type === 'PBM ';
  let indices: Uint8Array;
  if (isPBM) {
    // PBM = chunky (1 byte/pixel), row-major; ByteRun1 covers the whole BODY.
    const raw = compression === 1 ? decodeByteRun1(body.data, width * height) : body.data;
    indices = raw.subarray(0, width * height);
  } else {
    const planeSize = rowBytes * height * planes;
    const raw = compression === 1 ? decodeByteRun1(body.data, planeSize) : body.data.subarray(0, planeSize);
    indices = decodePlanar(raw, { width, height, planes, layout: 'row-interleaved' });
  }

  return { width, height, planes, compression, masking, palette, indices };
}

/** `IlbmBitmap` -> RGBA8888, treating colour 0 as opaque (level-map pictures have no mask). */
export function ilbmToRGBA(bmp: IlbmBitmap): Uint8Array {
  return indicesToPaletteRGBA({ indices: bmp.indices, width: bmp.width, height: bmp.height }, bmp.palette);
}
