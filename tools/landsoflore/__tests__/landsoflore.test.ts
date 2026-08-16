import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeKyraBitmap } from '../kyra-bitmap.ts';
import { decodeCmz, wallTypeAt } from '../decode-maze.ts';
import { decodeWll, buildWllLookup } from '../decode-wll.ts';
import { decodeVcn } from '../decode-vcn.ts';
import { decodeVmp, WALL_RENDER_SLOTS } from '../decode-vmp.ts';
import { decodeIniWallSet } from '../decode-ini.ts';
import { disassembleEmc, LOL_SYSCALLS } from '../decode-emc.ts';
import { resolveWallTypes, canStepForward, rotateOffset } from '../view-model.ts';
import { renderView, VIEWPORT_W, VIEWPORT_H } from '../renderer.ts';
import { parsePak, readEntry, ensureExtracted, LEVEL_WALL_SETS, CACHE_DIR } from '../export-dungeon.ts';

const DATA_DIR = 'data/landsoflore/dosvga';
const PAK_DIR = resolve(CACHE_DIR, 'DATA');

beforeAll(() => {
  const isoPath = resolve(DATA_DIR, 'GAME.DAT');
  const levelPaths = Object.keys(LEVEL_WALL_SETS).map((n) => `DATA/L${String(n).padStart(2, '0')}.PAK`);
  const wallSetPaths = [...new Set(Object.values(LEVEL_WALL_SETS))].map((w) => `DATA/${w}.PAK`);
  // L02.PAK (FOREST1) isn't in LEVEL_WALL_SETS (skipped, non-standard VMP)
  // but its LEVEL2.INI is needed by the "wall-set name follows an ALTPAL
  // string" decodeIniWallSet test below.
  ensureExtracted(isoPath, CACHE_DIR, [...levelPaths, ...wallSetPaths, 'DATA/L02.PAK']);
}, 60_000);

function loadPakEntry(pak: string, entryName: string): Uint8Array {
  const data = readFileSync(resolve(PAK_DIR, pak));
  const entries = parsePak(data);
  const key = [...entries.keys()].find((k) => k.toUpperCase() === entryName.toUpperCase());
  if (!key) throw new Error(`${entryName} not found in ${pak} (have: ${[...entries.keys()].join(', ')})`);
  return readEntry(data, entries.get(key)!);
}

describe('decodeKyraBitmap', () => {
  it('unwraps the real LEVEL1.CMZ header (compType=4, imgSize=4102, palSize=0)', () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.CMZ');
    const body = decodeKyraBitmap(raw);
    expect(body.length).toBe(4102);
  });
});

describe('decodeCmz', () => {
  it("decodes the real LEVEL1.CMZ to a 32x32 grid matching EOB's MAZ shape", () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.CMZ');
    const maze = decodeCmz(raw);
    expect(maze.width).toBe(32);
    expect(maze.height).toBe(32);
    expect(maze.cells.length).toBe(1024);
  });

  it('most real per-side bytes are the clean small (0-3) range the renderer handles directly', () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.CMZ');
    const maze = decodeCmz(raw);
    let clean = 0;
    let total = 0;
    for (const cell of maze.cells) for (const v of cell) { total++; if (v <= 3) clean++; }
    expect(clean / total).toBeGreaterThan(0.95);
  });
});

describe('decodeWll', () => {
  it('decodes the real LEVEL1.WLL to 52 records, byte length matches the (size-2)/12 oracle (closes lol-wll-format independently)', () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.WLL');
    const wll = decodeWll(raw);
    expect(wll.records.length).toBe(52);
    expect((raw.length - 2) / 12).toBe(52);
  });

  it("wallTypeIndex is sequential 0-26 for the first 27 records, then a sparse set matching LEVEL1.CMZ's own out-of-range raw byte values (this session's correction: WLL is a sparse rawByte->vmpMapValue dictionary, not a dense 0-51 array)", () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.WLL');
    const wll = decodeWll(raw);
    const indices = wll.records.map((r) => r.wallTypeIndex);
    for (let i = 0; i < 27; i++) expect(indices[i]).toBe(i);
    // Every key is unique (a real dictionary, not an array with duplicate/garbage slots).
    expect(new Set(indices).size).toBe(52);
  });

  it('buildWllLookup covers every raw wall byte actually used by the real LEVEL1.CMZ (zero misses)', () => {
    const wll = decodeWll(loadPakEntry('L01.PAK', 'LEVEL1.WLL'));
    const lookup = buildWllLookup(wll);
    const maze = decodeCmz(loadPakEntry('L01.PAK', 'LEVEL1.CMZ'));
    const misses: number[] = [];
    for (const cell of maze.cells) for (const v of cell) if (v !== 0 && !lookup.has(v)) misses.push(v);
    expect(misses).toEqual([]);
  });
});

describe('decodeIniWallSet', () => {
  it('resolves LEVEL1.INI to KEEP (wall-set name is the first TEXT string)', () => {
    const raw = loadPakEntry('L01.PAK', 'LEVEL1.INI');
    expect(decodeIniWallSet(raw)).toBe('KEEP');
  });

  it('resolves LEVEL2.INI to FOREST1 (wall-set name follows an ALTPAL string, not first)', () => {
    const raw = loadPakEntry('L02.PAK', 'LEVEL2.INI');
    expect(decodeIniWallSet(raw)).toBe('FOREST1');
  });
});

describe('decodeVcn + decodeVmp, per real wall set', () => {
  const wallSets = [...new Set(Object.values(LEVEL_WALL_SETS))];

  for (const ws of wallSets) {
    it(`${ws}: VCN/VMP oracle checks pass and every VMP tile index is in range`, () => {
      const vcnRaw = loadPakEntry(`${ws}.PAK`, `${ws}.VCN`);
      const vcn = decodeVcn(vcnRaw);
      expect(vcn.numTiles).toBeGreaterThan(0);
      expect(vcn.palette.length).toBe(128);

      const vmpRaw = loadPakEntry(`${ws}.PAK`, `${ws}.VMP`);
      const vmp = decodeVmp(vmpRaw, vcn.numTiles);
      expect(vmp.wallTiles.length).toBeGreaterThanOrEqual(2);
      expect(vmp.wallTiles.length).toBeLessThanOrEqual(6);
    });
  }

  it('FOREST1 (1192-entry VMP) decodes cleanly with 2 wallTypes -- 1192-330 divides exactly by 431, so it is NOT the non-standard case EOB2 skips (that decoder just hardcodes N=6)', () => {
    const vcnRaw = loadPakEntry('FOREST1.PAK', 'FOREST1.VCN');
    const vcn = decodeVcn(vcnRaw);
    const vmpRaw = loadPakEntry('FOREST1.PAK', 'FOREST1.VMP');
    const vmp = decodeVmp(vmpRaw, vcn.numTiles);
    expect(vmp.wallTiles.length).toBe(2);
  });

  it('decodeVmp throws on a genuinely non-standard entry count', () => {
    // 330 + 1*431 + 1 = 762, one word short of a clean 2-wallType split.
    const bogus = new Uint8Array(2 + 10 + 762 * 2);
    bogus[0] = 0xba; bogus[1] = 0x02; // fileSize-2 placeholder (unused by decodeKyraBitmap's caller here -- compType/imgSize below are what matter)
    bogus[2] = 0; bogus[3] = 0; // compType 0 (raw)
    const imgSize = 2 + 762 * 2;
    bogus[4] = imgSize & 0xff; bogus[5] = (imgSize >> 8) & 0xff;
    bogus[8] = 0; bogus[9] = 0; // palSize
    bogus[10] = 762 & 0xff; bogus[11] = (762 >> 8) & 0xff; // count
    expect(() => decodeVmp(bogus, 100000)).toThrow(/non-standard entry count/);
  });

  it('vcnShift byte values are always a clean multiple of 16 in 0-112 across every wall set (the format finding this session pinned down)', () => {
    for (const ws of wallSets) {
      const vcnRaw = loadPakEntry(`${ws}.PAK`, `${ws}.VCN`);
      const body = decodeKyraBitmap(vcnRaw);
      const numTiles = body[0]! | (body[1]! << 8);
      const shift = body.subarray(2, 2 + numTiles);
      for (const s of shift) {
        expect(s % 16).toBe(0);
        expect(s).toBeLessThanOrEqual(112);
      }
    }
  });
});

describe('view-model + renderer, real KEEP level 1 data', () => {
  let maze: ReturnType<typeof decodeCmz>;
  let vcn: ReturnType<typeof decodeVcn>;
  let vmp: ReturnType<typeof decodeVmp>;

  beforeAll(() => {
    maze = decodeCmz(loadPakEntry('L01.PAK', 'LEVEL1.CMZ'));
    vcn = decodeVcn(loadPakEntry('KEEP.PAK', 'KEEP.VCN'));
    vmp = decodeVmp(loadPakEntry('KEEP.PAK', 'KEEP.VMP'), vcn.numTiles);
  });

  it('resolveWallTypes returns all 25 slots with wallType in [0, wallTypes]', () => {
    const resolved = resolveWallTypes(maze, 5, 5, 0, vmp.wallTiles.length);
    expect(resolved.length).toBe(WALL_RENDER_SLOTS.length);
    for (const { wallType } of resolved) {
      expect(wallType).toBeGreaterThanOrEqual(0);
      expect(wallType).toBeLessThanOrEqual(vmp.wallTiles.length);
    }
  });

  it('canStepForward agrees with a direct wallTypeAt(front) === 0 check', () => {
    const canStep = canStepForward(maze, 5, 5, 0);
    expect(canStep).toBe(wallTypeAt(maze, 5, 5, 'N') === 0);
  });

  it('rotateOffset is a clean involution over 4 facings (rotating 4x returns the original offset)', () => {
    let [dx, dy] = [2, -3];
    for (let i = 0; i < 4; i++) [dx, dy] = rotateOffset(dx, dy, 1);
    expect([dx, dy]).toEqual([2, -3]);
  });

  it('renderView produces a full VIEWPORT_W x VIEWPORT_H surface with real (non-all-background) content', () => {
    const surface = renderView(maze, 5, 5, 0, vcn, vmp);
    expect(surface.width).toBe(VIEWPORT_W);
    expect(surface.height).toBe(VIEWPORT_H);
    const nonZero = surface.data.filter((v) => v !== 0).length;
    expect(nonZero).toBeGreaterThan(surface.data.length * 0.3);
  });
});

describe('decode-emc: EMC2 script bytecode disassembly, real LEVEL1.INI', () => {
  it('decodes every word to a valid opcode (0-18) with no truncation', () => {
    const instructions = disassembleEmc(loadPakEntry('L01.PAK', 'LEVEL1.INI'));
    expect(instructions.length).toBeGreaterThan(0);
    for (const inst of instructions) {
      expect(inst.opcode).toBeGreaterThanOrEqual(0);
      expect(inst.opcode).toBeLessThanOrEqual(18);
    }
  });

  it('resolves sysCall ids to real, mostly-implemented LoLEngine::olol_* names', () => {
    const instructions = disassembleEmc(loadPakEntry('L01.PAK', 'LEVEL1.INI'));
    const sysCalls = instructions.filter((i) => i.mnemonic === 'sysCall');
    expect(sysCalls.length).toBeGreaterThan(0);
    const unresolved = sysCalls.filter((i) => i.syscall?.startsWith('<unimplemented'));
    // A handful of real OpcodeUnImpl() reserved slots exist in the engine's
    // own table -- a script referencing one isn't a decode bug, but the vast
    // majority of a real level-init script's sysCalls should resolve to a
    // named engine function.
    expect(unresolved.length).toBeLessThan(sysCalls.length * 0.1);
    // Sanity: a level-init script should plausibly touch level/monster setup.
    const names = new Set(sysCalls.map((i) => i.syscall));
    expect(names.has('olol_loadLevelGraphics')).toBe(true);
    expect(names.has('olol_loadMonsterShapes')).toBe(true);
  });

  it('LOL_SYSCALLS has exactly 190 entries, matching the Opcode()/OpcodeUnImpl() push count in LoLEngine::setupOpcodeTable', () => {
    expect(LOL_SYSCALLS.length).toBe(190);
  });
});
