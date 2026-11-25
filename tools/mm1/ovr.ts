/**
 * MM1 map-script overlays (`*.OVR`): container header, the special-cell dispatcher's tables, the stub set the harness uses to cut the
 * overlay handlers off from the screen/file layers, and a runner that executes recorded overlay code with the x86 port (x86.ts).
 * Spec: docs/mm1/dosega/game-rules.md section 4.  Derived from the executable and overlay bytes only (no third-party engine code).
 *
 *   header (14 B, LE words): 0 magic 0xF2, 2 code load offset (CS:0xF48F), 4 code size, 6 data load offset (DS:0xC940), 8 data size,
 *   10 bss size, 12 entry (a C-runtime stub that calls the code start, which installs the dispatcher at DS:0x134)
 */
import { X86, type StubDef } from './x86.ts';
import type { Mem } from './rules-mem.ts';

export const OVR_CODE = 0xf48f, OVR_DATA = 0xc940, DISPATCH = 0xf4a1;

export interface Ovr {
  name: string; magic: number; cbase: number; csz: number; dbase: number; dsz: number; bss: number; entry: number;
  code: Uint8Array; data: Uint8Array;
}
export function parseOvr(name: string, buf: Uint8Array): Ovr {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w = (o: number) => dv.getUint16(o, true);
  const o: Ovr = { name, magic: w(0), cbase: w(2), csz: w(4), dbase: w(6), dsz: w(8), bss: w(10), entry: w(12), code: new Uint8Array(0), data: new Uint8Array(0) };
  if (o.magic !== 0xf2 || o.cbase !== OVR_CODE || o.dbase !== OVR_DATA || 14 + o.csz + o.dsz !== buf.length) throw new Error(`${name}: not a valid overlay`);
  o.code = buf.subarray(14, 14 + o.csz); o.data = buf.subarray(14 + o.csz);
  return o;
}

/** The standard dispatcher at CS:0xF4A1 has per-overlay absolute table addresses in its instructions (the assembler laid the tables out
 *  differently per overlay): count byte, cell-id table, facing-mask table, handler word table. null = custom dispatcher (DEMON). */
export interface Layout { countAddr: number; cells: number; masks: number; handlers: number }
export function tableLayout(o: Ovr): Layout | null {
  const c = o.code.subarray(DISPATCH - OVR_CODE);
  const eq = (i: number, ...b: number[]) => b.every((x, k) => c[i + k] === x);
  if (!eq(0, 0xa0, 0x3a, 0x3c, 0xbb, 0, 0, 0x3a, 0x87)) return null;
  if (!(c[10] === 0x74 || c[10] === 0x75) || !eq(12, 0xfe, 0xc3, 0x3a, 0x1e)) return null;
  const w = (i: number) => c[i] | (c[i + 1] << 8);
  let i = -1, j = -1;
  for (let k = 0; k < 0x60; k++) { if (i < 0 && c[k] === 0x22 && c[k + 1] === 0x87) i = k; if (j < 0 && c[k] === 0x8b && c[k + 1] === 0xbf) j = k; }
  if (i < 0 || j < 0) return null;
  return { countAddr: w(16), cells: w(8), masks: w(i + 2), handlers: w(j + 2) };
}

export type Dispatch = 'miss' | 'nomask' | number;
/** The dispatcher's decision for (cell id = y*16+x, facing mask 0xC0 N / 0x30 E / 0x0C S / 0x03 W), exactly as the code does it, including
 *  the scan running to the count byte even when the table is shorter (PP4) and the table running past the count (AREAE2). */
export function dispatch(o: Ovr, lay: Layout, cell: number, mask: number): Dispatch {
  const d = (a: number) => (a - OVR_DATA < o.data.length ? o.data[a - OVR_DATA] : 0);
  const count = d(lay.countAddr);
  let bl = 0;
  for (;;) {
    if (d(lay.cells + bl) === cell) {
      if ((mask & d(lay.masks + bl)) === 0) return 'nomask';
      const hi = d(lay.handlers + 2 * bl + 1), lo = d(lay.handlers + 2 * bl);
      return lo | (hi << 8);
    }
    bl = (bl + 1) & 255;
    if (!(bl < count)) return 'miss';
  }
}

// ---- stub set (identical to rules_oracle/ovr.py LEAVES/TERMINALS) ----
type M = X86;
const A = (name: string, args?: (m: M) => number[]): StubDef => ({ name, args });
const t3 = (m: M) => [m.r16(0x3bd4), m.r8(0x3bc3), m.r8(0x3bc4)];
export function stubTable(keys: number[], kbk: number): Map<number, StubDef> {
  const s = new Map<number, StubDef>();
  const put = (off: number, d: StubDef) => s.set(off, d);
  put(0x40e1, A('ph2', t3)); put(0x40d6, A('ph2one', m => [m.ax & 255, m.r8(0x3bc3), m.r8(0x3bc4)]));
  put(0x1ab3, A('noises', m => [m.ax & 255])); put(0x1ad6, A('dosound', m => [m.ax]));
  for (const [n, o] of [['clrbtm2', 0x43a8], ['clrall7', 0x4361], ['setgraph', 0x43fd], ['pnames', 0x4118], ['draw', 0xf45], ['resgrph', 0x45f7], ['clrtext4', 0x43ba], ['home', 0x43e6],
    ['clr13to19', 0x439b], ['delayt', 0x8377], ['loadgo', 0x511f], ['blacks', 0x2196], ['food', 0x1df3], ['tavern', 0x2544], ['temple', 0x1f2d], ['training', 0x1b08], ['encounter', 0x2f87],
    ['wait1', 0x4cd6]] as [string, number][]) put(o, A(n));
  put(0x509d, A('loadnext', m => [m.ax & 255, m.bx, m.bp, m.r8(0x3c38), m.r8(0x3c39)]));
  put(0x5123, A('retfmaze', m => [m.ax & 255])); put(0x276c, A('statue', m => [m.bp]));
  put(0x4cdc, A('inwait', m => [m.ax & 255])); put(0x46cb, A('getinfo', m => [m.ax & 255]));
  let ki = 0;
  put(0x4582, { name: 'wait_', args: () => [keys[ki++] ?? 0x1b], fn: m => { m.ax = (m.ax & 0xff00) | m.calls[m.calls.length - 1][1][0]; } });
  let kn = 0;
  put(0x306, { name: 'mykbhit', args: () => [++kn <= kbk ? 0 : 0xff], fn: m => { m.ax = (m.ax & 0xff00) | m.calls[m.calls.length - 1][1][0]; } });
  return s;
}

export function codeMap(code: Record<string, string>): Map<number, number[]> {
  const c = new Map<number, number[]>();
  for (const [k, h] of Object.entries(code)) c.set(Number(k), [...Buffer.from(h, 'hex')]);
  return c;
}

export interface RunOut { m: X86; stop: number }
/** Execute the dispatcher (or any CS offset) with recorded code and the stub set, on `mem` (a StrictMem over the vector's footprint). */
export function runOverlay(mem: Mem, code: Record<string, string>, ip: number, keys: number[], kbk: number, stops: number[] = [], wrong?: 'noCarryIn'): RunOut {
  const stubs = stubTable(keys, kbk);
  const m = new X86({ mem, code: codeMap(code), stubs, stops, wrong });
  m.run(ip);
  return { m, stop: m.stop };
}

/** CODE+0xD71 (called by loadmaze 0xD35): key (AH = BL, AL) and area class BP resolve to a screen number.
 *  BP*2 indexes the word table DS:0x173 (start offset into the key table); the key table DS:0x17B is scanned two bytes at a time (no bound);
 *  the match position / 2 is the MAZEDATA screen index; DS:0x13C[index] is the colour-set byte copied to DS:0x4F14; DS:0x136 keeps BP >> 1. */
export function screenKey(m: Mem, al: number, bl: number, bp: number): { screen: number } {
  const key = ((bl & 255) << 8) | (al & 255);
  let bx = m.r16(0x173 + ((bp << 1) & 0xffff));
  while (m.r16((bx + 0x17b) & 0xffff) !== key) bx = (bx + 2) & 0xffff;
  const idx = bx >> 1;
  m.w8(0x4f14, m.r8((idx + 0x13c) & 0xffff));
  const bp2 = (bp << 1) >> 2;
  if (bp2 !== m.r16(0x136)) m.w16(0x136, bp2);
  return { screen: idx };
}

// ---- town service flows (food 0x1DF3, blacks 0x2196, temple 0x1F2D, tavern 0x2544, training 0x1B08): same stub set as units_shops.py ----
export const TOWN_ENTRY = { trapfx: 0x3d65, blacks: 0x2196, food: 0x1df3, temple: 0x1f2d, tavern: 0x2544, training: 0x1b08, chest: 0x3740, chesttrap: 0x3749,
  equip: 0x7a67, remove: 0x7e7b, trade: 0x8027, discard: 0x7428, poption: 0xbe00 } as const;
export function townStubs(keys: number[]): Map<number, StubDef> {
  const s = new Map<number, StubDef>();
  const put = (off: number, name: string, args?: (m: M) => number[]) => s.set(off, { name, args });
  put(0x40e1, 'ph2', t3); put(0x4009, 'ptext', m => [m.r16(0x3bd4), m.r8(0x3bdc), m.r8(0x3bdd)]);
  put(0x3fff, 'cout', m => [m.ax & 255]); put(0x4030, 'pdec', m => [m.r8(0x3c14)]); put(0x1ab3, 'noises', m => [m.ax & 255]); put(0x1ad6, 'dosound', m => [m.ax]);
  for (const [o, n] of [[0x43ba, 'clrtext4'], [0x4384, 'clr40'], [0x4361, 'clrall7'], [0x43fd, 'setgraph'], [0x4118, 'pnames'], [0x45f7, 'resgrph'], [0x8377, 'delayt'], [0x7636, 'gatgold'],
    [0x6cfd, 'btmview'], [0xc3ad, 'treas'], [0x83f0, 'namestxt'], [0x439b, 'clr13to19'], [0x661, 'machdelay'], [0x511f, 'loadgo'], [0x6d1b, 'ddal'], [0x6555, 'alldead'], [0x74b6, 'backview'], [0x6e46, 'getviewo'], [0x832b, 'esctext'], [0x835f, 'pall'], [0x43c7, 'clr2024']] as [number, string][]) put(o, n);
  put(0x2461, 'delay', m => [m.bx]); put(0xdc19, 'treaspix', m => [m.bx]); put(0x837a, 'dl1', m => [m.bx]); put(0xc5ad, 'puttoscr', m => [m.ax & 255, m.cx, m.dx]);
  let ki = 0;
  s.set(0x4582, { name: 'wait_', args: () => [keys[ki++] ?? 0x1b], fn: m => { m.ax = (m.ax & 0xff00) | m.calls[m.calls.length - 1][1][0]; } });
  return s;
}
export function runTown(mem: Mem, code: Record<string, string>, entry: number, keys: number[], wrong?: 'noCarryIn'): X86 {
  const m = new X86({ mem, code: codeMap(code), stubs: townStubs(keys), wrong });
  m.run(entry);
  return m;
}

/** `draw` CODE+0xF45..0xFA3: the party cell as the game computes it (a shift by CL = 4 leaves y bit 4 in CF, which the ADC adds: only y >= 16 shows it),
 *  the wall byte / layer byte from the maze buffer (DS:0x3CFA page 0, 0x3DFA page 1) and the dark-cell rule.  Returns the stop address:
 *  0xFA3 lit, 0x11F8 dark view (cell flagged dark 0x20 or overlay flag getod(0x2E) bit 0, with the light counter DS:0x3C9C at 0). */
export function cellLoad(m: Mem): { stop: number } {
  const y = m.r8(0x3c39), x = m.r8(0x3c38);
  const cell = (((y << 4) & 255) + x + ((y >> 4) & 1)) & 255;
  m.w8(0x3c3a, cell); m.w8(0x3c3b, cell);
  for (let bp = 7; bp >= 0; bp--) m.w8(0x42d + bp, 0);
  m.w8(0x3c3c, m.r8(0x3cfa + cell));
  const layer = m.r8(0x3dfa + cell); m.w8(0x3c10, layer);
  const light = (): number => m.r8(0x3c9c);
  if (layer & 0x20) {
    if (light() === 0) return { stop: 0x11f8 };
    m.w8(0x3c9c, (light() - 1) & 255);
  }
  const od = m.r8((m.r16(0x132) + 0x2e) & 0xffff);
  if ((od & 1) && light() === 0) return { stop: 0x11f8 };
  return { stop: 0xfa3 };
}
