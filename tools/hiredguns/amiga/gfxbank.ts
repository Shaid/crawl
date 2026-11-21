/**
 * Hired Guns (Amiga) "block graphics" banks — `Styles/StyleNN.gfx`, `Game/Misc.gfx`
 * (RNC1-unpacked) and the decrunched `CharactersGfx`/`MonstersGfx` figures. Browser-safe.
 *
 * Shape (learned from the CD32 dev archive: `Graphics/Style1/Ass/Style1.s` builds the
 * table, `Stone.s` one record, `Sources/Macros.i` `bob_structure`, `Sources/Equates.i`
 * "Block graphics structure"; re-checked on all 5 retail Style banks):
 *
 *   bank   u32 offsets[], one per graphic (0 = none), up to the first record
 *   record +0  18-byte bob header: u32 addr (runtime), u16 w, u16 h,
 *              u16 maskPlane (0-5, 6 = no mask), u8 control, u8 clip, u8 planeOps[6]
 *              (per screen bitplane: 0 no draw, 1 copy, 2 clear, 3 set, 4 clear)
 *          +18 67 x 14-byte placements, one per view position (see view.ts):
 *              s16 w, s16 h, s16 x, s16 y, s16 control, u32 dataOffset (from record start)
 *              control: 0 normal, 1 flipped (vertical), 2 normal + flipped copy below,
 *              3 nothing, -1 random flip, >3 "split": the flipped half is drawn `control`
 *              rows lower, pushed apart by the cell's variant (lifts, force fields)
 *   image  plane-major bitplanes of (w/8)*h bytes: planes 0..3 colour, plane 4 mask
 */

export const VIEW_POSITIONS = 67;
export const BOB_HEADER = 18;
export const PLACEMENT = 14;

export interface Placement { w: number; h: number; x: number; y: number; control: number; data: number }

export interface GfxRecord {
  offset: number;
  maskPlane: number;
  planeOps: number[];
  bobs: Placement[];
}

export interface GfxBank {
  data: Uint8Array;
  records: Array<GfxRecord | null>;
}

export function parseGfxBank(data: Uint8Array): GfxBank {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let first = data.length;
  const offs: number[] = [];
  for (let i = 0; 4 * i < first && 4 * i + 4 <= data.length; i++) {
    const o = dv.getUint32(4 * i);
    offs.push(o);
    if (o !== 0 && o < first) first = o;
  }
  const records = offs.map((o): GfxRecord | null => {
    if (o === 0 || o + BOB_HEADER + VIEW_POSITIONS * PLACEMENT > data.length) return null;
    const bobs: Placement[] = [];
    for (let k = 0; k < VIEW_POSITIONS; k++) {
      const p = o + BOB_HEADER + PLACEMENT * k;
      bobs.push({ w: dv.getInt16(p), h: dv.getInt16(p + 2), x: dv.getInt16(p + 4), y: dv.getInt16(p + 6), control: dv.getInt16(p + 8), data: dv.getUint32(p + 10) });
    }
    return {
      offset: o,
      maskPlane: dv.getUint16(o + 8),
      planeOps: Array.from(data.subarray(o + 12, o + 18)),
      bobs,
    };
  });
  return { data, records };
}

/** A single-record bank (a decrunched figure's four facing records are records at 0/3556/7112/10668). */
export function recordAt(data: Uint8Array, offset: number): GfxRecord {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bobs: Placement[] = [];
  for (let k = 0; k < VIEW_POSITIONS; k++) {
    const p = offset + BOB_HEADER + PLACEMENT * k;
    bobs.push({ w: dv.getInt16(p), h: dv.getInt16(p + 2), x: dv.getInt16(p + 4), y: dv.getInt16(p + 6), control: dv.getInt16(p + 8), data: dv.getUint32(p + 10) });
  }
  return { offset, maskPlane: dv.getUint16(offset + 8), planeOps: Array.from(data.subarray(offset + 12, offset + 18)), bobs };
}

/** Is a placement drawable at all (non-empty, inside the bank)? */
export function placementValid(bank: GfxBank, rec: GfxRecord, b: Placement): boolean {
  if (b.control === 3 || b.w <= 0 || b.h <= 0 || (b.w & 15) !== 0) return false;
  const start = rec.offset + b.data;
  return start + (b.w >> 3) * b.h <= bank.data.length;
}
