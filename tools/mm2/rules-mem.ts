/**
 * Strict sparse memory for the MM2 rules ports (tools/mm2/rules.ts).
 *
 * The Unicorn oracle (tools/mm2/rules_oracle) records, per call, the bytes the
 * routine READ before writing (`init`) and the pre-call value of every byte it
 * wrote (`wpre`). A port runs against `StrictMem(init, wpre)`: reading an address
 * the game did not read throws (so the port can't depend on state the game
 * ignores), and `changes()` is the set of bytes whose value differs from the
 * pre-call value, which must equal the oracle's write set exactly.
 *
 * Addresses are absolute 68k addresses; A4 (SAS/C small-data base) is the fixed
 * constant A4V used by the harness.
 */
export const A4V = 0x167ffe;

export interface Mem {
  r8(a: number): number;
  r16(a: number): number;
  r32(a: number): number;
  w8(a: number, v: number): void;
  w16(a: number, v: number): void;
  w32(a: number, v: number): void;
}

export class StrictMem implements Mem {
  private cur = new Map<number, number>();
  private pre = new Map<number, number>();
  private readable = new Set<number>();
  private written = new Set<number>();
  constructor(init: Record<string, number>, wpre: Record<string, number> = {}) {
    for (const [k, v] of Object.entries(init)) {
      const a = Number(k);
      this.cur.set(a, v);
      this.pre.set(a, v);
      this.readable.add(a);
    }
    for (const [k, v] of Object.entries(wpre)) {
      const a = Number(k);
      this.cur.set(a, v);
      this.pre.set(a, v);
    }
  }
  r8(a: number): number {
    if (!this.written.has(a) && !this.readable.has(a)) throw new Error(`read of unread byte ${a - A4V} (A4${a - A4V >= 0 ? '+' : ''}${a - A4V})`);
    return this.cur.get(a)!;
  }
  r16(a: number): number {
    return (this.r8(a) << 8) | this.r8(a + 1);
  }
  r32(a: number): number {
    return ((this.r16(a) << 16) | this.r16(a + 2)) >>> 0;
  }
  w8(a: number, v: number): void {
    if (!this.pre.has(a)) throw new Error(`write to byte ${a - A4V} the game never touched`);
    this.cur.set(a, v & 0xff);
    this.written.add(a);
  }
  w16(a: number, v: number): void {
    this.w8(a, v >> 8);
    this.w8(a + 1, v);
  }
  w32(a: number, v: number): void {
    this.w16(a, v >>> 16);
    this.w16(a + 2, v);
  }
  /** bytes whose final value differs from the pre-call value */
  changes(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const a of this.written) if (this.cur.get(a) !== this.pre.get(a)) o[String(a)] = this.cur.get(a)!;
    return o;
  }
}

/** A4-relative helpers */
export const g = (disp: number) => A4V + disp;
