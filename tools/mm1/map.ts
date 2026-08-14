/**
 * MM1 `MAZEDATA.DTA` codec — 55 map screens × 512 bytes = 28160 bytes.
 *
 * Format documentation ported from Vairn/MM2
 * (`EXTRACTED/docs/22-mm1-mazedata-format.md`, `tools/mm1_maps.py`) and
 * independently re-verified against the GOG retail files in `data/mm1/dosega/`
 * (see `docs/mm1/dosega/data-structure.md` for the verification evidence).
 *
 * Each screen is two 256-byte pages over a 16×16 grid — the *same* layout as
 * MM2 `map.dat` (Vairn's `21-map-dat-format.md`), which is why the cell decode
 * below is imported from the MM2 codec rather than re-derived:
 *
 *   Page 0 (visual, +0x000): four 2-bit wall fields per cell, N/E/S/W:
 *       `0` open, `1` wall, `2` door, `3` wall+torch.
 *   Page 1 (collision, +0x100): per direction `(dark<<1)|wall`; the low bit
 *       is the wall, the high bit darkness. West's dark slot is reused:
 *       bit 0x80 is the event flag.
 *
 * Row 0 on disk = south (same convention as MM2; automap renders north-up).
 *
 * Screen names come from MM.EXE's null-terminated slug table at file offset
 * `0x10C07` (55 entries in MAZEDATA order) — each slug also names a companion
 * `*.OVR` map-script overlay, which is how the order is cross-verified.
 */
import { decodeMapCell, encodeMapCell } from '../mm2/map.ts';

export const MM1_MAP_SCREENS = 55;
export const MM1_MAP_SCREEN_SIZE = 512;
export const MM1_MAP_PAGE_SIZE = 256;
export const MM1_MAP_FILE_SIZE = MM1_MAP_SCREENS * MM1_MAP_SCREEN_SIZE;
export const MM1_MAP_GRID = 16;

/**
 * Slug table in MAZEDATA order (authoritative screen names). Identical to the
 * null-terminated table MM.EXE embeds at file offset 0x10C07 and to the 55
 * `*.OVR` companion filenames in the GOG install (set-equal, case-insensitive).
 */
export const MM1_MAP_SLUGS: readonly string[] = [
  'sorpigal', 'portsmit', 'algary', 'dusk', 'erliquin',
  'cave1', 'cave2', 'cave3', 'cave4', 'cave5', 'cave6', 'cave7', 'cave8', 'cave9',
  'areaa1', 'areaa2', 'areaa3', 'areaa4',
  'areab1', 'areab2', 'areab3', 'areab4',
  'areac1', 'areac2', 'areac3', 'areac4',
  'aread1', 'aread2', 'aread3', 'aread4',
  'areae1', 'areae2', 'areae3', 'areae4',
  'doom', 'blackrn', 'blackrs',
  'qvl1', 'qvl2', 'rwl1', 'rwl2', 'enf1', 'enf2', 'whitew', 'dragad',
  'udrag1', 'udrag2', 'udrag3', 'demon', 'alamar',
  'pp1', 'pp2', 'pp3', 'pp4', 'astral',
];

/** Editorial display titles (slug table is authoritative for screen index). */
const MM1_MAP_TITLES: ReadonlyMap<string, string> = new Map([
  ['sorpigal', 'Sorpigal'],
  ['portsmit', 'Portsmith'],
  ['algary', 'Algary'],
  ['dusk', 'Dusk'],
  ['erliquin', 'Erliquin'],
  ['doom', 'Doom'],
  ['blackrn', 'Black Ridge (north)'],
  ['blackrs', 'Black Ridge (south)'],
  ['qvl1', "Queen's Pyramids (1)"],
  ['qvl2', "Queen's Pyramids (2)"],
  ['rwl1', 'Rainbow Road (1)'],
  ['rwl2', 'Rainbow Road (2)'],
  ['enf1', 'Enchanted Forest (1)'],
  ['enf2', 'Enchanted Forest (2)'],
  ['whitew', 'White Wolf'],
  ['dragad', 'Dragadune'],
  ['udrag1', 'Under Dragadune (1)'],
  ['udrag2', 'Under Dragadune (2)'],
  ['udrag3', 'Under Dragadune (3)'],
  ['demon', 'Demon'],
  ['alamar', 'Alamar'],
  ['pp1', 'Protection Point (1)'],
  ['pp2', 'Protection Point (2)'],
  ['pp3', 'Protection Point (3)'],
  ['pp4', 'Protection Point (4)'],
  ['astral', 'Astral Plane'],
]);

export function mm1MapTitle(slug: string): string {
  const known = MM1_MAP_TITLES.get(slug);
  if (known) return known;
  if (/^cave[1-9]$/.test(slug)) return `Cave ${slug.slice(4)}`;
  const m = /^area([a-e])([1-4])$/.exec(slug);
  if (m) return `Overland ${m[1].toUpperCase()}${m[2]}`;
  return slug.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Mm1Env = 'town' | 'cavern' | 'outside';

/** Walker environment: overland uses the outdoor renderer, towns/caves the indoor frustum. */
export function mm1EnvForSlug(slug: string): Mm1Env {
  if (slug.startsWith('area')) return 'outside';
  if (slug.startsWith('cave') || slug.startsWith('udrag')) return 'cavern';
  switch (slug) {
    case 'sorpigal': case 'portsmit': case 'algary': case 'dusk': case 'erliquin':
    case 'alamar': case 'blackrn': case 'blackrs':
      return 'town';
    default:
      return 'cavern';
  }
}

export interface Mm1MapCell {
  /** Page-0 wall codes (0 open, 1 wall, 2 door, 3 wall+torch). */
  visual: { n: number; e: number; s: number; w: number };
  /** Page-1 collision: wall low bit, dark high bit (north/east/south/west). */
  collision: { n: number; e: number; s: number; w: number };
  /** True when collision byte bit 0x80 is set (event trigger). */
  event: boolean;
}

export interface Mm1MapScreen {
  index: number;
  slug: string;
  title: string;
  env: Mm1Env;
  /** First fully open cell `[x, y]` in collision page (walk-in point); fallback `[8, 8]`. */
  entry: [number, number];
  /** row-major [row][col]; row 0 is the south edge on disk. */
  cells: Mm1MapCell[][];
}

export interface Mm1MazeData {
  fileSize: number;
  screens: Mm1MapScreen[];
}

/**
 * Parse the null-terminated slug list from MM.EXE: starts at the first
 * `"sorpigal\0"` and reads consecutive lowercase alphanumeric strings until
 * the 55 MAZEDATA screens are accounted for. Throws when MM.EXE disagrees.
 */
export function parseMapSlugsFromExe(exe: Uint8Array): string[] {
  const start = findBytes(exe, textBytes('sorpigal\x00'));
  if (start < 0) throw new Error("MM1: 'sorpigal' map slug not found in MM.EXE");
  const slugs: string[] = [];
  let off = start;
  while (off < exe.length) {
    let end = off;
    while (end < exe.length && exe[end] !== 0) end++;
    if (end <= off) break;
    const raw = exe.subarray(off, end);
    if (raw.length === 0 || !everyByte(raw, (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57))) break;
    slugs.push(String.fromCharCode(...raw));
    off = end + 1;
  }
  if (slugs.length !== MM1_MAP_SCREENS) {
    throw new Error(`MM1: expected ${MM1_MAP_SCREENS} map slugs from MM.EXE, got ${slugs.length}`);
  }
  return slugs;
}

/**
 * First fully open cell in the collision page (no wall in any direction) —
 * the natural walk-in point for the screen; falls back to the centre.
 */
export function findEntry(collision: Uint8Array): [number, number] {
  for (let y = 0; y < MM1_MAP_GRID; y++) {
    for (let x = 0; x < MM1_MAP_GRID; x++) {
      const c = collision[y * MM1_MAP_GRID + x];
      const blocks =
        (c & 1) !== 0 || ((c >> 2) & 1) !== 0 || ((c >> 4) & 1) !== 0 || ((c >> 6) & 1) !== 0;
      if (!blocks) return [x, y];
    }
  }
  return [8, 8];
}

export function decodeMazeData(data: Uint8Array, slugs?: readonly string[]): Mm1MazeData {
  if (data.length < MM1_MAP_FILE_SIZE) {
    throw new Error(`MAZEDATA.DTA: expected ${MM1_MAP_FILE_SIZE} bytes, got ${data.length}`);
  }
  const names = slugs ?? MM1_MAP_SLUGS;
  if (names.length !== MM1_MAP_SCREENS) {
    throw new Error(`MAZEDATA.DTA: expected ${MM1_MAP_SCREENS} slugs, got ${names.length}`);
  }
  const screens: Mm1MapScreen[] = [];
  for (let s = 0; s < MM1_MAP_SCREENS; s++) {
    const base = s * MM1_MAP_SCREEN_SIZE;
    const page0 = data.subarray(base, base + MM1_MAP_PAGE_SIZE);
    const page1 = data.subarray(base + MM1_MAP_PAGE_SIZE, base + MM1_MAP_SCREEN_SIZE);
    const cells: Mm1MapCell[][] = [];
    for (let row = 0; row < MM1_MAP_GRID; row++) {
      const cellRow: Mm1MapCell[] = [];
      for (let col = 0; col < MM1_MAP_GRID; col++) {
        cellRow.push(decodeMapCell(page0[row * MM1_MAP_GRID + col], page1[row * MM1_MAP_GRID + col]));
      }
      cells.push(cellRow);
    }
    const slug = names[s];
    screens.push({
      index: s,
      slug,
      title: mm1MapTitle(slug),
      env: mm1EnvForSlug(slug),
      entry: findEntry(page1),
      cells,
    });
  }
  return { fileSize: data.length, screens };
}

/** Byte-exact inverse of `decodeMazeData` — used by the round-trip test. */
export function encodeMazeData(screens: Mm1MapScreen[]): Uint8Array {
  const out = new Uint8Array(MM1_MAP_FILE_SIZE);
  for (const s of screens) {
    const base = s.index * MM1_MAP_SCREEN_SIZE;
    for (let row = 0; row < MM1_MAP_GRID; row++) {
      for (let col = 0; col < MM1_MAP_GRID; col++) {
        const [visual, collision] = encodeMapCell(s.cells[row][col]);
        out[base + row * MM1_MAP_GRID + col] = visual;
        out[base + MM1_MAP_PAGE_SIZE + row * MM1_MAP_GRID + col] = collision;
      }
    }
  }
  return out;
}

function textBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function everyByte(a: Uint8Array, pred: (b: number) => boolean): boolean {
  for (const b of a) if (!pred(b)) return false;
  return true;
}
