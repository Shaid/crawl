/**
 * Waxworks walker: movement/collision/turning on synthetic data, the room
 * script evaluator, the view's blit placement, and real-data checks (skipped
 * when `data/waxworks` is absent) with null controls.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { layoutRooms, tryMove, doorState, type MazeFile, type MazeRoom } from '../../waxworks/amiga/maze-map.ts';
import { roomPictureFor } from '../../waxworks/amiga/room-script.ts';
import { WaxworksView, SCENE_X, SCENE_Y, turnLeft, turnRight } from '../games-waxworks.ts';
import type { Subroutine, ScriptOp, Operand, AgosItem } from '../../shared/agos-gamepc.ts';
import { readGamePc, readGrammarFromExe, readSubroutineBlock, roomsOf } from '../../shared/agos-gamepc.ts';
import { simonDecr, discoverZones } from '../../shared/agos-vga.ts';
import { parseVga1, scriptStarts, walkScript, VC_PARAM_BYTES } from '../../shared/agos-vc.ts';
import { buildMaze } from '../../waxworks/amiga/export-maze.ts';

const w = (v: number): Operand => ({ k: 'w', v });
const b = (v: number): Operand => ({ k: 'b', v });
const op = (o: number, ...args: Operand[]): ScriptOp => ({ op: o, args });

function room(id: number, x: number, y: number, exits: Record<number, [number, number]>, pics = [0, 0, 0, 0]): MazeRoom {
  const e = [0, 0, 0, 0, 0, 0];
  let st = 0;
  for (const [d, [dest, state]] of Object.entries(exits)) {
    e[Number(d)] = dest;
    st |= state << (Number(d) * 2);
  }
  return { id, x, y, z: 0, exits: e, doorStates: st, pics, uncertain: false };
}
/** 1 - 2 - 3 east-west corridor; door 2->3 is locked, a closed door on the north of 1 leads to 9 (not in world). */
function synthMaze(): MazeFile {
  const rooms = [
    room(1, 0, 0, { 1: [2, 1], 0: [9, 2] }, [101, 102, 103, 104]),
    room(2, 1, 0, { 3: [1, 1], 1: [3, 3] }, [105, 106, 107, 108]),
    room(3, 2, 0, { 3: [2, 3] }, [109, 0, 0, 0]),
  ];
  const pictures: MazeFile['pictures'] = {};
  [101, 102, 103, 104, 105, 106, 107, 108, 109].forEach((id, i) => (pictures[String(id)] = { zone: 10, index: i, script: id }));
  return { version: 1, picWidth: 224, picHeight: 127, sheetCols: 8, worlds: [{ id: 0, label: 'synthetic', zones: { '10': 9 }, rooms }], pictures, stats: {} };
}

describe('movement rule (moveDirn: only door state 1 passes)', () => {
  const byId = new Map(synthMaze().worlds[0].rooms.map((r) => [r.id, r]));
  it('open exit moves; closed/locked/none do not', () => {
    expect(tryMove(byId, 1, 1)).toEqual({ ok: true, to: 2 });
    expect(tryMove(byId, 2, 1)).toEqual({ ok: false, reason: 'locked' });
    expect(tryMove(byId, 1, 0)).toEqual({ ok: false, reason: 'closed' });
    expect(tryMove(byId, 1, 2)).toEqual({ ok: false, reason: 'no-exit' });
  });
  it('door state is the 2-bit field of the direction', () => {
    const r = byId.get(2)!;
    expect([doorState(r, 1), doorState(r, 3), doorState(r, 0)]).toEqual([3, 1, 0]);
  });
  it('turning is mod 4 and left/right invert each other', () => {
    expect([0, 1, 2, 3].map(turnRight)).toEqual([1, 2, 3, 0]);
    expect([0, 1, 2, 3].map(turnLeft)).toEqual([3, 0, 1, 2]);
    for (let f = 0; f < 4; f++) expect(turnLeft(turnRight(f))).toBe(f);
  });
});

describe('layout', () => {
  it('places rooms by exit direction (N=-y, E=+x)', () => {
    const rs = synthMaze().worlds[0].rooms;
    const { pos } = layoutRooms([1, 2, 3], (id) => rs.find((r) => r.id === id)!.exits.map((e) => (rs.some((r) => r.id === e) ? e : 0)));
    expect(pos.get(2)).toEqual([1, 0, 0]);
    expect(pos.get(3)).toEqual([2, 0, 0]);
  });
  it('nudges colliding rooms instead of overwriting', () => {
    // 1 -E-> 2, 1 -S-> 3, 3 -E-> 4, 4 -N-> 5 would put 5 on 2's cell
    const ex: Record<number, number[]> = { 1: [0, 2, 3, 0, 0, 0], 2: [0, 0, 0, 1, 0, 0], 3: [1, 4, 0, 0, 0, 0], 4: [5, 0, 0, 3, 0, 0], 5: [0, 0, 4, 0, 0, 0] };
    const { pos, conflicts } = layoutRooms([1, 2, 3, 4, 5], (id) => ex[id]);
    expect(conflicts).toBe(1);
    expect(new Set([...pos.values()].map((p) => p.join(','))).size).toBe(5);
  });
});

describe('room script evaluator', () => {
  const items = new Map<number, AgosItem>();
  const sub: Subroutine = {
    id: 1,
    lines: [
      { ops: [op(13, b(150), w(1)), op(96, w(1402), b(4))] }, // eq facing 1 -> picture
      { ops: [op(11, b(150)), op(96, w(1410), b(4))] }, // zero facing -> picture
      { ops: [op(0), op(13, b(150), w(2)), op(96, w(1500), b(4))] }, // inverted: facing != 2
      { ops: [op(27, { k: 'i', v: -9 }, w(2)), op(96, w(1999), b(4))] }, // item state on a special item: unmodelled -> skipped
    ],
  };
  it('selects the picture by facing; the last drawn picture wins', () => {
    expect(roomPictureFor(sub, items, 0).id).toBe(1500); // line 2 (zero) then line 3 (!=2)
    expect(roomPictureFor(sub, items, 1).id).toBe(1500);
    expect(roomPictureFor(sub, items, 2).id).toBe(null);
  });
  it('a condition on game state it cannot see aborts its line and is reported', () => {
    const r = roomPictureFor(sub, items, 3);
    expect(r.id).toBe(1500);
    expect(r.result.unmodelled.has(27)).toBe(true);
    expect(r.result.pictures.map((p) => p.id)).not.toContain(1999);
  });
  it('done ends the subroutine', () => {
    const s2: Subroutine = { id: 2, lines: [{ ops: [op(69)] }, { ops: [op(96, w(5), b(4))] }] };
    expect(roomPictureFor(s2, items, 0).id).toBe(null);
  });
});

describe('WaxworksView', () => {
  const mk = () => new WaxworksView(synthMaze(), 0, null, { roomId: 1, facing: 1 });
  it('forward walks through an open door, locked/closed doors report and stay put', () => {
    const v = mk();
    expect(v.forward()).toMatchObject({ x: 1, y: 0 });
    expect(v.forward()).toBeNull();
    expect(v.takeMessage()).toMatch(/locked/);
    v.setPose({ level: 0, x: 0, y: 0, facing: 0 });
    expect(v.forward()).toBeNull();
    expect(v.takeMessage()).toMatch(/closed/);
  });
  it('noclip ignores door state but not the missing room', () => {
    const v = mk();
    v.setNoclip(true);
    v.forward();
    expect(v.forward()).toMatchObject({ x: 2 });
  });
  it('keys: D turns right, W walks', () => {
    const v = mk();
    expect(v.update(300, { isDown: (c: string) => c === 'KeyD' })).toMatchObject({ facing: 2 });
    const v2 = mk();
    expect(v2.update(300, { isDown: (c: string) => c === 'KeyW' })).toMatchObject({ x: 1 });
  });
  it('draws the room/facing picture crop at (48,3) in the 320x200 frame', () => {
    const v = mk();
    (v as unknown as { sheets: Map<number, unknown> }).sheets.set(10, 'SHEET'); // inject a loaded sheet
    const calls: unknown[][] = [];
    const ctx = {
      canvas: { width: 0, height: 0 },
      fillRect() {}, fillText() {},
      drawImage: (...a: unknown[]) => calls.push(a),
      set fillStyle(_v: string) {}, set font(_v: string) {}, set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    // not an HTMLImageElement -> view treats 'SHEET' string as a loaded image only via the cache; patch accessor
    (v as unknown as { sheet: (z: number) => unknown }).sheet = () => 'SHEET';
    v.renderCanvas(ctx);
    // room 1 facing 1 -> picture 102 -> sheet cell index 1
    expect(calls[0]).toEqual(['SHEET', 224, 0, 224, 127, SCENE_X, SCENE_Y, 224, 127]);
    expect([SCENE_X, SCENE_Y]).toEqual([48, 3]);
  });
});

const DATA = resolve('data/waxworks/amiga/data');
const HAVE = existsSync(resolve(DATA, 'gameamiga'));
describe('real data: room database', { skip: !HAVE }, () => {
  const raw = (f: string) => simonDecr(new Uint8Array(readFileSync(resolve(DATA, f))));
  const grammar = HAVE ? readGrammarFromExe(new Uint8Array(readFileSync(resolve(DATA, 'runit')))) : [];
  const db = HAVE ? readGamePc(raw('gameamiga'), 'waxworks', grammar) : null;

  it('the executable-derived opcode grammar parses every database/table file to its last byte', () => {
    expect(grammar.length).toBe(191);
    expect(db!.end).toBe(raw('gameamiga').length);
    expect(db!.items.size).toBe(1759);
    const files = readdirSync(DATA).filter((n) => /^(tables|xtable)\d\d$/.test(n));
    expect(files.length).toBe(20);
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(DATA, f)));
      expect(readSubroutineBlock(buf, 0, grammar).end, f).toBe(buf.length);
    }
  });
  it('a deliberately wrong grammar entry desynchronises the walk (null control)', () => {
    const bad = grammar.slice();
    bad[13] = 'B'; // eq: BN -> B
    const buf = new Uint8Array(readFileSync(resolve(DATA, 'tables04')));
    let ok = true;
    try { ok = readSubroutineBlock(buf, 0, bad).end === buf.length; } catch { ok = false; }
    expect(ok).toBe(false);
  });
  it('every exit has its reciprocal back-exit (2,890/2,890); shuffled destinations do not', () => {
    const rooms = roomsOf(db!);
    const BACK = [2, 3, 0, 1, 5, 4];
    let total = 0, rec = 0;
    const dests: number[] = [];
    for (const r of rooms.values()) for (const e of r.exits) dests.push(e.dest);
    for (const [id, r] of rooms) for (const e of r.exits) { total++; if (rooms.get(e.dest)?.exits.some((x) => x.dir === BACK[e.dir] && x.dest === id)) rec++; }
    expect([total, rec, rooms.size]).toEqual([2890, 2890, 1396]);
    // null control: rotate the destination list by a prime step
    let k = 0, rec2 = 0;
    for (const [id, r] of rooms) for (const e of r.exits) { const d = dests[(k++ * 7919 + 13) % dests.length]; if (rooms.get(d)?.exits.some((x) => x.dir === BACK[e.dir] && x.dest === id)) rec2++; }
    expect(rec2).toBeLessThan(total * 0.02);
  });
});

describe('real data: VC scripts and the maze export', { skip: !HAVE }, () => {
  const raw = (f: string) => simonDecr(new Uint8Array(readFileSync(resolve(DATA, f))));
  it('every VC script ends (opcode 0) exactly where the next begins: 3,496/3,496; perturbed table collapses', () => {
    const zs = discoverZones(readdirSync(DATA), 'waxworks').filter((z) => z.type1);
    const count = (tweak: (op: number) => number | undefined) => {
      let good = 0, total = 0;
      for (const z of zs) {
        const v = parseVga1(raw(z.type1!));
        const st = scriptStarts(v);
        for (let i = 0; i + 1 < st.length; i++) {
          total++;
          let p = st[i];
          try {
            for (;;) {
              const o = (v.data[p] << 8) | v.data[p + 1];
              p += 2;
              if (o === 0) break;
              const n = tweak(o) ?? VC_PARAM_BYTES[o];
              if (n < 0) throw new Error('unknown');
              p += n;
              if (p > st[i + 1]) break;
            }
          } catch { continue; }
          if (p === st[i + 1]) good++;
        }
      }
      return { good, total };
    };
    const ok = count(() => undefined);
    expect(ok).toEqual({ good: 3496, total: 3496 });
    const bad = count((o) => (o === 10 ? 6 : undefined)); // draw with a wrong operand length
    expect(bad.good).toBeLessThan(bad.total / 2);
    // and walkScript itself accepts the draw script of picture 1000 (zone 10): 24 draws
    const v10 = parseVga1(raw('0101.pkd'));
    expect(walkScript(v10, v10.images.get(1000)!.script).filter((o) => o.op === 10).length).toBe(24);
  });

  it('maze export: 5 worlds, maze-zone rooms render all 4 facings, and the picture for a facing shows a wall when that exit is blocked', () => {
    const { maze, sheets } = buildMaze(DATA);
    expect(maze.worlds.map((x) => x.rooms.length)).toEqual([579, 386, 217, 180, 21]);
    const MAZE = new Set([10, 20, 21, 22, 24, 32, 34, 35, 85, 89, 91, 92, 93, 95, 96]);
    const mz = maze.worlds.flatMap((x) => x.rooms).filter((r) => r.pics.some((p) => p && MAZE.has(maze.pictures[String(p)].zone)));
    expect(mz.length).toBeGreaterThanOrEqual(355);
    expect(mz.filter((r) => r.pics.every(Boolean)).length).toBeGreaterThanOrEqual(mz.length - 8);

    // Orientation oracle: the open-ahead pictures are darker/flatter in the centre than blocked-wall ones.
    // Feature = luminance std-dev of the central block; AUC of "exit open" vs feature, for the game's mapping
    // (facing f <-> exit f) against the mapping rotated by 1..3 (null controls).
    const lum = new Map<string, number>();
    const feat = (pid: number): number => {
      const k = String(pid);
      if (lum.has(k)) return lum.get(k)!;
      const ref = maze.pictures[k];
      const s = sheets.get(ref.zone)!;
      const ox = (ref.index % maze.sheetCols) * 224, oy = Math.floor(ref.index / maze.sheetCols) * 127;
      const vals: number[] = [];
      for (let y = 30; y < 100; y++) for (let x = 80; x < 144; x++) { const o = ((oy + y) * s.width + ox + x) * 4; vals.push(0.3 * s.rgba[o] + 0.59 * s.rgba[o + 1] + 0.11 * s.rgba[o + 2]); }
      const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, c) => a + (c - mean) ** 2, 0) / vals.length);
      lum.set(k, sd);
      return sd;
    };
    const auc = (rot: number): number => {
      const pos: number[] = [], neg: number[] = [];
      for (const r of mz) {
        if (!r.pics.every(Boolean)) continue;
        for (let f = 0; f < 4; f++) {
          const e = (f + rot) % 4;
          (r.exits[e] && doorState(r, e) === 1 ? pos : neg).push(feat(r.pics[f]));
        }
      }
      let gt = 0;
      for (const p of pos) for (const n of neg) gt += p > n ? 1 : p === n ? 0.5 : 0;
      return gt / (pos.length * neg.length);
    };
    const a0 = auc(0);
    expect(Math.abs(a0 - 0.5)).toBeGreaterThan(0.3); // strong separation under the game's mapping
    for (const rot of [1, 2, 3]) expect(Math.abs(auc(rot) - 0.5)).toBeLessThan(0.25); // collapses when rotated
  });
});

describe('Elvira II shares the room/exit reader', { skip: !existsSync(resolve('data/elvira2/amiga/data/gameamiga')) }, () => {
  it('items + rooms parse; every tables file consumes to EOF with the grammar read from its own runit', () => {
    const d = resolve('data/elvira2/amiga/data');
    const g = readGrammarFromExe(new Uint8Array(readFileSync(resolve(d, 'runit'))));
    const db = readGamePc(new Uint8Array(readFileSync(resolve(d, 'gameamiga'))), 'elvira2', g);
    expect(db.items.size).toBe(853);
    expect(roomsOf(db).size).toBe(167);
    for (const f of readdirSync(d).filter((n) => /^(tables|xtable)\d\d$/.test(n))) {
      const buf = new Uint8Array(readFileSync(resolve(d, f)));
      expect(readSubroutineBlock(buf, 0, g).end, f).toBe(buf.length);
    }
  });
});
