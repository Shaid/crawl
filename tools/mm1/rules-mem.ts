/**
 * Strict sparse memory for the MM1 rules ports (tools/mm1/rules.ts).
 *
 * The Unicorn oracle (tools/mm1/rules_oracle) records, per run, the bytes the routine READ before writing (`init`),
 * the pre-run value of every byte it wrote (`wpre`) and the final value of the changed ones (`fin`). A port runs against
 * `StrictMem(init, wpre)`: reading a byte the game did not read throws, writing a byte the game never wrote throws, and
 * `changes()` must equal `fin`. Keys are DS offsets (0..0xEFFF; DS = image 0x107B0, MM.RSM type-3 symbols are DS offsets);
 * `CS + n` (0x10000 + n) addresses the code segment (the game reads a few code-segment bytes).
 * Words are little-endian (8086).
 */
export const CS = 0x10000;

export interface Mem {
  r8(a: number): number;
  r16(a: number): number;
  w8(a: number, v: number): void;
  w16(a: number, v: number): void;
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
    if (!this.written.has(a) && !this.readable.has(a)) throw new Error(`read of unread byte DS:${a.toString(16)}`);
    return this.cur.get(a)!;
  }
  r16(a: number): number {
    return this.r8(a) | (this.r8(a + 1) << 8);
  }
  w8(a: number, v: number): void {
    if (!this.pre.has(a)) throw new Error(`write to byte DS:${a.toString(16)} the game never touched`);
    this.cur.set(a, v & 0xff);
    this.written.add(a);
  }
  w16(a: number, v: number): void {
    this.w8(a, v);
    this.w8(a + 1, v >> 8);
  }
  /** bytes whose final value differs from the pre-run value */
  changes(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const a of [...this.written].sort((x, y) => x - y)) if (this.cur.get(a) !== this.pre.get(a)) o[String(a)] = this.cur.get(a)!;
    return o;
  }
  /** keys written (including unchanged values) */
  writeSet(): number[] {
    return [...this.written].sort((x, y) => x - y);
  }
}
