import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGlibIndex, readBlock } from '../goldbox-glib.ts';
import { loadGlibFile } from '../goldbox-glib-codecs.ts';
import { findWallsetBindings, OPCODE_TABLE_DQK, OPCODE_TABLE_POOLS_V13, OPCODE_TABLE } from '../goldbox-ecl.ts';

const DIR = resolve(__dirname, '../../../data/ssi/DarkQueenOfKrynn/data/Disk3');

describe.skipIf(!existsSync(resolve(DIR, 'ECL.GLB')))('Dark Queen ECL (real data)', () => {
  const ecl = loadGlibFile(readFileSync(resolve(DIR, 'ECL.GLB')));
  const byId = new Map<number, Uint8Array>();
  for (const { id, blockIndex } of decodeGlibIndex(ecl.data, ecl.container)) byId.set(id, readBlock(ecl.data, ecl.container.blocks[blockIndex]));
  const geo = loadGlibFile(readFileSync(resolve(DIR, 'GEO.GLB')));
  const geoIds = decodeGlibIndex(geo.data, geo.container).map((e) => e.id);
  const resolveBlock = (id: number) => byId.get(id);

  const run = (opcodeTable: typeof OPCODE_TABLE) => {
    let visited = 0;
    let unknown = 0;
    let desync = 0;
    let bound = 0;
    const wallsets: number[] = [];
    for (const id of geoIds) {
      const raw = resolveBlock(id);
      if (!raw) continue;
      const { binding, diagnostics } = findWallsetBindings(raw, {
        opcodeTable,
        wallsetLoad: { opcode: 0x21, mode: 'fill-all-from-second-operand' },
        resolveBlock,
      });
      for (const d of diagnostics) {
        visited += d.visitedCount;
        unknown += d.unknownOpcodes;
        desync += d.desyncs;
      }
      if (binding.slot1 !== undefined) {
        bound++;
        wallsets.push(binding.slot1);
      }
    }
    return { visited, unknown, desync, bound, wallsets };
  };

  it('DQK table parses every reachable instruction (0 unknown, 0 desync)', () => {
    const r = run(OPCODE_TABLE_DQK);
    expect(r.unknown).toBe(0);
    expect(r.desync).toBe(0);
    expect(r.visited).toBeGreaterThan(30000);
    expect(r.bound).toBeGreaterThanOrEqual(19);
    expect(r.wallsets.filter((w) => w >= 1 && w <= 6).length).toBeGreaterThanOrEqual(18);
  });

  it('null controls: stock v1.3 and v1.1 tables leave unknown opcodes', () => {
    expect(run(OPCODE_TABLE_POOLS_V13).unknown).toBeGreaterThan(100);
    expect(run(OPCODE_TABLE).unknown).toBeGreaterThan(run(OPCODE_TABLE_POOLS_V13).unknown);
  });
});
