/**
 * `movement.ts` — the port of W6's move path (TryMove CODE+0x116ac ->
 * LAB_0792 -> LAB_07AB) and the post-move entity scan (LAB_06B6), on
 * synthetic planes. See data-structure.md §4.7.10.
 */
import { describe, expect, it } from 'vitest';
import { arrive, rawWall, tryMove, W6TriggerState, type MovePlanes, type W6LevelLinks } from '../movement.ts';
import { evalCellFace, evalPerpFace, evalOverlay } from '../evaluate-cell.ts';

const W = 8;
const H = 8;
function planes(level = 3): MovePlanes & { feature: number[]; orient: number[] } {
  const n = W * H;
  return {
    width: W,
    height: H,
    wallA: new Array(n).fill(0),
    wallB: new Array(n).fill(0),
    feature: new Array(n).fill(0),
    orient: new Array(n).fill(0),
    flagP: new Array(n).fill(0),
    flagQ: new Array(n).fill(0),
    region: new Array(n).fill(0),
    level,
  };
}
const at = (x: number, y: number) => y * W + x;

function emptyLinks(level: number): W6LevelLinks {
  const z = () => new Array(144).fill(0);
  return {
    level,
    regionOrigin: [{ x: 0, y: 0 }, ...new Array(11).fill(null)],
    entities: { kind: z(), localX: z(), localY: z(), region: z(), flagBit: z(), w000: z(), w240: z(), b630: z(), regionStart: new Array(12).fill(0) },
    teleportDest: new Array(144).fill(null),
    initialFlags: new Array(10).fill(0),
  };
}

describe('TryMove wall rule (raw planes, features ignored)', () => {
  it('0 open and 1 doorway pass in any direction', () => {
    const p = planes();
    p.wallA[at(3, 3)] = 1;
    expect(tryMove(p, undefined, 3, 3, 0, 0).kind).toBe('moved');
    expect(tryMove(p, undefined, 3, 4, 2, 0).kind).toBe('moved'); // backing through the doorway
  });
  it('3 closed door opens only moving forward', () => {
    const p = planes();
    p.wallA[at(3, 3)] = 3;
    const r = tryMove(p, undefined, 3, 3, 0, 0);
    expect(r).toMatchObject({ kind: 'moved', doorOpened: true });
    expect(tryMove(p, undefined, 3, 4, 2, 0).kind).toBe('bump'); // backing into it
    expect(tryMove(p, undefined, 3, 3, 0, 1).kind).toBe('bump'); // strafing into it
  });
  it('2 wall bumps; features (stairs) do not gate movement', () => {
    const p = planes();
    p.wallB[at(3, 3)] = 2;
    expect(tryMove(p, undefined, 3, 3, 1, 1).kind).toBe('bump');
    p.feature[at(3, 3)] = 1; // stairs up drawn on the N face
    p.orient[at(3, 3)] = 0;
    expect(tryMove(p, undefined, 3, 3, 0, 0).kind).toBe('moved');
  });
  it('kind-7 door states: 1/2 locked, 3 inverts (wall passes, open bumps)', () => {
    const p = planes();
    p.wallA[at(3, 3)] = 3;
    p.wallB[at(3, 3)] = 2;
    expect(tryMove(p, undefined, 3, 3, 0, 0, [1, 0, 0, 0]).kind).toBe('locked');
    expect(tryMove(p, undefined, 3, 3, 1, 1, [0, 3, 0, 0]).kind).toBe('moved');
    expect(tryMove(p, undefined, 3, 3, 3, 3, [0, 0, 0, 3]).kind).toBe('bump');
  });
});

describe('LAB_07AB step handlers', () => {
  it('off-map: death on most levels, bounce on 10/12 (whose off-map faces read 0)', () => {
    const p = planes(3);
    p.region![at(3, 4)] = -1;
    expect(tryMove(p, undefined, 3, 3, 0, 0).kind).toBe('death');
    expect(tryMove(p, undefined, 3, 5, 2, 2).kind).toBe('bump'); // neighbour helper: off-map -> 2
    const q = planes(12);
    q.region![at(3, 4)] = -1;
    expect(rawWall(q, 3, 5, 2)).toBe(0);
    expect(tryMove(q, undefined, 3, 5, 2, 2).kind).toBe('bounce');
  });
  it('flagP: pits kill (0/2/3/4/6/11), water bounces (8/10, 12 regions 0-8), 5/7/9/13 nothing', () => {
    for (const [level, kind] of [[0, 'death'], [4, 'death'], [11, 'death'], [8, 'bounce'], [10, 'bounce'], [12, 'bounce'], [5, 'moved'], [9, 'moved']] as const) {
      const p = planes(level);
      p.flagP![at(3, 4)] = 1;
      expect(tryMove(p, undefined, 3, 3, 0, 0).kind, `level ${level}`).toBe(kind);
    }
    const p = planes(12);
    p.flagP![at(3, 4)] = 1;
    p.region![at(3, 4)] = 9;
    expect(tryMove(p, undefined, 3, 3, 0, 0).kind).toBe('moved');
    const lev = planes(8);
    lev.flagP![at(3, 4)] = 1;
    expect(tryMove(lev, undefined, 3, 3, 0, 0, [0, 0, 0, 0], true).kind).toBe('moved'); // -18136 set
  });
  it('level-1 region-10 flagP warps to region 4/5 (+4/-4, +3)', () => {
    const p = planes(1);
    p.region = new Array(W * H).fill(10);
    p.flagP![at(2, 1)] = 1;
    const links = { regionOrigin: new Array(12).fill(null) as Array<{ x: number; y: number } | null> };
    links.regionOrigin[10] = { x: 0, y: 0 };
    links.regionOrigin[4] = { x: 100, y: 50 };
    links.regionOrigin[5] = { x: 200, y: 50 };
    expect(tryMove(p, links, 2, 0, 0, 0)).toMatchObject({ kind: 'moved', x: 106, y: 54, warped: true });
  });
  it('level-2 flagQ kills', () => {
    const p = planes(2);
    p.flagQ![at(3, 4)] = 1;
    expect(tryMove(p, undefined, 3, 3, 0, 0).kind).toBe('death');
  });
});

describe('arrival scan (kind 1 teleport, kind 7 doors, trigger bits)', () => {
  it('teleports, chains on the same level, and honours mark mode / initial flags', () => {
    const p = planes(6);
    const links = emptyLinks(6);
    const e = links.entities;
    // entity 0 at (1,1): teleport to (5,5), flag bit 3, mode 2
    e.kind[0] = 1; e.localX[0] = 1; e.localY[0] = 1; e.flagBit[0] = 3; e.w240[0] = 2 << 10;
    links.teleportDest[0] = { level: 6, x: 5, y: 5 };
    // entity 1 at (5,5): teleport back to (1,1), flag bit 33, mode 2
    e.kind[1] = 1; e.localX[1] = 5; e.localY[1] = 5; e.flagBit[1] = 33; e.w240[1] = 2 << 10;
    links.teleportDest[1] = { level: 6, x: 1, y: 1 };
    const t = new W6TriggerState();
    t.enterLevel(6, links.initialFlags);
    // A fires (marks 3), B fires (marks 33), back at A which is now spent.
    expect(arrive(p, links, t, 1, 1)).toMatchObject({ pose: { level: 6, x: 1, y: 1 }, teleported: true });
    // With bit 33 initially set (as SCENARIO.HDR does for level 6) the pair is one-way.
    const t2 = new W6TriggerState();
    t2.enterLevel(6, [0, 0, 0, 0, 0b10, 0, 0, 0, 0, 0]);
    expect(arrive(p, links, t2, 1, 1)).toMatchObject({ pose: { x: 5, y: 5 }, levelChange: false });
  });
  it('a cross-level teleport hands back a level change', () => {
    const p = planes(0);
    const links = emptyLinks(0);
    links.entities.kind[0] = 1; links.entities.localX[0] = 2; links.entities.localY[0] = 2;
    links.teleportDest[0] = { level: 1, x: 7, y: 7 };
    expect(arrive(p, links, new W6TriggerState(), 2, 2)).toMatchObject({ levelChange: true, pose: { level: 1, x: 7, y: 7 } });
  });
  it('kind 7 sets per-direction door states', () => {
    const p = planes(3);
    const links = emptyLinks(3);
    links.entities.kind[0] = 7; links.entities.localX[0] = 2; links.entities.localY[0] = 2;
    links.entities.w240[0] = 1 | (3 << 4); // N locked, S inverted
    expect(arrive(p, links, new W6TriggerState(), 2, 2).doorState).toEqual([1, 0, 3, 0]);
  });
});

describe('render evaluators: off-map on levels 10/12, perpendicular flagP', () => {
  it('off-map is open with skip-ceiling + alt-floor on 10/12, solid elsewhere', () => {
    const p = { ...planes(10), region: new Array(W * H).fill(0) };
    expect(evalCellFace(p as never, 3, 8, 0, 0)).toBe(0);
    expect(evalOverlay(p as never, 10, 3, 8, 0, 0)).toMatchObject({ skipCeiling: true, altFloor: true });
    const q = { ...planes(3) };
    expect(evalCellFace(q as never, 3, 8, 0, 0)).toBe(2);
  });
  it('0x969a: flagP on a fog level returns 0; elsewhere flagP is ignored; feature 5 unchanged', () => {
    const p = planes(0);
    p.wallB[at(2, 3)] = 2; // west face of (3,3)
    p.flagP![at(3, 3)] = 1;
    expect(evalPerpFace(p as never, 3, 3, 0, -1)).toBe(0);
    const q = planes(1);
    q.wallB[at(2, 3)] = 2;
    q.flagP![at(3, 3)] = 1;
    expect(evalPerpFace(q as never, 3, 3, 0, -1)).toBe(2);
    q.feature[at(3, 3)] = 5;
    q.orient[at(3, 3)] = 3;
    expect(evalPerpFace(q as never, 3, 3, 0, -1)).toBe(2);
    expect(evalCellFace(q as never, 3, 3, 3, 0)).toBe(14);
  });
});
