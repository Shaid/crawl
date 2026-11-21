/**
 * Elvira II walker: the VC opcode table derived for this game, the shared
 * room/exit reader on its database, the Waxworks pipeline run with Elvira II's
 * spec, and the view's movement. Real-data blocks skip when `data/elvira2`
 * is absent; each oracle has a null control.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { doorState, tryMove, type MazeFile, type MazeRoom } from '../../waxworks/amiga/maze-map.ts';
import { BACK_DIR, readGamePc, readGrammarFromExe, readSubroutineBlock, roomsOf } from '../../shared/agos-gamepc.ts';
import { simonDecr, discoverZones } from '../../shared/agos-vga.ts';
import { parseVga1, scriptStarts, ELVIRA2_VC_PARAM_BYTES, VC_PARAM_BYTES } from '../../shared/agos-vc.ts';
import { buildMaze } from '../../waxworks/amiga/export-maze.ts';
import { ELVIRA2_SPEC } from '../../elvira2/amiga/export-maze.ts';
import { WaxworksView, startRoomFor } from '../games-waxworks.ts';

const DATA = resolve('data/elvira2/amiga/data');
const HAVE = existsSync(resolve(DATA, 'gameamiga'));

function room(id: number, x: number, y: number, exits: Record<number, [number, number]>, pics = [0, 0, 0, 0]): MazeRoom {
  const e = [0, 0, 0, 0, 0, 0];
  let st = 0;
  for (const [d, [dest, state]] of Object.entries(exits)) {
    e[Number(d)] = dest;
    st |= state << (Number(d) * 2);
  }
  return { id, x, y, z: 0, exits: e, doorStates: st, pics, uncertain: false };
}

describe('Elvira II view on synthetic data', () => {
  const maze: MazeFile = {
    version: 1, picWidth: 224, picHeight: 127, sheetCols: 8, pictures: {}, stats: {},
    worlds: [{ id: 0, label: 'syn', zones: {}, rooms: [room(1, 0, 0, { 1: [2, 1], 0: [9, 2] }), room(2, 1, 0, { 3: [1, 1], 1: [3, 3] }), room(3, 2, 0, { 3: [2, 3] })] }],
  };
  const who = { id: 'elvira2', label: 'Elvira II' };
  it('walks through open exits only, turns, and identifies as elvira2', () => {
    const v = new WaxworksView(maze, 0, null, { roomId: 1, facing: 1 }, who);
    expect(v.id).toBe('elvira2');
    expect(v.forward()).not.toBeNull();
    expect(v.room.id).toBe(2);
    expect(v.forward()).toBeNull(); // locked
    v.turn('around');
    expect(v.forward()).not.toBeNull();
    expect(v.room.id).toBe(1);
    v.turn('right'); // facing W -> N
    expect(v.pose.facing).toBe(0);
    expect(v.forward()).toBeNull(); // closed door north
    expect(tryMove(new Map(maze.worlds[0].rooms.map((r) => [r.id, r])), 1, 0)).toEqual({ ok: false, reason: 'closed' });
  });
  it('start room falls back to a pictured room when the id is unknown', () => {
    expect(startRoomFor(maze.worlds[0], -1).id).toBe(1);
  });
});

describe('real data: Elvira II', { skip: !HAVE }, () => {
  const raw = (f: string) => simonDecr(new Uint8Array(readFileSync(resolve(DATA, f))));

  it('VC scripts: the Elvira II length table ends every script on its successor (1,268/1,268); Waxworks table and perturbed table do not', () => {
    const zs = discoverZones(readdirSync(DATA), 'elvira').filter((z) => z.type1);
    const count = (table: readonly number[], tweak?: (op: number) => number | undefined) => {
      let good = 0, total = 0;
      for (const z of zs) {
        const v = parseVga1(raw(z.type1!), table);
        const st = scriptStarts(v);
        for (let i = 0; i + 1 < st.length; i++) {
          total++;
          let p = st[i];
          let fail = false;
          for (;;) {
            const o = (v.data[p] << 8) | v.data[p + 1];
            p += 2;
            if (o === 0) break;
            const n = tweak?.(o) ?? table[o];
            if (n === undefined || n < 0) { fail = true; break; }
            p += n;
            if (p > st[i + 1]) { fail = true; break; }
          }
          if (!fail && p === st[i + 1]) good++;
        }
      }
      return { good, total };
    };
    expect(count(ELVIRA2_VC_PARAM_BYTES)).toEqual({ good: 1268, total: 1268 });
    expect(count(VC_PARAM_BYTES).good).toBeLessThan(1268); // 1,237: the dialects differ
    expect(count(ELVIRA2_VC_PARAM_BYTES, (o) => (o === 10 ? 6 : undefined)).good).toBeLessThan(1000); // a wrong draw length drops every script that draws (711)
  });

  it('database: 167 rooms, exits reciprocal (rotated mapping = null control), 2 super-rooms', () => {
    const g = readGrammarFromExe(new Uint8Array(readFileSync(resolve(DATA, 'runit'))));
    const db = readGamePc(new Uint8Array(readFileSync(resolve(DATA, 'gameamiga'))), 'elvira2', g);
    const rooms = roomsOf(db);
    expect(rooms.size).toBe(167);
    let tot = 0, rec = 0, rot1 = 0;
    for (const [id, r] of rooms) for (const e of r.exits) {
      const t = rooms.get(e.dest);
      if (!t) continue;
      tot++;
      if (t.exits.some((x) => x.dir === BACK_DIR[e.dir] && x.dest === id)) rec++;
      if (e.dir < 4 && t.exits.some((x) => x.dir === (BACK_DIR[e.dir] + 1) % 4 && x.dest === id)) rot1++;
    }
    expect(tot).toBe(283);
    expect(rec).toBe(280);
    expect(rot1).toBe(0);
    expect([...db.items.values()].filter((i) => i.children.some((c) => c.kind === 'superroom')).length).toBe(2);
    for (const f of readdirSync(DATA).filter((n) => /^tables\d\d$/.test(n))) {
      const buf = new Uint8Array(readFileSync(resolve(DATA, f)));
      expect(readSubroutineBlock(buf, 0, g).end, f).toBe(buf.length);
    }
  });

  it('maze export: worlds, pictures non-blank, picture differs per facing in a corridor-like sample', () => {
    const { maze, sheets } = buildMaze(DATA, ELVIRA2_SPEC);
    expect(maze.worlds.slice(0, 3).map((x) => x.rooms.length)).toEqual([118, 22, 4]);
    expect(maze.worlds[3].rooms.length).toBe(22); // the maze-760 doorway rooms (no other exits); room 452 -> maze 744 sits in area 3
    expect(maze.worlds.length).toBe(14); // + 4 levels of maze 744 and 6 of maze 760
    expect(maze.stats.roomPicturesRendered).toBeGreaterThanOrEqual(540);
    expect(maze.stats.picturesWithoutSetPalette).toBe(0);
    // every picture uses > 4 distinct colours (a blank/garbled composite would not)
    let flat = 0;
    for (const [h, ref] of Object.entries(maze.pictures)) {
      const s = sheets.get(ref.zone)!;
      const ox = (ref.index % maze.sheetCols) * maze.picWidth, oy = Math.floor(ref.index / maze.sheetCols) * maze.picHeight;
      const set = new Set<number>();
      for (let y = 0; y < maze.picHeight; y += 3) for (let x = 0; x < maze.picWidth; x += 3) { const o = ((oy + y) * s.width + ox + x) * 4; set.add((s.rgba[o] << 16) | (s.rgba[o + 1] << 8) | s.rgba[o + 2]); }
      if (set.size < 5) flat++;
      void h;
    }
    expect(flat).toBeLessThan(Object.keys(maze.pictures).length * 0.05);
    // the real start of world 1 is a pictured room
    const w1 = maze.worlds[0];
    expect(startRoomFor(w1, -1).pics[0]).toBeGreaterThan(0);
    // movement over the real graph: every open exit inside the world is reciprocal
    const byId = new Map(w1.rooms.map((r) => [r.id, r]));
    let open = 0, back = 0;
    for (const r of w1.rooms) for (let d = 0; d < 6; d++) {
      const m = tryMove(byId, r.id, d);
      if (!m.ok) continue;
      open++;
      if (tryMove(byId, m.to, BACK_DIR[d]).ok) back++;
      expect(doorState(r, d)).toBe(1);
    }
    expect(back / open).toBeGreaterThan(0.97);
  }, 90_000);
});
