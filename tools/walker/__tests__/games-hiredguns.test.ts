import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CrunchError, decrunch } from '../../hiredguns/amiga/crunch.ts';
import {
  AUX_HERE, BLOCK_HERE, CELLS, FLOOR_HERE, LAYER, OPAQUE, auxOf, blockOf, cellIndex, floorOf, parseMap,
} from '../../hiredguns/amiga/map.ts';
import { fall, supported, tryStep, type HgWorld } from '../../hiredguns/amiga/model.ts';
import { scanView, renderView, VIEW_W, VIEW_H, type HgViewTables } from '../../hiredguns/amiga/view.ts';
import { parseGfxBank } from '../../hiredguns/amiga/gfxbank.ts';
import { readExeTables, readDoors } from '../../hiredguns/amiga/export-walker.ts';
import { levelIdOf, splitLevelId } from '../games-hiredguns.ts';

// ── synthetic crunch stream (test-only encoder: literal runs + one 2-byte copy) ──
function packBits(bits: number[]): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8 && i + k < bits.length; k++) b |= bits[i + k]! << k; // read LSB first
    bytes.push(b);
  }
  return Uint8Array.from(bytes);
}
const val = (v: number, n: number) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
function crunchFile(bits: number[], unpacked: number): Uint8Array {
  const body = packBits(bits);
  const packed = 10 + body.length;
  const out = new Uint8Array(packed);
  out[0] = 8;
  for (let k = 0; k < body.length; k++) out[packed - 1 - k] = body[k]!; // read backwards
  out[1] = body.reduce((a, b) => a ^ b, 0);
  new DataView(out.buffer).setUint32(2, unpacked);
  new DataView(out.buffer).setUint32(6, packed);
  return out;
}

describe('hiredguns crunch (synthetic)', () => {
  // "ABAB": two literals written from the end (B then A), then a 2-byte copy at offset 1.
  const bits = [0, 0, ...val(1, 3), ...val(0x42, 8), ...val(0x41, 8), 0, 1, ...val(1, 8)];
  it('decodes literals and a backward copy', () => {
    expect(Array.from(decrunch(crunchFile(bits, 4)))).toEqual([0x41, 0x42, 0x41, 0x42]);
  });
  it('a corrupted byte fails the checksum (null control)', () => {
    const f = crunchFile(bits, 4);
    f[f.length - 1] ^= 0x10;
    expect(() => decrunch(f)).toThrow(CrunchError);
  });
});

// ── synthetic voxel world ──
function world(): HgWorld {
  const cells = new Uint32Array(CELLS);
  const stone = (BLOCK_HERE | OPAQUE) >>> 0;
  for (let i = 0; i < LAYER * 5; i++) cells[i] = stone; // z 0..4 solid
  // z=5 is open ground; a wall at (6,5,5); a door at (5,3,5); a locked door at (3,5,5)
  cells[cellIndex(6, 5, 5)] = stone;
  cells[cellIndex(5, 3, 5)] = ((20 << 11) | BLOCK_HERE | AUX_HERE | (12 << 28)) >>> 0;
  cells[cellIndex(3, 5, 5)] = ((21 << 11) | BLOCK_HERE) >>> 0;
  // stairs at (5,7): aux "up facing S" (10) at z5; the block ahead (5,8,5) is "down facing N" (18)
  cells[cellIndex(5, 7, 5)] = (AUX_HERE | (10 << 28)) >>> 0;
  cells[cellIndex(5, 8, 5)] = ((18 << 11) | BLOCK_HERE) >>> 0;
  cells[cellIndex(5, 8, 4)] = stone;
  // a hole: (8,5,4) open, so stepping onto (8,5,5) falls to z4 (z3 is stone)
  cells[cellIndex(8, 5, 4)] = 0;
  return { cells, doors: [{ cell: cellIndex(3, 5, 5), direction: 3, key: 71, buttonOnly: false }] };
}

describe('hiredguns movement (synthetic)', () => {
  it('walks on solid ground and is blocked by a wall', () => {
    const w = world();
    expect(supported(w, cellIndex(5, 5, 5))).toBe(true);
    expect(tryStep(w, { x: 5, y: 5, z: 5 }, 2)).toMatchObject({ moved: true, pos: { x: 5, y: 6, z: 5 } });
    expect(tryStep(w, { x: 5, y: 5, z: 5 }, 1)).toMatchObject({ moved: false, event: 'blocked' });
  });
  it('cannot move while unsupported', () => {
    const w = world();
    expect(supported(w, cellIndex(5, 5, 7))).toBe(false);
    expect(tryStep(w, { x: 5, y: 5, z: 7 }, 0).event).toBe('falling');
  });
  it('opens an unlocked door, keeps a locked one shut', () => {
    const w = world();
    expect(tryStep(w, { x: 5, y: 4, z: 5 }, 0).event).toBe('door-opened');
    expect(blockOf(w.cells[cellIndex(5, 3, 5)]!)).toBe(0);
    expect(auxOf(w.cells[cellIndex(5, 3, 5)]!)).toBe(12);
    expect(tryStep(w, { x: 5, y: 4, z: 5 }, 0)).toMatchObject({ moved: true, pos: { x: 5, y: 3, z: 5 } });
    expect(tryStep(w, { x: 4, y: 5, z: 5 }, 3).event).toBe('door-locked');
  });
  it('climbs stairs only in the stair direction (wrong-orientation control)', () => {
    const w = world();
    expect(tryStep(w, { x: 5, y: 7, z: 5 }, 2)).toMatchObject({ moved: true, event: 'stairs-up', pos: { x: 5, y: 8, z: 6 } });
    expect(tryStep(w, { x: 5, y: 7, z: 5 }, 0)).toMatchObject({ moved: true, event: 'moved', pos: { x: 5, y: 6, z: 5 } });
  });
  it('descends from the top of a down-stair', () => {
    const w = world();
    // standing on (5,8,6) above the down-stair block facing N: walking N goes down to (5,7,5)
    expect(tryStep(w, { x: 5, y: 8, z: 6 }, 0)).toMatchObject({ moved: true, event: 'stairs-down', pos: { x: 5, y: 7, z: 5 } });
    expect(tryStep(w, { x: 5, y: 8, z: 6 }, 2).event).not.toBe('stairs-down');
  });
  it('falls through a hole until supported', () => {
    const w = world();
    expect(fall(w, cellIndex(8, 5, 5))).toEqual({ cell: cellIndex(8, 5, 4), fell: 1 });
    expect(tryStep(w, { x: 7, y: 5, z: 5 }, 1)).toMatchObject({ moved: true, event: 'falling', pos: { x: 8, y: 5, z: 4 } });
  });
  it('level ids encode map and layer', () => {
    expect(levelIdOf(1, 11)).toBe(111);
    expect(splitLevelId(4718)).toEqual({ map: 47, z: 18 });
  });
});

// ── real data (skips without data/) ──
const GAME = resolve('data/hiredguns/amiga/game');
const UNPACKED = resolve('build/cache/hiredguns/unpacked');
const haveData = existsSync(resolve(GAME, 'CharactersGfx')) && existsSync(resolve(UNPACKED, 'Hired Guns'));

describe.skipIf(!haveData)('hiredguns real data', () => {
  const exe = () => new Uint8Array(readFileSync(resolve(UNPACKED, 'Hired Guns')));
  const map01 = () => new Uint8Array(readFileSync(resolve(UNPACKED, 'Maps/01.map')));

  it('decrunches all 31 figure files with a clean checksum', () => {
    let n = 0;
    for (const d of ['CharactersGfx', 'MonstersGfx']) for (const f of readdirSync(resolve(GAME, d)).filter((x) => x.endsWith('.gfx'))) {
      const src = new Uint8Array(readFileSync(resolve(GAME, d, f)));
      const out = decrunch(src);
      expect(out.length).toBe(new DataView(src.buffer, src.byteOffset).getUint32(2));
      n++;
    }
    expect(n).toBe(31);
  });

  it('exe view tables pass their fingerprints', () => {
    const t = readExeTables(exe());
    expect(t.dirOffsets).toHaveLength(4);
    expect(t.dirOffsets[0]![66]).toBe(0); // last position = own cell
    expect(t.dirOffsets[1]![64]).toBe(-23); // facing E, left = north
  });

  it('map 01: start cell, plane alignment and the stair pairing', () => {
    const m = parseMap(map01());
    expect(m.num).toBe(1);
    expect(m.title).toBe('Artificial Island');
    expect(m.players[0]).toEqual({ x: 7, y: 11, z: 11 });
    // z=0 is bedrock (stone, opaque), z=19 the closed cap
    expect(m.cells[0]).toBe((BLOCK_HERE | OPAQUE) >>> 0);
    const below = m.cells[cellIndex(7, 11, 10)]!;
    expect(below & BLOCK_HERE).toBe(BLOCK_HERE);
    expect(floorOf(m.cells[cellIndex(7, 11, 11)]!) & 3).toBe(3);
    expect(m.cells[cellIndex(7, 11, 11)]! & FLOOR_HERE).toBe(1);
    // every up-stair has the down-stair block ahead, facing back; none for a rotated reading
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], DOWN = [18, 19, 16, 17];
    let ok = 0, rotated = 0, total = 0;
    m.cells.forEach((v, i) => {
      if (!(v & AUX_HERE) || auxOf(v) < 8 || auxOf(v) > 11) return;
      const d = auxOf(v) - 8, x = i % 23, y = Math.floor(i / 23) % 23, z = Math.floor(i / LAYER);
      const t = m.cells[cellIndex(x + DX[d]!, y + DY[d]!, z)]!;
      total++;
      if (t & BLOCK_HERE && blockOf(t) === DOWN[(d + 2) & 3]) ok++;
      if (t & BLOCK_HERE && blockOf(t) === DOWN[(d + 3) & 3]) rotated++;
    });
    expect(total).toBeGreaterThan(0);
    expect(ok).toBe(total);
    expect(rotated).toBe(0);
    expect(readDoors(map01()).some((d) => d.direction === 3)).toBe(true);
  });

  it('view: deterministic, facing-dependent, and a wall ahead hides what is behind it', () => {
    const t: HgViewTables = readExeTables(exe());
    const m = parseMap(map01());
    const style = parseGfxBank(new Uint8Array(readFileSync(resolve(UNPACKED, 'Styles/Style00.gfx'))));
    const inp = { cells: m.cells, sky4: m.sky4, style, tables: t };
    const start = cellIndex(7, 11, 11);
    const a = renderView(inp, start, 0), a2 = renderView(inp, start, 0), b = renderView(inp, start, 1);
    expect(a.index.length).toBe(VIEW_W * VIEW_H);
    expect(Buffer.from(a.index).equals(Buffer.from(a2.index))).toBe(true);
    expect(Buffer.from(a.index).equals(Buffer.from(b.index))).toBe(false);
    expect(new Set(a.index).size).toBeGreaterThan(8); // real art, not a blank frame

    // hidden-block removal: an opaque block right ahead (position 57 = depth-1 centre)
    const cells = new Uint32Array(CELLS);
    for (let i = 0; i < LAYER * 5; i++) cells[i] = (BLOCK_HERE | OPAQUE) >>> 0;
    const me = cellIndex(10, 10, 5);
    cells[me - 2 * 23] = (BLOCK_HERE) >>> 0; // two ahead (north), a visible block
    const open = scanView({ ...inp, cells }, me, 0);
    const d2 = t.dirOffsets[0]!.indexOf(-46);
    expect(open[d2]! & 0x80).toBe(0); // visible without the wall (null control)
    cells[me - 23] = (BLOCK_HERE | OPAQUE) >>> 0;
    const walled = scanView({ ...inp, cells }, me, 0);
    expect(walled[d2]).toBe(0x80);
  });
});
