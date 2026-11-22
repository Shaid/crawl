/**
 * Minimal 65816 interpreter + just enough SNES bus (LoROM mapping, WRAM,
 * the `$4202`-`$4217` multiply/divide unit, general DMA to VRAM/CGRAM/the
 * WRAM port) to run the Wizardry 6 SNES ROM's own maze-window builder,
 * view walk, palette and blit routines headlessly -- the walker's parity
 * oracle (`docs/wizardry6/snes/data-structure.md` §3.14.13).
 *
 * Original code, written from the WDC 65C816 datasheet's instruction
 * semantics; not derived from any emulator. It is deliberately NOT an
 * emulator: there is no PPU timing, no APU, no interrupts, no RESET.
 * Callers enter routines directly (`callLong`/`callShort`) in native mode;
 * emulation-mode stack/direct-page wrap quirks are not modelled, and any
 * opcode the routines it runs never use throws rather than guessing.
 * Browser-safe (no Node imports) -- the ROM bytes are passed in.
 */

export class Bus {
  rom: Uint8Array;
  wram = new Uint8Array(0x20000);
  vram = new Uint16Array(0x8000);
  cgram = new Uint16Array(256);
  regs = new Uint8Array(0x10000); // last-written MMIO bytes (bank 0 $2000-$5FFF)
  mulRes = 0; divQ = 0; divR = 0;
  vmaddr = 0; cgaddr = 0; cgLatch = -1; wmaddr = 0;
  unknownReads = new Map<number, number>();
  log: string[] = [];
  constructor(rom: Uint8Array) { this.rom = rom; }

  romOff(bank: number, addr: number): number {
    return ((bank & 0x7f) * 0x8000 + (addr & 0x7fff)) % this.rom.length;
  }
  read(a: number): number {
    const bank = (a >>> 16) & 0xff, addr = a & 0xffff;
    if (bank === 0x7e || bank === 0x7f) return this.wram[((bank & 1) << 16) | addr]!;
    const b7 = bank & 0x7f;
    if (b7 < 0x40) {
      if (addr < 0x2000) return this.wram[addr]!;
      if (addr < 0x6000) return this.ioRead(addr);
      if (addr < 0x8000) return 0;
      return this.rom[this.romOff(bank, addr)]!;
    }
    return this.rom[this.romOff(bank, addr)]!;
  }
  write(a: number, v: number): void {
    v &= 0xff;
    const bank = (a >>> 16) & 0xff, addr = a & 0xffff;
    if (bank === 0x7e || bank === 0x7f) { this.wram[((bank & 1) << 16) | addr] = v; return; }
    const b7 = bank & 0x7f;
    if (b7 < 0x40) {
      if (addr < 0x2000) { this.wram[addr] = v; return; }
      if (addr < 0x6000) { this.ioWrite(addr, v); return; }
    }
    // ROM / unmapped writes ignored
  }
  ioRead(addr: number): number {
    switch (addr) {
      case 0x4214: return this.divQ & 0xff;
      case 0x4215: return (this.divQ >> 8) & 0xff;
      case 0x4216: return this.mulRes & 0xff;
      case 0x4217: return (this.mulRes >> 8) & 0xff;
      case 0x4210: return 0x80;
      case 0x4211: return 0x80;
      case 0x4212: return 0x80;
      case 0x2180: { const v = this.wram[this.wmaddr]!; this.wmaddr = (this.wmaddr + 1) & 0x1ffff; return v; }
    }
    if (addr >= 0x4300 && addr < 0x4380) return this.regs[addr]!;
    this.unknownReads.set(addr, (this.unknownReads.get(addr) ?? 0) + 1);
    return this.regs[addr]!;
  }
  vramInc(): number { const s = this.regs[0x2115]! & 3; return s === 0 ? 1 : s === 1 ? 32 : 128; }
  ioWrite(addr: number, v: number): void {
    this.regs[addr] = v;
    switch (addr) {
      case 0x4203: this.mulRes = this.regs[0x4202]! * v; break;
      case 0x4206: {
        const dividend = this.regs[0x4204]! | (this.regs[0x4205]! << 8);
        if (v === 0) { this.divQ = 0xffff; this.mulRes = dividend; } else { this.divQ = Math.floor(dividend / v); this.mulRes = dividend % v; }
        break;
      }
      case 0x2116: case 0x2117: this.vmaddr = (this.regs[0x2116]! | (this.regs[0x2117]! << 8)) & 0x7fff; break;
      case 0x2118: {
        const w = this.vmaddr & 0x7fff; this.vram[w] = (this.vram[w]! & 0xff00) | v;
        if ((this.regs[0x2115]! & 0x80) === 0) this.vmaddr = (this.vmaddr + this.vramInc()) & 0x7fff;
        break;
      }
      case 0x2119: {
        const w = this.vmaddr & 0x7fff; this.vram[w] = (this.vram[w]! & 0x00ff) | (v << 8);
        if ((this.regs[0x2115]! & 0x80) !== 0) this.vmaddr = (this.vmaddr + this.vramInc()) & 0x7fff;
        break;
      }
      case 0x2121: this.cgaddr = v; this.cgLatch = -1; break;
      case 0x2122:
        if (this.cgLatch < 0) this.cgLatch = v;
        else { this.cgram[this.cgaddr & 0xff] = (this.cgLatch | (v << 8)) & 0x7fff; this.cgaddr = (this.cgaddr + 1) & 0xff; this.cgLatch = -1; }
        break;
      case 0x2181: case 0x2182: case 0x2183:
        this.wmaddr = (this.regs[0x2181]! | (this.regs[0x2182]! << 8) | ((this.regs[0x2183]! & 1) << 16)); break;
      case 0x2180: this.wram[this.wmaddr] = v; this.wmaddr = (this.wmaddr + 1) & 0x1ffff; break;
      case 0x420b: this.dma(v); break;
    }
  }
  dmaLog: Array<{ ch: number; bbad: number; src: number; size: number; vmaddr: number; cgaddr: number }> = [];
  dma(mask: number): void {
    for (let ch = 0; ch < 8; ch++) {
      if (!(mask & (1 << ch))) continue;
      const b = 0x4300 + ch * 16;
      const dmap = this.regs[b]!, bbad = this.regs[b + 1]!;
      let src = this.regs[b + 2]! | (this.regs[b + 3]! << 8);
      const sbank = this.regs[b + 4]!;
      let size = this.regs[b + 5]! | (this.regs[b + 6]! << 8);
      if (size === 0) size = 0x10000;
      const mode = dmap & 7, fixed = (dmap & 8) !== 0, dec = (dmap & 0x10) !== 0, toA = (dmap & 0x80) !== 0;
      const pat = [[0], [0, 1], [0, 0], [0, 0, 1, 1], [0, 1, 2, 3], [0, 1, 0, 1], [0, 0], [0, 0, 1, 1]][mode]!;
      this.dmaLog.push({ ch, bbad, src: (sbank << 16) | src, size, vmaddr: this.vmaddr, cgaddr: this.cgaddr });
      for (let i = 0; i < size; i++) {
        const reg = 0x2100 + ((bbad + pat[i % pat.length]!) & 0xff);
        const a = (sbank << 16) | src;
        if (toA) this.write(a, this.ioRead(reg)); else this.ioWrite(reg, this.read(a));
        if (!fixed) src = (src + (dec ? -1 : 1)) & 0xffff;
      }
      this.regs[b + 5] = 0; this.regs[b + 6] = 0;
    }
  }
}

const N = 0x80, V = 0x40, M = 0x20, XF = 0x10, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;

export class CPU {
  A = 0; X = 0; Y = 0; S = 0x1fff; DP = 0; DBR = 0; PBR = 0; PC = 0; P = 0x34; E = false;
  steps = 0; stopReason = '';
  hooks = new Map<number, (cpu: CPU) => void>(); // keyed by 24-bit PC; hook runs instead of the instruction
  trace: ((cpu: CPU, pc24: number) => void) | null = null;
  watch = new Map<number, (cpu: CPU) => void>(); // observe-before-execute
  bus: Bus;
  constructor(bus: Bus) { this.bus = bus; }

  get m8() { return (this.P & M) !== 0; }
  get x8() { return (this.P & XF) !== 0; }
  rd(a: number) { return this.bus.read(a & 0xffffff); }
  wr(a: number, v: number) { this.bus.write(a & 0xffffff, v); }
  rd16(a: number) { return this.rd(a) | (this.rd(a + 1) << 8); }
  rd16b0(a: number) { return this.rd(a & 0xffff) | (this.rd((a + 1) & 0xffff) << 8); }
  fetch8() { const v = this.rd((this.PBR << 16) | this.PC); this.PC = (this.PC + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }
  fetch24() { const lo = this.fetch16(); return lo | (this.fetch8() << 16); }
  push8(v: number) { this.wr(this.S, v); this.S = (this.S - 1) & 0xffff; }
  pull8() { this.S = (this.S + 1) & 0xffff; return this.rd(this.S); }
  push16(v: number) { this.push8((v >> 8) & 0xff); this.push8(v & 0xff); }
  pull16() { const lo = this.pull8(); return lo | (this.pull8() << 8); }
  setNZ8(v: number) { this.P = (this.P & ~(N | Z)) | (v & 0x80) | ((v & 0xff) === 0 ? Z : 0); }
  setNZ16(v: number) { this.P = (this.P & ~(N | Z)) | ((v >> 8) & 0x80) | ((v & 0xffff) === 0 ? Z : 0); }
  setNZm(v: number) { if (this.m8) this.setNZ8(v); else this.setNZ16(v); }
  setNZx(v: number) { if (this.x8) this.setNZ8(v); else this.setNZ16(v); }
  fixX() { if (this.x8) { this.X &= 0xff; this.Y &= 0xff; } }
  setP(v: number) { this.P = v & 0xff; this.fixX(); }

  // effective-address helpers (return 24-bit address)
  eaDP(o: number) { return (this.DP + o) & 0xffff; }
  eaDPX(o: number) { return (this.DP + o + this.X) & 0xffff; }
  eaDPY(o: number) { return (this.DP + o + this.Y) & 0xffff; }
  eaAbs(o: number) { return ((this.DBR << 16) | o); }
  eaAbsX(o: number) { return (((this.DBR << 16) | o) + this.X) & 0xffffff; }
  eaAbsY(o: number) { return (((this.DBR << 16) | o) + this.Y) & 0xffffff; }
  eaInd(o: number) { return (this.DBR << 16) | this.rd16b0(this.eaDP(o)); }
  eaIndX(o: number) { return (this.DBR << 16) | this.rd16b0(this.eaDPX(o)); }
  eaIndY(o: number) { return (((this.DBR << 16) | this.rd16b0(this.eaDP(o))) + this.Y) & 0xffffff; }
  eaIndL(o: number) { const p = this.eaDP(o); return this.rd(p) | (this.rd((p + 1) & 0xffff) << 8) | (this.rd((p + 2) & 0xffff) << 16); }
  eaIndLY(o: number) { return (this.eaIndL(o) + this.Y) & 0xffffff; }
  eaSR(o: number) { return (this.S + o) & 0xffff; }
  eaSRY(o: number) { return (((this.DBR << 16) | this.rd16b0(this.eaSR(o))) + this.Y) & 0xffffff; }

  // read operand of width m/x; `bank0wrap` for dp-style addresses
  rdM(a: number, b0: boolean) { if (this.m8) return this.rd(a); return b0 ? this.rd16b0(a) : this.rd16(a); }
  wrM(a: number, v: number, b0: boolean) {
    this.wr(a, v & 0xff);
    if (!this.m8) this.wr(b0 ? ((a & 0xff0000) | ((a + 1) & 0xffff)) : a + 1, (v >> 8) & 0xff);
  }
  rdX(a: number, b0: boolean) { if (this.x8) return this.rd(a); return b0 ? this.rd16b0(a) : this.rd16(a); }
  wrX(a: number, v: number, b0: boolean) {
    this.wr(a, v & 0xff);
    if (!this.x8) this.wr(b0 ? ((a & 0xff0000) | ((a + 1) & 0xffff)) : a + 1, (v >> 8) & 0xff);
  }

  // ALU
  getAm() { return this.m8 ? this.A & 0xff : this.A; }
  setAm(v: number) { if (this.m8) this.A = (this.A & 0xff00) | (v & 0xff); else this.A = v & 0xffff; }
  adc(v: number) {
    const c = this.P & C;
    if (this.m8) {
      const a = this.A & 0xff; let r: number;
      if (this.P & D) {
        let lo = (a & 0x0f) + (v & 0x0f) + c; if (lo > 9) lo += 6;
        let hi = (a & 0xf0) + (v & 0xf0) + (lo > 0x0f ? 0x10 : 0) + (lo & 0x0f);
        const ov = (~(a ^ v) & (a ^ hi) & 0x80);
        if (hi > 0x9f) hi += 0x60;
        r = hi; this.P = (this.P & ~(C | V)) | (r > 0xff ? C : 0) | (ov ? V : 0);
      } else {
        r = a + v + c;
        this.P = (this.P & ~(C | V)) | (r > 0xff ? C : 0) | ((~(a ^ v) & (a ^ r) & 0x80) ? V : 0);
      }
      this.setAm(r); this.setNZ8(r);
    } else {
      const a = this.A; let r: number;
      if (this.P & D) {
        let res = 0, carry = c;
        for (let s = 0; s < 16; s += 4) {
          let d = ((a >> s) & 0xf) + ((v >> s) & 0xf) + carry;
          carry = d > 9 ? 1 : 0; if (carry) d -= 10; res |= (d & 0xf) << s;
        }
        r = res | (carry << 16);
        this.P = (this.P & ~(C | V)) | (carry ? C : 0) | ((~(a ^ v) & (a ^ res) & 0x8000) ? V : 0);
      } else {
        r = a + v + c;
        this.P = (this.P & ~(C | V)) | (r > 0xffff ? C : 0) | ((~(a ^ v) & (a ^ r) & 0x8000) ? V : 0);
      }
      this.A = r & 0xffff; this.setNZ16(r);
    }
  }
  sbc(v: number) {
    if (this.P & D) {
      // decimal subtract
      const w = this.m8 ? 2 : 4; const a = this.getAm(); let borrow = (this.P & C) ? 0 : 1; let res = 0;
      for (let s = 0; s < w * 4; s += 4) {
        let d = ((a >> s) & 0xf) - ((v >> s) & 0xf) - borrow;
        borrow = d < 0 ? 1 : 0; if (borrow) d += 10; res |= (d & 0xf) << s;
      }
      const mask = this.m8 ? 0x80 : 0x8000;
      this.P = (this.P & ~(C | V)) | (borrow ? 0 : C) | (((a ^ v) & (a ^ res) & mask) ? V : 0);
      this.setAm(res); this.setNZm(res);
    } else {
      this.adc(this.m8 ? (~v & 0xff) : (~v & 0xffff));
    }
  }
  cmp(r: number, v: number, eight: boolean) {
    const mask = eight ? 0xff : 0xffff; r &= mask; v &= mask;
    const d = r - v; this.P = (this.P & ~C) | (d >= 0 ? C : 0);
    if (eight) this.setNZ8(d & 0xff); else this.setNZ16(d & 0xffff);
  }

  // memory RMW helper
  rmw(a: number, b0: boolean, f: (v: number) => number) { const v = this.rdM(a, b0); const r = f(v); this.wrM(a, r, b0); }
  asl(v: number) { const hb = this.m8 ? 0x80 : 0x8000; this.P = (this.P & ~C) | (v & hb ? C : 0); const r = (v << 1) & (this.m8 ? 0xff : 0xffff); this.setNZm(r); return r; }
  lsr(v: number) { this.P = (this.P & ~C) | (v & 1); const r = v >> 1; this.setNZm(r); return r; }
  rol(v: number) { const hb = this.m8 ? 0x80 : 0x8000; const c = this.P & C; this.P = (this.P & ~C) | (v & hb ? C : 0); const r = ((v << 1) | c) & (this.m8 ? 0xff : 0xffff); this.setNZm(r); return r; }
  ror(v: number) { const hb = this.m8 ? 0x80 : 0x8000; const c = this.P & C; this.P = (this.P & ~C) | (v & 1); const r = (v >> 1) | (c ? hb : 0); this.setNZm(r); return r; }
  inc(v: number) { const r = (v + 1) & (this.m8 ? 0xff : 0xffff); this.setNZm(r); return r; }
  dec(v: number) { const r = (v - 1) & (this.m8 ? 0xff : 0xffff); this.setNZm(r); return r; }

  branch(cond: boolean) { const o = this.fetch8(); if (cond) this.PC = (this.PC + ((o << 24) >> 24)) & 0xffff; }

  // ---- calls from the harness ----
  /** Call a routine with JSL semantics and run until it returns. */
  callLong(target: number, maxSteps = 5_000_000): void {
    const SENT_BANK = 0xff, SENT_PC = 0xfff0;
    this.push8(SENT_BANK); this.push16(SENT_PC - 1);
    this.PBR = (target >> 16) & 0xff; this.PC = target & 0xffff;
    this.runUntil(SENT_BANK, SENT_PC, maxSteps);
  }
  /** Call a routine with JSR semantics (same bank) and run until it returns. */
  callShort(target: number, maxSteps = 5_000_000): void {
    const bank = (target >> 16) & 0xff; const SENT = 0xfff0;
    this.push16(SENT - 1);
    this.PBR = bank; this.PC = target & 0xffff;
    this.runUntil(bank, SENT, maxSteps);
  }
  runUntil(bank: number, pc: number, maxSteps: number) {
    let n = 0;
    while (!(this.PBR === bank && this.PC === pc)) {
      if (++n > maxSteps) throw new Error(`step limit at ${this.PBR.toString(16)}:${this.PC.toString(16)}`);
      this.step();
    }
    this.steps += n;
  }

  step(): void {
    const pc24 = (this.PBR << 16) | this.PC;
    const h = this.hooks.get(pc24);
    if (h) { h(this); return; }
    if (this.trace) this.trace(this, pc24);
    const wch = this.watch.get(pc24); if (wch) wch(this);
    const op = this.fetch8();
    const m8 = this.m8, x8 = this.x8;
    let a: number;
    switch (op) {
      // ---- loads ----
      case 0xa9: this.setAm(m8 ? this.fetch8() : this.fetch16()); this.setNZm(this.getAm()); break;
      case 0xa2: this.X = x8 ? this.fetch8() : this.fetch16(); this.setNZx(this.X); break;
      case 0xa0: this.Y = x8 ? this.fetch8() : this.fetch16(); this.setNZx(this.Y); break;
      // generic ALU group handled below via decode
      default: this.exec(op, m8, x8); return;
    }
    void a!;
  }

  // decode the 8 "group 1" ALU ops and others
  operand(mode: string): { a: number; b0: boolean } {
    switch (mode) {
      case 'dp': return { a: this.eaDP(this.fetch8()), b0: true };
      case 'dpx': return { a: this.eaDPX(this.fetch8()), b0: true };
      case 'dpy': return { a: this.eaDPY(this.fetch8()), b0: true };
      case 'idp': return { a: this.eaInd(this.fetch8()), b0: false };
      case 'idpx': return { a: this.eaIndX(this.fetch8()), b0: false };
      case 'idpy': return { a: this.eaIndY(this.fetch8()), b0: false };
      case 'idl': return { a: this.eaIndL(this.fetch8()), b0: false };
      case 'idly': return { a: this.eaIndLY(this.fetch8()), b0: false };
      case 'abs': return { a: this.eaAbs(this.fetch16()), b0: false };
      case 'abx': return { a: this.eaAbsX(this.fetch16()), b0: false };
      case 'aby': return { a: this.eaAbsY(this.fetch16()), b0: false };
      case 'abl': return { a: this.fetch24(), b0: false };
      case 'ablx': return { a: (this.fetch24() + this.X) & 0xffffff, b0: false };
      case 'sr': return { a: this.eaSR(this.fetch8()), b0: true };
      case 'sry': return { a: this.eaSRY(this.fetch8()), b0: false };
    }
    throw new Error('bad mode ' + mode);
  }

  exec(op: number, m8: boolean, x8: boolean): void {
    const g = GROUP1[op];
    if (g) {
      const [fn, mode] = g;
      let v: number;
      if (mode === 'imm') v = m8 ? this.fetch8() : this.fetch16();
      else { const o = this.operand(mode); if (fn === 'STA') { this.wrM(o.a, this.getAm(), o.b0); return; } v = this.rdM(o.a, o.b0); }
      switch (fn) {
        case 'ORA': this.setAm(this.getAm() | v); this.setNZm(this.getAm()); break;
        case 'AND': this.setAm(this.getAm() & v); this.setNZm(this.getAm()); break;
        case 'EOR': this.setAm(this.getAm() ^ v); this.setNZm(this.getAm()); break;
        case 'ADC': this.adc(v); break;
        case 'SBC': this.sbc(v); break;
        case 'CMP': this.cmp(this.getAm(), v, m8); break;
        case 'LDA': this.setAm(v); this.setNZm(v); break;
      }
      return;
    }
    const r = RMW[op];
    if (r) {
      const [fn, mode] = r;
      const o = this.operand(mode);
      const f = fn === 'ASL' ? (v: number) => this.asl(v) : fn === 'LSR' ? (v: number) => this.lsr(v) : fn === 'ROL' ? (v: number) => this.rol(v)
        : fn === 'ROR' ? (v: number) => this.ror(v) : fn === 'INC' ? (v: number) => this.inc(v) : (v: number) => this.dec(v);
      this.rmw(o.a, o.b0, f);
      return;
    }
    let t: number;
    switch (op) {
      // index loads/stores
      case 0xa6: { const o = this.operand('dp'); this.X = this.rdX(o.a, true); this.setNZx(this.X); break; }
      case 0xb6: { const o = this.operand('dpy'); this.X = this.rdX(o.a, true); this.setNZx(this.X); break; }
      case 0xae: { const o = this.operand('abs'); this.X = this.rdX(o.a, false); this.setNZx(this.X); break; }
      case 0xbe: { const o = this.operand('aby'); this.X = this.rdX(o.a, false); this.setNZx(this.X); break; }
      case 0xa4: { const o = this.operand('dp'); this.Y = this.rdX(o.a, true); this.setNZx(this.Y); break; }
      case 0xb4: { const o = this.operand('dpx'); this.Y = this.rdX(o.a, true); this.setNZx(this.Y); break; }
      case 0xac: { const o = this.operand('abs'); this.Y = this.rdX(o.a, false); this.setNZx(this.Y); break; }
      case 0xbc: { const o = this.operand('abx'); this.Y = this.rdX(o.a, false); this.setNZx(this.Y); break; }
      case 0x86: { const o = this.operand('dp'); this.wrX(o.a, this.X, true); break; }
      case 0x96: { const o = this.operand('dpy'); this.wrX(o.a, this.X, true); break; }
      case 0x8e: { const o = this.operand('abs'); this.wrX(o.a, this.X, false); break; }
      case 0x84: { const o = this.operand('dp'); this.wrX(o.a, this.Y, true); break; }
      case 0x94: { const o = this.operand('dpx'); this.wrX(o.a, this.Y, true); break; }
      case 0x8c: { const o = this.operand('abs'); this.wrX(o.a, this.Y, false); break; }
      case 0x64: { const o = this.operand('dp'); this.wrM(o.a, 0, true); break; }
      case 0x74: { const o = this.operand('dpx'); this.wrM(o.a, 0, true); break; }
      case 0x9c: { const o = this.operand('abs'); this.wrM(o.a, 0, false); break; }
      case 0x9e: { const o = this.operand('abx'); this.wrM(o.a, 0, false); break; }
      // compares X/Y
      case 0xe0: this.cmp(this.X, x8 ? this.fetch8() : this.fetch16(), x8); break;
      case 0xe4: { const o = this.operand('dp'); this.cmp(this.X, this.rdX(o.a, true), x8); break; }
      case 0xec: { const o = this.operand('abs'); this.cmp(this.X, this.rdX(o.a, false), x8); break; }
      case 0xc0: this.cmp(this.Y, x8 ? this.fetch8() : this.fetch16(), x8); break;
      case 0xc4: { const o = this.operand('dp'); this.cmp(this.Y, this.rdX(o.a, true), x8); break; }
      case 0xcc: { const o = this.operand('abs'); this.cmp(this.Y, this.rdX(o.a, false), x8); break; }
      // BIT
      case 0x89: { const v = m8 ? this.fetch8() : this.fetch16(); this.P = (this.P & ~Z) | ((this.getAm() & v) === 0 ? Z : 0); break; }
      case 0x24: case 0x2c: case 0x34: case 0x3c: {
        const o = this.operand(op === 0x24 ? 'dp' : op === 0x2c ? 'abs' : op === 0x34 ? 'dpx' : 'abx');
        const v = this.rdM(o.a, o.b0); const hb = m8 ? 0x80 : 0x8000; const vb = m8 ? 0x40 : 0x4000;
        this.P = (this.P & ~(N | V | Z)) | (v & hb ? N : 0) | (v & vb ? V : 0) | ((this.getAm() & v) === 0 ? Z : 0);
        break;
      }
      case 0x04: case 0x0c: case 0x14: case 0x1c: { // TSB/TRB
        const o = this.operand(op === 0x04 || op === 0x14 ? 'dp' : 'abs');
        const v = this.rdM(o.a, o.b0); const am = this.getAm();
        this.P = (this.P & ~Z) | ((v & am) === 0 ? Z : 0);
        this.wrM(o.a, op < 0x10 ? (v | am) : (v & ~am), o.b0);
        break;
      }
      // accumulator shifts / inc/dec
      case 0x0a: this.setAm(this.asl(this.getAm())); break;
      case 0x4a: this.setAm(this.lsr(this.getAm())); break;
      case 0x2a: this.setAm(this.rol(this.getAm())); break;
      case 0x6a: this.setAm(this.ror(this.getAm())); break;
      case 0x1a: this.setAm(this.inc(this.getAm())); break;
      case 0x3a: this.setAm(this.dec(this.getAm())); break;
      case 0xe8: this.X = (this.X + 1) & (x8 ? 0xff : 0xffff); this.setNZx(this.X); break;
      case 0xca: this.X = (this.X - 1) & (x8 ? 0xff : 0xffff); this.setNZx(this.X); break;
      case 0xc8: this.Y = (this.Y + 1) & (x8 ? 0xff : 0xffff); this.setNZx(this.Y); break;
      case 0x88: this.Y = (this.Y - 1) & (x8 ? 0xff : 0xffff); this.setNZx(this.Y); break;
      // transfers
      case 0xaa: this.X = x8 ? this.A & 0xff : this.A; this.setNZx(this.X); break;
      case 0xa8: this.Y = x8 ? this.A & 0xff : this.A; this.setNZx(this.Y); break;
      case 0x8a: this.setAm(this.X); this.setNZm(this.getAm()); break;
      case 0x98: this.setAm(this.Y); this.setNZm(this.getAm()); break;
      case 0x9b: this.Y = this.X; this.setNZx(this.Y); break;
      case 0xbb: this.X = this.Y; this.setNZx(this.X); break;
      case 0x9a: this.S = this.X; break;
      case 0xba: this.X = x8 ? this.S & 0xff : this.S; this.setNZx(this.X); break;
      case 0x5b: this.DP = this.A; this.setNZ16(this.DP); break;
      case 0x7b: this.A = this.DP; this.setNZ16(this.A); break;
      case 0x1b: this.S = this.A; break;
      case 0x3b: this.A = this.S; this.setNZ16(this.A); break;
      case 0xeb: this.A = ((this.A >> 8) | (this.A << 8)) & 0xffff; this.setNZ8(this.A & 0xff); break;
      // stack
      case 0x48: if (m8) this.push8(this.A & 0xff); else this.push16(this.A); break;
      case 0x68: if (m8) { this.setAm(this.pull8()); this.setNZ8(this.A); } else { this.A = this.pull16(); this.setNZ16(this.A); } break;
      case 0xda: if (x8) this.push8(this.X); else this.push16(this.X); break;
      case 0xfa: this.X = x8 ? this.pull8() : this.pull16(); this.setNZx(this.X); break;
      case 0x5a: if (x8) this.push8(this.Y); else this.push16(this.Y); break;
      case 0x7a: this.Y = x8 ? this.pull8() : this.pull16(); this.setNZx(this.Y); break;
      case 0x08: this.push8(this.P); break;
      case 0x28: this.setP(this.pull8()); break;
      case 0x8b: this.push8(this.DBR); break;
      case 0xab: this.DBR = this.pull8(); this.setNZ8(this.DBR); break;
      case 0x0b: this.push16(this.DP); break;
      case 0x2b: this.DP = this.pull16(); this.setNZ16(this.DP); break;
      case 0x4b: this.push8(this.PBR); break;
      case 0xf4: this.push16(this.fetch16()); break;
      case 0xd4: { const o = this.eaDP(this.fetch8()); this.push16(this.rd16b0(o)); break; }
      case 0x62: { const d = this.fetch16(); this.push16((this.PC + d) & 0xffff); break; }
      // flags
      case 0x18: this.P &= ~C; break; case 0x38: this.P |= C; break;
      case 0x58: this.P &= ~I; break; case 0x78: this.P |= I; break;
      case 0xd8: this.P &= ~D; break; case 0xf8: this.P |= D; break;
      case 0xb8: this.P &= ~V; break;
      case 0xc2: this.setP(this.P & ~this.fetch8()); break;
      case 0xe2: this.setP(this.P | this.fetch8()); break;
      case 0xfb: { const c = this.P & C; this.P = (this.P & ~C) | (this.E ? C : 0); this.E = c !== 0; if (this.E) { this.P |= M | XF; this.fixX(); this.S = 0x100 | (this.S & 0xff); } break; }
      // branches
      case 0x10: this.branch(!(this.P & N)); break; case 0x30: this.branch(!!(this.P & N)); break;
      case 0x50: this.branch(!(this.P & V)); break; case 0x70: this.branch(!!(this.P & V)); break;
      case 0x90: this.branch(!(this.P & C)); break; case 0xb0: this.branch(!!(this.P & C)); break;
      case 0xd0: this.branch(!(this.P & Z)); break; case 0xf0: this.branch(!!(this.P & Z)); break;
      case 0x80: this.branch(true); break;
      case 0x82: { const d = this.fetch16(); this.PC = (this.PC + d) & 0xffff; break; }
      // jumps
      case 0x4c: this.PC = this.fetch16(); break;
      case 0x5c: { const t2 = this.fetch24(); this.PBR = t2 >> 16; this.PC = t2 & 0xffff; break; }
      case 0x6c: { const p = this.fetch16(); this.PC = this.rd16b0(p); break; }
      case 0x7c: { const p = this.fetch16(); this.PC = this.rd16((this.PBR << 16) | ((p + this.X) & 0xffff)); break; }
      case 0xdc: { const p = this.fetch16(); const lo = this.rd16b0(p); this.PBR = this.rd((p + 2) & 0xffff); this.PC = lo; break; }
      case 0x20: { const t2 = this.fetch16(); this.push16((this.PC - 1) & 0xffff); this.PC = t2; break; }
      case 0xfc: { const p = this.fetch16(); this.push16((this.PC - 1) & 0xffff); this.PC = this.rd16((this.PBR << 16) | ((p + this.X) & 0xffff)); break; }
      case 0x22: { const t2 = this.fetch24(); this.push8(this.PBR); this.push16((this.PC - 1) & 0xffff); this.PBR = t2 >> 16; this.PC = t2 & 0xffff; break; }
      case 0x60: this.PC = (this.pull16() + 1) & 0xffff; break;
      case 0x6b: { this.PC = (this.pull16() + 1) & 0xffff; this.PBR = this.pull8(); break; }
      case 0x40: { this.setP(this.pull8()); this.PC = this.pull16(); this.PBR = this.pull8(); break; }
      // block moves
      case 0x54: case 0x44: {
        const dst = this.fetch8(), src = this.fetch8(); this.DBR = dst;
        const step = op === 0x54 ? 1 : -1; const xm = x8 ? 0xff : 0xffff;
        do {
          this.wr((dst << 16) | this.Y, this.rd((src << 16) | this.X));
          this.X = (this.X + step) & xm; this.Y = (this.Y + step) & xm;
          this.A = (this.A - 1) & 0xffff;
        } while (this.A !== 0xffff);
        break;
      }
      case 0xea: break;
      case 0x42: this.fetch8(); break;
      case 0xcb: this.stopReason = 'WAI'; break;
      default:
        throw new Error(`unimplemented/trap opcode ${op.toString(16)} at ${this.PBR.toString(16)}:${((this.PC - 1) & 0xffff).toString(16)}`);
    }
    void t!;
  }
}

const GROUP1: Record<number, [string, string]> = {};
{
  const fns = ['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC'];
  const modes: Array<[number, string]> = [[0x01, 'idpx'], [0x03, 'sr'], [0x05, 'dp'], [0x07, 'idl'], [0x09, 'imm'], [0x0d, 'abs'], [0x0f, 'abl'],
    [0x11, 'idpy'], [0x12, 'idp'], [0x13, 'sry'], [0x15, 'dpx'], [0x17, 'idly'], [0x19, 'aby'], [0x1d, 'abx'], [0x1f, 'ablx']];
  fns.forEach((fn, i) => {
    for (const [lo, mode] of modes) {
      const op = i * 0x20 + lo;
      if (fn === 'STA' && mode === 'imm') continue; // 0x89 = BIT #
      GROUP1[op] = [fn, mode];
    }
  });
  delete GROUP1[0xa9];
}
const RMW: Record<number, [string, string]> = {
  0x06: ['ASL', 'dp'], 0x0e: ['ASL', 'abs'], 0x16: ['ASL', 'dpx'], 0x1e: ['ASL', 'abx'],
  0x46: ['LSR', 'dp'], 0x4e: ['LSR', 'abs'], 0x56: ['LSR', 'dpx'], 0x5e: ['LSR', 'abx'],
  0x26: ['ROL', 'dp'], 0x2e: ['ROL', 'abs'], 0x36: ['ROL', 'dpx'], 0x3e: ['ROL', 'abx'],
  0x66: ['ROR', 'dp'], 0x6e: ['ROR', 'abs'], 0x76: ['ROR', 'dpx'], 0x7e: ['ROR', 'abx'],
  0xe6: ['INC', 'dp'], 0xee: ['INC', 'abs'], 0xf6: ['INC', 'dpx'], 0xfe: ['INC', 'abx'],
  0xc6: ['DEC', 'dp'], 0xce: ['DEC', 'abs'], 0xd6: ['DEC', 'dpx'], 0xde: ['DEC', 'abx'],
};
