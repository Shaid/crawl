/**
 * The Wizardry 6 (Amiga) memory image the verified rules run on. The rules in `tools/wizardry6/*.ts` read and write the game's own globals through absolute 68k
 * addresses (`a4 + displacement`) on a sparse byte map (`Mem`, combat.ts). This module builds that map's BASE state from the user's own files at load time:
 * the relocated DATA hunk of `Bane` (the constant tables, e.g. the spell table at A4-31698 and the item-kind table at A4-31716), SCENARIO.HDR (the persistent
 * entity-trigger tables at A4-30310) and the per-level maze blocks of scenario.dbs (section 2 = level table, section 3 = entities). No retail byte is committed.
 */
import { Mem } from '../combat';

export const CODE_BASE = 0x100000, DATA_BASE = 0x160000, BSS_BASE = 0x168000;
export const A4 = DATA_BASE + 0x7ffe;
/** level blocks live on the heap, one pair per level, so a level's mutable state (unlocked doors, spent triggers) persists while the party is elsewhere */
export const L2_BASE = 0x440000, L2_STRIDE = 0x600, L3_BASE = 0x460000, L3_STRIDE = 0x800;
export const SEC2 = { off: 0x9408, size: 1346 }, SEC3 = { off: 0xe828, size: 1740 }, SEC1 = { off: 0x380, size: 74 }, SEC4 = { off: 0x154e8, size: 222 }, SEC7 = { off: 0x27174, size: 40 };
export const LEVELS = 14;

/** the relocated DATA hunk of the `Bane` executable (CODE / DATA / BSS, the oracle's fixed map) */
export function dataHunk(exe: Uint8Array): Uint8Array {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  let p = 0;
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  if (u32() !== 0x3f3) throw new Error('wizardry6: Bane is not an AmigaDOS load file');
  for (;;) { const n = u32(); if (n === 0) break; p += n * 4; }
  u32(); const first = u32(); const last = u32();
  const sizes = Array.from({ length: last - first + 1 }, () => u32() & 0x3fffffff);
  const hunks: { data: Uint8Array; size: number; relocs: Map<number, number[]> }[] = [];
  let cur: (typeof hunks)[number] | null = null;
  while (p < exe.length) {
    const t = u32() & 0x3fffffff;
    if (t === 0x3e9 || t === 0x3ea) { const n = u32() * 4; cur = { data: exe.subarray(p, p + n), size: sizes[hunks.length] * 4, relocs: new Map() }; p += n; hunks.push(cur); }
    else if (t === 0x3eb) { u32(); cur = { data: new Uint8Array(0), size: sizes[hunks.length] * 4, relocs: new Map() }; hunks.push(cur); }
    else if (t === 0x3ec) {
      for (;;) { const n = u32(); if (n === 0) break; const h = u32(); const l = cur!.relocs.get(h) ?? []; for (let i = 0; i < n; i++) l.push(u32()); cur!.relocs.set(h, l); }
    } else if (t === 0x3f0) { for (;;) { const n = u32(); if (n === 0) break; p += n * 4 + 4; } }
    else if (t === 0x3f1) { const n = u32(); p += n * 4; }
    else if (t === 0x3f2) { /* end */ }
    else throw new Error('wizardry6: unexpected hunk ' + t.toString(16));
  }
  if (hunks.length < 3) throw new Error('wizardry6: Bane has fewer than 3 hunks');
  const bases = [CODE_BASE, DATA_BASE, BSS_BASE];
  const d = hunks[1];
  const img = new Uint8Array(d.size); img.set(d.data);
  const iv = new DataView(img.buffer);
  for (const [th, offs] of d.relocs) for (const o of offs) iv.setUint32(o, (iv.getUint32(o) + bases[th]) >>> 0);
  return img;
}

/** the base byte map every game starts from (and every save is a diff against) */
export function baseImage(exe: Uint8Array, scenario: Uint8Array, hdr: Uint8Array): Map<number, number> {
  const b = new Map<number, number>();
  const put = (addr: number, bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) b.set(addr + i, bytes[i]); };
  put(DATA_BASE, dataHunk(exe));
  put(A4 - 30310, hdr.subarray(0, 414));
  for (let l = 0; l < LEVELS; l++) {
    put(L2_BASE + l * L2_STRIDE, scenario.subarray(SEC2.off + l * SEC2.size, SEC2.off + (l + 1) * SEC2.size));
    put(L3_BASE + l * L3_STRIDE, scenario.subarray(SEC3.off + l * SEC3.size, SEC3.off + (l + 1) * SEC3.size));
  }
  return b;
}

export function freshMem(base: Map<number, number>): Mem {
  const m = new Mem({}, true);
  for (const [a, v] of base) m.b.set(a, v);
  return m;
}

/** the bytes of `m` that differ from `base` (a missing entry reads 0 in both), as sorted runs [addr, hex] */
export function diffRuns(m: Mem, base: Map<number, number>): [number, string][] {
  const addrs: number[] = [];
  for (const [a, v] of m.b) if ((base.get(a) ?? 0) !== v) addrs.push(a);
  for (const [a, v] of base) if (!m.b.has(a) && v !== 0) addrs.push(a);   // cannot happen (Mem never deletes) but keeps the diff total
  addrs.sort((x, y) => x - y);
  const runs: [number, string][] = [];
  let i = 0;
  while (i < addrs.length) {
    let j = i; let hex = '';
    while (j < addrs.length && (j === i || addrs[j] === addrs[j - 1] + 1)) { hex += (m.b.get(addrs[j]) ?? 0).toString(16).padStart(2, '0'); j++; }
    runs.push([addrs[i], hex]); i = j;
  }
  return runs;
}
export function applyRuns(m: Mem, runs: [number, string][]): void {
  for (const [a, hex] of runs) for (let k = 0; k < hex.length; k += 2) m.b.set(a + k / 2, parseInt(hex.slice(k, k + 2), 16));
}
