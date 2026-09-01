/**
 * Minimal ALIS bytecode reader (Silmarils "ALIS" VM, platform.version 20/21 —
 * Ishar 1/2 era, Amiga). Scoped per the task brief: NOT a general-purpose
 * disassembler/interpreter (that's the separately-tracked, lower-priority
 * `ishar-alis-bytecode-disassembler` TODO item) — this is "just enough" to
 * mechanically walk a script's control-flow graph and decode every operand
 * as a structured value (not a string), so a second pass can pattern-match
 * specific instruction shapes (see `ishar-scene-script.ts`).
 *
 * Ground truth: `github.com/maestun/alis` (MIT) — `src/opcodes.c` (one
 * opcode byte -> handler, argument shapes), `src/opernames.c`/`storenames.c`/
 * `addnames.c` (the three operand-token tables: read/store/add-to
 * addressing modes). This is a faithful port of a hand-derived Python
 * prototype (`alisdis.py`, built during the `re-oracle` escalation that
 * cracked `docs/ishar-container-format.md` §9's world-grid system) that was
 * used to hand-verify `FORET.bin`'s and `VILLAGE.bin`'s frustum-scan
 * bytecode byte-for-byte against the reference source — see
 * `docs/ishar-container-format.md` §8's "First-person rendering mechanism"
 * section for the worked derivation this module's output was checked
 * against.
 *
 * Two opcode families deliberately generalized beyond the Python prototype
 * during this port, both re-verified against `opcodes.c` directly (not just
 * carried over): `cswitch1`'s real dispatch is a **sorted linear scan**
 * (`while (acc == test) jump; continue while acc > test`, i.e. unmatched
 * values fall through with no jump at all — `opcodes.c:713-737`), and
 * `cswitch2`'s real dispatch is `index = value + base`, valid for
 * `0 <= index <= count`, target = the offset stored at slot `index`
 * (`opcodes.c:743-761`) — NOT `value - base` as the printed prototype
 * listing's per-slot labels ambiguously suggested. Both are implemented
 * here per the real algorithm, not the prototype's display convention.
 *
 * Coverage: every opcode observed while decoding Ishar 1's `FORET.bin`,
 * `FOND.bin`, `ORC.bin`, `VILLAGE.bin`, `GERDEP.bin` and `MAIN.bin`'s
 * `cdefsc` calls, plus the full `opcodes.c` table transcribed for opcodes
 * not yet exercised by this corpus (their argument SHAPES are transcribed
 * from source; their exact runtime semantics are UNVERIFIED beyond that
 * shape until a script actually exercising them is decoded and checked).
 * An unrecognized opcode byte stops that branch of the CFG walk (recorded
 * in `errors`) rather than throwing — the walker is robust to opcodes this
 * module doesn't know about appearing in an unrelated part of a script.
 */

export type AlisTableKind = 'opername' | 'storename' | 'addname';

/** One decoded operand token. EVAL/SEVAL bodies are flat ordered step lists (a tiny accumulator-machine program), not nested expression trees -- see `evalSteps` in `ishar-scene-script.ts` for how they execute. */
export type AlisToken =
  | { t: 'imm'; op: string; width: 'b' | 'w' | 'z'; value: number | string }
  | { t: 'ref'; op: string; addr: number }
  | { t: 'nullary'; op: string }
  | { t: 'unary'; op: string; arg: AlisToken }
  | { t: 'eval'; steps: AlisToken[] }
  /** `seval`/`aeval`: an index expression (opername steps) followed by one store/add destination token. */
  | { t: 'indexed'; steps: AlisToken[]; dest: AlisToken };

export interface AlisInstr {
  addr: number;
  end: number;
  op: string;
  /** Free-form decoded fields, opcode-specific (see the `case` bodies below). */
  fields: Record<string, unknown>;
  /** CFG successors: index 0 is the fallthrough address (or null if none, e.g. `cret`/`cstop`). */
  next: Array<number | null>;
}

const OPERNAMES: Record<number, [string, string]> = {
  0x00: ['oimmb', 'b'], 0x02: ['oimmw', 'w'], 0x04: ['oimmp', 'z'],
  0x06: ['olocb', 'w'], 0x08: ['olocw', 'w'], 0x0a: ['olocp', 'w'],
  0x0c: ['oloctp', 'w'], 0x0e: ['oloctc', 'w'], 0x10: ['olocti', 'w'],
  0x12: ['odirb', 'b'], 0x14: ['odirw', 'b'], 0x16: ['odirp', 'b'],
  0x18: ['odirtp', 'b'], 0x1a: ['odirtc', 'b'], 0x1c: ['odirti', 'b'],
  0x1e: ['omainb', 'w'], 0x20: ['omainw', 'w'], 0x22: ['omainp', 'w'],
  0x24: ['omaintp', 'w'], 0x26: ['omaintc', 'w'], 0x28: ['omainti', 'w'],
  0x2a: ['ohimb', 'w'], 0x2c: ['ohimw', 'w'], 0x2e: ['ohimp', 'w'],
  0x30: ['ohimtp', ''], 0x32: ['ohimtc', ''], 0x34: ['ohimti', ''],
  0x36: ['opile', ''], 0x38: ['oeval', 'EVAL'], 0x3a: ['ofin', ''],
  0x40: ['opushacc', ''],
  0x42: ['oand', 'R'], 0x44: ['oor', 'R'], 0x46: ['oxor', 'R'], 0x48: ['oeqv', 'R'],
  0x4a: ['oegal', 'R'], 0x4c: ['odiff', 'R'], 0x4e: ['oinfeg', 'R'], 0x50: ['osupeg', 'R'],
  0x52: ['oinf', 'R'], 0x54: ['osup', 'R'], 0x56: ['oadd', 'R'], 0x58: ['osub', 'R'],
  0x5a: ['omod', 'R'], 0x5c: ['odiv', 'R'], 0x5e: ['omul', 'R'],
  0x60: ['oneg', ''], 0x62: ['oabs', ''], 0x64: ['ornd', ''], 0x66: ['osgn', ''],
  0x68: ['onot', ''], 0x6a: ['oinkey', ''], 0x6c: ['okeyon', ''], 0x6e: ['ojoy', ''],
  0x70: ['oprnd', ''], 0x72: ['oscan', ''], 0x74: ['oshiftkey', ''], 0x76: ['ofree', ''],
  0x78: ['omodel', ''], 0x7a: ['ogetkey', ''], 0x7c: ['oleft', ''], 0x7e: ['oright', ''],
  0x80: ['omid', ''], 0x82: ['olen', ''], 0x84: ['oasc', ''], 0x86: ['ostr', ''],
  0x88: ['osadd', 'R'], 0x8a: ['osegal', 'R'], 0x8c: ['osdiff', 'R'],
  0x8e: ['osinfeg', 'R'], 0x90: ['ossupeg', 'R'], 0x92: ['osinf', 'R'], 0x94: ['ossup', 'R'],
  0x96: ['ospushacc', ''], 0x98: ['ospile', ''], 0x9a: ['oval', ''], 0x9c: ['oexistf', ''],
  0x9e: ['ochr', ''], 0xa0: ['ochange', ''], 0xa2: ['ocountry', ''], 0xa4: ['omip', ''],
  0xa6: ['ojoykey', ''], 0xa8: ['oconfig', ''],
};

const STORENAMES: Record<number, [string, string]> = {
  0x06: ['slocb', 'w'], 0x08: ['slocw', 'w'], 0x0a: ['slocp', 'w'],
  0x0c: ['sloctp', 'w'], 0x0e: ['sloctc', 'w'], 0x10: ['slocti', 'w'],
  0x12: ['sdirb', 'b'], 0x14: ['sdirw', 'b'], 0x16: ['sdirp', 'b'],
  0x18: ['sdirtp', 'b'], 0x1a: ['sdirtc', 'b'], 0x1c: ['sdirti', 'b'],
  0x1e: ['smainb', 'w'], 0x20: ['smainw', 'w'], 0x22: ['smainp', 'w'],
  0x24: ['smaintp', 'w'], 0x26: ['smaintc', 'w'], 0x28: ['smainti', 'w'],
  0x2a: ['shimb', 'w'], 0x2c: ['shimw', 'w'], 0x2e: ['shimp', ''],
  0x30: ['shimtp', ''], 0x32: ['shimtc', ''], 0x34: ['shimti', ''],
  0x36: ['spile', ''], 0x38: ['seval', 'SEVAL'], 0x3a: ['sfin', ''],
};

const ADDNAMES: Record<number, [string, string]> = {
  0x06: ['alocb', 'w'], 0x08: ['alocw', 'w'], 0x0a: ['alocp', 'w'],
  0x0c: ['aloctp', 'w'], 0x0e: ['aloctc', 'w'], 0x10: ['alocti', 'w'],
  0x12: ['adirb', 'b'], 0x14: ['adirw', 'b'], 0x16: ['adirp', 'b'],
  0x18: ['adirtp', 'b'], 0x1a: ['adirtc', 'b'], 0x1c: ['adirti', 'b'],
  0x1e: ['amainb', 'w'], 0x20: ['amainw', 'w'], 0x22: ['amainp', 'w'],
  0x24: ['amaintp', 'w'], 0x26: ['amaintc', 'w'], 0x28: ['amainti', 'w'],
  0x2a: ['ahimb', ''], 0x2c: ['ahimw', 'w'], 0x2e: ['ahimp', ''],
  0x30: ['ahimtp', 'w'], 0x32: ['ahimtc', ''], 0x34: ['ahimti', ''],
  0x36: ['spile', ''], 0x38: ['aeval', 'SEVAL'], 0x3a: ['afin', ''],
};

function tableFor(kind: AlisTableKind): Record<number, [string, string]> {
  return kind === 'opername' ? OPERNAMES : kind === 'storename' ? STORENAMES : ADDNAMES;
}

/** Cursor-based byte reader over one script's decompressed bytes. */
class Cursor {
  pc: number;
  data: Uint8Array;
  constructor(data: Uint8Array, start: number) {
    this.data = data;
    this.pc = start;
  }
  u8(): number {
    return this.data[this.pc++]!;
  }
  s8(): number {
    const v = this.u8();
    return v >= 0x80 ? v - 0x100 : v;
  }
  u16(): number {
    const v = ((this.data[this.pc]! << 8) | this.data[this.pc + 1]!) >>> 0;
    this.pc += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  s24(): number {
    const b0 = this.data[this.pc]!;
    const b1 = this.data[this.pc + 1]!;
    const b2 = this.data[this.pc + 2]!;
    this.pc += 3;
    const v = (b0 << 16) | (b1 << 8) | b2;
    return v & 0x800000 ? v - 0x1000000 : v;
  }
  strz(): string {
    let s = '';
    for (;;) {
      const c = this.u8();
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

/** Read one operand/store/add token, recursing for `R`-shaped (single embedded operand) and `EVAL`/`SEVAL`-shaped tokens. */
function readToken(c: Cursor, kind: AlisTableKind): AlisToken {
  const table = tableFor(kind);
  const opByte = c.u8();
  const entry = table[opByte];
  if (!entry) throw new Error(`bad ${kind} token 0x${opByte.toString(16)} at 0x${(c.pc - 1).toString(16)}`);
  const [name, shape] = entry;
  if (shape === 'EVAL') {
    const steps: AlisToken[] = [];
    for (;;) {
      if (c.data[c.pc] === 0x3a) {
        c.pc++;
        break;
      }
      steps.push(readToken(c, kind));
    }
    return { t: 'eval', steps };
  }
  if (shape === 'SEVAL') {
    const steps: AlisToken[] = [];
    for (;;) {
      if (c.data[c.pc] === 0x3a) {
        c.pc++;
        break;
      }
      steps.push(readToken(c, 'opername'));
    }
    const dest = readToken(c, kind);
    return { t: 'indexed', steps, dest };
  }
  if (shape === 'R') {
    return { t: 'unary', op: name, arg: readToken(c, kind) };
  }
  if (shape === '') {
    return { t: 'nullary', op: name };
  }
  // `oimmb`/`oimmw` are literal numeric VALUES (usable as negative constants,
  // e.g. `cadd oimmb(0xff)` = "-1" -- confirmed by the ring/lateral clamp
  // loop needing this to terminate) and are read sign-extended. Every other
  // 'b'/'w'-shaped token here is an ADDRESS/offset operand (local-scratch
  // index, global byte offset) and stays unsigned.
  if (shape === 'b') return { t: 'imm', op: name, width: 'b', value: name === 'oimmb' ? c.s8() : c.u8() };
  if (shape === 'w') return { t: 'imm', op: name, width: 'w', value: name === 'oimmw' ? c.s16() : c.u16() };
  if (shape === 'z') return { t: 'imm', op: name, width: 'z', value: c.strz() };
  throw new Error(`unhandled token shape ${shape} for ${name}`);
}

const expr = (c: Cursor): AlisToken => readToken(c, 'opername');
const store = (c: Cursor): AlisToken => readToken(c, 'storename');
const addn = (c: Cursor): AlisToken => readToken(c, 'addname');

/** Decode one instruction at `pc`. Returns the instruction plus its CFG successors (element 0 = fallthrough, or null). Throws on an unrecognized opcode -- callers should catch per-branch (see `disassembleAlisScript`). */
export function decodeAlisInstr(data: Uint8Array, pc: number): AlisInstr {
  const start = pc;
  const c = new Cursor(data, pc);
  const op = c.u8();
  const fin = (name: string, fields: Record<string, unknown>, ...next: Array<number | null>): AlisInstr => ({
    addr: start,
    end: c.pc,
    op: name,
    fields,
    next: next.length ? next : [c.pc],
  });

  switch (op) {
    case 0x00:
      return fin('cnul', {});
    case 0x05: case 0x06: case 0x07: {
      const off = op === 0x05 ? c.s8() : op === 0x06 ? c.s16() : c.s24();
      const tgt = c.pc + off;
      return fin('cjsr', { target: tgt }, c.pc, tgt);
    }
    case 0x08: case 0x09: case 0x0a: {
      const off = op === 0x08 ? c.s8() : op === 0x09 ? c.s16() : c.s24();
      const tgt = c.pc + off;
      return fin('cjmp', { target: tgt }, null, tgt);
    }
    case 0x11:
      return fin('cret', {}, null);
    default:
      break;
  }
  if (op >= 0x12 && op <= 0x1d) {
    const kinds = ['cbz', 'cbnz', 'cbeq', 'cbne'] as const;
    const kind = kinds[Math.floor((op - 0x12) / 3)]!;
    const width = (op - 0x12) % 3;
    const off = width === 0 ? c.s8() : width === 1 ? c.s16() : c.s24();
    const tgt = c.pc + off;
    return fin(kind, { target: tgt }, c.pc, tgt);
  }
  switch (op) {
    case 0x1e: {
      const e = expr(c);
      const s = store(c);
      return fin('cstore', { expr: e, dest: s });
    }
    case 0x1f:
      return fin('ceval', { expr: expr(c) });
    case 0x20: case 0x21: {
      const e = expr(c);
      const a = addn(c);
      return fin(op === 0x20 ? 'cadd' : 'csub', { expr: e, dest: a });
    }
    case 0x24:
      return fin('cvprint', { expr: expr(c) });
    case 0x25:
      return fin('csprinti', { text: c.strz() });
    case 0x26:
      return fin('csprinta', { expr: expr(c) });
    case 0x27: {
      const a = expr(c);
      const b = expr(c);
      return fin('clocate', { a, b });
    }
    case 0x28:
      return fin('ctab', { expr: expr(c) });
    case 0x29: {
      const off = c.u16();
      const count = c.u8();
      const elemsz = c.u8();
      const dims: number[] = [];
      for (let i = 0; i < count; i++) dims.push(c.u16());
      return fin('cdim', { off, count, elemsz, dims });
    }
    case 0x2a:
      return fin('crandom', { expr: expr(c) });
    case 0x2b: case 0x2c: case 0x2d: {
      const off = op === 0x2b ? c.s8() : op === 0x2c ? c.s16() : c.s24();
      const a = addn(c);
      const tgt = c.pc + off;
      return fin('cloop', { dest: a, target: tgt }, c.pc, tgt);
    }
    case 0x2e: { // cswitch1 -- real dispatch: sorted linear scan, jump on exact match only (opcodes.c:713-737)
      const e = expr(c);
      const count = c.u8();
      if (c.pc & 1) c.pc++;
      const cases: Array<{ value: number; target: number }> = [];
      const targets1: number[] = [];
      for (let i = 0; i <= count; i++) {
        const value = c.s16();
        const here = c.pc;
        const rel = c.s16();
        const target = here + 2 + rel;
        cases.push({ value, target });
        targets1.push(target);
      }
      return fin('cswitch1', { expr: e, cases }, c.pc, ...targets1);
    }
    case 0x2f: { // cswitch2 -- real dispatch: index = value + base, valid 0..count (opcodes.c:743-761)
      const e = expr(c);
      const count = c.u8();
      if (c.pc & 1) c.pc++;
      const base = c.s16();
      const targets: number[] = [];
      for (let i = 0; i <= count; i++) {
        const here = c.pc;
        const rel = c.s16();
        const target = here + 2 + rel;
        targets.push(target);
      }
      return fin('cswitch2', { expr: e, base, count, targets }, c.pc, ...targets);
    }
    case 0x30: case 0x31: case 0x32: {
      const off = op === 0x30 ? c.s8() : op === 0x31 ? c.s16() : c.s24();
      const tgt = c.pc + off;
      return fin('cstart', { target: tgt }, c.pc, tgt);
    }
    case 0x33:
      return fin('cleave', {});
    case 0x34:
      return fin('cprotect', { expr: expr(c) });
    case 0x35:
      return fin('casleep', { expr: expr(c) });
    case 0x36:
      return fin('cclock', { expr: expr(c) });
    case 0x37:
      return fin('cnul37', {});
    case 0x38: {
      const a = expr(c); const b = expr(c); const cc = expr(c);
      return fin('cscmov', { a, b, c: cc });
    }
    case 0x39: {
      const a = expr(c); const b = expr(c); const cc = expr(c);
      return fin('cscset', { a, b, c: cc });
    }
    case 0x3a: return fin('cclipping', {});
    case 0x3b: return fin('cswitching', {});
    case 0x3c: return fin('cwlive', {});
    case 0x3d:
      return fin('cunload', { id: c.u16() });
    case 0x3e:
      return fin('cwakeup', { expr: expr(c) });
    case 0x3f: return fin('csleep', {});
    case 0x40: {
      const id = c.s16();
      const st = store(c);
      return fin('clive', { id, dest: st });
    }
    case 0x41:
      return fin('ckill', { expr: expr(c) });
    case 0x42: return fin('cstop', {}, null);
    case 0x43: return fin('cstopret', {}, null);
    case 0x44: return fin('cexit', {}, null);
    case 0x45: {
      const sid = c.u16();
      if (sid !== 0) return fin('cload', { id: sid, name: c.strz() });
      return fin('cload', { id: 0, expr: expr(c) });
    }
    case 0x46: { // cdefsc -- 32-byte per-screen config block (see docs/ishar-container-format.md §8 for the field derivation)
      const scridx = c.u16();
      const numelem = c.u8();
      const cfg = data.slice(c.pc, c.pc + 32);
      c.pc += 32;
      return fin('cdefsc', { scridx, numelem, cfg });
    }
    case 0x47:
      return fin('cscreen', { id: c.u16() });
    case 0x48:
      return fin('cput', { expr: expr(c) });
    case 0x49: {
      const x = expr(c); const y = expr(c); const z = expr(c); const idx = expr(c); const numelem = expr(c);
      return fin('cputnat', { x, y, z, idx, numelem });
    }
    case 0x4a: return fin('cerase', {});
    case 0x4b:
      return fin('cerasen', { expr: expr(c) });
    case 0x4c: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('cset', { a, b, c: cc }); }
    case 0x4d: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('cmov', { a, b, c: cc }); }
    case 0x4e: return fin('copensc', { id: c.u16() });
    case 0x4f: return fin('cclosesc', { id: c.u16() });
    case 0x50: return fin('cerasall', {});
    case 0x51: return fin('cforme', { expr: expr(c) });
    case 0x52: return fin('cdelforme', {});
    case 0x53: {
      const a = expr(c); const b = expr(c); const cc = expr(c); const d = expr(c);
      return fin('ctstmov', { a, b, c: cc, d });
    }
    case 0x54: return fin('ctstset', {});
    case 0x55: case 0x56: {
      const args = [expr(c), expr(c), expr(c), expr(c), expr(c)];
      return fin(op === 0x55 ? 'cftstmov' : 'cftstset', { args });
    }
    case 0x57: return fin('csuccent', { dest: store(c) });
    case 0x58: return fin('cpredent', { dest: store(c) });
    case 0x59: { const a = expr(c); const b = expr(c); return fin('cnearent', { a, b }); }
    case 0x5a: { const a = expr(c); const type = c.u16(); const b = expr(c); return fin('cneartyp', { a, type, b }); }
    case 0x5b: { const a = expr(c); const b = expr(c); return fin('cnearmat', { a, b }); }
    case 0x5c: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('cviewent', { a, b, c: cc }); }
    case 0x5d: { const a = expr(c); const type = c.u16(); const b = expr(c); const cc = expr(c); return fin('cviewtyp', { a, type, b, c: cc }); }
    case 0x5e: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('cviewmat', { a, b, c: cc }); }
    case 0x5f: return fin('corient', { expr: expr(c) });
    case 0x60: return fin('crstent', {});
    case 0x61: {
      const ln = c.u8();
      const exprs: AlisToken[] = [];
      for (let i = 0; i < ln + 2; i++) exprs.push(expr(c));
      return fin('csend', { len: ln, exprs });
    }
    case 0x62: return fin('cscanon', {});
    case 0x63: return fin('cscanoff', {});
    case 0x64: return fin('cinteron', {});
    case 0x65: return fin('cinteroff', {});
    case 0x66: return fin('cscanclr', {});
    case 0x67: return fin('callentity', {});
    case 0x68: return fin('cpalette', { expr: expr(c) });
    case 0x69: { const a = expr(c); const b = expr(c); return fin('cdefcolor', { a, b }); }
    case 0x6a: return fin('ctiming', { expr: expr(c) });
    case 0x6b: { const args = [expr(c), expr(c), expr(c), expr(c), expr(c)]; return fin('czap', { args }); }
    case 0x6c: case 0x6d: case 0x6e: {
      const names = ['cexplode', 'cding', 'cnoise'];
      const args = [expr(c), expr(c), expr(c), expr(c)];
      return fin(names[op - 0x6c]!, { args });
    }
    case 0x6f: return fin('cinitab', {});
    case 0x70: { // cfopen
      if (data[c.pc] === 0xff) {
        c.pc++;
        const n = expr(c);
        const m = expr(c);
        return fin('cfopen', { nameExpr: n, modeExpr: m });
      }
      const name = c.strz();
      const mode = c.u16();
      return fin('cfopen', { name, mode });
    }
    case 0x71: return fin('cfclose', {});
    case 0x75: return fin('cfwritev', { expr: expr(c) });
    case 0x77: case 0x78: { // cfreadb/cfwriteb (v<30 form -- s16 addr, u16 len)
      const addr = c.s16();
      let basemain: number | null = null;
      if (addr === 0) basemain = c.s16();
      const len = c.u16();
      return fin(op === 0x77 ? 'cfreadb' : 'cfwriteb', { addr, basemain, len });
    }
    case 0x79: case 0x7a: case 0x7b: case 0x7c: {
      const names = ['cplot', 'cdraw', 'cbox', 'cboxf'];
      const a = expr(c); const b = expr(c);
      return fin(names[op - 0x79]!, { a, b });
    }
    case 0x7d: return fin('cink', { expr: expr(c) });
    case 0x80: return fin('cpmode', { expr: expr(c) });
    case 0x81: return fin('cpicture', {});
    case 0x82: { const a = expr(c); const b = expr(c); return fin('cxyscroll', { a, b }); }
    case 0x83: return fin('clinking', { expr: expr(c) });
    case 0x84: return fin('cmouson', {});
    case 0x85: return fin('cmousoff', {});
    case 0x86: { const a = store(c); const b = store(c); const cc = store(c); return fin('cmouse', { a, b, c: cc }); }
    case 0x87: return fin('cdefmouse', { expr: expr(c) });
    case 0x88: { const a = expr(c); const b = expr(c); return fin('csetmouse', { a, b }); }
    case 0x89: {
      const n = c.u8();
      const raw = data.slice(c.pc, c.pc + Math.max(0, n - 2));
      c.pc += Math.max(0, n - 2);
      return fin('cdefvect', { n, raw });
    }
    case 0x8a: return fin('csetvect', { value: c.u16() });
    case 0x8c: return fin('capproach', { expr: expr(c) });
    case 0x8d: return fin('cescape', { expr: expr(c) });
    case 0x8e: return fin('cvtstmov', { expr: expr(c) });
    case 0x8f: { const a = expr(c); const b = expr(c); return fin('cvftstmov', { a, b }); }
    case 0x90: return fin('cvmov', {});
    case 0x91: {
      const off = c.u16();
      const cnt = c.u8();
      const raw = data.slice(c.pc, c.pc + cnt * 2);
      c.pc += cnt * 2;
      return fin('cdefworld', { off, cnt, raw });
    }
    case 0x92: { const a = c.u8(); const b = c.u8(); return fin('cworld', { a, b }); }
    case 0x93: return fin('cfindmat', {});
    case 0x94: { const type = c.u16(); const e = expr(c); return fin('cfindtyp', { type, expr: e }); }
    case 0x95: return fin('cmusic', {});
    case 0x96: return fin('cdelmusic', { expr: expr(c) });
    case 0x97: return fin('ccadence', { expr: expr(c) });
    case 0x98: return fin('csetvolum', { expr: expr(c) });
    case 0x99: return fin('cxinv', {});
    case 0x9a: return fin('cxinvon', {});
    case 0x9b: return fin('cxinvoff', {});
    case 0x9c: return fin('clistent', {});
    case 0x9d: return fin('csound', {});
    case 0x9e: return fin('cmsound', {});
    case 0x9f: return fin('credon', {});
    case 0xa0: return fin('credoff', {});
    case 0xa1: return fin('cdelsound', {});
    case 0xa5: { const a = expr(c); const b = expr(c); return fin('ctstform', { a, b }); }
    case 0xa6: return fin('cxput', { expr: expr(c) });
    case 0xa8: return fin('cmput', { expr: expr(c) });
    case 0xaa: return fin('cmxput', { expr: expr(c) });
    case 0xa7: case 0xa9: case 0xab: {
      const names = { 0xa7: 'cxputat', 0xa9: 'cmputat', 0xab: 'cmxputat' } as const;
      const args = [expr(c), expr(c), expr(c), expr(c), expr(c)];
      return fin(names[op as 0xa7 | 0xa9 | 0xab], { args });
    }
    case 0xac: return fin('cmmusic', {});
    case 0xad: return fin('cmforme', { expr: expr(c) });
    case 0xae: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('csettime', { a, b, c: cc }); }
    case 0xaf: { const a = store(c); const b = store(c); const cc = store(c); return fin('cgettime', { a, b, c: cc }); }
    case 0xb0: return fin('cvinput', { dest: store(c) });
    case 0xb1: return fin('csinput', { dest: store(c) });
    case 0xb2: return fin('casleepfar', { expr: expr(c) });
    case 0xb3: return fin('casleepon', {});
    case 0xb4: return fin('casleepoff', {});
    case 0xb5: { const e = expr(c); const a = store(c); const b = store(c); return fin('crunfilm', { e, a, b }); }
    case 0xb6: return fin('cvpicprint', { expr: expr(c) });
    case 0xb8: return fin('cvputprint', { expr: expr(c) });
    case 0xb7: return fin('cspicprint', { expr: expr(c) });
    case 0xb9: return fin('csputprint', { expr: expr(c) });
    case 0xba: { const args = [expr(c), expr(c), expr(c), expr(c), expr(c)]; return fin('cfont', { args }); }
    case 0xbb: return fin('cpaper', { expr: expr(c) });
    case 0xbc: return fin('ctoblack', { expr: expr(c) });
    case 0xbd: { const a = expr(c); const b = expr(c); return fin('cmovcolor', { a, b }); }
    case 0xbe: { const a = expr(c); const b = expr(c); return fin('ctopalet', { pal: a, dur: b }); }
    case 0xbf: {
      const args = [expr(c), expr(c), expr(c), expr(c)];
      return fin('cnumput', { x: args[0], y: args[1], z: args[2], numelem: args[3] });
    }
    case 0xc0: case 0xc1: case 0xc2: {
      const names = ['cscheart', 'cscpos', 'cscsize'];
      const a = expr(c); const b = expr(c);
      return fin(names[op - 0xc0]!, { a, b });
    }
    case 0xc3: case 0xc4: {
      const a = expr(c); const b = expr(c); const cc = expr(c);
      return fin(op === 0xc3 ? 'cschoriz' : 'cscvertic', { a, b, c: cc });
    }
    case 0xc5: { const a = expr(c); const b = expr(c); const cc = expr(c); return fin('cscreduce', { a, b, c: cc }); }
    case 0xc6: return fin('cscscale', { expr: expr(c) });
    case 0xc7: { const a = expr(c); const b = expr(c); return fin('creducing', { a, b }); }
    case 0xc8: { const e = expr(c); const a = c.u16(); const b = c.u16(); return fin('cscmap', { e, a, b }); }
    case 0xc9: return fin('cscdump', {});
    case 0xca: return fin('cfindcla', { expr: expr(c) });
    case 0xcb: return fin('cnearcla', {});
    case 0xcc: return fin('cviewcla', {});
    case 0xcd: case 0xce: {
      const a = expr(c); const b = expr(c); const cc = expr(c);
      return fin(op === 0xcd ? 'cinstru' : 'cminstru', { a, b, c: cc });
    }
    case 0xcf: return fin('cordspr', { expr: expr(c) });
    case 0xd0: { const a = expr(c); const b = expr(c); return fin('calign', { a, b }); }
    case 0xd1: { const args = Array.from({ length: 6 }, () => expr(c)); return fin('cbackstar', { args }); }
    case 0xd2: { const args = Array.from({ length: 8 }, () => expr(c)); return fin('cstarring', { args }); }
    case 0xd3: { const args = Array.from({ length: 4 }, () => expr(c)); return fin('cengine', { args }); }
    case 0xd4: return fin('cautobase', {});
    case 0xd5: return fin('cquality', { expr: expr(c) });
    case 0xd6: { const args = Array.from({ length: 7 }, () => expr(c)); return fin('chsprite', { args }); }
    case 0xd7: return fin('cselpalet', { expr: expr(c) });
    case 0xd8: { const a = expr(c); const b = expr(c); return fin('clinepalet', { a, b }); }
    case 0xd9: return fin('cautomode', {});
    case 0xda: return fin('cautofile', { expr: expr(c) });
    case 0xdb: return fin('ccancel', {});
    case 0xdc: return fin('ccancall', {});
    case 0xdd: return fin('ccancen', {});
    case 0xde: return fin('cblast', {});
    case 0xdf: { const args = Array.from({ length: 6 }, () => expr(c)); return fin('cscback', { args }); }
    case 0xe0: { const args = Array.from({ length: 4 }, () => expr(c)); return fin('cscrolpage', { args }); }
    case 0xe1: return fin('cmatent', { dest: store(c) });
    case 0xe2: { const a = expr(c); const b = expr(c); return fin('cshrink', { a, b }); }
    case 0xe6: return fin('csavepal', { expr: expr(c) });
    case 0xe7: return fin('csczoom', {});
    case 0xe9: { const a = c.u16(); const b = c.u16(); return fin('calloctab', { a, b }); }
    case 0xea: return fin('cfreetab', {});
    case 0xeb: return fin('cscantab', {});
    case 0xec: return fin('cneartab', {});
    case 0xed: return fin('cscsun', {});
    case 0xee: { const args = Array.from({ length: 5 }, () => expr(c)); return fin('cdarkpal', { args }); }
    case 0xef: { const args = Array.from({ length: 3 }, () => expr(c)); return fin('cscdark', { args }); }
    case 0xf4: { const args = Array.from({ length: 8 }, () => expr(c)); return fin('cscfollow', { args }); }
    case 0xf5: { const args = Array.from({ length: 6 }, () => expr(c)); return fin('cscview', { args }); }
    case 0xf6: { const args = Array.from({ length: 3 }, () => expr(c)); return fin('cfilm', { args }); }
    case 0xfc: { const a = expr(c); const b = expr(c); return fin('cpointpix', { a, b }); }
    case 0xff: { const a = expr(c); const b = expr(c); return fin('czoom', { a, b }); }
    default:
      throw new Error(`unimplemented opcode 0x${op.toString(16)} at 0x${start.toString(16)}`);
  }
}

export interface AlisDisasmResult {
  instrs: Map<number, AlisInstr>;
  errors: Array<{ addr: number; message: string }>;
}

/** Worklist CFG walk from one or more entry points. Mirrors `alisdis.py`'s `disasm()`. */
export function disassembleAlisScript(data: Uint8Array, entries: number[]): AlisDisasmResult {
  const instrs = new Map<number, AlisInstr>();
  const errors: Array<{ addr: number; message: string }> = [];
  const worklist = [...entries];
  const visited = new Set<number>();
  while (worklist.length) {
    let pc: number | undefined = worklist.pop();
    while (pc !== undefined && pc !== null && !visited.has(pc) && pc >= 0 && pc < data.length) {
      visited.add(pc);
      let instr: AlisInstr;
      try {
        instr = decodeAlisInstr(data, pc);
      } catch (e) {
        errors.push({ addr: pc, message: e instanceof Error ? e.message : String(e) });
        break;
      }
      instrs.set(pc, instr);
      for (let i = 1; i < instr.next.length; i++) {
        const n = instr.next[i];
        if (n !== null && n !== undefined && !visited.has(n)) worklist.push(n);
      }
      pc = instr.next[0] ?? undefined;
    }
  }
  return { instrs, errors };
}

/** Script header (`docs/ishar-container-format.md` §6/§9): `+0` u16 script id, `+4` u16 `code_loc_offset`; bytecode entry = payload + code_loc_offset + 2. */
export function scriptEntryPoint(data: Uint8Array): number {
  const codeLoc = (data[4]! << 8) | data[5]!;
  return codeLoc + 2;
}
