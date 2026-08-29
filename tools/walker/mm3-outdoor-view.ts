/**
 * MM3 (DOS) outdoor 3-D view — which terrain sprite/frame draws at each of
 * the outdoor draw-list's 50 fixed screen slots, for a given party position
 * and facing, on one of the 24 outdoor mazes (ids 41-64). TS port of
 * `scripts/mm3lib/dos_outdoor_view.py` — see that module's doc and
 * `docs/mm3/dosvga/data-structure.md` "Outdoor mazes" for the full
 * disassembly citations this is built from. Keep this file's algorithm in
 * sync with the Python one; both are pure reimplementations of the same
 * frozen `data/outdoor-view.json` table (extracted once via live
 * disassembly, not re-derived at runtime). Verified byte-identical to the
 * Python reference on a 384-case golden fixture (`__tests__/
 * mm3-outdoor-view.test.ts`), and the Python reference itself matches the
 * `re-codebreaker`-verified escalation reference exactly on 1,344 cases
 * (see TODO `mm3-outdoor-view-port`).
 */

export interface OutdoorViewRecord {
  layer: 'ground' | 'overlay';
  /** Index into the 46-slot facing offset tables, or `null` for the 3
   * screen-centred overlay records that sample the party's own cell. */
  slot: number | null;
  x: number;
  y: number;
  /** A literal flags word, or `'ALT'` meaning "use the caller's `alt` value directly". */
  flags: number | 'ALT';
  /** A literal frame number, or a 2-entry alternator pair selected by `alt`. */
  frame: number | { altTable: string; values: [number, number] };
}

export interface OutdoorViewTable {
  /** `terrain[id]` -> sprite basename (no `.vga`), `null` at index 0. Index = the maze trailer's graphic-set id (1-18). */
  terrain: (string | null)[];
  /** 4-entry decimation bit-pattern table (16/16, 11/16, 7/16, 4/16 kept), selected by flags bits 8-9. */
  pat: number[];
  clip: { x0: number; y0: number; x1: number; y1: number };
  /** `dxt[facing][slot]` / `dyt[facing][slot]` — facing order N,S,E,W (matches the indoor view). */
  dxt: number[][];
  dyt: number[][];
  records: OutdoorViewRecord[];
}

/** `(dx, dy) -> wall u16` — sample the raw wall word at `(partyX+dx,
 * partyY+dy)`. Unlike the indoor view's `GetWall`, the real accessor
 * returns 0 (not 1/"plain wall") off the current 16x16 maze — outdoor
 * index 0 means "nothing drawn" for both layers, so off-map naturally
 * draws nothing extra. */
export type GetWallWord = (dx: number, dy: number) => number;

export interface OutdoorDraw {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  flags: number;
}

/** The maze's 7 graphic-set ids -> `[undefined, 'name1.vga', ..., 'name7.vga']` (1-based). */
function handleTable(table: OutdoorViewTable, graphicSets: number[]): (string | undefined)[] {
  const out: (string | undefined)[] = [undefined];
  for (const g of graphicSets) {
    out.push(g ? `${table.terrain[g]}.vga` : undefined);
  }
  return out;
}

/**
 * Returns `[(sprite, frame, x, y, flags), ...]` in real draw order: sky
 * backdrop, water backdrop, then the 50 ground/overlay terrain draws (any
 * whose resolved index is 0, or whose graphic-set slot is unassigned, are
 * omitted).
 *
 * `graphicSets`: the maze's own 7-entry `graphicSets` field (`MazeRecordJson.graphicSets`).
 * `facing`: 0=N, 1=S, 2=E, 3=W — the outdoor/indoor view's own shared
 * facing order, **not** the walker's usual N,E,S,W; convert at the call
 * site (see `FACING_NESW_TO_INDOOR` in `games-mm3.ts`). `alt`: 0/1, the
 * same per-redraw toggle the indoor view uses.
 */
export function buildOutdoorDrawList(
  table: OutdoorViewTable,
  getWallWord: GetWallWord,
  graphicSets: number[],
  facing: number,
  alt: number,
): OutdoorDraw[] {
  const handle = handleTable(table, graphicSets);
  const out: OutdoorDraw[] = [
    { sprite: 'day.vga', frame: 0, x: 8, y: 8, flags: 0 },
    { sprite: 'water.vga', frame: 0, x: 8, y: 0x43, flags: 0 },
  ];
  for (const r of table.records) {
    let dx = 0;
    let dy = 0;
    if (r.slot !== null) {
      dx = table.dxt[facing]![r.slot]!;
      dy = table.dyt[facing]![r.slot]!;
    }
    const w = getWallWord(dx, dy);
    const idx = r.layer === 'ground' ? (w >> 4) & 7 : w & 7;
    if (!idx) continue;
    const nm = handle[idx];
    if (nm === undefined) continue;
    const frameSpec = r.frame;
    const frame = typeof frameSpec === 'number' ? frameSpec : frameSpec.values[alt]!;
    const flags = r.flags === 'ALT' ? alt : r.flags;
    out.push({ sprite: nm, frame, x: r.x, y: r.y, flags });
  }
  return out;
}

export async function loadOutdoorViewTable(base: string): Promise<OutdoorViewTable | undefined> {
  try {
    return (await fetch(`${base}/data/outdoor-view.json`).then((r) => r.json())) as OutdoorViewTable;
  } catch {
    return undefined;
  }
}
