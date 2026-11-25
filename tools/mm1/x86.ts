/**
 * Minimal real-mode 8086 interpreter for the MM1 `.OVR` map-script overlays (and the few MM.EXE helper routines they call:
 * `stanp`, `erase`, `random`, `encountr`).  It supports exactly the instruction subset the executed code uses (about 45 opcode
 * forms); anything else throws, so a new overlay path can never be silently mis-executed.
 *
 * Memory is a `StrictMem` (rules-mem.ts): DS offsets below 0xF000 are the tracked data segment, `0x10000 + n` is the code segment as
 * data (`cs:` prefix), DS offsets >= 0xF000 are the (untracked) stack.  Code is fetched from a table `addr -> bytes` of the
 * instructions the oracle actually executed (so the port can never run an instruction the game did not).
 * Flags modelled: CF, ZF, SF, OF (jb/jbe/je/js/jl/jle and their negations; parity jumps throw).
 */
import { type Mem, CS } from './rules-mem.ts';

export const SENT = 0xfff0;
export const SP0 = 0xfe00;
const TRACK_END = 0xf000;

export type StubDef = { name: string; args?: (m: X86) => number[]; fn?: (m: X86) => void };
export interface X86Opts {
  mem: Mem;
  code: Map<number, number[]>;
  stubs: Map<number, StubDef>;
  stops?: number[];
  /** null-control variants: an interpreter that drops the carry-in of ADC/SBB */
  wrong?: 'noCarryIn';
}

export class X86 {
  ax = 0; bx = 0; cx = 0; dx = 0; sp = 0; bp = 0; si = 0; di = 0;
  cf = 0; zf = 0; sf = 0; of = 0;
  ip = 0;
  calls: [string, number[]][] = [];
  stop = -1;
  steps = 0;
  private stack = new Map<number, number>();
  readonly mem: Mem;
  private code: Map<number, number[]>;
  private stubs: Map<number, StubDef>;
  private stops: Set<number>;
  private wrong?: 'noCarryIn';
  constructor(o: X86Opts) {
    this.mem = o.mem; this.code = o.code; this.stubs = o.stubs; this.stops = new Set(o.stops ?? []); this.wrong = o.wrong;
  }

  // ---- memory (DS space, stack above TRACK_END) ----
  r8(a: number): number { a &= 0xffff; return a >= TRACK_END ? (this.stack.get(a) ?? 0) : this.mem.r8(a); }
  r16(a: number): number { return this.r8(a) | (this.r8(a + 1) << 8); }
  w8(a: number, v: number) { a &= 0xffff; if (a >= TRACK_END) this.stack.set(a, v & 255); else this.mem.w8(a, v & 255); }
  w16(a: number, v: number) { this.w8(a, v); this.w8(a + 1, v >> 8); }
  cr8(a: number) { return this.mem.r8(CS + (a & 0xffff)); }
  cw8(a: number, v: number) { this.mem.w8(CS + (a & 0xffff), v & 255); }

  getR(r: number, w: boolean): number {
    if (w) return [this.ax, this.cx, this.dx, this.bx, this.sp, this.bp, this.si, this.di][r];
    const x = [this.ax, this.cx, this.dx, this.bx][r & 3];
    return r < 4 ? x & 255 : (x >> 8) & 255;
  }
  setR(r: number, w: boolean, v: number) {
    if (w) {
      v &= 0xffff;
      switch (r) { case 0: this.ax = v; break; case 1: this.cx = v; break; case 2: this.dx = v; break; case 3: this.bx = v; break;
        case 4: this.sp = v; break; case 5: this.bp = v; break; case 6: this.si = v; break; default: this.di = v; }
      return;
    }
    v &= 255;
    const k = r & 3, cur = [this.ax, this.cx, this.dx, this.bx][k];
    const nv = r < 4 ? (cur & 0xff00) | v : (cur & 0x00ff) | (v << 8);
    if (k === 0) this.ax = nv; else if (k === 1) this.cx = nv; else if (k === 2) this.dx = nv; else this.bx = nv;
  }
  push(v: number) { this.sp = (this.sp - 2) & 0xffff; this.w16(this.sp, v); }
  pop(): number { const v = this.r16(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }

  // ---- ALU ----
  private alu(op: number, a: number, b: number, w: boolean): number | null {
    const mask = w ? 0xffff : 0xff, top = w ? 0x8000 : 0x80;
    let r: number, rr: number;
    switch (op) {
      case 0: rr = a + b; r = rr & mask; this.cf = rr > mask ? 1 : 0; this.of = ((a ^ r) & (b ^ r) & top) ? 1 : 0; break;
      case 1: r = (a | b) & mask; this.cf = 0; this.of = 0; break;
      case 2: { const c = this.wrong ? 0 : this.cf; rr = a + b + c; r = rr & mask; this.cf = rr > mask ? 1 : 0; this.of = ((a ^ r) & (b ^ r) & top) ? 1 : 0; break; }
      case 3: { const c = this.wrong ? 0 : this.cf; rr = a - b - c; r = rr & mask; this.cf = rr < 0 ? 1 : 0; this.of = ((a ^ b) & (a ^ r) & top) ? 1 : 0; break; }
      case 4: r = (a & b) & mask; this.cf = 0; this.of = 0; break;
      case 5: case 7: rr = a - b; r = rr & mask; this.cf = rr < 0 ? 1 : 0; this.of = ((a ^ b) & (a ^ r) & top) ? 1 : 0; break;
      default: r = (a ^ b) & mask; this.cf = 0; this.of = 0;
    }
    this.zf = r === 0 ? 1 : 0; this.sf = (r & top) ? 1 : 0;
    return op === 7 ? null : r;
  }
  private shift(kind: number, v: number, n: number, w: boolean): number {
    const bits = w ? 16 : 8, mask = w ? 0xffff : 0xff, top = 1 << (bits - 1);
    for (let i = 0; i < n; i++) {
      switch (kind) {
        case 0: { const c = (v & top) ? 1 : 0; v = ((v << 1) | c) & mask; this.cf = c; break; }                  // rol
        case 1: { const c = v & 1; v = ((v >> 1) | (c ? top : 0)) & mask; this.cf = c; break; }                  // ror
        case 2: { const c = (v & top) ? 1 : 0; v = ((v << 1) | this.cf) & mask; this.cf = c; break; }           // rcl
        case 3: { const c = v & 1; v = ((v >> 1) | (this.cf ? top : 0)) & mask; this.cf = c; break; }           // rcr
        case 4: case 6: { this.cf = (v & top) ? 1 : 0; v = (v << 1) & mask; break; }                             // shl
        case 5: { this.cf = v & 1; v = v >> 1; break; }                                                         // shr
        default: throw new Error('sar unsupported');
      }
    }
    if (n > 0 && (kind >= 4)) { this.zf = v === 0 ? 1 : 0; this.sf = (v & top) ? 1 : 0; }
    return v;
  }

  // ---- ModRM ----
  private ea(b: number[], p: { i: number }, seg: 'd' | 'c'): { reg: number; mem: boolean; rm: number; addr: number; seg: 'd' | 'c' } {
    const m = b[p.i++]; const mod = m >> 6, reg = (m >> 3) & 7, rm = m & 7;
    if (mod === 3) return { reg, mem: false, rm, addr: 0, seg };
    let a = 0;
    if (mod === 0 && rm === 6) { a = b[p.i] | (b[p.i + 1] << 8); p.i += 2; }
    else {
      a = [this.bx + this.si, this.bx + this.di, this.bp + this.si, this.bp + this.di, this.si, this.di, this.bp, this.bx][rm];
      if (mod === 1) { const d = b[p.i++]; a += d > 127 ? d - 256 : d; }
      else if (mod === 2) { a += b[p.i] | (b[p.i + 1] << 8); p.i += 2; }
    }
    return { reg, mem: true, rm, addr: a & 0xffff, seg };
  }
  private rd(e: { mem: boolean; rm: number; addr: number; seg: 'd' | 'c' }, w: boolean): number {
    if (!e.mem) return this.getR(e.rm, w);
    if (e.seg === 'c') return w ? this.cr8(e.addr) | (this.cr8(e.addr + 1) << 8) : this.cr8(e.addr);
    return w ? this.r16(e.addr) : this.r8(e.addr);
  }
  private wr(e: { mem: boolean; rm: number; addr: number; seg: 'd' | 'c' }, w: boolean, v: number) {
    if (!e.mem) { this.setR(e.rm, w, v); return; }
    if (e.seg === 'c') { this.cw8(e.addr, v); if (w) this.cw8(e.addr + 1, v >> 8); return; }
    if (w) this.w16(e.addr, v); else this.w8(e.addr, v);
  }
  /** positive condition for an even jcc nibble (jo/jb/je/jbe/js); odd nibbles negate it. Parity (jp/jnp) is not modelled. */
  private cond(c: number): boolean {
    switch (c) {
      case 0: return this.of === 1;
      case 2: return this.cf === 1;
      case 4: return this.zf === 1;
      case 6: return this.cf === 1 || this.zf === 1;
      case 8: return this.sf === 1;
      case 12: return this.sf !== this.of;
      case 14: return this.zf === 1 || this.sf !== this.of;
      default: throw new Error('unsupported condition ' + c);
    }
  }

  /** run from `ip` with regs preset; two sentinel return addresses are pushed like the oracle's Emu.call */
  run(ip: number, maxSteps = 40_000_000): void {
    this.ip = ip; this.sp = SP0 - 4; this.w16(this.sp, SENT); this.w16(this.sp + 2, SENT); this.cf = 0; this.zf = 0; this.sf = 0; this.of = 0;
    for (;;) {
      if (this.ip === SENT) return;
      if (this.stops.has(this.ip)) { this.stop = this.ip; return; }
      const st = this.stubs.get(this.ip);
      if (st) {
        this.calls.push([st.name, st.args ? st.args(this) : []]);
        if (st.fn) st.fn(this);
        this.ip = this.pop();
        continue;
      }
      if (++this.steps > maxSteps) throw new Error('step limit');
      this.step();
    }
  }

  private step() {
    const b = this.code.get(this.ip);
    if (!b) throw new Error(`no recorded instruction at CS:${this.ip.toString(16)}`);
    const p = { i: 0 };
    let seg: 'd' | 'c' = 'd';
    let op = b[p.i++];
    if (op === 0x2e) { seg = 'c'; op = b[p.i++]; }
    const next = (): number => (this.ip + b.length) & 0xffff;
    const ni = next();
    const imm8 = () => b[p.i++];
    const imm16 = () => { const v = b[p.i] | (b[p.i + 1] << 8); p.i += 2; return v; };
    const rel8 = () => { const d = b[p.i++]; return d > 127 ? d - 256 : d; };
    const rel16 = () => { const v = imm16(); return v > 32767 ? v - 65536 : v; };

    if (op < 0x40 && (op & 7) < 6) {                        // ALU family
      const aop = op >> 3, form = op & 7;
      if (form < 4) {
        const w = (form & 1) === 1, e = this.ea(b, p, seg);
        if (form < 2) { const r = this.alu(aop, this.rd(e, w), this.getR(e.reg, w), w); if (r !== null) this.wr(e, w, r); }
        else { const r = this.alu(aop, this.getR(e.reg, w), this.rd(e, w), w); if (r !== null) this.setR(e.reg, w, r); }
      } else if (form === 4) { const r = this.alu(aop, this.ax & 255, imm8(), false); if (r !== null) this.setR(0, false, r); }
      else { const r = this.alu(aop, this.ax, imm16(), true); if (r !== null) this.ax = r; }
      this.ip = ni; return;
    }
    if (op >= 0x40 && op <= 0x4f) {                           // inc/dec r16 (CF kept)
      const r = op & 7, cf = this.cf; const v = this.alu(op < 0x48 ? 0 : 5, this.getR(r, true), 1, true)!; this.setR(r, true, v); this.cf = cf; this.ip = ni; return;
    }
    if (op >= 0x50 && op <= 0x57) { this.push(this.getR(op & 7, true)); this.ip = ni; return; }
    if (op >= 0x58 && op <= 0x5f) { this.setR(op & 7, true, this.pop()); this.ip = ni; return; }
    if (op >= 0x70 && op <= 0x7f) { const d = rel8(); const pos = this.cond(op & 14); const take = (op & 1) ? !pos : pos; this.ip = take ? (ni + d) & 0xffff : ni; return; }
    switch (op) {
      case 0x80: case 0x81: case 0x83: {
        const w = op !== 0x80, e = this.ea(b, p, seg);
        const imm = op === 0x81 ? imm16() : (op === 0x83 ? (() => { const d = imm8(); return d > 127 ? (d - 256) & 0xffff : d; })() : imm8());
        const r = this.alu(e.reg, this.rd(e, w), imm, w); if (r !== null) this.wr(e, w, r); break;
      }
      case 0x84: case 0x85: { const w = op === 0x85, e = this.ea(b, p, seg); this.alu(4, this.rd(e, w), this.getR(e.reg, w), w); break; }
      case 0x88: case 0x89: { const w = op === 0x89, e = this.ea(b, p, seg); this.wr(e, w, this.getR(e.reg, w)); break; }
      case 0x8a: case 0x8b: { const w = op === 0x8b, e = this.ea(b, p, seg); this.setR(e.reg, w, this.rd(e, w)); break; }
      case 0x8d: { const e = this.ea(b, p, seg); this.setR(e.reg, true, e.addr); break; }
      case 0x8f: { const e = this.ea(b, p, seg); this.wr(e, true, this.pop()); break; }
      case 0x06: case 0x1e: this.push(0x207b); break;                                  // push es / ds (ES = DS = SS in this memory model; the value is never inspected)
      case 0x07: case 0x1f: this.pop(); break;                                         // pop es / ds
      case 0x90: break;
      case 0xa0: { const a = imm16(); this.setR(0, false, seg === 'c' ? this.cr8(a) : this.r8(a)); break; }
      case 0xa1: { const a = imm16(); this.ax = seg === 'c' ? this.cr8(a) | (this.cr8(a + 1) << 8) : this.r16(a); break; }
      case 0xa2: { const a = imm16(); if (seg === 'c') this.cw8(a, this.ax); else this.w8(a, this.ax & 255); break; }
      case 0xa3: { const a = imm16(); if (seg === 'c') { this.cw8(a, this.ax); this.cw8(a + 1, this.ax >> 8); } else this.w16(a, this.ax); break; }
      case 0xa8: this.alu(4, this.ax & 255, imm8(), false); break;
      case 0xa9: this.alu(4, this.ax, imm16(), true); break;
      case 0xc3: this.ip = this.pop(); return;
      case 0xc6: case 0xc7: { const w = op === 0xc7, e = this.ea(b, p, seg); this.wr(e, w, w ? imm16() : imm8()); break; }
      case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
        const w = (op & 1) === 1, e = this.ea(b, p, seg); const n = op < 0xd2 ? 1 : this.cx & 31;
        this.wr(e, w, this.shift(e.reg, this.rd(e, w), n, w)); break;
      }
      case 0xe2: { const d = rel8(); this.cx = (this.cx - 1) & 0xffff; this.ip = this.cx !== 0 ? (ni + d) & 0xffff : ni; return; }   // loop
      case 0xe8: { const d = rel16(); this.push(ni); this.ip = (ni + d) & 0xffff; return; }
      case 0xe9: { const d = rel16(); this.ip = (ni + d) & 0xffff; return; }
      case 0xeb: { const d = rel8(); this.ip = (ni + d) & 0xffff; return; }
      case 0xf6: case 0xf7: {
        const w = op === 0xf7, e = this.ea(b, p, seg);
        switch (e.reg) {
          case 0: case 1: this.alu(4, this.rd(e, w), w ? imm16() : imm8(), w); break;                           // test rm, imm
          case 2: this.wr(e, w, ~this.rd(e, w)); break;                                                          // not
          case 3: { const v = this.alu(5, 0, this.rd(e, w), w)!; this.wr(e, w, v); break; }                      // neg
          case 4: {                                                                                              // mul (unsigned)
            if (w) { const r = this.ax * this.rd(e, true); this.ax = r & 0xffff; this.dx = (r >>> 16) & 0xffff; this.cf = this.dx ? 1 : 0; }
            else { const r = (this.ax & 255) * this.rd(e, false); this.ax = r & 0xffff; this.cf = (r >> 8) ? 1 : 0; }
            break;
          }
          case 6: {                                                                                              // div (unsigned)
            const d = this.rd(e, w); if (d === 0) throw new Error('divide by zero');
            if (w) { const n = (this.dx * 65536) + this.ax; const q = Math.floor(n / d); if (q > 0xffff) throw new Error('divide overflow'); this.ax = q; this.dx = n % d; }
            else { const n = this.ax; const q = Math.floor(n / d); if (q > 255) throw new Error('divide overflow'); this.setR(0, false, q); this.setR(4, false, n % d); }
            break;
          }
          default: throw new Error('unsupported f6/f7 form ' + e.reg);
        }
        break;
      }
      case 0xf5: this.cf ^= 1; break;
      case 0xf8: this.cf = 0; break;
      case 0xf9: this.cf = 1; break;
      case 0xfc: break;
      case 0xfe: case 0xff: {
        const w = op === 0xff, e = this.ea(b, p, seg);
        if (e.reg === 0 || e.reg === 1) { const cf = this.cf; const v = this.alu(e.reg === 0 ? 0 : 5, this.rd(e, w), 1, w)!; this.wr(e, w, v); this.cf = cf; }
        else if (op === 0xff && e.reg === 2) { const t = this.rd(e, true); this.push(ni); this.ip = t; return; }
        else if (op === 0xff && e.reg === 4) { this.ip = this.rd(e, true); return; }
        else if (op === 0xff && e.reg === 6) { this.push(this.rd(e, true)); }
        else throw new Error('unsupported ff/fe form ' + e.reg);
        break;
      }
      default:
        if (op >= 0xb0 && op <= 0xb7) { this.setR(op & 7, false, imm8()); break; }
        if (op >= 0xb8 && op <= 0xbf) { this.setR(op & 7, true, imm16()); break; }
        throw new Error(`unsupported opcode ${op.toString(16)} at CS:${this.ip.toString(16)}`);
    }
    this.ip = ni;
  }
}
