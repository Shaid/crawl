/**
 * MM3 (DOS) indoor 3-D view — which wall sprite/frame draws at each of the
 * 44 real on-screen view slots, for a given party position and facing.
 * TS port of `scripts/mm3lib/dos_indoor_view.py` — see that module's doc
 * and `docs/mm3/dosvga/data-structure.md` "Indoor 3-D view" for the full
 * disassembly citations this is built from. Keep this file's algorithm in
 * sync with the Python one; both are pure reimplementations of the same
 * frozen `data/indoor-view.json` table (extracted once via live
 * disassembly, not re-derived at runtime), verified byte-identical to a
 * live-disassembly reference across 497,664 test cases.
 */

/** [dx, dy, mask, shift] — shift is unused here (the mask alone already selects a direction). */
type GeomEntry = [number, number, number, number];

interface Slot {
  geom: GeomEntry[]; // 4 facings x (dx, dy, mask, shift)
  arms: number[][]; // 7 kinds (graphic index 1-7) x flag ids
}

interface Spec {
  kind: 'imm' | 'alt' | 'alt2' | 'pair' | 'pairinv' | 'torch' | 'expr';
  value?: number | [number, number];
}

interface ChainItem {
  guards: number[];
  x: number;
  y: number;
  flags: Spec;
  frame: Spec;
}

interface Chain {
  sprite: string;
  pre: number[];
  items: ChainItem[];
}

export interface IndoorViewTable {
  slots: Slot[];
  chains: Chain[];
}

/** `(dx, dy, mask) -> graphic index 0-7`. 0 = no wall. The real accessor
 * returns 1 (plain wall) off the current 16x16 maze — the caller's
 * `getWall` should replicate that (matches the verified Python reference;
 * true multi-block (32x32 castle/cavern) cross-boundary sampling isn't
 * implemented, a known simplification — see TODO `mm3-maze-wall-frames`). */
export type GetWall = (dx: number, dy: number, mask: number) => number;

export interface WallDraw {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  flags: number;
}

function evalSpec(spec: Spec, alt: number, torch: number): number {
  switch (spec.kind) {
    case 'imm':
      return spec.value as number;
    case 'alt':
      return alt;
    case 'alt2':
      return 2 | alt;
    case 'pair':
      return (spec.value as [number, number])[alt];
    case 'pairinv':
      return (spec.value as [number, number])[1 - alt];
    case 'torch':
      return torch + 1;
    case 'expr':
      return 0;
  }
}

/**
 * Returns wall-draw commands in real draw order (the real game's own code
 * order — already correct back-to-front, no re-sorting needed).
 *
 * `facing`: 0=N, 1=S, 2=E, 3=W — the indoor view's own order, **not** the
 * N,E,S,W order the rest of this walker uses for party facing; convert at
 * the call site. `alt`: 0/1, a per-redraw toggle that makes side-wall art
 * alternate (the real game flips this roughly once per redraw — the
 * "corridor slides past you" effect). `torch`: 0-2, wall-torch flicker
 * phase.
 */
export function buildWallList(table: IndoorViewTable, getWall: GetWall, facing: number, alt: number, torch: number): WallDraw[] {
  const flag = new Map<number, number>();
  const bump = (g: number) => flag.set(g, (flag.get(g) ?? 0) + 1);
  const any = (gs: number[]) => gs.some((g) => (flag.get(g) ?? 0) > 0);

  for (const slot of table.slots) {
    const [dx, dy, mask] = slot.geom[facing]!;
    const idx = getWall(dx, dy, mask);
    if (idx >= 1 && idx <= 7) {
      for (const g of slot.arms[idx - 1]!) bump(g);
    }
  }

  const out: WallDraw[] = [];
  for (const chain of table.chains) {
    if (any(chain.pre)) continue;
    for (const item of chain.items) {
      if (!any(item.guards)) continue;
      const flagsVal = item.flags.kind === 'imm' || item.flags.kind === 'alt' || item.flags.kind === 'alt2' ? evalSpec(item.flags, alt, torch) : 0;
      const frameVal = evalSpec(item.frame, alt, torch);
      out.push({ sprite: chain.sprite, frame: frameVal, x: item.x, y: item.y, flags: flagsVal });
      break;
    }
  }
  return out;
}

export async function loadIndoorViewTable(base: string): Promise<IndoorViewTable | undefined> {
  try {
    const raw = await fetch(`${base}/data/indoor-view.json`).then((r) => r.json());
    return { slots: raw.slots, chains: raw.chains };
  } catch {
    return undefined;
  }
}
