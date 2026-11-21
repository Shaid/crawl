/**
 * AESOP/16 SOP bytecode interpreter + object/message system (original code).
 *
 * Shared by EOB3 and Dungeon Hack (both SSI AESOP/16 games).
 *
 * PROVENANCE (clean-room, rewritten 2026-11-22)
 * ---------------------------------------------
 * This file contains no code from any GPL AESOP reimplementation. What it is
 * built from:
 *  - The AESOP/32 *compiler* source and manual that John Miles (author, sole
 *    copyright holder) released as public domain in January 2009
 *    (VOGONS thread t=20601, `aesop32.zip`): `DEV/SOPCOMP.C` is the authority
 *    for what each opcode does, because every opcode's stack behaviour is
 *    visible in what the code generator emits around it:
 *      - `SOP_emit_array_index` (AIM/AIS/ADD index arithmetic),
 *      - `SOP_fn_var_reference` (which load/store opcode is used for which
 *        storage class; REF_PUSH/REF_DUP/REF_LOAD/REF_STORE order),
 *      - `SOP_compile_send`/`SOP_compile_pass`/`SOP_compile_call`
 *        (PUSH-delimited argument slots, argc operand),
 *      - `SOP_compile_index` (extern arrays: PUSH, index, SXAS),
 *      - `SOP_expr_or`/`_and`/`_cond` (BRT/BRF do not pop; SETB),
 *      - `SOP_switch_statement` (CASE table layout),
 *      - `SOP_var_declaration` + `SOP_message_statement`/`_procedure_statement`
 *        (parameter offsets 0,-4,-8...; auto offsets measured to the END of the
 *        variable; THIS is a 2-byte auto at offset 2; header word = auto_size).
 *    Opcode numbering and operand sizes: the public-domain DAESOP 0.85
 *    (Mirek Luza) `abc_list.def`, cross-checked against the compiler's `OP_*`
 *    enum order.
 *  - The game's own bytecode: `EYE.RES` class resources, exported by
 *    `scripts/extract_eotb3_walker.py` to `aesop-classes.json` (376 classes).
 *    Questions the compiler cannot answer (SOLE, SXAS, what an empty SEND
 *    target returns) were settled by running the game's `dungeon`/`features`/
 *    `doors` handlers and demanding the same frames as the walker produced
 *    before this rewrite (see docs/eotb3/dosvga/data-structure.md 10.2).
 *  - NOT used: the runtime interpreter sources (`RT.ASM`, `RTOBJECT.C`, ...)
 *    shipped in `runtime.zip`. Miles states he withheld the runtime from the
 *    public-domain release because parts of it belong to SSI's successors;
 *    its files carry only a "Copyright (C) 1992 Miles Design, Inc." header, so
 *    its licence is unclear and it was deliberately not read.
 *
 * Execution model (this implementation's own design):
 *  - One byte-addressed stack growing UP, 32-bit little-endian value slots.
 *    `PUSH` reserves a zeroed slot; load/constant opcodes overwrite the TOP
 *    slot in place; stores leave the stored value in the top slot; binary ops
 *    take left = second slot, right = top slot, pop the right, and leave the
 *    result in the left slot. BRT/BRF/CASE read the top slot without popping.
 *  - A call frame is: [argument slots][auto area (auto_size bytes)][operand
 *    stack]. Parameter k lives at `argBase + 4k`; an auto variable with
 *    compiled offset `o` lives at `autoBase - o`.
 *  - `SEND`: `[obj][arg1..argN] SEND n msg` leaves the handler's result in the
 *    `obj` slot. `CALL`: `[fn][arg1..argN] CALL n` leaves the runtime
 *    function's result in the `fn` slot. `PASS n` has no object slot.
 *  - Code resource = 14-byte header {u16 staticSize, u32 import, u32 export,
 *    u32 parent} then bytecode; branch targets and handler offsets are
 *    absolute offsets in that resource; each handler/procedure starts with a
 *    u16 auto_size.
 *  - Static (object-state) layout is base-class-first; a class's static
 *    offsets are relative to its own block (`staticBase`).
 *  - Extern opcodes take the target object INDEX in the top slot and an
 *    operand that is a key of the importing class's `externs` table; that
 *    names (tag, exporting class), and the exporting class's `exportedVars`
 *    gives the offset inside its static block.
 */

export type Value = number;

export interface ExternImport {
  tag: string;
  source: number;
}

export interface SopClassData {
  number: number;
  name: string;
  staticSize: number;
  /** -1 = none. The `.EXPT` N:PARENT value (not the code header's field). */
  parent: number;
  /** message number -> offset of the handler's auto_size word in `code` */
  handlers: Map<number, number>;
  exportedVars: Map<string, number>;
  /** runtime-function operand (RCRS) -> name */
  runtimeFns: Map<number, string>;
  /** extern operand -> (tag, exporting class number) */
  externs: Map<number, ExternImport>;
  code: Uint8Array;
}

export class VmError extends Error {}

const STACK_BYTES = 32768;
const STACK_GUARD = 256;
const MAX_DEPTH = 120;

export type RuntimeCall = (vm: Interpreter, name: string, args: Value[], obj: ObjectSystem) => Value;

export function decodeClassJson(raw: {
  number: number;
  name: string;
  staticSize: number;
  parent: number;
  handlers: Record<string, number>;
  exportedVars: Record<string, number>;
  runtimeFns: Record<string, string>;
  externs: Record<string, [string, number]>;
  code: string;
}): SopClassData {
  const bin = typeof atob === 'function' ? atob(raw.code) : Buffer.from(raw.code, 'base64').toString('binary');
  const code = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) code[i] = bin.charCodeAt(i);
  return {
    number: raw.number,
    name: raw.name,
    staticSize: raw.staticSize,
    parent: raw.parent,
    handlers: new Map(Object.entries(raw.handlers).map(([k, v]) => [Number(k), v])),
    exportedVars: new Map(Object.entries(raw.exportedVars)),
    runtimeFns: new Map(Object.entries(raw.runtimeFns).map(([k, v]) => [Number(k), v])),
    externs: new Map(Object.entries(raw.externs).map(([k, [tag, source]]) => [Number(k), { tag, source }])),
    code,
  };
}

/** Memory spaces an effective-address value can point into. */
export const Space = { Invalid: 0, Code: 8, Stack: 9, Static: 10, Extern: 11 } as const;
export type Space = (typeof Space)[keyof typeof Space];

/** Address value: space in bits 28-31, owner (class for Code, object for Static/Extern) in 16-27, offset in 0-15. */
export function makeAddr(space: Space, offset: number, owner = 0): Value {
  return ((space << 28) | ((owner & 0xfff) << 16) | (offset & 0xffff)) | 0;
}
export function decodeAddr(v: Value): { space: Space; offset: number; obj: number } {
  return { space: ((v >>> 28) & 15) as Space, obj: (v >>> 16) & 0xfff, offset: v & 0xffff };
}

// Opcode numbers (SOPCOMP.C OP_* enum order == DAESOP abc_list.def).
const Op = {
  BRT: 0x00,
  BRF: 0x01,
  BRA: 0x02,
  CASE: 0x03,
  PUSH: 0x04,
  DUP: 0x05,
  NOT: 0x06,
  SETB: 0x07,
  NEG: 0x08,
  ADD: 0x09,
  SUB: 0x0a,
  MUL: 0x0b,
  DIV: 0x0c,
  MOD: 0x0d,
  EXP: 0x0e,
  BAND: 0x0f,
  BOR: 0x10,
  XOR: 0x11,
  BNOT: 0x12,
  SHL: 0x13,
  SHR: 0x14,
  LT: 0x15,
  LE: 0x16,
  EQ: 0x17,
  NE: 0x18,
  GE: 0x19,
  GT: 0x1a,
  INC: 0x1b,
  DEC: 0x1c,
  SHTC: 0x1d,
  INTC: 0x1e,
  LNGC: 0x1f,
  RCRS: 0x20,
  CALL: 0x21,
  SEND: 0x22,
  PASS: 0x23,
  JSR: 0x24,
  RTS: 0x25,
  AIM: 0x26,
  AIS: 0x27,
  LTBA: 0x28,
  LTWA: 0x29,
  LTDA: 0x2a,
  LETA: 0x2b,
  LAB: 0x2c,
  LAW: 0x2d,
  LAD: 0x2e,
  SAB: 0x2f,
  SAW: 0x30,
  SAD: 0x31,
  LABA: 0x32,
  LAWA: 0x33,
  LADA: 0x34,
  SABA: 0x35,
  SAWA: 0x36,
  SADA: 0x37,
  LEAA: 0x38,
  LSB: 0x39,
  LSW: 0x3a,
  LSD: 0x3b,
  SSB: 0x3c,
  SSW: 0x3d,
  SSD: 0x3e,
  LSBA: 0x3f,
  LSWA: 0x40,
  LSDA: 0x41,
  SSBA: 0x42,
  SSWA: 0x43,
  SSDA: 0x44,
  LESA: 0x45,
  LXB: 0x46,
  LXW: 0x47,
  LXD: 0x48,
  SXB: 0x49,
  SXW: 0x4a,
  SXD: 0x4b,
  LXBA: 0x4c,
  LXWA: 0x4d,
  LXDA: 0x4e,
  SXBA: 0x4f,
  SXWA: 0x50,
  SXDA: 0x51,
  LEXA: 0x52,
  SXAS: 0x53,
  LECA: 0x54,
  SOLE: 0x55,
  END: 0x56,
  BRK: 0x57,
} as const;

/** One executing handler/procedure. */
interface Frame {
  cls: SopClassData;
  code: Uint8Array;
  pc: number;
  /** address of parameter 0 */
  argBase: number;
  /** address one past the auto area; auto var with offset o is at autoBase - o */
  autoBase: number;
  /** address of the top operand slot */
  sp: number;
  objIndex: number;
  statics: Uint8Array | null;
  staticBase: number;
  msg: number;
}

export class Interpreter {
  readonly stk = new Uint8Array(STACK_BYTES);
  private readonly dv = new DataView(this.stk.buffer);
  /** first free stack address for a nested call */
  private free = 0;
  private xarr = 0;
  steps = 0;
  maxSteps = 200_000_000;
  private readonly sys: ObjectSystem;

  constructor(sys: ObjectSystem) {
    this.sys = sys;
  }

  private rd(a: number): number { return this.dv.getInt32(a, true); }
  private wr(a: number, v: number): void { this.dv.setInt32(a, v | 0, true); }

  /**
   * Run one handler of `cls` (offset `handler` of its auto_size word) on object
   * `objIndex` and return the value left in its top slot.
   */
  execute(cls: SopClassData, handler: number, objIndex: number, args: Value[], statics: Uint8Array | null,
    staticBase: number, msg = -1): Value {
    const base = this.free;
    if (base + 4 * args.length + STACK_GUARD > this.stk.length) throw new VmError('stack overflow');
    args.forEach((v, i) => this.wr(base + 4 * i, v));
    const f = this.enter(cls, handler, base, args.length, objIndex, statics, staticBase, msg);
    const saved = this.free;
    try {
      return this.run(f);
    } finally {
      this.free = saved;
    }
  }

  private enter(cls: SopClassData, at: number, argBase: number, argc: number, objIndex: number,
    statics: Uint8Array | null, staticBase: number, msg: number): Frame {
    const code = cls.code;
    const autoSize = code[at]! | (code[at + 1]! << 8);
    const autoStart = argBase + 4 * argc;
    const autoBase = autoStart + autoSize;
    if (autoBase + 4 + STACK_GUARD > this.stk.length) throw new VmError('stack overflow');
    this.stk.fill(0, autoStart, autoBase + 4);
    this.dv.setUint16(autoBase - 2, objIndex & 0xffff, true); // THIS, the 2-byte auto at offset 2
    return { cls, code, pc: at + 2, argBase, autoBase, sp: autoBase, objIndex, statics, staticBase, msg };
  }

  private autoAddr(f: Frame, off: number): number {
    // parameters were compiled as 0, -4, -8 ... (as u16); autos as positive end offsets
    // (autos start at offset 2, so 0 is the first parameter)
    if (off === 0) return f.argBase;
    return off >= 0x8000 ? f.argBase - (off - 0x10000) : f.autoBase - off;
  }

  private u16(code: Uint8Array, p: number): number { return code[p]! | (code[p + 1]! << 8); }

  private memRead(buf: Uint8Array, at: number, size: number): number {
    if (at < 0 || at + size > buf.length) return 0;
    // all three AESOP data types (byte/word/long) are signed (manual, language note 1)
    if (size === 1) return (buf[at]! << 24) >> 24;
    if (size === 2) return ((buf[at]! | (buf[at + 1]! << 8)) << 16) >> 16;
    return (buf[at]! | (buf[at + 1]! << 8) | (buf[at + 2]! << 16) | (buf[at + 3]! << 24)) | 0;
  }
  private memWrite(buf: Uint8Array, at: number, size: number, v: number): void {
    if (at < 0 || at + size > buf.length) return;
    for (let i = 0; i < size; i++) buf[at + i] = (v >> (8 * i)) & 0xff;
  }

  /** Resolve an extern operand to (target object's statics, byte offset of the variable). */
  private extern(f: Frame, imp: number, obj: number): { b: Uint8Array; at: number } | null {
    const e = f.cls.externs.get(imp);
    if (!e) throw new VmError(`bad extern operand ${imp} in class ${f.cls.name}`);
    const st = this.sys.staticsOf(obj);
    if (!st) return null;
    for (let c = this.sys.classes.get(e.source); c; c = c.parent >= 0 ? this.sys.classes.get(c.parent) : undefined) {
      const off = c.exportedVars.get(e.tag);
      if (off !== undefined) return { b: st, at: this.sys.staticBase(c.number) + off };
    }
    throw new VmError(`extern ${e.tag} not exported by class ${e.source} (from ${f.cls.name})`);
  }

  private run(f: Frame): number {
    const code = f.code;
    const dv = this.dv;
    let pc = f.pc;
    let sp = f.sp;
    for (;;) {
      if (++this.steps > this.maxSteps) throw new VmError('step limit exceeded');
      const op = code[pc++]!;
      switch (op) {
        case Op.BRT: { const t = this.u16(code, pc); pc = this.rd(sp) !== 0 ? t : pc + 2; break; }
        case Op.BRF: { const t = this.u16(code, pc); pc = this.rd(sp) === 0 ? t : pc + 2; break; }
        case Op.BRA: pc = this.u16(code, pc); break;
        case Op.CASE: {
          const sel = this.rd(sp);
          const n = this.u16(code, pc);
          let p = pc + 2;
          let target = -1;
          for (let i = 0; i < n; i++, p += 6) {
            if ((code[p]! | (code[p + 1]! << 8) | (code[p + 2]! << 16) | (code[p + 3]! << 24)) === sel) { target = this.u16(code, p + 4); break; }
          }
          pc = target >= 0 ? target : this.u16(code, pc + 2 + n * 6);
          break;
        }
        case Op.PUSH:
          sp += 4;
          if (sp + 4 + STACK_GUARD > this.stk.length) throw new VmError('stack overflow');
          dv.setInt32(sp, 0, true);
          break;
        case Op.DUP: sp += 4; dv.setInt32(sp, dv.getInt32(sp - 4, true), true); break;
        case Op.NOT: this.wr(sp, this.rd(sp) === 0 ? 1 : 0); break;
        case Op.SETB: this.wr(sp, this.rd(sp) !== 0 ? 1 : 0); break;
        case Op.NEG: this.wr(sp, -this.rd(sp)); break;
        case Op.BNOT: this.wr(sp, ~this.rd(sp)); break;
        case Op.INC: this.wr(sp, this.rd(sp) + 1); break;
        case Op.DEC: this.wr(sp, this.rd(sp) - 1); break;
        case Op.ADD: case Op.SUB: case Op.MUL: case Op.DIV: case Op.MOD: case Op.EXP:
        case Op.BAND: case Op.BOR: case Op.XOR: case Op.SHL: case Op.SHR:
        case Op.LT: case Op.LE: case Op.EQ: case Op.NE: case Op.GE: case Op.GT: {
          const b = this.rd(sp), a = this.rd(sp - 4);
          sp -= 4;
          let r: number;
          switch (op) {
            case Op.ADD: r = a + b; break;
            case Op.SUB: r = a - b; break;
            case Op.MUL: r = Math.imul(a, b); break;
            case Op.DIV: r = b === 0 ? 0 : Math.trunc(a / b); break;
            case Op.MOD: r = b === 0 ? 0 : a % b; break;
            case Op.EXP: { r = 1; for (let i = 0; i < b; i++) r = Math.imul(r, a); break; }
            case Op.BAND: r = a & b; break;
            case Op.BOR: r = a | b; break;
            case Op.XOR: r = a ^ b; break;
            case Op.SHL: r = b >= 32 || b < 0 ? 0 : a << b; break;
            case Op.SHR: r = b >= 32 || b < 0 ? 0 : a >>> b; break;
            case Op.LT: r = a < b ? 1 : 0; break;
            case Op.LE: r = a <= b ? 1 : 0; break;
            case Op.EQ: r = a === b ? 1 : 0; break;
            case Op.NE: r = a !== b ? 1 : 0; break;
            case Op.GE: r = a >= b ? 1 : 0; break;
            default: r = a > b ? 1 : 0; break;
          }
          this.wr(sp, r);
          break;
        }
        case Op.SHTC: this.wr(sp, code[pc]!); pc += 1; break;
        case Op.INTC: this.wr(sp, this.u16(code, pc)); pc += 2; break;
        case Op.LNGC: this.wr(sp, code[pc]! | (code[pc + 1]! << 8) | (code[pc + 2]! << 16) | (code[pc + 3]! << 24)); pc += 4; break;
        case Op.RCRS: this.wr(sp, this.u16(code, pc)); pc += 2; break;
        case Op.CALL: {
          const argc = code[pc++]!;
          const fnSlot = sp - 4 * argc;
          const args: number[] = [];
          for (let i = 0; i < argc; i++) args.push(this.rd(fnSlot + 4 + 4 * i));
          const name = f.cls.runtimeFns.get(this.rd(fnSlot));
          this.free = sp + 4;
          const r = this.sys.runtime(this, name ?? `?${this.rd(fnSlot)}`, args);
          sp = fnSlot;
          this.wr(sp, r);
          break;
        }
        case Op.SEND: {
          const argc = code[pc]!;
          const msg = this.u16(code, pc + 1);
          pc += 3;
          const slot = sp - 4 * argc;
          const args: number[] = [];
          for (let i = 0; i < argc; i++) args.push(this.rd(slot + 4 + 4 * i));
          this.free = sp + 4;
          const r = this.sys.send(this.rd(slot), msg, args);
          sp = slot;
          this.wr(sp, r);
          break;
        }
        case Op.PASS: {
          const argc = code[pc++]!;
          const slot = sp - 4 * argc;
          const args: number[] = [];
          for (let i = 0; i < argc; i++) args.push(this.rd(slot + 4 + 4 * i));
          this.free = sp + 4;
          const r = this.sys.pass(f.objIndex, f.msg, f.cls, args);
          sp = slot;
          this.wr(sp, r);
          break;
        }
        case Op.JSR: {
          const target = this.u16(code, pc);
          pc += 2;
          const child = this.enter(f.cls, target, sp + 4, 0, f.objIndex, f.statics, f.staticBase, f.msg);
          this.dv.setUint16(child.autoBase - 2, this.dv.getUint16(f.autoBase - 2, true), true);
          if (this.sys.depthEnter() > MAX_DEPTH) throw new VmError('call depth exceeded');
          let r: number;
          try { r = this.run(child); } finally { this.sys.depthLeave(); }
          this.wr(sp, r);
          break;
        }
        case Op.RTS: case Op.END: return this.rd(sp);
        case Op.AIM: { const m = this.u16(code, pc); pc += 2; const b = this.rd(sp); sp -= 4; this.wr(sp, this.rd(sp) + Math.imul(b, m)); break; }
        case Op.AIS: { const s = code[pc++]!; const b = this.rd(sp); sp -= 4; this.wr(sp, this.rd(sp) + (b << s)); break; }

        case Op.LTBA: case Op.LTWA: case Op.LTDA: {
          const base = this.u16(code, pc); pc += 2;
          const sz = op === Op.LTBA ? 1 : op === Op.LTWA ? 2 : 4;
          this.wr(sp, this.memRead(code, base + this.rd(sp), sz));
          break;
        }
        case Op.LETA: this.wr(sp, makeAddr(Space.Code, this.u16(code, pc), f.cls.number)); pc += 2; break;

        // ---- auto (parameters + locals)
        case Op.LAB: case Op.LAW: case Op.LAD: {
          const a = this.autoAddr(f, this.u16(code, pc)); pc += 2;
          this.wr(sp, this.memRead(this.stk, a, op === Op.LAB ? 1 : op === Op.LAW ? 2 : 4));
          break;
        }
        case Op.SAB: case Op.SAW: case Op.SAD: {
          const a = this.autoAddr(f, this.u16(code, pc)); pc += 2;
          this.memWrite(this.stk, a, op === Op.SAB ? 1 : op === Op.SAW ? 2 : 4, this.rd(sp));
          break;
        }
        case Op.LABA: case Op.LAWA: case Op.LADA: {
          const a = this.autoAddr(f, this.u16(code, pc)) + this.rd(sp); pc += 2;
          this.wr(sp, this.memRead(this.stk, a, op === Op.LABA ? 1 : op === Op.LAWA ? 2 : 4));
          break;
        }
        case Op.SABA: case Op.SAWA: case Op.SADA: {
          const a = this.autoAddr(f, this.u16(code, pc)) + this.rd(sp - 4); pc += 2;
          const v = this.rd(sp);
          this.memWrite(this.stk, a, op === Op.SABA ? 1 : op === Op.SAWA ? 2 : 4, v);
          sp -= 4; this.wr(sp, v);
          break;
        }
        case Op.LEAA: this.wr(sp, makeAddr(Space.Stack, this.autoAddr(f, this.u16(code, pc)))); pc += 2; break;

        // ---- static (this object's own block of the defining class)
        case Op.LSB: case Op.LSW: case Op.LSD: {
          const o = this.u16(code, pc); pc += 2;
          this.wr(sp, f.statics ? this.memRead(f.statics, f.staticBase + o, op === Op.LSB ? 1 : op === Op.LSW ? 2 : 4) : 0);
          break;
        }
        case Op.SSB: case Op.SSW: case Op.SSD: {
          const o = this.u16(code, pc); pc += 2;
          if (f.statics) this.memWrite(f.statics, f.staticBase + o, op === Op.SSB ? 1 : op === Op.SSW ? 2 : 4, this.rd(sp));
          break;
        }
        case Op.LSBA: case Op.LSWA: case Op.LSDA: {
          const o = this.u16(code, pc); pc += 2;
          this.wr(sp, f.statics ? this.memRead(f.statics, f.staticBase + o + this.rd(sp), op === Op.LSBA ? 1 : op === Op.LSWA ? 2 : 4) : 0);
          break;
        }
        case Op.SSBA: case Op.SSWA: case Op.SSDA: {
          const o = this.u16(code, pc); pc += 2;
          const v = this.rd(sp);
          if (f.statics) this.memWrite(f.statics, f.staticBase + o + this.rd(sp - 4), op === Op.SSBA ? 1 : op === Op.SSWA ? 2 : 4, v);
          sp -= 4; this.wr(sp, v);
          break;
        }
        case Op.LESA: this.wr(sp, makeAddr(Space.Static, f.staticBase + this.u16(code, pc), f.objIndex)); pc += 2; break;

        // ---- extern (variable of another object; object index in the slot below any array/value)
        case Op.LXB: case Op.LXW: case Op.LXD: {
          const imp = this.u16(code, pc); pc += 2;
          const t = this.extern(f, imp, this.rd(sp));
          this.wr(sp, t ? this.memRead(t.b, t.at, op === Op.LXB ? 1 : op === Op.LXW ? 2 : 4) : 0);
          break;
        }
        case Op.SXB: case Op.SXW: case Op.SXD: {
          const imp = this.u16(code, pc); pc += 2;
          const v = this.rd(sp);
          const t = this.extern(f, imp, this.rd(sp - 4));
          if (t) this.memWrite(t.b, t.at, op === Op.SXB ? 1 : op === Op.SXW ? 2 : 4, v);
          sp -= 4; this.wr(sp, v);
          break;
        }
        case Op.LXBA: case Op.LXWA: case Op.LXDA: {
          const imp = this.u16(code, pc); pc += 2;
          const t = this.extern(f, imp, this.rd(sp));
          this.wr(sp, t ? this.memRead(t.b, t.at + this.xarr, op === Op.LXBA ? 1 : op === Op.LXWA ? 2 : 4) : 0);
          break;
        }
        case Op.SXBA: case Op.SXWA: case Op.SXDA: {
          const imp = this.u16(code, pc); pc += 2;
          const v = this.rd(sp);
          const t = this.extern(f, imp, this.rd(sp - 4));
          if (t) this.memWrite(t.b, t.at + this.xarr, op === Op.SXBA ? 1 : op === Op.SXWA ? 2 : 4, v);
          sp -= 4; this.wr(sp, v);
          break;
        }
        case Op.LEXA: {
          const imp = this.u16(code, pc); pc += 2;
          const obj = this.rd(sp);
          const t = this.extern(f, imp, obj);
          this.wr(sp, t ? makeAddr(Space.Extern, t.at + this.xarr, obj) : 0);
          break;
        }
        case Op.SXAS: this.xarr = this.rd(sp); sp -= 4; break;

        case Op.LECA: this.wr(sp, makeAddr(Space.Code, this.u16(code, pc), f.cls.number)); pc += 2; break;
        case Op.SOLE: this.wr(sp, this.sys.lookup(this.rd(sp))); break;
        case Op.BRK: break;
        default:
          throw new VmError(`invalid opcode 0x${op.toString(16)} at ${f.cls.name}+${pc - 1}`);
      }
    }
  }

  /** Backing buffer + byte offset of an effective address (for runtime functions that read/write memory). */
  resolveAddr(addr: Value): { buf: Uint8Array; at: number } | null {
    const { space, offset, obj } = decodeAddr(addr);
    let buf: Uint8Array | null | undefined;
    if (space === Space.Code) buf = this.sys.classes.get(obj)?.code;
    else if (space === Space.Stack) buf = this.stk;
    else if (space === Space.Static) buf = this.sys.staticsOf(obj);
    return buf ? { buf, at: offset } : null;
  }

  /** NUL-terminated string at an effective address (code / static / stack spaces). */
  readCodeString(addr: Value): string {
    const { space, offset, obj } = decodeAddr(addr);
    let buf: Uint8Array | null | undefined;
    if (space === Space.Code) buf = this.sys.classes.get(obj)?.code;
    else if (space === Space.Stack) buf = this.stk;
    else buf = this.sys.staticsOf(obj);
    let s = '';
    if (!buf) return s;
    for (let i = offset; i < buf.length && buf[i] !== 0; i++) s += String.fromCharCode(buf[i]!);
    return s;
  }
}

export class ObjectSystem {
  readonly classes = new Map<number, SopClassData>();
  readonly byName = new Map<string, number>();
  private readonly objects = new Map<number, { cn: number; statics: Uint8Array }>();
  private readonly baseCache = new Map<number, number>();
  private depth = 0;
  private readonly vm = new Interpreter(this);
  private readonly msgStack: number[] = [];
  runtimeFn: RuntimeCall = () => 0;
  /** runtime functions that were called without a registered implementation, by name */
  readonly unknownCalls = new Map<string, number>();

  addClass(c: SopClassData): void {
    this.classes.set(c.number, c);
    this.byName.set(c.name, c.number);
    this.baseCache.clear();
  }

  classByName(name: string): number {
    const n = this.byName.get(name);
    if (n === undefined) throw new VmError(`no class named ${name}`);
    return n;
  }

  /** Dispatch a runtime (host) function; unknown ones are counted and return 0. */
  runtime(vm: Interpreter, name: string, args: Value[]): Value {
    const r = this.runtimeFn(vm, name, args, this);
    return r | 0;
  }

  /** Sum of the static sizes of `defClass`'s ancestors = where its own block starts in an instance. */
  staticBase(defClass: number): number {
    let v = this.baseCache.get(defClass);
    if (v === undefined) {
      v = 0;
      for (let c = this.classes.get(defClass); c && c.parent >= 0; ) {
        const p = this.classes.get(c.parent);
        if (!p) break;
        v += p.staticSize;
        c = p;
      }
      this.baseCache.set(defClass, v);
    }
    return v;
  }

  instanceStaticSize(cn: number): number {
    return this.staticBase(cn) + (this.classes.get(cn)?.staticSize ?? 0);
  }

  /** Offset of the exporting class's variable for extern operand `xr` of class `importer`. */
  resolveExtern(importer: number, xr: number): number {
    const e = this.classes.get(importer)?.externs.get(xr);
    if (!e) throw new VmError(`class ${importer} has no extern ${xr}`);
    for (let c = this.classes.get(e.source); c; c = c.parent >= 0 ? this.classes.get(c.parent) : undefined) {
      const off = c.exportedVars.get(e.tag);
      if (off !== undefined) return this.staticBase(c.number) + off;
    }
    throw new VmError(`extern ${e.tag} unresolved`);
  }

  allocAt(index: number, cn: number): number {
    if (!this.classes.has(cn)) throw new VmError(`no class ${cn}`);
    this.objects.set(index, { cn, statics: new Uint8Array(this.instanceStaticSize(cn)) });
    return index;
  }

  destroy(index: number): void { this.objects.delete(index); }
  classOf(index: number): number { return this.objects.get(index)?.cn ?? -1; }
  staticsOf(index: number): Uint8Array | null { return this.objects.get(index)?.statics ?? null; }

  /** The object-list-entry selector (`@n`): the entry's index if it is in use, else -1. */
  lookup(index: number): Value { return this.objects.has(index) ? index : -1; }

  isSubclassOf(cn: number, base: number): boolean {
    for (let c = this.classes.get(cn); c; c = c.parent >= 0 ? this.classes.get(c.parent) : undefined) if (c.number === base) return true;
    return false;
  }

  /** Read a static field (unsigned) of class `defClass`'s block in object `obj`. */
  field(obj: number, defClass: number, off: number, size: number): number {
    const s = this.classStatics(obj, defClass, off, size);
    if (!s) return 0;
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = v * 256 + s.b[s.at + i]!;
    return v;
  }

  setField(obj: number, defClass: number, off: number, size: number, v: number): void {
    const s = this.classStatics(obj, defClass, off, size);
    if (!s) return;
    for (let i = 0; i < size; i++) s.b[s.at + i] = (v >> (8 * i)) & 0xff;
  }

  classStatics(obj: number, defClass: number, off: number, size: number): { b: Uint8Array; at: number } | null {
    const o = this.objects.get(obj);
    if (!o) return null;
    const at = this.staticBase(defClass) + off;
    return at + size <= o.statics.length ? { b: o.statics, at } : null;
  }

  /** First handler for `msg` found from class `start` upward. */
  resolve(start: number, msg: number): { def: SopClassData; offset: number } | null {
    for (let c = this.classes.get(start); c; c = c.parent >= 0 ? this.classes.get(c.parent) : undefined) {
      const offset = c.handlers.get(msg);
      if (offset !== undefined) return { def: c, offset };
    }
    return null;
  }

  currentMessage(_vm: Interpreter): number { return this.msgStack[this.msgStack.length - 1] ?? -1; }

  depthEnter(): number { return ++this.depth; }
  depthLeave(): void { this.depth--; }

  /** Send `msg` to object `obj`; an absent object or an unhandled message yields 0. */
  send(obj: number, msg: number, args: Value[]): Value {
    const o = this.objects.get(obj);
    if (!o) return 0;
    const h = this.resolve(o.cn, msg);
    if (!h) return 0;
    return this.runHandler(obj, msg, h.def, h.offset, args);
  }

  /** `pass_message`: run the next handler for `msg` above class `from`. */
  pass(obj: number, msg: number, from: SopClassData, args: Value[]): Value {
    if (from.parent < 0 || !this.objects.has(obj)) return 0;
    const h = this.resolve(from.parent, msg);
    if (!h) return 0;
    return this.runHandler(obj, msg, h.def, h.offset, args);
  }

  private runHandler(obj: number, msg: number, def: SopClassData, offset: number, args: Value[]): Value {
    const o = this.objects.get(obj)!;
    if (this.depthEnter() > MAX_DEPTH) { this.depthLeave(); throw new VmError('call depth exceeded'); }
    const top = this.depth === 1;
    if (top) this.vm.steps = 0;
    this.msgStack.push(msg);
    try {
      return this.vm.execute(def, offset, obj, args, o.statics, this.staticBase(def.number), msg);
    } finally {
      this.msgStack.pop();
      this.depthLeave();
    }
  }
}
