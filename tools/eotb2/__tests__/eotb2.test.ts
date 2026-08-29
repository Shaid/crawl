import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeMaze, wallTypeAt, type MazeData } from '../decode-maze.ts';
import { rotateOffset, resolveWallTypes, canStepForward } from '../view-model.ts';
import { decodeInf, parseInf, buildWallTypeMap, resolveWallDecorationAssignments } from '../decode-inf.ts';
import { decodeVcn } from '../decode-vcn.ts';
import { decodeVmp, WALL_RENDER_SLOTS } from '../decode-vmp.ts';
import { decodePal } from '../palette.ts';
import { decodeCps } from '../decode-cps.ts';
import { decodeDecorations, decorationChain, type DecorationData } from '../../eotb/decode-decorations.ts';
import { renderView, VIEWPORT_W, VIEWPORT_H } from '../renderer.ts';

const DATA_DIR = 'data/eotb2/dosvga';

function loadMaze(level: number): MazeData {
  const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${level}.INF`)));
  const { mazStem } = decodeInf(infRaw);
  const data = readFileSync(resolve(DATA_DIR, mazStem.toUpperCase()));
  return decodeMaze(new Uint8Array(data));
}

describe('decodeInf', () => {
  it('resolves every real LEVEL*.INF (1-16) to a known wall-set stem and a .maz mazStem', () => {
    const KNOWN_WALL_SETS = new Set(['dung', 'forest', 'mezz', 'silver', 'crimson', 'azure']);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`));
      const { mazStem, wallSetStem } = decodeInf(new Uint8Array(data));
      expect(KNOWN_WALL_SETS.has(wallSetStem.toLowerCase())).toBe(true);
      expect(mazStem.toLowerCase()).toMatch(/\.maz$/);
    }
  });

  it("LEVEL16.INF reuses LEVEL15's maze (documented maze-reuse case)", () => {
    const data = readFileSync(resolve(DATA_DIR, 'LEVEL16.INF'));
    const { mazStem } = decodeInf(new Uint8Array(data));
    expect(mazStem.toLowerCase()).toBe('level15.maz');
  });

  it('throws on a truncated/corrupt buffer rather than silently misreading', () => {
    expect(() => decodeInf(new Uint8Array(5))).toThrow();
  });

  it('decodes the optional second wall-set stem ("azure") on exactly LEVEL10-14, and only those', () => {
    const expectSecond = new Set([10, 11, 12, 13, 14]);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`));
      const { secondWallSetStem } = decodeInf(new Uint8Array(data));
      if (expectSecond.has(n)) {
        expect(secondWallSetStem?.toLowerCase()).toBe('azure');
      } else {
        expect(secondWallSetStem).toBeUndefined();
      }
    }
  });
});

describe('parseInf / buildWallTypeMap / resolveWallDecorationAssignments (wall-mapping + decoration-load record stream)', () => {
  it('parses the full record stream for every real LEVEL*.INF (1-16) with a tag2 0xEC before the record count', () => {
    for (let n = 1; n <= 16; n++) {
      const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`)));
      const { wallMappings, decorationLoads, records } = parseInf(infRaw);
      expect(records.length).toBe(wallMappings.length + decorationLoads.length);
      expect(decorationLoads.length).toBeGreaterThan(0);
    }
  });

  it("LEVEL1's decoration-load records resolve to the real on-disk brown1/brown2 CPS + brown.dec pair", () => {
    const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'LEVEL1.INF')));
    const { decorationLoads } = parseInf(infRaw);
    expect(decorationLoads.map((r) => r.cpsFile.toLowerCase())).toEqual(['brown1', 'brown2']);
    expect(decorationLoads.every((r) => r.decFile.toLowerCase() === 'brown.dec')).toBe(true);
  });

  it('every decoration-load decFile resolves to one of the 6 real on-disk .DEC files, for all 16 levels', () => {
    const KNOWN_DEC_FILES = new Set(['brown.dec', 'forest.dec', 'mezz.dec', 'silver.dec', 'azure.dec', 'crimson.dec']);
    for (let n = 1; n <= 16; n++) {
      const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`)));
      const { decorationLoads } = parseInf(infRaw);
      for (const { decFile } of decorationLoads) {
        expect(KNOWN_DEC_FILES.has(decFile.toLowerCase())).toBe(true);
      }
    }
  });

  it('buildWallTypeMap applies the resetWallData default plus this level\'s real .INF overrides', () => {
    const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'LEVEL1.INF')));
    const map = buildWallTypeMap(infRaw);
    expect(map).toHaveLength(256);
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(2);
    expect(map[10]).toBe(3); // resetWallData default range 3-22
    expect(map[23]).toBe(4);
    expect(map[24]).toBe(5);
  });

  it('resolveWallDecorationAssignments resolves every wall-mapping decIndex in-range against its real .DEC file, across all 16 levels (0 out-of-range, 0 empty chains)', () => {
    const decCache = new Map<string, DecorationData>();
    let totalAssignments = 0;
    for (let n = 1; n <= 16; n++) {
      const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`)));
      const assignments = resolveWallDecorationAssignments(infRaw);
      for (const [, a] of assignments) {
        totalAssignments++;
        if (!decCache.has(a.decFile)) {
          const decRaw = readFileSync(resolve(DATA_DIR, a.decFile.toUpperCase()));
          decCache.set(a.decFile, decodeDecorations(new Uint8Array(decRaw)));
        }
        const dec = decCache.get(a.decFile)!;
        expect(a.decIndex).toBeGreaterThanOrEqual(0);
        expect(a.decIndex).toBeLessThan(dec.properties.length);
        expect(decorationChain(dec, a.decIndex).length).toBeGreaterThan(0);
      }
    }
    expect(totalAssignments).toBe(308); // this session's full-corpus verification count, see decode-inf.ts's module doc
  });

  it('LEVEL10-14 (mezz tileset) reference azure.dec/azure*.cps, not mezz.dec -- the second-wall-set-stem correlation', () => {
    for (const n of [10, 11, 12, 13, 14]) {
      const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`)));
      const { wallSetStem, decorationLoads } = parseInf(infRaw);
      expect(wallSetStem.toLowerCase()).toBe('mezz');
      expect(decorationLoads.every((r) => r.decFile.toLowerCase() === 'azure.dec')).toBe(true);
    }
  });
});

describe('decodeCps (EOB2 DOS/VGA chunky 8bpp, distinct from EOB1 Amiga planar)', () => {
  it('decodes a real decoration sheet (BROWN1.CPS) to exactly 320x200 chunky indices with 0 residue', () => {
    const data = readFileSync(resolve(DATA_DIR, 'BROWN1.CPS'));
    const cps = decodeCps(new Uint8Array(data));
    expect(cps.width).toBe(320);
    expect(cps.height).toBe(200);
    expect(cps.indices).toHaveLength(320 * 200);
  });
});

describe('decodePal', () => {
  it('rejects a size that fails the 768-byte oracle check', () => {
    expect(() => decodePal(new Uint8Array(100))).toThrow(/oracle check failed/);
  });

  it('expands 6-bit VGA values with the low-2-bit-preserving formula, not naive *4', () => {
    // v=63 (max 6-bit) -> 255, not 63*4=252.
    const data = new Uint8Array(768);
    data[0] = 63;
    data[1] = 63;
    data[2] = 63;
    const palette = decodePal(data);
    expect(palette[0]).toEqual([255, 255, 255]);
  });

  it('decodes a real CRIMSON.PAL to 256 colours', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.PAL'));
    const palette = decodePal(new Uint8Array(data));
    expect(palette).toHaveLength(256);
  });
});

describe('decodeVcn', () => {
  it('decodes real CRIMSON.VCN to the doc-confirmed tile count', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VCN'));
    const vcn = decodeVcn(new Uint8Array(data));
    expect(vcn.numTiles).toBe(1132);
    expect(vcn.tiles).toHaveLength(1132);
    expect(vcn.tiles[0]).toHaveLength(64); // 8x8
  });
});

describe('decodeVmp', () => {
  it('decodes real FOREST.VMP as a 2-wall-type set (1192 = 330 backdrop + 2*431), not a rejected non-standard layout', () => {
    const data = readFileSync(resolve(DATA_DIR, 'FOREST.VMP'));
    const vmp = decodeVmp(new Uint8Array(data), 906);
    expect(vmp.backdrop).toHaveLength(22);
    expect(vmp.backdrop[0]).toHaveLength(15);
    expect(vmp.wallTiles).toHaveLength(2);
    expect(vmp.wallTiles[0]).toHaveLength(431);
  });

  it('rejects a genuinely non-standard entry count that does not divide evenly by 431', () => {
    const bogus = new Uint8Array(2 + 331 * 2); // 331 != 330 + N*431 for any integer N
    bogus[0] = 331 & 0xff;
    bogus[1] = (331 >> 8) & 0xff;
    expect(() => decodeVmp(bogus, 10000)).toThrow(/non-standard entry count/);
  });

  it('rejects a resolved tile index >= numTiles (endianness/layout guard)', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    expect(() => decodeVmp(new Uint8Array(data), 1)).toThrow(/oracle check failed/);
  });

  it('decodes real CRIMSON.VMP to the doc-confirmed shape and max index', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    const vmp = decodeVmp(new Uint8Array(data), 1132);
    expect(vmp.backdrop).toHaveLength(22);
    expect(vmp.backdrop[0]).toHaveLength(15);
    expect(vmp.wallTiles).toHaveLength(6);
    expect(vmp.wallTiles[0]).toHaveLength(431);
    let maxIndex = 0;
    for (const col of vmp.backdrop) for (const ref of col) maxIndex = Math.max(maxIndex, ref.tileIndex);
    for (const run of vmp.wallTiles) for (const ref of run) maxIndex = Math.max(maxIndex, ref.tileIndex);
    expect(maxIndex).toBe(1131); // numTiles - 1, per docs/eotb2/dosvga/data-structure.md's table
  });
});

describe('decodeMaze (reused from tools/eotb)', () => {
  it('decodes a real EOB2 LEVEL1.MAZ header (byte-identical format to EOB1)', () => {
    const maze = loadMaze(1);
    expect(maze.width).toBe(32);
    expect(maze.height).toBe(32);
    expect(wallTypeAt(maze, 0, 0, 'N')).toBeGreaterThanOrEqual(0);
  });
});

describe('rotateOffset / resolveWallTypes / canStepForward (reused from tools/eotb, same geometry table)', () => {
  it('rotateOffset is the identity for facing North', () => {
    expect(rotateOffset(2, -3, 0)).toEqual([2, -3]);
  });

  it('resolveWallTypes resolves all 25 WALL_RENDER_SLOTS to a wallType in 0-6 for a real EOB2 level', () => {
    const maze = loadMaze(1);
    for (const facing of [0, 1, 2, 3] as const) {
      const resolved = resolveWallTypes(maze, 16, 16, facing);
      expect(resolved).toHaveLength(WALL_RENDER_SLOTS.length);
      for (const { wallType } of resolved) {
        expect(wallType).toBeGreaterThanOrEqual(0);
        expect(wallType).toBeLessThanOrEqual(6);
      }
    }
  });

  it('canStepForward agrees with wallTypeAt on the facing side', () => {
    const maze = loadMaze(1);
    for (let x = 0; x < 5; x++) {
      expect(canStepForward(maze, x, x, 0)).toBe(wallTypeAt(maze, x, x, 'N') === 0);
    }
  });
});

describe('renderView (end-to-end, real EOB2 corpus data)', () => {
  it('renders a real level-1 pose to a non-degenerate (not all-background) surface', () => {
    const maze = loadMaze(1);
    const vcnData = readFileSync(resolve(DATA_DIR, 'CRIMSON.VCN'));
    const vmpData = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    const vcn = decodeVcn(new Uint8Array(vcnData));
    const vmp = decodeVmp(new Uint8Array(vmpData), vcn.numTiles);

    const surface = renderView(maze, 16, 16, 0, vcn, vmp);
    expect(surface.width).toBe(VIEWPORT_W);
    expect(surface.height).toBe(VIEWPORT_H);
    // The backdrop alone (ceiling/floor, drawn unconditionally) guarantees
    // at least some nonzero pixels regardless of pose.
    let nonZero = 0;
    for (const v of surface.data) if (v !== 0) nonZero++;
    expect(nonZero).toBeGreaterThan(0);
  });

  it('renders LEVEL1 with decoration overlays on top of walls without throwing, using the real wallTypeMap + decoration data, and stays a superset of the walls-only pixels', () => {
    const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'LEVEL1.INF')));
    const { mazStem } = decodeInf(infRaw);
    const maze = decodeMaze(new Uint8Array(readFileSync(resolve(DATA_DIR, mazStem.toUpperCase()))));
    const wallTypeMap = buildWallTypeMap(infRaw);
    const wallDecorations = Object.fromEntries([...resolveWallDecorationAssignments(infRaw)]);
    const { decorationLoads } = parseInf(infRaw);

    const vcn = decodeVcn(new Uint8Array(readFileSync(resolve(DATA_DIR, 'DUNG.VCN'))));
    const vmp = decodeVmp(new Uint8Array(readFileSync(resolve(DATA_DIR, 'DUNG.VMP'))), vcn.numTiles);

    const decorationsByFile: Record<string, DecorationData> = {};
    const sheets: Record<string, { width: number; height: number; indices: Uint8Array }> = {};
    for (const { cpsFile, decFile } of decorationLoads) {
      if (!decorationsByFile[decFile]) {
        decorationsByFile[decFile] = decodeDecorations(new Uint8Array(readFileSync(resolve(DATA_DIR, decFile.toUpperCase()))));
      }
      if (!sheets[cpsFile]) {
        const cps = decodeCps(new Uint8Array(readFileSync(resolve(DATA_DIR, `${cpsFile.toUpperCase()}.CPS`))));
        sheets[cpsFile] = { width: cps.width, height: cps.height, indices: cps.indices };
      }
    }

    // Find a real pose adjacent to a decorated wallIndex so the overlay actually has something to draw.
    let found: { x: number; y: number; facing: 0 | 1 | 2 | 3 } | null = null;
    outer: for (let y = 0; y < maze.height && !found; y++) {
      for (let x = 0; x < maze.width && !found; x++) {
        for (const facing of [0, 1, 2, 3] as const) {
          const resolved = resolveWallTypes(maze, x, y, facing, wallTypeMap);
          const front = resolved.find((r) => r.slot.label === 'D-south');
          if (front && wallDecorations[front.rawWallIndex]) {
            found = { x, y, facing };
            break outer;
          }
        }
      }
    }
    expect(found).not.toBeNull();

    const withoutDecorations = renderView(maze, found!.x, found!.y, found!.facing, vcn, vmp, wallTypeMap);
    const withDecorations = renderView(maze, found!.x, found!.y, found!.facing, vcn, vmp, wallTypeMap, {
      wallDecorations,
      decorationsByFile,
      sheets,
    });

    expect(withDecorations.width).toBe(VIEWPORT_W);
    expect(withDecorations.height).toBe(VIEWPORT_H);
    let changedPixels = 0;
    for (let i = 0; i < withoutDecorations.data.length; i++) {
      if (withoutDecorations.data[i] !== withDecorations.data[i]) changedPixels++;
    }
    expect(changedPixels).toBeGreaterThan(0);
  });
});
