/**
 * MM2 `attrib.dat` codec — 60 screens × 64 bytes = 3840 bytes.
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/12-attrib-dat-format.md`).
 * Per-screen map attribute table parallel to `map.dat`: environment, world
 * adjacency, and roof data. The few multibyte fields are read byte-wise by the
 * engine (the Amiga build is big-endian); the "complex id" pair (+0x15/+0x16)
 * is stored big-endian.
 *
 *   +0x00  area_id       always equals the record index (0..59)
 *   +0x01  map_category  1 town, 2 cavern, 3 dungeon, 4 castle; 5..8 planes
 *   +0x02  tileset_id    graphics/wall set (town 0x21, cavern 0x32, ...)
 *   +0x03  env_type      0x11 town, 0x12 cavern, 0x13/0x14 castle, else outside
 *   +0x04  surface_flag  0 = interior; nonzero = overland terrain class
 *   +0x05..+0x08  neighbour ids N/E/S/W (interiors set all four = self)
 *   +0x09  field_09      mostly 0x64
 *   +0x0A..+0x0C  params (observed)
 *   +0x0D  field_0D      multiples of 10 (30..200)
 *   +0x0E  entry_coord   packed (Y<<4)|X spawn/safe square (asm-confirmed)
 *   +0x0F  era_gate      compared against current era index (asm-confirmed)
 *   +0x10  pad (0)
 *   +0x11  sublayout param (observed; role unclear, read/compared @ 0x12F58)
 *   +0x12  door_strength — asm-confirmed: materialized to A4-$5608,
 *          consumed by the door-bash handler @ 0x9C2A
 *   +0x13  door_trap — asm-confirmed: materialized to A4-$5607, consumed
 *          by the unlock handler @ 0x20D6E (NOT a second coordinate pair,
 *          per a correction in Vairn's own doc)
 *   +0x14  sublayout param (observed; role unclear, read/compared @ 0x1A8B4)
 *   +0x15  label / transition hi (outside label; interior complex_id high)
 *   +0x16  recall_coord  packed (Y<<4)|X (asm-confirmed)
 *   +0x17  level/floor   interior floor index
 *   +0x18  recall_screen destination screen id (asm-confirmed)
 *   +0x19  pad (0)
 *   +0x1A  flags         screen behaviour bitfield (asm-confirmed)
 *   +0x1B  flags2        nonzero on a few screens
 *   +0x1C..+0x1F  tail   mostly zero
 *   +0x20..+0x3F  roof_bits  256-bit roof bitmap, bit t of 16×16 tile
 */

export const ATTRIB_RECORD_SIZE = 64;
export const ATTRIB_SCREENS = 60;
export const ATTRIB_FILE_SIZE = ATTRIB_RECORD_SIZE * ATTRIB_SCREENS;

export interface AttribRecord {
  areaId: number;
  mapCategory: number;
  tilesetId: number;
  envType: number;
  surfaceFlag: number;
  neighbours: [number, number, number, number];
  field09: number;
  params: [number, number, number];
  field0D: number;
  entryCoord: number;
  eraGate: number;
  pad10: number;
  /** Byte 0x11. "Observed" only in Vairn's docs — read/compared during screen setup (@0x12F58); no confirmed role. */
  sublayoutParam11: number;
  /** Byte 0x12. ASM-confirmed `door_strength`: materialized to A4-$5608, consumed by the door-bash handler @0x9C2A. */
  doorStrength: number;
  /** Byte 0x13. ASM-confirmed `door_trap`: materialized to A4-$5607, consumed by the unlock handler @0x20D6E. */
  doorTrap: number;
  /** Byte 0x14. "Observed" only in Vairn's docs — read/compared during screen setup (@0x1A8B4); no confirmed role. */
  sublayoutParam14: number;
  labelOrTransitionHi: number;
  recallCoord: number;
  level: number;
  recallScreen: number;
  pad19: number;
  flags: number;
  flags2: number;
  tail: [number, number, number, number];
  /** 32 bytes of roof bits, 1 bit per 16×16 tile. */
  roofBits: Uint8Array;
}

export function decodeAttrib(data: Uint8Array): AttribRecord[] {
  if (data.length !== ATTRIB_FILE_SIZE) {
    throw new Error(`attrib.dat: expected ${ATTRIB_FILE_SIZE} bytes, got ${data.length}`);
  }
  const records: AttribRecord[] = [];
  for (let i = 0; i < ATTRIB_SCREENS; i++) {
    const o = i * ATTRIB_RECORD_SIZE;
    const d = data.subarray(o, o + ATTRIB_RECORD_SIZE);
    records.push({
      areaId: d[0x00],
      mapCategory: d[0x01],
      tilesetId: d[0x02],
      envType: d[0x03],
      surfaceFlag: d[0x04],
      neighbours: [d[0x05], d[0x06], d[0x07], d[0x08]],
      field09: d[0x09],
      params: [d[0x0a], d[0x0b], d[0x0c]],
      field0D: d[0x0d],
      entryCoord: d[0x0e],
      eraGate: d[0x0f],
      pad10: d[0x10],
      sublayoutParam11: d[0x11],
      doorStrength: d[0x12],
      doorTrap: d[0x13],
      sublayoutParam14: d[0x14],
      labelOrTransitionHi: d[0x15],
      recallCoord: d[0x16],
      level: d[0x17],
      recallScreen: d[0x18],
      pad19: d[0x19],
      flags: d[0x1a],
      flags2: d[0x1b],
      tail: [d[0x1c], d[0x1d], d[0x1e], d[0x1f]],
      roofBits: Uint8Array.from(d.subarray(0x20, 0x40)),
    });
  }
  return records;
}

export function encodeAttrib(records: AttribRecord[]): Uint8Array {
  const out = new Uint8Array(ATTRIB_FILE_SIZE);
  for (const r of records) {
    const o = r.areaId * ATTRIB_RECORD_SIZE;
    out[o + 0x00] = r.areaId;
    out[o + 0x01] = r.mapCategory;
    out[o + 0x02] = r.tilesetId;
    out[o + 0x03] = r.envType;
    out[o + 0x04] = r.surfaceFlag;
    out.set(r.neighbours, o + 0x05);
    out[o + 0x09] = r.field09;
    out.set(r.params, o + 0x0a);
    out[o + 0x0d] = r.field0D;
    out[o + 0x0e] = r.entryCoord;
    out[o + 0x0f] = r.eraGate;
    out[o + 0x10] = r.pad10;
    out[o + 0x11] = r.sublayoutParam11;
    out[o + 0x12] = r.doorStrength;
    out[o + 0x13] = r.doorTrap;
    out[o + 0x14] = r.sublayoutParam14;
    out[o + 0x15] = r.labelOrTransitionHi;
    out[o + 0x16] = r.recallCoord;
    out[o + 0x17] = r.level;
    out[o + 0x18] = r.recallScreen;
    out[o + 0x19] = r.pad19;
    out[o + 0x1a] = r.flags;
    out[o + 0x1b] = r.flags2;
    out.set(r.tail, o + 0x1c);
    out.set(r.roofBits, o + 0x20);
  }
  return out;
}
