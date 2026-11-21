/**
 * Evil's Doom (Amiga AGA): walker data. Depacks what it needs (RNC1 via `ancient`) into
 * build/cache/evilsdoom/unpacked/ and emits to public/assets/evilsdoom/amigaaga/:
 *   walker/dungeons.json      5 dungeons: module tables (slot table, palette), levels (grid, start)
 *   walker/art/<WAL>.json     raw `WAL/<WAL>.DT0` + `.DT1` (base64, 3-plane pieces; see view-model.ts)
 *   dungeon/levels-index.json the walker shell's default level list (id = dungeon*10 + level)
 *   npx tsx tools/evilsdoom/amigaaga/export-walker.ts
 * Maps come from the per-dungeon state blocks saved as data/SAVE/B/.<DNG> (see DUNGEONS).
 * Spec: docs/evilsdoom/amigaaga/data-structure.md.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ancientDecompressFile } from '@seer-project/pipeline';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { readModule } from './module.ts';
import { canEnter, GRID, type EdLevel } from './view-model.ts';

const GAME = 'evilsdoom';
const PLATFORM = 'amigaaga';
const DATA = resolve('data/evilsdoom/amigaaga/data');
const CACHE = resolve('build/cache/evilsdoom/unpacked');

/**
 * Module tag, WAL basename (from each module's own `EVIL:WAL/...` file table) and the save slot
 * the map state is read from. Slot B: BEL/IOW/MIN/MYT are the byte-identical copy shared by
 * 12/12/11/10 slots (never entered); CLL has no such copy (every slot entered it), and slot B is
 * one of the four with the most solid cells (5,607, i.e. the fewest walls removed by switches)
 * with the party still on level 0.
 */
export const DUNGEONS = [
  { tag: 'CLL', name: 'Lost Legions', wal: 'CLL', slot: 'B' },
  { tag: 'BEL', name: 'Lake of Belcoon', wal: 'BELCOON', slot: 'B' },
  { tag: 'MIN', name: 'Old Steel Mine', wal: 'MINE', slot: 'B' },
  { tag: 'MYT', name: 'Castle Mythil', wal: 'MYTHIL', slot: 'B' },
  { tag: 'IOW', name: 'Castle of Wisdom', wal: 'IOW', slot: 'B' },
] as const;

/** Depack `rel` (relative to data/) into the cache once; returns the unpacked bytes. */
export function unpacked(rel: string): Uint8Array {
  const out = resolve(CACHE, rel);
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    ancientDecompressFile(resolve(DATA, rel), out);
  }
  return new Uint8Array(readFileSync(out));
}

export interface StartPose { x: number; y: number; facing: number; source: 'save' | 'heuristic' }

/**
 * Start pose: the saved party pose (state-block level/facing/x/y words) for the level the party
 * is on; elsewhere a HYPOTHESIS — the first cell with bit 2 set that can be entered (bit-2 cells
 * are looked up in a per-level list at A6+$791A by the view builder, +0xBA0C; possibly stairs),
 * else the first enterable cell; facing = first enterable neighbour.
 */
export function startPose(level: EdLevel, saved: { level: number; facing: number; x: number; y: number }, li: number): StartPose {
  if (saved.level === li) return { x: saved.x, y: saved.y, facing: saved.facing & 3, source: 'save' };
  const cands: number[] = [];
  for (let i = 0; i < GRID * GRID; i++) if ((level.grid[i] & 0x84) === 0x04) cands.push(i);
  for (let i = 0; i < GRID * GRID; i++) if (level.grid[i] === 0) cands.push(i);
  for (const i of cands) {
    const x = i % GRID, y = Math.floor(i / GRID);
    if (!canEnter(level, x, y)) continue;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const f = dirs.findIndex(([dx, dy]) => canEnter(level, x + dx, y + dy));
    if (f >= 0) return { x, y, facing: f, source: 'heuristic' };
  }
  return { x: 1, y: 1, facing: 0, source: 'heuristic' };
}

const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64');

export function exportWalker(): { dungeons: number; levels: number } {
  const root = assetRoot(GAME, PLATFORM);
  mkdirSync(resolve(root, 'walker/art'), { recursive: true });
  mkdirSync(resolve(root, 'dungeon'), { recursive: true });
  const index: Array<{ id: number; file: string }> = [];
  const dungeons = DUNGEONS.map((dn, di) => {
    const t = readModule(unpacked(`PRG/${dn.tag}.dat`), `.${dn.tag}`);
    const state = new Uint8Array(readFileSync(resolve(DATA, `SAVE/${dn.slot}/.${dn.tag}`)));
    if (state.length !== t.stateSize) throw new Error(`${dn.tag}: state ${state.length} != module size ${t.stateSize}`);
    const dv = new DataView(state.buffer, state.byteOffset, state.byteLength);
    const p = t.poseOffset;
    const saved = { level: dv.getInt16(p), facing: dv.getInt16(p + 2), x: dv.getInt16(p + 4), y: dv.getInt16(p + 6) };
    const levels = t.gridOffsets.flatMap((off, li) => {
      if (off === null) return [];
      const grid = state.slice(off, off + GRID * GRID);
      const id = di * 10 + li;
      index.push({ id, file: 'walker/dungeons.json' });
      return [{ id, level: li, stateOffset: off, grid: b64(grid), start: startPose({ grid }, saved, li) }];
    });
    const dt0 = unpacked(`WAL/${dn.wal}.DT0`), dt1 = unpacked(`WAL/${dn.wal}.DT1`);
    const art = new Uint8Array(dt0.length + dt1.length);
    art.set(dt0, 0); art.set(dt1, dt0.length);
    writeJson(resolve(root, `walker/art/${dn.wal}.json`), { dt0: dt0.length, dt1: dt1.length, data: b64(art) }, false);
    return { index: di, tag: dn.tag, name: dn.name, wal: dn.wal, slot: dn.slot, a6: t.a6, stateBase: t.stateBase, stateSize: t.stateSize, poseOffset: t.poseOffset, palette: t.palette, slots: t.slots, levels };
  });
  writeJson(resolve(root, 'walker/dungeons.json'), dungeons);
  writeJson(resolve(root, 'dungeon/levels-index.json'), { levels: index });
  return { dungeons: dungeons.length, levels: index.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportWalker();
  console.log(`evilsdoom/amigaaga walker: ${r.dungeons} dungeons, ${r.levels} levels`);
}
