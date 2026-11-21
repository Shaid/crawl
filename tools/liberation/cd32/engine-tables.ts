/**
 * Liberation (CD32): read the city view-composer tables out of `captiveII`.
 * Every offset is CODE-hunk-relative (file offset = 0x2C + value) unless noted;
 * see docs/liberation/cd32/data-structure.md § "City view composer".
 */
import { parseHunkFile } from '@seer-project/amiga';
import type { EngineTables, SlotEntry, DrawRec } from './view-model.ts';

export const OFF = {
  layerM1: 0x285ba, layerZ0: 0x285d6, layerZ1: 0x285f2, layerZ2: 0x2860e, layerZ3: 0x2862a,
  cityTypeTable: 0x26c16, // (2012,A5) in city mode: 64 x {s16 handler off, u16 flags}
  clip: 0x25a62,
  slotBank0: 0x2b230, // LAB_2B22E+2: static view, bank 0 (+0x2800E)
  texA: 0x2e220, texB: 0x2d5d0, // type-6 6-plane texture tables (+0x27BFE / +0x27C06)
  cityWalls: 0x37010, // count byte + VGM numbers (+0x36A0E)
  /** DATA hunk: AGA base palette CMAP body (IRA 0x4279C = DATA +0x389C), 64 x RGB8 */
  basePaletteData: 0x389c,
  /** DATA hunk +0: AmSp, 1 sprite 192x100x6: the city view backdrop, copied by +0x1D794 (pixels at +0x10) */
  backdropData: 0x10,
} as const;

export interface CaptiveImage { code: Uint8Array; data: Uint8Array }

export function splitCaptive(exe: Uint8Array): CaptiveImage {
  const hunks = parseHunkFile(exe);
  const code = hunks.find((h) => h.type === 'CODE')!;
  const data = hunks.find((h) => h.type === 'DATA')!;
  return {
    code: exe.subarray(code.fileOffset!, code.fileOffset! + code.size),
    data: exe.subarray(data.fileOffset!, data.fileOffset! + data.size),
  };
}

const s16 = (d: Uint8Array, o: number) => { const v = (d[o]! << 8) | d[o + 1]!; return v & 0x8000 ? v - 0x10000 : v; };

/** Window index the type-6 handler (+0x27E1C) looks its texture up under. */
function texIndex(idx: number, rec: DrawRec): number {
  const d4 = (rec.spr >> 6) & 3;
  if (!(rec.fl & 0x40)) return d4 === 0 ? idx + 5 : d4 === 2 ? idx - 1 : idx + 1;
  return d4 === 0 ? idx + 25 : idx - 25;
}

export function readSlots(code: Uint8Array, base = OFF.slotBank0): SlotEntry[] {
  const out: SlotEntry[] = [];
  let a = base + s16(code, base + 2);
  const cellTab = base + s16(code, base + 4);
  for (;;) {
    const idx = code[a]!, nb = code[a + 1]!, off = s16(code, a + 2);
    if (out.length > 0 && s16(code, a) < 0) break;
    const nbr = nb >= 0x80 ? nb - 0x100 : nb;
    if (off < 0) out.push({ idx, nbr, obj: true });
    else {
      const r = a + off;
      const rec: DrawRec = { x: code[r]!, y: code[r + 1]!, spr: code[r + 2]!, fl: code[r + 3]! };
      if (rec.fl & 0x10) {
        const n = code[r + 4]!;
        rec.runs = Array.from(code.subarray(r + 5, r + 6 + n));
      }
      let tex: SlotEntry['tex'] = null;
      const ti = texIndex(idx, rec);
      if (ti >= 0 && ti < 75) {
        const w = s16(code, cellTab + 2 * ti);
        if (w !== -1) {
          const b3 = code[cellTab + w + 3]!;
          tex = { table: rec.fl & 0x40 ? 1 : 0, off: (((-b3) & 0x1f) & ~1) << 4 };
        }
      }
      out.push({ idx, nbr, rec, tex });
    }
    a += 4;
  }
  return out;
}

/** Window visibility script at slot table + word 0 (run by +0x28646 after the fill). */
export function readVisScript(code: Uint8Array, base = OFF.slotBank0): number[] {
  const start = base + s16(code, base);
  let p = start;
  for (;;) {
    const b = code[p++]!;
    if (b === 0) break;
    if (b & 0x80) p += ((~b) & 0xff) + 1;
    else p += 1;
  }
  return Array.from(code.subarray(start, p));
}

export function readEngineTables(code: Uint8Array): EngineTables {
  const bytes = (o: number, n: number) => Array.from(code.subarray(o, o + n));
  return {
    layer: { m1: bytes(OFF.layerM1, 28), z0: bytes(OFF.layerZ0, 28), z1: bytes(OFF.layerZ1, 28), z2: bytes(OFF.layerZ2, 28), z3: bytes(OFF.layerZ3, 28) },
    flags: Array.from({ length: 64 }, (_, i) => (code[OFF.cityTypeTable + 4 * i + 2]! << 8) | code[OFF.cityTypeTable + 4 * i + 3]!),
    clip: Array.from(code.subarray(OFF.clip, OFF.clip + 8), (b) => (b >= 0x80 ? b - 0x100 : b)),
    slots: readSlots(code),
    vis: readVisScript(code),
    textures: [code.slice(OFF.texA, OFF.texA + 3072), code.slice(OFF.texB, OFF.texB + 3072)],
  };
}

/** 6 x 2400-byte planar backdrop the city view starts from (+0x1D7A0: MOVEA.L #DATA+0x10). */
export function readBackdrop(img: CaptiveImage): Uint8Array {
  return img.data.slice(OFF.backdropData, OFF.backdropData + 14400);
}

export function readCityWalls(code: Uint8Array): number[] {
  const n = code[OFF.cityWalls]!;
  return Array.from(code.subarray(OFF.cityWalls + 1, OFF.cityWalls + 1 + n));
}

/**
 * The 64-colour AGA view palette for a wall CMAP (captiveII +0x1CA8A): colours
 * 0-23 / 32-55 from the base CMAP, 24-31 / 56-63 from the wall CMAP's first /
 * second 24 bytes (CMAP + 12, +0x36A76 / +0x36A68 pick it).
 */
export function viewPalette(img: CaptiveImage, cmapCodeOff: number): Array<[number, number, number]> {
  const base = img.data.subarray(OFF.basePaletteData, OFF.basePaletteData + 192);
  const wall = img.code.subarray(cmapCodeOff + 12, cmapCodeOff + 60);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < 64; i++) {
    const src = (i & 31) >= 24 ? wall : base;
    const o = (i & 31) >= 24 ? ((i >> 5) * 8 + (i & 7)) * 3 : i * 3;
    out.push([src[o]!, src[o + 1]!, src[o + 2]!]);
  }
  return out;
}
