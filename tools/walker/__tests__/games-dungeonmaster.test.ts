import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  deriveFaces, tryStep, DoorStates, DmLevelView, faceOf, SQ, type DmMapData,
} from '../../dungeonmaster/amiga/model.ts';
import { DmViewport, VIEWPORT_W, VIEWPORT_H, parseLayout, getCoord } from '../../dungeonmaster/amiga/viewport.ts';
import { buildMaps, gfxFromDat, kaosPalette0Matches } from '../../dungeonmaster/amiga/export-walker.ts';

const sq = (type: number, attr = 0) => (type << 5) | attr;

/** 5x3 test map: a corridor row with a door (N-S passage axis needs bit 3; here E-W) and stairs. */
function synth(): DmMapData {
  const w = 5;
  const h = 3;
  const raw = new Array<number>(w * h).fill(sq(SQ.WALL));
  // row 1: corridor, corridor, door(E-W axis = attr bit3 clear), corridor, stairs-down(E-W axis)
  raw[1 * w + 0] = sq(SQ.CORRIDOR);
  raw[1 * w + 1] = sq(SQ.CORRIDOR);
  raw[1 * w + 2] = sq(SQ.DOOR, 4); // closed, E-W axis
  raw[1 * w + 3] = sq(SQ.CORRIDOR);
  raw[1 * w + 4] = sq(SQ.STAIRS, 0); // down, E-W axis
  return { index: 0, group: 0, level: 0, width: w, height: h, offsetX: 0, offsetY: 0, doorSets: [0, 1], raw, doors: {}, faces: deriveFaces(w, h, raw) };
}

function symmetric(m: DmMapData): number {
  let bad = 0;
  const dx = [0, 1, 0, -1];
  const dy = [-1, 0, 1, 0];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      for (let d = 0; d < 4; d++) {
        const nx = x + dx[d]!;
        const ny = y + dy[d]!;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        if (faceOf(m.faces[y * m.width + x]!, d) !== faceOf(m.faces[ny * m.width + nx]!, (d + 2) & 3)) bad++;
      }
    }
  }
  return bad;
}

describe('DM per-cell faces + movement (synthetic)', () => {
  it('faces are symmetric across every shared edge; a perturbed face is detected (null control)', () => {
    const m = synth();
    expect(symmetric(m)).toBe(0);
    const broken = { ...m, faces: m.faces.slice() };
    broken.faces[1 * m.width + 1] ^= 0x10; // flip E face of (1,1)
    expect(symmetric(broken)).toBeGreaterThan(0);
  });

  it('walls block, a closed door blocks until opened, stairs change level, orientation matters', () => {
    const m = synth();
    const ds = new DoorStates();
    const all = [m];
    const here = { mapIndex: 0, x: 1, y: 1, facing: 1 };
    expect(tryStep(all, ds, here, 0).moved).toBe(false); // north: wall
    const toDoor = tryStep(all, ds, here, 1);
    expect(toDoor.moved).toBe(false); // door closed (state 4 from attr&7)
    ds.set(m, 1 * m.width + 2, 0);
    expect(tryStep(all, ds, here, 1).moved).toBe(true);
    // door passage axis is E-W: entering it from the north/south side is blocked even when open
    const rawSide = synth();
    rawSide.raw[0 * rawSide.width + 2] = sq(SQ.CORRIDOR);
    rawSide.faces = deriveFaces(rawSide.width, rawSide.height, rawSide.raw);
    const ds2 = new DoorStates();
    ds2.set(rawSide, 1 * rawSide.width + 2, 0);
    expect(tryStep([rawSide], ds2, { mapIndex: 0, x: 2, y: 0, facing: 2 }, 2).moved).toBe(false);
  });

  it('stairs with no destination map stay put (null control for the level-change path)', () => {
    const m = synth();
    const ds = new DoorStates();
    const out = tryStep([m], ds, { mapIndex: 0, x: 3, y: 1, facing: 1 }, 1);
    expect(out.moved).toBe(false);
    const lower: DmMapData = { ...synth(), index: 1, level: 1, raw: synth().raw.slice() };
    lower.raw[1 * lower.width + 4] = sq(SQ.STAIRS, 4); // paired up-stairs
    lower.raw[1 * lower.width + 3] = sq(SQ.CORRIDOR);
    lower.faces = deriveFaces(lower.width, lower.height, lower.raw);
    const moved = tryStep([m, lower], ds, { mapIndex: 0, x: 3, y: 1, facing: 1 }, 1);
    expect(moved.moved).toBe(true);
    expect(moved.pose.mapIndex).toBe(1);
  });
});

const HAS_DM = existsSync('data/dungeonmaster/amiga/Graphics.DAT') && existsSync('data/dungeonmaster/amiga/Dungeon.DAT');

describe.skipIf(!HAS_DM)('Dungeon Master real data', () => {
  const gfx = gfxFromDat('data/dungeonmaster/amiga/Graphics.DAT');
  const { maps, start } = buildMaps(new Uint8Array(readFileSync('data/dungeonmaster/amiga/Dungeon.DAT')));

  it('item-696 layout tiles the item exactly (parseLayout throws otherwise) and resolves wall zones', () => {
    expect(gfx.layout.size).toBe(1135);
    const c = getCoord(gfx.layout, 712, 160, 111); // D1C wall
    expect(c).not.toBeNull();
    expect(getCoord(gfx.layout, 9999, 10, 10)).toBeNull(); // null control: unknown zone
    expect(() => parseLayout(new Uint8Array(16))).toThrow();
  });

  it('every map has symmetric faces and every door square resolved to a door record', () => {
    expect(maps).toHaveLength(14);
    for (const m of maps) {
      expect(symmetric(m)).toBe(0);
      const doorSquares = m.raw.filter((r) => (r >> 5) === SQ.DOOR).length;
      expect(Object.keys(m.doors).length).toBe(doorSquares);
    }
  });

  it('palette 0 is reproduced by the game\'s own KAOS.FTL (16/16 words)', () => {
    const kaos = new Uint8Array(readFileSync('data/dungeonmaster/amiga/KAOS.FTL'));
    expect(kaosPalette0Matches(kaos, 0xfbc)).toBe(16);
    expect(kaosPalette0Matches(kaos, 0xfbc + 2)).toBeLessThan(16); // null control: wrong offset
  });

  it('start view renders a non-blank frame; a wall-facing and an open-facing view differ; a rotated copy differs', () => {
    const ds = new DoorStates();
    const vp = new DmViewport(gfx);
    const view = new DmLevelView(maps[0]!, maps, ds);
    const a = Uint8Array.from(vp.render(view, start.x, start.y, start.facing));
    expect(new Set(a).size).toBeGreaterThanOrEqual(4);
    expect(a).toHaveLength(VIEWPORT_W * VIEWPORT_H);
    // start (1,3) faces south down the corridor; facing east is a wall
    const open = Uint8Array.from(vp.render(view, start.x, start.y, start.facing));
    const wall = Uint8Array.from(vp.render(view, start.x, start.y, (start.facing + 1) & 3));
    let diff = 0;
    for (let i = 0; i < open.length; i++) if (open[i] !== wall[i]) diff++;
    expect(diff).toBeGreaterThan(2000);
    expect(open).toEqual(a); // determinism
  });

  it('a closed door ahead differs from the same door opened (door-state oracle)', () => {
    const ds = new DoorStates();
    const vp = new DmViewport(gfx);
    const m = maps[0]!;
    const view = new DmLevelView(m, maps, ds);
    const closed = Uint8Array.from(vp.render(view, 4, 9, 1)); // portcullis at (5,9)
    ds.set(m, 9 * m.width + 5, 0);
    const open = Uint8Array.from(vp.render(view, 4, 9, 1));
    let diff = 0;
    for (let i = 0; i < open.length; i++) if (open[i] !== closed[i]) diff++;
    expect(diff).toBeGreaterThan(500);
  });
});

const HAS_CSB = existsSync('data/chaosstrikesback/amiga/disk1/Graphics.DAT') && existsSync('data/chaosstrikesback/amiga/disk2/MINI.DAT');

describe.skipIf(!HAS_CSB)('Chaos Strikes Back real data (same engine)', () => {
  it('Prison (2 maps) and the MINI.DAT main dungeon (11 maps) both import with symmetric faces and resolved doors', () => {
    const main = buildMaps(new Uint8Array(readFileSync('data/chaosstrikesback/amiga/disk2/MINI.DAT')), 0, 0, true);
    const prison = buildMaps(new Uint8Array(readFileSync('data/chaosstrikesback/amiga/disk1/Dungeon.DAT')), 100, 1);
    expect(main.maps).toHaveLength(11);
    expect(prison.maps).toHaveLength(2);
    for (const m of [...main.maps, ...prison.maps]) {
      expect(symmetric(m)).toBe(0);
      expect(Object.keys(m.doors).length).toBe(m.raw.filter((r) => (r >> 5) === SQ.DOOR).length);
    }
    const kaos = new Uint8Array(readFileSync('data/chaosstrikesback/amiga/disk1/KAOS.FTL'));
    expect(kaosPalette0Matches(kaos, 0x100a)).toBe(16);
  });
});
