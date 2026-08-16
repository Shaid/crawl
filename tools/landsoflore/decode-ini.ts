/**
 * Lands of Lore `LEVELn.INI` -- an EMC2 script container (`FORM` IFF-style
 * chunks: `EMC2ORDR` + `TEXT` + `DATA`), confirmed present per-level inside
 * each level's own PAK (e.g. `LEVEL1.INI` inside `L01.PAK`). The full EMC2
 * bytecode isn't decoded here (`docs/landsoflore/TODO.md`'s `lol-text-
 * script-data` explicitly defers it, gameplay logic not asset structure) --
 * this module only needs the **wall-set name** each level's script
 * references, which lives as a plain string in the `TEXT` chunk's string
 * pool alongside everything else the script touches.
 *
 * `TEXT` chunk layout (empirically derived this session from the real
 * `LEVEL1.INI`/`LEVEL2.INI`/`LEVEL3.INI`, not cited from source): 4-byte
 * BE `u32` chunk size, then content = `N` BE `u16` byte-offsets (relative
 * to the content start) followed immediately by `N` NUL-terminated ASCII
 * strings. Self-describing exactly like this project's other confirmed
 * offset-table formats: `offsets[0]` always equals `N*2` (the offset
 * table's own byte length), so `N = offsets[0]/2` and the string pool
 * starts exactly where the offset table ends -- verified this session
 * against `LEVEL1.INI` (offsets[0]=20 -> N=10, exactly 10 real strings:
 * `KEEP`, `LEVEL01`, `KEEPDOOR.SHP`, `LEVEL1.CMZ`, `GUARD.SHP`, `KEEP.DAT`,
 * `KEEP.SHP`, `ORCLDR1`, `SWING1`, `MALEOOF2`) and `LEVEL2.INI`
 * (offsets[0]=30 -> N=15).
 *
 * **Wall-set name is not always the first string** -- `LEVEL1.INI`'s first
 * string is `KEEP` (the wall set) directly, but `LEVEL2.INI`/`LEVEL3.INI`
 * lead with an `ALTPALn.PAL` reference before `FOREST1`. Rather than guess
 * a fixed string-table position, this scans every string against the known
 * wall-set directory names actually present in this corpus (confirmed via
 * the ISO's own `DATA/*.PAK` listing and `docs/landsoflore/TODO.md`'s
 * `lol-iso-remaining-paks` enumeration) -- the same pragmatic token-scan
 * technique `tools/eotb2/decode-inf.ts` already used for its own
 * documented-offsets-don't-match gap.
 */
const KNOWN_WALL_SETS = [
  'CATWALK', 'KEEP', 'CIMMERIA', 'MANOR', 'MINE1', 'RUIN', 'SWAMP',
  'TOWER1', 'URBISH', 'YVEL', 'FOREST1', 'CAVE1',
];

function findTextChunk(data: Uint8Array): Uint8Array {
  for (let i = 0; i + 4 <= data.length; i++) {
    if (data[i] === 0x54 && data[i + 1] === 0x45 && data[i + 2] === 0x58 && data[i + 3] === 0x54) {
      // "TEXT"
      const size = (data[i + 4]! << 24) | (data[i + 5]! << 16) | (data[i + 6]! << 8) | data[i + 7]!;
      return data.subarray(i + 8, i + 8 + size);
    }
  }
  throw new Error('decodeIni: no "TEXT" chunk found');
}

function readStrings(content: Uint8Array): string[] {
  const firstOffset = (content[0]! << 8) | content[1]!;
  const pool = content.subarray(firstOffset);
  const strings: string[] = [];
  let start = 0;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] === 0) {
      if (i > start) strings.push(new TextDecoder('ascii').decode(pool.subarray(start, i)));
      start = i + 1;
    }
  }
  return strings;
}

/** Resolve a level's wall-set stem (e.g. "KEEP") from its `LEVELn.INI` bytes. */
export function decodeIniWallSet(data: Uint8Array): string {
  const strings = readStrings(findTextChunk(data));
  for (const s of strings) {
    const upper = s.toUpperCase();
    if (KNOWN_WALL_SETS.includes(upper)) return upper;
  }
  throw new Error(`decodeIniWallSet: no known wall-set name found among strings [${strings.join(', ')}]`);
}
