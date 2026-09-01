/**
 * A tiny, scoped ALIS bytecode interpreter built on top of `alis-disasm.ts`.
 *
 * Why an interpreter and not a static pattern-matcher: Ishar's first-person
 * view is not engine code reading a data table — each location script's own
 * compiled bytecode IS the renderer (frustum scan, per-cell sprite
 * selection, all baked into per-script literal constants — see
 * `docs/ishar-container-format.md` §8/§9). Statically "extracting the
 * tables" would mean hand-recognizing a specific instruction shape per
 * script; actually *running* the bytecode with real inputs (a real party
 * position/facing and a real region grid) is both more general (works for
 * any script using the same opcode vocabulary, not just one recognized
 * shape) and strictly more faithful (no risk of mistranscribing a formula)
 * — it reproduces exactly what the real engine would compute for one frame.
 *
 * Scope: this implements real execution semantics for exactly the opcodes
 * needed to run an Ishar 1 outdoor location script's per-frame placement
 * logic (arithmetic/comparison EVAL steps, `cstore`/`cadd`/`csub` to local
 * scratch, `cjmp`/`cjsr`/`cret`/branches, `cswitch1`/`cswitch2` dispatch,
 * `omaintc` 2D grid reads, and `cput`/`cputnat`/`cxputat` sprite
 * placement). Every other opcode (screen setup, palette install, sound,
 * mouse, etc.) is a documented no-op — this interpreter does not attempt to
 * be a general ALIS VM (rendering side effects like `cscreen`/`cpalette`
 * are irrelevant to computing *which sprites go where*, which is the only
 * thing this module is for). An opcode this interpreter has no case for
 * simply falls through (recorded in `warnings`) rather than throwing, so a
 * script that does something this module doesn't model yet degrades to
 * "fewer placements found," not a crash.
 *
 * Verified: applied to Ishar 1's `FORET.bin` with a real region-grid cell
 * lookup and a real party pose, this reproduces the exact per-ring
 * elevation/lateral-scale constants and per-cell sprite-index bases that
 * were hand-verified byte-for-byte against the decompiled bytecode during
 * the `re-oracle` escalation (see `docs/ishar-container-format.md` §8's
 * "First-person rendering mechanism" section) — see
 * `tools/shared/ishar-firstperson.ts`'s module doc for the render-level
 * verification (recognizable forest scene, sensible response to
 * turning/walking).
 */

import { decodeAlisInstr, type AlisInstr, type AlisToken } from './alis-disasm.ts';

export interface PlacementCommand {
  /** Source opcode: `cput` places at (0,0,0) with the last-set invert flag; `cputnat`/`cxputat` place at an explicit (x,y,z). */
  op: 'cput' | 'cputnat' | 'cxputat';
  x: number;
  y: number;
  z: number;
  idx: number;
  numelem: number;
  /** Address of the placing instruction — useful for debugging which script line produced a given placement. */
  addr: number;
}

/** Read/write access to the two things a scene script's frame-render logic touches beyond its own local scratch: named "main" globals (party position, facing, location-type) and the region/scene-content array(s) (`omaintc` reads). */
export interface SceneEnv {
  /** `omainb(addr)`/`omainw(addr)` reads. Return 0 (and it'll show up in `warnings`) for anything not modeled. */
  readMain(addr: number): number;
  /**
   * `omaintc(addr)` indexed array read — a direct, byte-verified port of the
   * real VM's `tabchar()` (`github.com/maestun/alis`'s `alis.c:1431`, traced
   * this session): `result = addr + varD7 + Σ dims[i] * pop()` for `i` in
   * `0..count-1`, where `count`/`dims` are the array's own `cdim`-declared
   * dimensions (a length-prefixed stride table `cdim` writes into vram just
   * before the array's base address, per `opcodes.c:613`'s real algorithm),
   * `varD7` is the current accumulator (`direct`, below) at the time
   * `omaintc` executes, and each `pop()` call consumes ONE eval-stack value
   * in LIFO order (most-recently-`opushacc`'d value first) — NOT a fixed
   * x/y pair. `addr` is the array's base offset baked into the bytecode.
   * Ishar 1's world-grid arrays (`basemain+0x80`/`+0x234a`) are `count=1`
   * (a single stride = row width), so a caller only ever needs to call
   * `pop()` once — matches the originally-confirmed `cell = grid[y*width+x]`
   * formula (a hand-decoded `GERDEP.bin` statement, `docs/ishar-container-
   * format.md` §9) exactly, with `direct` playing the `y` role and one
   * `pop()` playing the `x` role. Crystals of Arborea's own local
   * scene-content array (`basemain+0x7c`, `cdim`-declared `count=2,
   * dims=[2,114]`) needs `pop()` called TWICE — see
   * `tools/shared/crystals-firstperson.ts`.
   */
  readGrid(addr: number, pop: () => number, direct: number): number;
}

const STEP_BUDGET = 200_000;

interface RunResult {
  placements: PlacementCommand[];
  warnings: string[];
  steps: number;
}

/** One interpreter run over a single decompressed script's bytecode, starting at `entry`. */
export function runIsharScene(data: Uint8Array, entry: number, env: SceneEnv): RunResult {
  const placements: PlacementCommand[] = [];
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  const warn = (msg: string) => {
    if (!seenWarnings.has(msg)) {
      seenWarnings.add(msg);
      warnings.push(msg);
    }
  };

  const locals = new Map<number, number>();
  const callStack: number[] = [];
  let acc = 0;
  let steps = 0;

  const readVar = (op: string, addr: number): number => {
    switch (op) {
      case 'oimmb': case 'oimmw':
        return addr;
      case 'odirb': case 'odirw': case 'odirp':
        return locals.get(addr) ?? 0;
      case 'omainb': case 'omainw': case 'omainp':
        return env.readMain(addr);
      case 'olocb': case 'olocw': case 'olocp':
        return locals.get(0x10000 + addr) ?? 0; // separate namespace from dirb/dirw, unused by our scripts but kept distinct defensively
      default:
        warn(`unmodeled value opname ${op}`);
        return 0;
    }
  };

  const pile: number[] = [];

  /** Evaluate a single token to a scalar. Handles the shapes actually produced by `alis-disasm.ts`. */
  function evalToken(tok: AlisToken): number {
    switch (tok.t) {
      case 'imm':
        if (typeof tok.value === 'string') {
          warn(`string immediate evaluated as 0 (${tok.op})`);
          return 0;
        }
        return readVar(tok.op, tok.value);
      case 'nullary':
        if (tok.op === 'opile') return pile.pop() ?? 0;
        if (tok.op === 'opushacc') {
          pile.push(acc);
          return acc;
        }
        warn(`unmodeled nullary opname ${tok.op}`);
        return 0;
      case 'unary': {
        const rhs = evalToken(tok.arg);
        return applyBinary(tok.op, acc, rhs, warn);
      }
      case 'eval':
        return runSteps(tok.steps);
      case 'ref':
        warn(`unmodeled ref token ${tok.op}`);
        return 0;
      case 'indexed':
        warn('indexed (seval/aeval) token evaluated as 0 -- not needed by scene scripts');
        return 0;
      default:
        return 0;
    }
  }

  /** Run a flat EVAL step list against the shared `acc`/`pile` machine state, returning the final acc. */
  function runSteps(steps_: AlisToken[]): number {
    for (const step of steps_) {
      if (step.t === 'imm') {
        if (typeof step.value === 'string') {
          warn(`string immediate in EVAL (${step.op})`);
          acc = 0;
          continue;
        }
        if (step.op === 'omaintc' || step.op === 'omainti' || step.op === 'odirtc' || step.op === 'odirti') {
          // Real tabchar() semantics: the callback pops as many eval-stack
          // values (LIFO) as its own array's cdim-declared `count` needs --
          // see SceneEnv.readGrid's doc comment.
          acc = env.readGrid(step.value, () => pile.pop() ?? 0, acc);
        } else {
          acc = readVar(step.op, step.value);
        }
      } else if (step.t === 'nullary') {
        if (step.op === 'opushacc') pile.push(acc);
        else if (step.op === 'oneg') acc = -acc;
        else if (step.op === 'oabs') acc = Math.abs(acc);
        else if (step.op === 'opile') acc = pile.pop() ?? 0;
        else warn(`unmodeled EVAL step opname ${step.op}`);
      } else if (step.t === 'unary') {
        const rhs = evalToken(step.arg);
        acc = applyBinary(step.op, acc, rhs, warn);
      } else {
        warn(`unmodeled EVAL step shape ${step.t}`);
      }
    }
    return acc;
  }

  const evalExpr = (tok: AlisToken): number => (tok.t === 'eval' ? runSteps(tok.steps) : evalToken(tok));

  const destOffset = (tok: AlisToken): { local: boolean; addr: number } | null => {
    if (tok.t !== 'imm' || typeof tok.value !== 'number') return null;
    if (tok.op.startsWith('sdir') || tok.op.startsWith('adir')) return { local: true, addr: tok.value };
    if (tok.op.startsWith('smain') || tok.op.startsWith('amain')) return { local: false, addr: tok.value };
    return null;
  };

  let pc: number | null = entry;
  while (pc !== null) {
    if (++steps > STEP_BUDGET) {
      warn('step budget exceeded -- aborting run');
      break;
    }
    let instr: AlisInstr;
    try {
      instr = decodeAlisInstr(data, pc);
    } catch (e) {
      warn(`decode error at 0x${pc.toString(16)}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }

    switch (instr.op) {
      case 'cjmp':
        pc = instr.fields.target as number;
        continue;
      case 'cjsr':
        callStack.push(instr.next[0] as number);
        pc = instr.fields.target as number;
        continue;
      case 'cret':
        pc = callStack.pop() ?? null;
        continue;
      case 'cstop': case 'cstopret': case 'cexit':
        pc = null;
        continue;
      case 'cbz': case 'cbeq':
        pc = acc === 0 ? (instr.fields.target as number) : (instr.next[0] as number);
        continue;
      case 'cbnz': case 'cbne':
        pc = acc !== 0 ? (instr.fields.target as number) : (instr.next[0] as number);
        continue;
      case 'ceval':
        acc = evalExpr(instr.fields.expr as AlisToken);
        break;
      case 'cstore': {
        const v = evalExpr(instr.fields.expr as AlisToken);
        acc = v;
        const dest = destOffset(instr.fields.dest as AlisToken);
        if (dest) {
          if (dest.local) locals.set(dest.addr, v);
          else warn(`ignored write to main global 0x${dest.addr.toString(16)}`);
        } else {
          warn(`unmodeled cstore destination ${JSON.stringify(instr.fields.dest)}`);
        }
        break;
      }
      case 'cadd': case 'csub': {
        const v = evalExpr(instr.fields.expr as AlisToken);
        const dest = destOffset(instr.fields.dest as AlisToken);
        const sign = instr.op === 'cadd' ? 1 : -1;
        if (dest) {
          if (dest.local) locals.set(dest.addr, (locals.get(dest.addr) ?? 0) + sign * v);
          else warn(`ignored cadd/csub to main global 0x${dest.addr.toString(16)}`);
        }
        break;
      }
      case 'cswitch1': {
        const value = evalExpr(instr.fields.expr as AlisToken);
        acc = value;
        const cases = instr.fields.cases as Array<{ value: number; target: number }>;
        let target: number | null = instr.next[0] as number;
        for (const cs of cases) {
          if (value === cs.value) {
            target = cs.target;
            break;
          }
          if (value <= cs.value) break; // matches the real linear-scan cutoff (opcodes.c:713-737)
        }
        pc = target;
        continue;
      }
      case 'cswitch2': {
        const value = evalExpr(instr.fields.expr as AlisToken);
        acc = value;
        const base = instr.fields.base as number;
        const count = instr.fields.count as number;
        const targets = instr.fields.targets as number[];
        const index = value + base;
        pc = index >= 0 && index <= count ? targets[index]! : (instr.next[0] as number);
        continue;
      }
      case 'cput': {
        const idx = evalExpr(instr.fields.expr as AlisToken);
        placements.push({ op: 'cput', x: 0, y: 0, z: 0, idx, numelem: 0, addr: instr.addr });
        break;
      }
      case 'cputnat': case 'cxputat': {
        let x: number, y: number, z: number, idx: number, numelem: number;
        if (instr.op === 'cputnat') {
          x = evalExpr(instr.fields.x as AlisToken);
          y = evalExpr(instr.fields.y as AlisToken);
          z = evalExpr(instr.fields.z as AlisToken);
          idx = evalExpr(instr.fields.idx as AlisToken);
          numelem = evalExpr(instr.fields.numelem as AlisToken);
        } else {
          const args = instr.fields.args as AlisToken[];
          x = evalExpr(args[0]!);
          y = evalExpr(args[1]!);
          z = evalExpr(args[2]!);
          idx = evalExpr(args[3]!);
          numelem = evalExpr(args[4]!);
        }
        placements.push({ op: instr.op, x, y, z, idx, numelem, addr: instr.addr });
        break;
      }
      // Everything below is a documented no-op for this interpreter's purpose (see module doc).
      case 'cscreen': case 'cinteron': case 'cinteroff': case 'cscanon': case 'cscanoff': case 'cscanclr':
      case 'credon': case 'credoff': case 'cfindtyp': case 'clinking': case 'ccancall': case 'ccancel':
      case 'ccancen': case 'cblast': case 'cforme': case 'cdelforme': case 'cerase': case 'cerasen':
      case 'cerasall': case 'cpalette': case 'cdefcolor': case 'csetvect': case 'cdefvect': case 'cnul':
      case 'cnul37': case 'cxinv': case 'cxinvon': case 'cxinvoff': case 'copensc': case 'cclosesc':
      case 'cscmov': case 'cscset': case 'cset': case 'cmov': case 'csleep': case 'casleep':
      case 'casleepon': case 'casleepoff': case 'casleepfar': case 'ctstmov': case 'ctstset':
      case 'cftstmov': case 'cftstset': case 'csuccent': case 'cpredent': case 'cnearent': case 'cneartyp':
      case 'cnearmat': case 'cviewent': case 'cviewtyp': case 'cviewmat': case 'corient': case 'crstent':
      case 'csend': case 'callentity': case 'ctiming': case 'czap': case 'cexplode': case 'cding':
      case 'cnoise': case 'cinitab': case 'cfopen': case 'cfclose': case 'cfwritev': case 'cfreadb':
      case 'cfwriteb': case 'cplot': case 'cdraw': case 'cbox': case 'cboxf': case 'cink': case 'cpmode':
      case 'cpicture': case 'cxyscroll': case 'cmouson': case 'cmousoff': case 'cmouse': case 'cdefmouse':
      case 'csetmouse': case 'capproach': case 'cescape': case 'cvtstmov': case 'cvftstmov': case 'cvmov':
      case 'cdefworld': case 'cworld': case 'cfindmat': case 'cmusic': case 'cdelmusic': case 'ccadence':
      case 'csetvolum': case 'clistent': case 'csound': case 'cmsound': case 'cdelsound': case 'ctstform':
      case 'cxput': case 'cmput': case 'cmxput': case 'cmputat': case 'cmxputat':
      case 'cmmusic': case 'cmforme': case 'csettime': case 'cgettime': case 'cvinput': case 'csinput':
      case 'crunfilm': case 'cvpicprint': case 'cvputprint': case 'cspicprint': case 'csputprint': case 'cfont':
      case 'cpaper': case 'ctoblack': case 'cmovcolor': case 'ctopalet': case 'cnumput': case 'cscheart':
      case 'cscpos': case 'cscsize': case 'cschoriz': case 'cscvertic': case 'cscreduce': case 'cscscale':
      case 'creducing': case 'cscmap': case 'cscdump': case 'cfindcla': case 'cnearcla': case 'cviewcla':
      case 'cinstru': case 'cminstru': case 'cordspr': case 'calign': case 'cbackstar': case 'cstarring':
      case 'cengine': case 'cautobase': case 'cquality': case 'chsprite': case 'cselpalet': case 'clinepalet':
      case 'cautomode': case 'cautofile': case 'cscback': case 'cscrolpage': case 'cmatent': case 'cshrink':
      case 'csavepal': case 'csczoom': case 'calloctab': case 'cfreetab': case 'cscantab': case 'cneartab':
      case 'cscsun': case 'cdarkpal': case 'cscdark': case 'cscfollow': case 'cscview': case 'cfilm':
      case 'cpointpix': case 'czoom': case 'cload': case 'clive': case 'cunload': case 'cwakeup':
      case 'ckill': case 'cvprint': case 'csprinti': case 'csprinta': case 'clocate': case 'ctab':
      case 'cdim': case 'crandom': case 'cloop': case 'cstart': case 'cleave': case 'cprotect': case 'cclock':
      case 'cwlive': case 'cswitching': case 'cclipping':
        break;
      default:
        warn(`unmodeled opcode ${instr.op} at 0x${instr.addr.toString(16)}`);
        break;
    }
    pc = instr.next[0] ?? null;
  }

  return { placements, warnings, steps };
}

function applyBinary(op: string, lhs: number, rhs: number, warn: (m: string) => void): number {
  switch (op) {
    case 'oadd': return lhs + rhs;
    case 'osub': return lhs - rhs;
    case 'omul': return lhs * rhs;
    case 'odiv': return rhs === 0 ? 0 : Math.trunc(lhs / rhs);
    case 'omod': return rhs === 0 ? 0 : lhs % rhs;
    case 'oand': return lhs !== 0 && rhs !== 0 ? 1 : 0;
    case 'oor': return lhs !== 0 || rhs !== 0 ? 1 : 0;
    case 'oxor': return (lhs !== 0) !== (rhs !== 0) ? 1 : 0;
    case 'oegal': return lhs === rhs ? 1 : 0;
    case 'odiff': return lhs !== rhs ? 1 : 0;
    case 'oinfeg': return lhs <= rhs ? 1 : 0;
    case 'osupeg': return lhs >= rhs ? 1 : 0;
    case 'oinf': return lhs < rhs ? 1 : 0;
    case 'osup': return lhs > rhs ? 1 : 0;
    default:
      warn(`unmodeled binary opname ${op}`);
      return lhs;
  }
}

/**
 * Resolve one script's own resource-directory entry into a flat list of
 * (bitmap-or-null, dx, dy, dz, invertX) leaves, recursively expanding
 * composite records (`type > 0x80 && type !== 0xfe`, `count = byte[1]`,
 * `count` x 8-byte `[elem:u16 (high bit = mirror), dx:s16, dy:s16, dz:s16]`
 * records) — a direct, byte-verified port of `putin()`'s composite branch
 * in `github.com/maestun/alis`'s `src/image.c` (see this project's
 * `docs/ishar-container-format.md` §8's composite-record worked example).
 * `type === 0xfe` (palette install) resolves to no leaves — the caller
 * doesn't need it for placement geometry.
 */
export interface CompositeLeaf {
  index: number;
  dx: number;
  dy: number;
  dz: number;
  invertX: boolean;
}

export function resolveIsharComposite(
  data: Uint8Array,
  dir: { dirOff: number; length: number; baseDelta: number },
  index: number,
  resolveSlot: (idx: number) => number,
  invertX = false,
  depth = 0,
): CompositeLeaf[] {
  if (depth > 6 || index < 0 || index >= dir.length) return [];
  const headerOffset = resolveSlot(index);
  if (headerOffset < 0 || headerOffset >= data.length) return [];
  const type = data[headerOffset]!;
  if (type <= 0x80) return [{ index, dx: 0, dy: 0, dz: 0, invertX }];
  if (type === 0xfe) return [];
  const count = data[headerOffset + 1]!;
  const out: CompositeLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const rec = headerOffset + 2 + i * 8;
    if (rec + 8 > data.length) break;
    let elem = (data[rec]! << 8) | data[rec + 1]!;
    let elemInvert = invertX;
    if (elem & 0x8000) {
      elem &= 0x7fff;
      elemInvert = !elemInvert;
    }
    const dx = i16(data, rec + 2);
    const dy = i16(data, rec + 4);
    const dz = i16(data, rec + 6);
    const leaves = resolveIsharComposite(data, dir, elem, resolveSlot, elemInvert, depth + 1);
    for (const leaf of leaves) {
      out.push({ index: leaf.index, dx: leaf.dx + (invertX ? -dx : dx), dy: leaf.dy + dy, dz: leaf.dz + dz, invertX: leaf.invertX });
    }
  }
  return out;
}

function i16(data: Uint8Array, o: number): number {
  const v = (data[o]! << 8) | data[o + 1]!;
  return v >= 0x8000 ? v - 0x10000 : v;
}
