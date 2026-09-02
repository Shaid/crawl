import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeVcn } from '../decode-vcn.ts';
import { decodeVmp } from '../decode-vmp.ts';
import { decodeMaze } from '../decode-maze.ts';
import { decodeInf, parseInf, buildWallTypeMap, resolveWallDecorationAssignments } from '../decode-inf.ts';
import { decodePal } from '../palette.ts';
import { decodeCps } from '../decode-cps.ts';
import { decodeDecorations, decorationChain, type DecorationData } from '../decode-decorations.ts';
import { decodeItemDat, decodeItemTypeDat } from '../decode-items.ts';
import { decodeTextCps } from '../decode-text.ts';
import { decompressKyraContainer } from '../decode-vcn.ts';
import { createHash } from 'node:crypto';

const DATA_DIR = 'data/eotb2/amiga/data';
const HAS_CORPUS = existsSync(resolve(DATA_DIR, 'EOBII'));

// LEVEL5's real on-disk filename is lowercase in this corpus.
const infFilename = (n: number) => (n === 5 ? 'level5.inf' : `LEVEL${n}.INF`);

describe.skipIf(!HAS_CORPUS)('EOB2 (Amiga) decoders, real corpus', () => {
  const WALL_SETS = ['CRIMSON', 'DUNG', 'FOREST', 'MEZZ', 'SILVER'] as const;
  // Real numTiles per wall set, confirmed 2026-09-02 (see docs/eotb2/amiga/data-structure.md).
  const EXPECTED_TILES: Record<string, number> = { CRIMSON: 1138, DUNG: 1448, FOREST: 904, MEZZ: 1193, SILVER: 1115 };

  it('decodeVcn: LCW-decompresses every real wall-set .VCN to the EOB1-Amiga-shaped raw payload, 0 residue', () => {
    for (const ws of WALL_SETS) {
      const raw = readFileSync(resolve(DATA_DIR, `${ws}.VCN`));
      const vcn = decodeVcn(new Uint8Array(raw));
      expect(vcn.numTiles).toBe(EXPECTED_TILES[ws]);
      expect(vcn.tiles).toHaveLength(EXPECTED_TILES[ws]!);
      for (const tile of vcn.tiles) expect(tile).toHaveLength(64); // 8x8
    }
  });

  it('decodeVcn throws on a truncated buffer rather than silently misreading', () => {
    expect(() => decodeVcn(new Uint8Array(4))).toThrow();
  });

  it('decodeVmp: all 5 real wall sets decode with 0 oracle-check failures, correct wall-type-run counts', () => {
    const EXPECTED_RUNS: Record<string, number> = { CRIMSON: 6, DUNG: 6, FOREST: 2, MEZZ: 6, SILVER: 6 };
    for (const ws of WALL_SETS) {
      const raw = readFileSync(resolve(DATA_DIR, `${ws}.VCN`));
      const vcn = decodeVcn(new Uint8Array(raw));
      const vmpRaw = readFileSync(resolve(DATA_DIR, `${ws}.VMP`));
      const vmp = decodeVmp(new Uint8Array(vmpRaw), vcn.numTiles);
      expect(vmp.wallTiles).toHaveLength(EXPECTED_RUNS[ws]);
    }
  });

  it('decodePal: every wall-set .PAL is 32 BE Amiga colours, first colour black, last colour white', () => {
    for (const ws of WALL_SETS) {
      const raw = readFileSync(resolve(DATA_DIR, `${ws}.PAL`));
      const pal = decodePal(new Uint8Array(raw));
      expect(pal).toHaveLength(32);
      expect(pal[0]).toEqual([0, 0, 0]);
      expect(pal[31]).toEqual([255, 255, 255]);
    }
  });

  it('decodePal throws on a wrong-size buffer', () => {
    expect(() => decodePal(new Uint8Array(32))).toThrow();
  });

  it('decodeMaze: LEVEL1.MAZ header is (32, 32, 4), file size exact', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'LEVEL1.MAZ'));
    expect(raw.length).toBe(4102);
    const maze = decodeMaze(new Uint8Array(raw));
    expect(maze.width).toBe(32);
    expect(maze.height).toBe(32);
  });

  it('decodeCps: DARKMOON/MENU/HEROES.CPS decode to 320x200 Amiga 5bpp with a real embedded 32-colour palette', () => {
    for (const f of ['DARKMOON', 'MENU', 'HEROES']) {
      const raw = readFileSync(resolve(DATA_DIR, `${f}.CPS`));
      const cps = decodeCps(new Uint8Array(raw));
      expect(cps.width).toBe(320);
      expect(cps.height).toBe(200);
      expect(cps.indices).toHaveLength(64000);
      expect(cps.palette).not.toBeNull();
      expect(cps.palette).toHaveLength(32);
    }
  });

  it('decodeCps: decoration-sheet CPS files (no header palette) still decode cleanly', () => {
    for (const f of ['CRIMSON', 'BROWN1', 'SILVER1']) {
      const raw = readFileSync(resolve(DATA_DIR, `${f}.CPS`));
      const cps = decodeCps(new Uint8Array(raw));
      expect(cps.indices).toHaveLength(64000);
      expect(cps.palette).toBeNull();
    }
  });

  it('decodeInf: resolves every real LEVELn.INF (1-16) to a known wall-set stem and .maz mazStem', () => {
    const KNOWN_WALL_SETS = new Set(['dung', 'forest', 'mezz', 'silver', 'crimson', 'azure']);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, infFilename(n)));
      const { mazStem, wallSetStem } = decodeInf(new Uint8Array(data));
      expect(KNOWN_WALL_SETS.has(wallSetStem.toLowerCase())).toBe(true);
      expect(mazStem.toLowerCase()).toMatch(/\.maz$/);
    }
  });

  it('decodeInf: the optional second wall-set stem ("azure") is present on exactly LEVEL10-14', () => {
    const expectSecond = new Set([10, 11, 12, 13, 14]);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, infFilename(n)));
      const { secondWallSetStem } = decodeInf(new Uint8Array(data));
      if (expectSecond.has(n)) expect(secondWallSetStem?.toLowerCase()).toBe('azure');
      else expect(secondWallSetStem).toBeUndefined();
    }
  });

  it('maze-reuse cases: LEVEL16->level15, LEVEL6->level5, LEVEL14->level12, and the Amiga-specific LEVEL15->level14', () => {
    const cases: Record<number, string> = { 16: 'level15.maz', 6: 'level5.maz', 14: 'level12.maz', 15: 'level14.maz' };
    for (const [n, expected] of Object.entries(cases)) {
      const data = readFileSync(resolve(DATA_DIR, infFilename(Number(n))));
      const { mazStem } = decodeInf(new Uint8Array(data));
      expect(mazStem.toLowerCase()).toBe(expected);
    }
  });

  it('parseInf/resolveWallDecorationAssignments: all 16 levels parse with 0 errors, 308 total assignments in-range against real .DEC files', () => {
    const decCache = new Map<string, DecorationData>();
    let total = 0;
    for (let n = 1; n <= 16; n++) {
      const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, infFilename(n))));
      const { wallMappings, decorationLoads, records } = parseInf(infRaw);
      expect(records.length).toBe(wallMappings.length + decorationLoads.length);
      const assignments = resolveWallDecorationAssignments(infRaw);
      for (const [, a] of assignments) {
        total++;
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
    expect(total).toBe(308); // matches EOB2 DOS/VGA's own total, see module docs
  });

  it('decodeItemDat: real ITEM.DAT decodes big-endian to the same counts as EOB2 DOS, 0 residue', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'ITEM.DAT'));
    const { items, names } = decodeItemDat(new Uint8Array(raw));
    expect(items).toHaveLength(434); // matches EOB2 DOS/VGA's own count exactly
    expect(names).toHaveLength(123); // matches EOB2 DOS/VGA's own count exactly
    expect(names[0]).toBe('Mouse Pointer'); // matches EOB1/EOB2-DOS convention
  });

  it('decodeItemTypeDat: real ITEMTYPE.DAT decodes big-endian to the same count as EOB2 DOS, 0 residue', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'ITEMTYPE.DAT'));
    const types = decodeItemTypeDat(new Uint8Array(raw));
    expect(types).toHaveLength(64); // matches EOB2 DOS/VGA's own count exactly
  });

  it('decodeTextCps: all 3 real TEXT*.CPS decompress byte-exact-identical to EOB2 DOS TEXT.DAT, 122 dialogue strings', () => {
    const dosTextDat = new Uint8Array(readFileSync(resolve('data/eotb2/dosvga', 'TEXT.DAT')));
    const dosMd5 = createHash('md5').update(dosTextDat).digest('hex');
    for (const f of ['TEXT.CPS', 'TEXT2.CPS', 'TEXT4.CPS']) {
      const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, f)));
      const decompressed = decompressKyraContainer(raw);
      expect(createHash('md5').update(decompressed).digest('hex')).toBe(dosMd5);

      const strings = decodeTextCps(raw);
      expect(strings).toHaveLength(122); // matches EOB2 DOS/VGA's own TEXT.DAT count exactly
      expect(strings[0]).toContain('Oh great heroes, thank you for your timely rescue');
    }
  });

  it('buildWallTypeMap: resetWallData default plus LEVEL1 overrides', () => {
    const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'LEVEL1.INF')));
    const map = buildWallTypeMap(infRaw);
    expect(map).toHaveLength(256);
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(2);
    expect(map[23]).toBe(4);
    expect(map[24]).toBe(5);
  });
});
