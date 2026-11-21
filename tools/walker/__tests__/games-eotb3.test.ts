import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ObjectSystem, type SopClassData } from '../../aesop/vm.ts';
import { Eotb3Engine, VIEW_W, VIEW_H, type WalkerPack } from '../../eotb3/engine.ts';
import { tryStep } from '../games-eotb3.ts';

function mkClass(code: number[], extra: Partial<SopClassData> = {}): SopClassData {
  // 14-byte header, then a handler at offset 14: u16 auto_size=4, body
  const bytes = new Uint8Array([...new Array(14).fill(0), 4, 0, ...code]);
  return { number: 1, name: 't', staticSize: 0, parent: -1, handlers: new Map([[0, 14]]), exportedVars: new Map(),
    runtimeFns: new Map(), externs: new Map(), code: bytes, ...extra };
}
const run = (code: number[]) => {
  const s = new ObjectSystem();
  s.addClass(mkClass(code));
  s.allocAt(0, 1);
  return s.send(0, 0, []);
};

describe('AESOP VM (synthetic)', () => {
  it('SUB/DIV take left=second, right=top', () => {
    expect(run([0x04, 0x1d, 10, 0x04, 0x1d, 3, 0x0a, 0x56])).toBe(7);
    expect(run([0x04, 0x1d, 20, 0x04, 0x1d, 6, 0x0c, 0x56])).toBe(3);
  });
  it('null control: swapped operands would give the wrong answer', () => {
    expect(run([0x04, 0x1d, 3, 0x04, 0x1d, 10, 0x0a, 0x56])).not.toBe(7);
  });
  it('CASE picks the matching target (and default otherwise)', () => {
    const mk = (sel: number) => {
      const base = 14 + 2;
      const head = [0x04, 0x1d, sel, 0x03, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0]; // PUSH SHTC sel CASE n=1 {2->tgt} default
      const defBlock = base + head.length;
      const matchBlock = defBlock + 3;
      head[10] = matchBlock & 0xff; head[11] = matchBlock >> 8; head[12] = defBlock & 0xff; head[13] = defBlock >> 8;
      return [...head, 0x1d, 22, 0x56, 0x1d, 11, 0x56];
    };
    expect(run(mk(2))).toBe(11);
    expect(run(mk(3))).toBe(22);
  });
});

describe('EOB3 step geometry (EYE.C DX/DY tables)', () => {
  const fake = { impedance: () => 0 } as unknown as Eotb3Engine;
  it('forward: N=-y, E=+x, S=+y, W=-x, wrapping at 32', () => {
    expect(tryStep(fake, 5, 5, 0, 2)).toMatchObject({ x: 5, y: 4 });
    expect(tryStep(fake, 5, 5, 1, 2)).toMatchObject({ x: 6, y: 5 });
    expect(tryStep(fake, 5, 5, 2, 2)).toMatchObject({ x: 5, y: 6 });
    expect(tryStep(fake, 5, 5, 3, 2)).toMatchObject({ x: 4, y: 5 });
    expect(tryStep(fake, 0, 0, 0, 2)).toMatchObject({ x: 0, y: 31 });
  });
  it('backward is the reverse of forward and a negative impedance blocks', () => {
    expect(tryStep(fake, 5, 5, 1, 5)).toMatchObject({ x: 4, y: 5 });
    expect(tryStep({ impedance: () => -1 } as unknown as Eotb3Engine, 5, 5, 1, 2).ok).toBe(false);
  });
});

const dir = 'public/assets/eotb3/dosvga/data/walker/';
const have = existsSync(dir + 'aesop-classes.json');
describe.skipIf(!have)('EOB3 real data (game bytecode)', () => {
  const j = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'));
  const pack: WalkerPack = { classes: j('aesop-classes.json').classes, levels: j('levels.json').levels,
    palettes: j('palettes.json'), vfxIndex: j('vfx-index.json'), vfx: new Uint8Array(readFileSync(dir + 'vfx.bin')) };

  it('area scripts set the expected wall sets (253 Mausoleum, 228 Forest)', () => {
    const e = new Eotb3Engine(pack);
    e.loadLevel(1); expect(e.wallset).toBe(253);
    e.loadLevel(3); expect(e.wallset).toBe(228);
  });
  it('level 1: dungeon.impedance blocks every wall cell and no bare floor cell is walled', () => {
    const e = new Eotb3Engine(pack);
    e.loadLevel(1);
    let wallBlocked = 0, walls = 0, openBlocked = 0, opens = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const blocked = e.impedance(x, y) < 0;
      if (e.isOpen(x, y)) { opens++; if (blocked) openBlocked++; } else { walls++; if (blocked) wallBlocked++; }
    }
    expect(wallBlocked).toBe(walls);
    expect(openBlocked).toBeLessThan(opens * 0.2); // doors/solid features only
    expect(opens).toBeGreaterThan(300);
  });
  it('frame: first call is the 176x120 floor backdrop (shape 18), frames differ by facing, and are mostly painted', () => {
    const e = new Eotb3Engine(pack);
    e.loadLevel(1);
    const dl = e.drawList(1, 1, 1);
    expect(dl[0]).toMatchObject({ table: 253, number: 18, x: 0, y: 0 });
    const a = e.composite(dl);
    const b = e.composite(e.drawList(1, 1, 2));
    expect(a.length).toBe(VIEW_W * VIEW_H);
    expect(a.filter((v) => v !== 0).length).toBeGreaterThan(VIEW_W * VIEW_H * 0.6);
    let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    expect(diff).toBeGreaterThan(500); // null control: same-facing re-render is identical
    const a2 = e.composite(e.drawList(1, 1, 1));
    expect(a2).toEqual(a);
  });
  it('level 3 quick-start pose draws decorations (objects beyond floor+walls)', () => {
    const e = new Eotb3Engine(pack);
    e.loadLevel(3);
    expect(e.objectCount).toBe(331);
    const dl = e.drawList(7, 24, 1);
    expect(dl.some((d) => d.table !== 228)).toBe(true);
  });
});
