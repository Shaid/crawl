/**
 * The dungeon levels the engine walks: the walker's own exported level files (`public/assets/wizardry6/amiga/dungeon/levelNN.json`, written by `npm run w6:levels`
 * from the user's scenario.dbs; collision planes + the section-3 entity links `movement.ts` consumes). They are generated, gitignored assets, not retail bytes in git.
 */
import type { MovePlanes, W6LevelLinks } from '../movement';

export interface W6Level {
  id: number; width: number; height: number;
  /** absolute maze coordinate of dense cell (0,0) */
  origin: { x: number; y: number };
  planes: MovePlanes;
  links: W6LevelLinks;
  entrance: { x: number; y: number; facing: number } | null;
}

interface RawLevel {
  cellSpace: { width: number; height: number };
  origin?: { x: number; y: number };
  units: { id: number; planes: { wallA: number[]; wallB: number[]; flagP: number[]; flagQ: number[]; region: number[] } }[];
  w6?: { links?: W6LevelLinks; entrance?: { x: number; y: number; facing: number } | null };
}

export function parseLevel(raw: unknown): W6Level {
  const r = raw as RawLevel;
  const u = r.units[0];
  if (!r.w6?.links) throw new Error('wizardry6: level file has no w6.links (re-run npm run w6:levels)');
  return {
    id: u.id, width: r.cellSpace.width, height: r.cellSpace.height, origin: r.origin ?? { x: 0, y: 0 },
    planes: { width: r.cellSpace.width, height: r.cellSpace.height, wallA: u.planes.wallA, wallB: u.planes.wallB, flagP: u.planes.flagP, flagQ: u.planes.flagQ, region: u.planes.region, level: u.id },
    links: r.w6.links, entrance: r.w6.entrance ?? null,
  };
}
