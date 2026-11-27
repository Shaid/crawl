/**
 * The MM2 (Amiga) memory image the verified rules run on. The rules in `tools/mm2/rules*.ts` read and write the game's own globals through absolute 68k addresses
 * (`g(displacement)` = A4 + displacement); this module provides the flat, mutable counterpart of the harness's `StrictMem`: the DATA hunk of the user's `mm2` executable
 * (relocated exactly as the Unicorn oracle maps it, constants such as the class/tier tables included) plus the zero BSS that follows it, and the allocation the overlay
 * loader makes for `monsters.dat`. No retail bytes are stored anywhere in the repository: the image is built at load from the user's files.
 */
import type { Mem } from '../rules-mem';

/** the oracle's fixed map: CODE 0x100000, DATA 0x160000, BSS contiguous after it; A4 = DATA + 0x7FFE (rules-mem `A4V`) */
export const CODE_BASE = 0x100000, DATA_BASE = 0x160000, WIN = 0x8000, MON_BASE = 0x170000, MON_LEN = 0x1a00;
const DATA_LEN = 8604;

/** Parse the root hunks of an AmigaDOS load file and return the relocated DATA hunk (the three root hunks CODE / DATA / BSS; the overlay hunk is not needed). */
export function dataImage(exe: Uint8Array): Uint8Array {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  let p = 0;
  const u32 = () => dv.getUint32(p);
  if (u32() !== 0x3f3) throw new Error('mm2: not an AmigaDOS load file');
  p += 4; if (u32() !== 0) throw new Error('mm2: resident libraries not supported'); p += 4;
  p += 4; const first = u32(); p += 4; const last = u32(); p += 4;
  p += 4 * (last - first + 1);
  const hunks: { data: Uint8Array; relocs: Map<number, number[]> }[] = [];
  let cur: (typeof hunks)[number] | null = null;
  for (;;) {
    const t = u32() & 0x3fffffff; p += 4;
    if (t === 0x3e9 || t === 0x3ea) {
      const n = u32() * 4; p += 4;
      cur = { data: exe.subarray(p, p + n), relocs: new Map() }; p += n; hunks.push(cur);
    } else if (t === 0x3eb) { p += 4; cur = { data: new Uint8Array(0), relocs: new Map() }; hunks.push(cur); }
    else if (t === 0x3ec) {
      for (;;) {
        const n = u32(); p += 4; if (n === 0) break;
        const h = u32(); p += 4;
        const list = cur!.relocs.get(h) ?? []; for (let i = 0; i < n; i++) list.push(dv.getUint32(p + 4 * i)); cur!.relocs.set(h, list); p += 4 * n;
      }
    } else if (t === 0x3f2) { if (hunks.length === 3) break; }
    else throw new Error('mm2: unexpected hunk ' + t.toString(16));
  }
  const bases = [CODE_BASE, DATA_BASE, DATA_BASE + WIN];
  const d = hunks[1];
  if (d.data.length !== DATA_LEN) throw new Error(`mm2: DATA hunk is ${d.data.length} bytes, expected ${DATA_LEN}`);
  const img = new Uint8Array(WIN); img.set(d.data);
  const iv = new DataView(img.buffer);
  for (const [th, offs] of d.relocs) for (const o of offs) iv.setUint32(o, (iv.getUint32(o) + bases[th]) >>> 0);
  return img;
}

/** strict-bounds big-endian memory over the A4 window and the monsters.dat buffer; an access outside them is a bug in the caller, so it throws */
export class FlatMem implements Mem {
  win: Uint8Array;
  mon: Uint8Array;
  /** set by the engine while a spell is resolving: called when the effect engine marks a monster for outright death (`A4-1310 := 1`, rules4 `partyEffect`) */
  killHook: (() => void) | null = null;
  constructor(win: Uint8Array, mon: Uint8Array = new Uint8Array(MON_LEN)) { this.win = win; this.mon = mon; }
  static fresh(img: Uint8Array): FlatMem { return new FlatMem(Uint8Array.from(img)); }
  clone(): FlatMem { const m = new FlatMem(Uint8Array.from(this.win), Uint8Array.from(this.mon)); return m; }
  private at(a: number): [Uint8Array, number] {
    if (a >= DATA_BASE && a < DATA_BASE + WIN) return [this.win, a - DATA_BASE];
    if (a >= MON_BASE && a < MON_BASE + MON_LEN) return [this.mon, a - MON_BASE];
    throw new Error(`mm2 memory: address ${a.toString(16)} outside the A4 window`);
  }
  r8(a: number): number { const [b, i] = this.at(a); return b[i]; }
  r16(a: number): number { const [b, i] = this.at(a); return (b[i] << 8) | b[i + 1]; }
  r32(a: number): number { const [b, i] = this.at(a); return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  w8(a: number, v: number): void {
    const [b, i] = this.at(a); b[i] = v & 0xff;
    if (v === 1 && this.killHook && a === DATA_BASE + 0x7ffe - 1310) this.killHook();
  }
  w16(a: number, v: number): void { const [b, i] = this.at(a); b[i] = (v >> 8) & 0xff; b[i + 1] = v & 0xff; }
  w32(a: number, v: number): void { const [b, i] = this.at(a); b[i] = (v >>> 24) & 0xff; b[i + 1] = (v >>> 16) & 0xff; b[i + 2] = (v >>> 8) & 0xff; b[i + 3] = v & 0xff; }
}
