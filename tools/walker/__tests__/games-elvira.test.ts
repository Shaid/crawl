/**
 * Elvira 1 (Amiga): the VC opcode table derived from the game's own 750 script
 * segments. Real-data blocks skip when `data/elvira` is absent; the table has
 * null controls (other dialects, a perturbed draw length).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { simonDecr, discoverZones } from '../../shared/agos-vga.ts';
import { parseVga1, scriptStarts, ELVIRA1_VC_PARAM_BYTES, ELVIRA2_VC_PARAM_BYTES, VC_PARAM_BYTES } from '../../shared/agos-vc.ts';

const DATA = resolve('data/elvira/amiga/data');
const HAVE = existsSync(resolve(DATA, '011.pkd'));

describe('real data: Elvira 1 VC dialect', { skip: !HAVE }, () => {
  const zs = discoverZones(readdirSync(DATA), 'elvira').filter((z) => z.type1);
  const segments = zs.flatMap((z) => {
    const v = parseVga1(simonDecr(new Uint8Array(readFileSync(resolve(DATA, z.type1!)))), VC_PARAM_BYTES);
    const st = scriptStarts(v);
    return st.slice(0, -1).map((a, i) => ({ d: v.data, a, b: st[i + 1] }));
  });
  const score = (table: readonly number[], tweak?: (op: number) => number | undefined) => {
    let good = 0;
    for (const s of segments) {
      let p = s.a;
      let ok = true;
      for (;;) {
        if (p + 2 > s.b) { ok = false; break; }
        const o = (s.d[p] << 8) | s.d[p + 1];
        p += 2;
        if (o === 0) break;
        const n = tweak?.(o) ?? table[o];
        if (n === undefined || n < 0) { ok = false; break; }
        p += n;
        if (p > s.b) { ok = false; break; }
      }
      if (ok && p === s.b) good++;
    }
    return good;
  };
  it('750 segments in 65 zones; the Elvira 1 table ends every one on its successor; other dialects and perturbations do not', () => {
    expect(zs.length).toBe(65);
    expect(segments.length).toBe(750);
    expect(score(ELVIRA1_VC_PARAM_BYTES)).toBe(750);
    expect(score(VC_PARAM_BYTES)).toBeLessThan(100); // 54: the Waxworks dialect is far from Elvira 1's
    expect(score(ELVIRA2_VC_PARAM_BYTES)).toBeLessThan(100); // 57
    expect(score(ELVIRA1_VC_PARAM_BYTES, (o) => (o === 10 ? 6 : undefined))).toBeLessThan(650); // a wrong draw length (most scripts do not draw)
    expect(score(ELVIRA1_VC_PARAM_BYTES, (o) => (o === 22 ? 4 : undefined))).toBeLessThan(720); // a wrong setPalette length
  });
});

// ---------------------------------------------------------------------------
// Walker: gameamiga (Elvira 1 dialect), exits, room scripts
// ---------------------------------------------------------------------------
import { readGamePc, readGrammarFromExe, type AgosItem, type Subroutine } from '../../shared/agos-gamepc.ts';
import { exitOf, findChild, roomIds } from '../../../tools/elvira/amiga/export-maze.ts';
import { roomPictureFor, FACING_TO_DIR, E1_OP } from '../../../tools/elvira/amiga/room-script.ts';

const mkItem = (id: number, p: Partial<AgosItem>): AgosItem => ({ id, itemName: 0, adjective: 0, noun: 0, state: 0, next: 0, child: 0, parent: 0, classFlags: 0, children: [], ...p });

describe('Elvira 1 exits and room scripts (synthetic)', () => {
  const room = { kind: 'e1room' as const, short: 0, long: 0, flags: 0 };
  const items = new Map<number, AgosItem>([
    [10, mkItem(10, { children: [room, { kind: 'genexit', dest: [11, 20, 21, 0, 0, 0], extra: [] }] })],
    [11, mkItem(11, { children: [room, { kind: 'genexit', dest: [0, 0, 10, 0, 0, 0], extra: [] }] })],
    [12, mkItem(12, { children: [{ kind: 'inherit', master: 11 }, { kind: 'genexit', dest: [0, 0, 10, 0, 0, 0], extra: [] }] })], // room by inheritance
    [20, mkItem(20, { state: 0, parent: 11 })], // open door item -> its parent room
    [21, mkItem(21, { state: 1, parent: 12 })], // closed door
  ]);
  it('a dest that is a room is an open exit; a door item resolves to its parent by state', () => {
    expect(exitOf(items, 10, 0)).toEqual({ dest: 11, state: 1 });
    expect(exitOf(items, 10, 1)).toEqual({ dest: 11, state: 1 });
    expect(exitOf(items, 10, 2)).toEqual({ dest: 12, state: 2 }); // closed
    expect(exitOf(items, 10, 3)).toEqual({ dest: 0, state: 0 });
  });
  it('rooms follow inherit masters (and a non-room item is not a room)', () => {
    expect(findChild(items, 12, 'e1room')).toBeDefined();
    expect(roomIds(items)).toEqual([10, 11, 12]);
  });
  const a = (k: 'w' | 'i', v: number) => ({ k, v });
  const sub = (lines: Array<Array<{ op: number; args: Array<{ k: 'w' | 'i'; v: number }> }>>): Subroutine => ({ id: 1000, lines: lines.map((ops) => ({ ops })) });
  const pic = (id: number) => ({ op: E1_OP.picture, args: [a('w', id), a('w', 4)] });
  const s = sub([
    [{ op: E1_OP.eq, args: [a('w', 150), a('w', 0)] }, pic(101)],
    [{ op: E1_OP.eq, args: [a('w', 150), a('w', 2)] }, { op: E1_OP.invert, args: [] }, { op: E1_OP.at, args: [a('i', 10)] }, pic(102)],
    [{ op: E1_OP.eq, args: [a('w', 150), a('w', 6)] }, pic(103)],
  ]);
  it('the picture follows the facing variable; invert flips a condition; unmatched facings draw nothing', () => {
    const it = (f: number) => roomPictureFor(10, s, items, new Map(), f).call?.id ?? null;
    expect(it(0)).toBe(101);
    expect(it(2)).toBeNull(); // `not at room 10` fails in room 10
    expect(roomPictureFor(11, s, items, new Map(), 2).call?.id).toBe(102);
    expect(it(6)).toBe(103);
    expect(it(4)).toBeNull();
    expect(FACING_TO_DIR).toEqual({ 0: 0, 2: 3, 4: 2, 6: 1 });
  });
});

const E1_DATA = resolve('data/elvira/amiga/data');
const HAVE_E1 = existsSync(resolve(E1_DATA, 'gameamiga')) && existsSync(resolve(E1_DATA, 'runit'));
describe('real data: Elvira 1 gameamiga', { skip: !HAVE_E1 }, () => {
  const exe = new Uint8Array(readFileSync(resolve(E1_DATA, 'runit')));
  const buf = new Uint8Array(readFileSync(resolve(E1_DATA, 'gameamiga')));
  const grammar = readGrammarFromExe(exe, 'elvira1');
  it('875 items and 357 subroutines consume the file to exactly its last byte', () => {
    expect(grammar.length).toBe(284);
    const db = readGamePc(buf, 'elvira1', grammar);
    expect(db.items.size).toBe(875);
    expect(db.subroutines.size).toBe(357);
    expect(db.end).toBe(buf.length);
  });
  it('null controls: the wrong grammar table, or a wrong item layout, does not consume the file', () => {
    const wrongTable = readGrammarFromExe(exe); // Waxworks-style start = a later, offset table
    let ok = true;
    try {
      ok = readGamePc(buf, 'elvira1', wrongTable).end === buf.length;
    } catch {
      ok = false;
    }
    expect(ok).toBe(false);
    expect(() => readGamePc(buf, 'elvira2', grammar)).toThrow();
  });
  it('the exit graph is reciprocal (738/774 reachable-room exits come back; a shuffled pairing does not)', () => {
    const db = readGamePc(buf, 'elvira1', grammar);
    const rooms = new Set(roomIds(db.items));
    expect(rooms.size).toBe(374);
    const BACK = [2, 3, 0, 1, 5, 4];
    let tot = 0;
    let rec = 0;
    let shuffled = 0;
    const list = [...rooms];
    for (const id of list) {
      for (let d = 0; d < 6; d++) {
        const e = exitOf(db.items, id, d);
        if (!e.dest || !rooms.has(e.dest)) continue;
        tot++;
        if (exitOf(db.items, e.dest, BACK[d]).dest === id) rec++;
        const other = list[(list.indexOf(e.dest) + 7) % list.length]; // wrong partner
        if (exitOf(db.items, other, BACK[d]).dest === id) shuffled++;
      }
    }
    expect(tot).toBe(774);
    expect(rec).toBeGreaterThanOrEqual(730);
    expect(shuffled).toBeLessThan(tot / 20);
  });
  it('the start room 876 (castle entrance) leads east to the gatehouse 875; each room has a scene subroutine', () => {
    const db = readGamePc(buf, 'elvira1', grammar);
    expect(exitOf(db.items, 876, 1)).toEqual({ dest: 875, state: 1 });
    for (const id of roomIds(db.items)) {
      const uf = findChild(db.items, id, 'userflags');
      expect(db.subroutines.has(1000 + (uf?.flags[0] ?? -1))).toBe(true);
    }
    const sub = db.subroutines.get(1000 + findChild(db.items, 876, 'userflags')!.flags[0])!;
    const c = roomPictureFor(876, sub, db.items, db.subroutines, 0).call;
    expect(c).not.toBeNull();
    expect(Math.floor(c!.id / 100)).toBeGreaterThan(0);
  });
});
