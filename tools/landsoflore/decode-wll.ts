/**
 * Lands of Lore `.WLL` wall-type parameter table -- confirmed byte-exact
 * (`docs/landsoflore/dosvga/data-structure.md` § "WLL", closes
 * `lol-wll-format`). Not LCW-compressed, lives inside the per-level PAK
 * (e.g. `LEVEL1.WLL` inside `L01.PAK`), 2-byte header + `(size-2)/12`
 * 12-byte records.
 *
 * **Correction this session to the cited doc's "sequential in practice"
 * reading of `wallTypeIndex`.** The real `LEVEL1.WLL` is NOT a dense
 * 0-51 positional array where `wallTypeIndex` just mirrors the record's
 * own index -- it only does that for the first 27 records (0-26); records
 * 27-51 have `wallTypeIndex` values 53-79 (specifically
 * `66,67,53,54,55,57,58,59,60,61,62,63,64,65,68,69,71,72,73,74,75,76,77,
 * 78,79`). This is a **sparse dictionary keyed by the raw `.CMZ` per-side
 * byte value itself**, not a dense array indexed 0-51 -- and it exactly
 * covers every distinct raw byte value `LEVEL1.CMZ` actually uses (the
 * "clean 0-3" majority AND the "8, 53-79" cluster `decode-maze.ts`'s
 * module doc flags, zero misses, all 52 WLL keys accounted for). This is
 * the real mechanism EOB1's own still-open `wallMappingIndex` question was
 * reaching for -- LOL just happens to have the table decoded already.
 * `buildWllLookup` exposes this as the `rawByte -> vmpMapValue` map
 * `view-model.ts`'s `resolveRawWallType` actually uses.
 */
export interface WllRecord {
  wallTypeIndex: number;
  vmpMapValue: number;
  shapeMapValue: number;
  specialWallType: number;
  wallFlags: number;
  automapData: number;
}

export interface WllData {
  shpDatListIndex: number;
  records: WllRecord[];
}

export function decodeWll(data: Uint8Array): WllData {
  const shpDatListIndex = data[0]! | (data[1]! << 8);
  const recordBytes = data.length - 2;
  if (recordBytes % 12 !== 0) {
    throw new Error(`decodeWll: oracle check failed -- ${recordBytes} record bytes isn't a multiple of 12`);
  }
  const count = recordBytes / 12;
  const records: WllRecord[] = [];
  for (let i = 0; i < count; i++) {
    const base = 2 + i * 12;
    const readWord = (o: number) => data[base + o]! | (data[base + o + 1]! << 8);
    records.push({
      wallTypeIndex: readWord(0),
      vmpMapValue: readWord(2) & 0xff,
      shapeMapValue: readWord(4),
      specialWallType: readWord(6) & 0xff,
      wallFlags: readWord(8) & 0xff,
      automapData: readWord(10) & 0xff,
    });
  }
  return { shpDatListIndex, records };
}

/** `rawByte -> vmpMapValue` lookup -- see module doc. Last record wins on a (unobserved) duplicate key. */
export function buildWllLookup(wll: WllData): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of wll.records) map.set(r.wallTypeIndex, r.vmpMapValue);
  return map;
}
