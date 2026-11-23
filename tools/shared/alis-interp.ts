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

import { decodeAlisInstr, scriptEntryPoint, type AlisInstr, type AlisToken } from './alis-disasm.ts';
import { findIsharDirectory, resolveIsharSlot } from './ishar-sprites.ts';

export interface PlacementCommand {
  /** Source opcode: `cput`/`cxput` place at (0,0,0); `cputnat`/`cxputat` at an explicit (x,y,z). */
  op: 'cput' | 'cputnat' | 'cxput' | 'cxputat';
  /** Absolute position: the script entity's own coordinates (vram words 0/2/4) plus the put's operands. */
  x: number;
  y: number;
  z: number;
  idx: number;
  numelem: number;
  /**
   * Mirror flag the reference engine stores in the sprite (`image.invert_x`):
   * the script's own `xinv` bit (`cxinv`/`cxinvon`/`cxinvoff`), XOR 1 for
   * the `cx*` put variants (`opcodes.c` `cput`/`cputnat`/`cxput`/`cxputat`).
   */
  invertX: boolean;
  /** Address of the placing instruction — useful for debugging which script line produced a given placement. */
  addr: number;
}

/** Read/write access to the two things a scene script's frame-render logic touches beyond its own local scratch: named "main" globals (party position, facing, location-type) and the region/scene-content array(s) (`omaintc` reads). */
export interface SceneEnv {
  /** `omainb(addr)`/`omainw(addr)` reads. Return 0 (and it'll show up in `warnings`) for anything not modeled. */
  readMain(addr: number): number;
  /**
   * `omaintc(addr)` indexed array read — a direct port of the reference
   * VM's `tabchar()` (`github.com/maestun/alis`'s `alis.c:1431`):
   * `result = addr + varD7 + Σ dims[i] * pop()` for `i` in `0..count-1`,
   * where `count`/`dims` are the array's own `cdim`-declared dimensions,
   * `varD7` is the current accumulator (`direct`, below) and each `pop()`
   * consumes ONE eval-stack value in LIFO order. The Ishar world-grid arrays
   * are `count=1` (a single stride = row width), so a caller only ever needs
   * to call `pop()` once: `cell = grid[pop*stride + direct]` -- the popped
   * value is the ROW, `direct` the COLUMN. Crystals of Arborea's local
   * scene-content array (`basemain+0x7c`, `count=2, dims=[2,114]`) needs
   * `pop()` called TWICE — see `tools/shared/crystals-firstperson.ts`.
   */
  readGrid(addr: number, pop: () => number, direct: number, size?: 1 | 2): number;
  /** Optional `smain*` writes; when absent they are dropped (and warned about). */
  writeMain?(addr: number, value: number): void;
  /** Optional `smaintc`/`smainti` writes into a one-dimensional main table (element `index`); when absent they are dropped (and warned about). */
  writeTable?(addr: number, index: number, value: number, size: 1 | 2): void;
  /** `clive id`: start another entity from script `id`; returns its handle (stored to the instruction's destination), or -1. */
  live?(id: number): number;
  /** `shim*`/`ohim*`: another entity's variable at vram `offset` (the handle comes from a `clive`). */
  writeEntity?(handle: number, offset: number, value: number): void;
  readEntity?(handle: number, offset: number): number;
}

const STEP_BUDGET = 200_000;

interface RunResult {
  placements: PlacementCommand[];
  warnings: string[];
  steps: number;
}

/**
 * How an activation ended. `stop` = `cstop`/`cstopret` (the reference VM
 * resumes at the next instruction on the NEXT frame, without a wake-up);
 * `sleep` = `csleep` (resumes after the next `cwakeup` from another script);
 * `exit` = `cexit`/fell off the end (the entity is gone); `budget`/`error`
 * = this interpreter gave up.
 */
export type AlisYield = 'stop' | 'sleep' | 'exit' | 'budget' | 'error';

/**
 * One sprite in an entity's element list, as the reference VM keeps it
 * between frames (`image.c` `putin`/`searchelem`/`getelem`/`createlem`/
 * `putfin`/`killelem`): always a single bitmap (composites are expanded at
 * put time), with absolute position.
 */
export interface RetainedPlacement {
  /** Directory slot of the bitmap. */
  idx: number;
  x: number;
  y: number;
  z: number;
  numelem: number;
  invertX: boolean;
  /** Reference sprite state: 0 = drawn last frame, -1 = created this frame, 2 = re-put this frame. */
  state: number;
}

const s8 = (v: number) => ((v & 0xff) ^ 0x80) - 0x80;
const s16 = (v: number) => ((v & 0xffff) ^ 0x8000) - 0x8000;

/**
 * One ALIS script entity as a resumable coroutine: its own local memory
 * (`dir`/`loc` operands are both offsets into the entity's vram, signed),
 * program counter, call stack and `cstart` marker survive between
 * activations, exactly like the reference VM's per-entity context
 * (`alis.c` `alis_main_V2`: resume at `script_ret_offset`, run until
 * `cstop`). Its retained sprite list (`sprites`) follows the reference
 * element rules: a put of element `numelem` replaces that element's sprites
 * from earlier activations (`putfin`), `ccancall`/`cerasall` drop every
 * sprite, `cerasen n` drops element `n`.
 *
 * Scope: the opcodes a scene/backdrop script needs (arithmetic, branches,
 * `cjsr`/`cret`/`cstart`, `cswitch1`/`cswitch2`, `cloop`, `omaintc`
 * grid reads, local `cdim` arrays, the put family, mirroring, erase) are
 * modelled; screen/palette/sound/mouse opcodes are no-ops, and anything
 * else is recorded in `warnings` and skipped rather than throwing.
 */
export class AlisScriptRunner {
  pc: number | null;
  readonly callStack: number[] = [];
  /** `callStack` as the first `cstart` left it (`vram+0x0c` marker); later `cstart`s restore it. */
  private startMarker: number[] | null = null;
  readonly locals = new Map<number, number>();
  /** Local `cdim` arrays: base offset -> dims. */
  private readonly arrays = new Map<number, number[]>();
  xinv = 0;
  sleeping = false;
  dead = false;
  /** Number of activations run so far. */
  gen = 0;
  sprites: RetainedPlacement[] = [];
  readonly warnings: string[] = [];
  private readonly seenWarnings = new Set<string>();

  readonly data: Uint8Array;
  readonly name: string;

  constructor(data: Uint8Array, name = '', entry = scriptEntryPoint(data)) {
    this.data = data;
    this.name = name;
    this.pc = entry;
  }

  private warn(msg: string): void {
    if (!this.seenWarnings.has(msg)) {
      this.seenWarnings.add(msg);
      this.warnings.push(msg);
    }
  }

  /** Engine version the bytecode is decoded for (`decodeAlisInstr`): 20 for Ishar 1/2, 30 for Ishar 3 (its `cdim`/`cfreadb`/... operand shapes differ). */
  version = 20;

  /** Where the entity coordinates live (`ALIS_SCR_WCX/WCY/WCZ`): vram words 0/2/4, or 0/8/16 for engine version 3.0 (Ishar 3). */
  coordOffsets: readonly [number, number, number] = [0, 2, 4];

  /** Entity coordinates. */
  get coords(): { x: number; y: number; z: number } {
    const [ox, oy, oz] = this.coordOffsets;
    return { x: this.locals.get(ox) ?? 0, y: this.locals.get(oy) ?? 0, z: this.locals.get(oz) ?? 0 };
  }

  /** Run one activation (one reference-VM frame for this entity) until it yields (or reaches a `stopAt` address, for running one routine of a bigger script). Returns the yield kind and the puts made during it. */
  activate(env: SceneEnv, budget = STEP_BUDGET, stopAt?: ReadonlySet<number>): { yield: AlisYield; placements: PlacementCommand[]; steps: number } {
    if (this.dead || this.pc === null) return { yield: 'exit', placements: [], steps: 0 };
    this.gen++;
    const warn = (m: string) => this.warn(m);
    const locals = this.locals;
    const callStack = this.callStack;
    const placements: PlacementCommand[] = [];
    let acc = 0;
    let steps = 0;
    const pile: number[] = [];

    const localKey = (op: string, addr: number): number => (op.startsWith('oloc') || op.startsWith('sloc') || op.startsWith('aloc') ? s16(addr) : addr);

    const readVar = (op: string, addr: number): number => {
      switch (op) {
        case 'oimmb': case 'oimmw':
          return addr;
        case 'odirb': case 'odirw': case 'odirp': case 'olocb': case 'olocw': case 'olocp':
          return locals.get(localKey(op, addr)) ?? 0;
        case 'omainb': case 'omainw': case 'omainp':
          return env.readMain(addr);
        case 'ofree':
          return 0x7fff; // free-memory probe: the reference host always has room
        default:
          warn(`unmodeled value opname ${op}`);
          return 0;
      }
    };

    /** `tabchar()` over a local `cdim` array: element index = D7 + Σ dims[i] * pop(). */
    const localArrayIndex = (base: number, direct: number): number => {
      const dims = this.arrays.get(base);
      let idx = direct;
      if (dims) for (const d of dims) idx += d * (pile.pop() ?? 0);
      else warn(`local array 0x${base.toString(16)} read before its cdim`);
      return base + idx;
    };

    const readHim = (tok: Extract<AlisToken, { t: 'him' }>): number => {
      const h = locals.get(s16(tok.value)) ?? -1;
      if (env.readEntity) return env.readEntity(h, tok.offset);
      warn(`unmodeled entity read ${tok.op}`);
      return 0;
    };
    const evalToken = (tok: AlisToken): number => {
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
        case 'unary':
          return applyUnaryStep(tok.op, tok.arg);
        case 'eval':
          return runSteps(tok.steps);
        case 'him':
          return readHim(tok);
        default:
          warn(`unmodeled token ${tok.t}`);
          return 0;
      }
    };

    /**
     * One binary opername step `acc OP arg`. Reference semantics
     * (`maestun/alis` `opernames.c`): every binary opername copies D7 (the
     * accumulator) into D6, reads its operand into D7, then computes
     * `D6 OP D7` -- `acc OP operand` -- EXCEPT when the operand is `opile`
     * (`opernames.c:617`), which swaps them: `popped OP acc`.
     */
    const applyUnaryStep = (op: string, arg: AlisToken): number => {
      if (arg.t === 'nullary' && arg.op === 'opile') {
        const popped = pile.pop() ?? 0;
        return applyBinary(op, popped, acc, warn);
      }
      const rhs = evalToken(arg);
      return applyBinary(op, acc, rhs, warn);
    };

    const runSteps = (steps_: AlisToken[]): number => {
      for (const step of steps_) {
        if (step.t === 'imm') {
          if (typeof step.value === 'string') {
            warn(`string immediate in EVAL (${step.op})`);
            acc = 0;
            continue;
          }
          if (step.op === 'omaintc' || step.op === 'omainti') {
            acc = env.readGrid(step.value, () => pile.pop() ?? 0, acc, step.op === 'omainti' ? 2 : 1);
          } else if (step.op === 'odirtc' || step.op === 'oloctc' || step.op === 'odirti' || step.op === 'olocti') {
            acc = locals.get(localArrayIndex(localKey(step.op, step.value), acc)) ?? 0;
          } else {
            acc = readVar(step.op, step.value);
          }
        } else if (step.t === 'nullary') {
          if (step.op === 'opushacc') pile.push(acc);
          else if (step.op === 'oneg') acc = -acc;
          else if (step.op === 'oabs') acc = Math.abs(acc);
          else if (step.op === 'onot') acc = ~acc;
          else if (step.op === 'osgn') acc = Math.sign(acc);
          else if (step.op === 'opile') acc = pile.pop() ?? 0;
          else if (step.op === 'ofree') acc = 0x7fff;
          else if (step.op === 'oprnd') acc = seededRandom(pile.pop() ?? 0, acc);
          // `ornd`: the engine's shared generator, advanced by every script
          // that calls it, so crawl cannot reproduce its value; take the
          // middle of the range (Ishar 2/3 jitter a monster's or a
          // townsperson's x with it).
          else if (step.op === 'ornd') acc = (acc & 0xffff) >> 1;
          else warn(`unmodeled EVAL step opname ${step.op}`);
        } else if (step.t === 'unary') {
          acc = applyUnaryStep(step.op, step.arg);
        } else if (step.t === 'him') {
          acc = readHim(step);
        } else {
          warn(`unmodeled EVAL step shape ${step.t}`);
        }
      }
      return acc;
    };

    // readexec_opername(): v<60 truncates D7 to 16 bits after every top-level operand.
    const evalExpr = (tok: AlisToken): number => (acc = s16(tok.t === 'eval' ? runSteps(tok.steps) : evalToken(tok)));

    /** Store `v` to a store/add destination token (`op` = 'set' | 'add'). */
    const storeTo = (tok: AlisToken, v: number, mode: 'set' | 'add'): void => {
      if (tok.t === 'indexed') {
        // seval/aeval: the steps compute the element index into D7 (+ pile), then the array dest.
        const saved = acc;
        runSteps(tok.steps);
        const dest = tok.dest;
        if (dest.t === 'imm' && typeof dest.value === 'number' && /^[sa](dir|loc)t[ci]$/.test(dest.op)) {
          const key = localArrayIndex(localKey(dest.op, dest.value), acc);
          const nv = mode === 'add' ? (locals.get(key) ?? 0) + v : v;
          locals.set(key, dest.op.endsWith('c') ? s8(nv) : s16(nv));
        } else if (dest.t === 'imm' && typeof dest.value === 'number' && /^[sa]maint[ci]$/.test(dest.op) && env.writeTable) {
          // e.g. Ishar 1 ENCONT `+0x4a9`: `smaintc(0x3d54)[1]` = the monster in the front-centre slot
          const size = dest.op.endsWith('c') ? 1 : 2;
          const cur = mode === 'add' ? env.readGrid(dest.value, () => 0, acc, size) : 0;
          const nv = cur + v;
          env.writeTable(dest.value, acc, size === 1 ? s8(nv) : s16(nv), size);
        } else {
          warn(`unmodeled indexed destination ${dest.t === 'imm' ? dest.op : dest.t}`);
        }
        acc = saved;
        return;
      }
      if (tok.t === 'him') {
        const h = locals.get(s16(tok.value)) ?? -1;
        if (env.writeEntity) env.writeEntity(h, tok.offset, mode === 'add' ? (env.readEntity?.(h, tok.offset) ?? 0) + v : v);
        else warn(`unmodeled entity write ${tok.op}`);
        return;
      }
      if (tok.t !== 'imm' || typeof tok.value !== 'number') {
        warn(`unmodeled store destination ${tok.t}`);
        return;
      }
      const op = tok.op;
      if (/^[sa](dir|loc)[bwp]$/.test(op)) {
        const key = localKey(op, tok.value);
        const nv = mode === 'add' ? (locals.get(key) ?? 0) + v : v;
        locals.set(key, op.endsWith('b') ? s8(nv) : s16(nv));
      } else if (/^[sa]main[bwp]$/.test(op)) {
        if (env.writeMain) env.writeMain(tok.value, mode === 'add' ? env.readMain(tok.value) + v : v);
        else warn(`ignored write to main global 0x${tok.value.toString(16)}`);
      } else {
        warn(`unmodeled store destination ${op}`);
      }
    };

    // Sprites drawn by the previous frame are "old" (state 0) for this one.
    for (const sp of this.sprites) sp.state = 0;
    const dir = findIsharDirectory(this.data);
    const slotOf = (i: number) => (dir ? resolveIsharSlot(this.data, dir, i) : -1);
    /** First index of element `n`'s group, and the index just past it (the list is ordered by element number, descending). */
    const group = (n: number): [number, number] => {
      let a = 0;
      while (a < this.sprites.length && this.sprites[a]!.numelem > n) a++;
      let b = a;
      while (b < this.sprites.length && this.sprites[b]!.numelem === n) b++;
      return [a, b];
    };
    const put = (instr: AlisInstr, x: number, y: number, z: number, idx: number, numelem: number, mirrorOp: boolean): void => {
      const old = this.coords;
      const p: PlacementCommand = {
        op: instr.op as PlacementCommand['op'],
        x: old.x + x,
        y: old.y + y,
        z: old.z + z,
        idx,
        numelem,
        invertX: ((this.xinv & 1) ^ (mirrorOp ? 1 : 0)) === 1,
        addr: instr.addr,
      };
      placements.push(p);
      if (!dir || idx < 0 || idx >= dir.length) return;
      const h = slotOf(idx);
      const type = h >= 0 ? this.data[h]! : 0;
      if (type === 0xfe) return; // a palette: `topalette`, no sprite
      if (type <= 0x80) {
        // plain put (`fmuldes` = 0): reuse the FIRST sprite of this element,
        // whatever its state, else create one at the end of the group.
        const [a, b] = group(numelem);
        const sp: RetainedPlacement = { idx, x: p.x, y: p.y, z: p.z, numelem, invertX: p.invertX, state: -1 };
        if (b > a) {
          const prev = this.sprites[a]!;
          sp.state = prev.state > -1 ? 2 : prev.state;
          this.sprites[a] = sp;
        } else this.sprites.splice(b, 0, sp);
        return;
      }
      // composite: each leaf takes the next old (state 0) sprite of the
      // element, else a new one at the end of the group; then `putfin`
      // kills the element's old sprites that were not reused.
      for (const leaf of resolveIsharComposite(this.data, dir, idx, slotOf, p.invertX)) {
        const sp: RetainedPlacement = { idx: leaf.index, x: p.x + leaf.dx, y: p.y + leaf.dy, z: p.z + leaf.dz, numelem, invertX: leaf.invertX, state: -1 };
        const [a, b] = group(numelem);
        let k = a;
        while (k < b && this.sprites[k]!.state !== 0) k++;
        if (k < b) {
          sp.state = 2;
          this.sprites[k] = sp;
        } else this.sprites.splice(b, 0, sp);
      }
      this.sprites = this.sprites.filter((sp) => sp.numelem !== numelem || sp.state !== 0);
    };

    let pc: number | null = this.pc;
    let result: AlisYield = 'exit';
    run: while (pc !== null) {
      if (stopAt?.has(pc)) {
        result = 'stop';
        break;
      }
      if (++steps > budget) {
        warn('step budget exceeded -- aborting run');
        result = 'budget';
        break;
      }
      let instr: AlisInstr;
      try {
        instr = decodeAlisInstr(this.data, pc, this.version);
      } catch (e) {
        warn(`decode error at 0x${pc.toString(16)}: ${e instanceof Error ? e.message : String(e)}`);
        result = 'error';
        pc = null;
        break;
      }
      const next = instr.next[0] ?? null;

      switch (instr.op) {
        case 'cjmp':
          pc = instr.fields.target as number;
          continue;
        case 'cjsr':
          callStack.push(next as number);
          pc = instr.fields.target as number;
          continue;
        case 'cret':
          pc = callStack.pop() ?? null;
          continue;
        case 'cstart': {
          // opcodes.c cstart (fseq != 0): the first one pushes the return
          // address and remembers that stack depth; later ones reset the stack
          // to it. Either way, jump to the target.
          // (The reference only moves the stack pointer back to the marker;
          // the return address stored there is still in memory, so keep a copy.)
          if (this.startMarker === null) {
            callStack.push(next as number);
            this.startMarker = [...callStack];
          } else {
            callStack.length = 0;
            callStack.push(...this.startMarker);
          }
          pc = instr.fields.target as number;
          continue;
        }
        case 'cstop':
          pc = instr.end; // resumes here next frame (the disassembler's CFG ends the path)
          result = 'stop';
          break run;
        case 'cstopret':
          pc = callStack.pop() ?? null;
          result = pc === null ? 'exit' : 'stop';
          break run;
        case 'csleep':
          pc = instr.end;
          this.sleeping = true;
          result = 'sleep';
          break run;
        case 'cexit':
          pc = null;
          result = 'exit';
          break run;
        case 'cbz': case 'cbeq':
          pc = acc === 0 ? (instr.fields.target as number) : next;
          continue;
        case 'cbnz': case 'cbne':
          pc = acc !== 0 ? (instr.fields.target as number) : next;
          continue;
        case 'cloop': {
          // add -1 to the destination, branch while it is non-zero
          const dest = instr.fields.dest as AlisToken;
          storeTo(dest, -1, 'add');
          const v = dest.t === 'imm' && typeof dest.value === 'number' ? (locals.get(localKey(dest.op, dest.value)) ?? 0) : 0;
          pc = v !== 0 ? (instr.fields.target as number) : next;
          continue;
        }
        case 'ceval':
          acc = evalExpr(instr.fields.expr as AlisToken);
          break;
        case 'cstore': {
          const v = evalExpr(instr.fields.expr as AlisToken);
          acc = v;
          storeTo(instr.fields.dest as AlisToken, v, 'set');
          break;
        }
        case 'cadd': case 'csub': {
          const v = evalExpr(instr.fields.expr as AlisToken);
          storeTo(instr.fields.dest as AlisToken, instr.op === 'cadd' ? v : -v, 'add');
          break;
        }
        case 'cdim': {
          const off = instr.fields.off as number;
          this.arrays.set(off, (instr.fields.dims as number[]) ?? []);
          break;
        }
        case 'cswitch1': {
          const value = evalExpr(instr.fields.expr as AlisToken);
          acc = value;
          const cases = instr.fields.cases as Array<{ value: number; target: number }>;
          let target: number | null = next;
          for (const cs of cases) {
            if (value === cs.value) {
              target = cs.target;
              break;
            }
            if (value <= cs.value) break; // the reference's linear-scan cutoff (opcodes.c:713-737)
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
          pc = index >= 0 && index <= count ? targets[index]! : next;
          continue;
        }
        case 'cput': case 'cxput': {
          const idx = evalExpr(instr.fields.expr as AlisToken);
          put(instr, 0, 0, 0, idx, 0, instr.op === 'cxput');
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
          put(instr, x, y, z, idx, numelem, instr.op === 'cxputat');
          break;
        }
        case 'cxinv':
          this.xinv ^= 1;
          break;
        case 'cxinvon':
          this.xinv = 1;
          break;
        case 'cxinvoff':
          this.xinv = 0;
          break;
        case 'ccancall': case 'cerasall':
          this.sprites = [];
          break;
        case 'cerasen': {
          const n = evalExpr(instr.fields.expr as AlisToken);
          this.sprites = this.sprites.filter((sp) => sp.numelem !== n);
          break;
        }
        case 'clive': {
          const h = env.live ? env.live(instr.fields.id as number) : -1;
          if (!env.live) warn('clive without a scene (no entity started)');
          acc = h;
          if (instr.fields.dest) storeTo(instr.fields.dest as AlisToken, h, 'set');
          break;
        }
        // The entity list: the scene runs no other entities, so every list
        // is empty and these store its end marker (-1).
        case 'clistent': case 'crstent': case 'csuccent': case 'cpredent':
        // the entity tests and searches that end in `crstent`
        case 'cfindtyp': case 'cfindcla': case 'ctstmov': case 'cftstmov': case 'cftstset':
        case 'cvtstmov': case 'cvftstmov': case 'ctstform':
          acc = -1;
          storeTo(instr.fields.dest as AlisToken, -1, 'set');
          break;
        // Everything below is a no-op for computing which sprites go where.
        case 'cscreen': case 'cinteron': case 'cinteroff': case 'cscanon': case 'cscanoff': case 'cscanclr':
        case 'credon': case 'credoff': case 'clinking': case 'ccancel':
        case 'ccancen': case 'cblast': case 'cforme': case 'cdelforme': case 'cerase':
        case 'cpalette': case 'cdefcolor': case 'csetvect': case 'cdefvect': case 'cnul':
        case 'cnul37': case 'copensc': case 'cclosesc':
        case 'cscmov': case 'cscset': case 'cset': case 'cmov': case 'casleep':
        case 'casleepon': case 'casleepoff': case 'casleepfar': case 'ctstset':
        case 'cnearent': case 'cneartyp':
        case 'cnearmat': case 'cviewent': case 'cviewtyp': case 'cviewmat': case 'corient':
        case 'csend': case 'callentity': case 'ctiming': case 'czap': case 'cexplode': case 'cding':
        case 'cnoise': case 'cinitab': case 'cfopen': case 'cfclose': case 'cfwritev': case 'cfreadb':
        case 'cfwriteb': case 'cplot': case 'cdraw': case 'cbox': case 'cboxf': case 'cink': case 'cpmode':
        case 'cpicture': case 'cxyscroll': case 'cmouson': case 'cmousoff': case 'cmouse': case 'cdefmouse':
        case 'csetmouse': case 'capproach': case 'cescape': case 'cvmov':
        case 'cdefworld': case 'cworld': case 'cfindmat': case 'cmusic': case 'cdelmusic': case 'ccadence':
        case 'csetvolum': case 'csound': case 'cmsound': case 'cdelsound':
        case 'cmmusic': case 'cmforme': case 'csettime': case 'cgettime': case 'cvinput': case 'csinput':
        case 'crunfilm': case 'cvpicprint': case 'cvputprint': case 'cspicprint': case 'csputprint': case 'cfont':
        case 'cpaper': case 'ctoblack': case 'cmovcolor': case 'ctopalet': case 'cnumput': case 'cscheart':
        case 'cscpos': case 'cscsize': case 'cschoriz': case 'cscvertic': case 'cscreduce': case 'cscscale':
        case 'creducing': case 'cscmap': case 'cscdump': case 'cnearcla': case 'cviewcla':
        case 'cinstru': case 'cminstru': case 'cordspr': case 'calign': case 'cbackstar': case 'cstarring':
        case 'cengine': case 'cautobase': case 'cquality': case 'chsprite': case 'cselpalet': case 'clinepalet':
        case 'cautomode': case 'cautofile': case 'cscback': case 'cscrolpage': case 'cmatent': case 'cshrink':
        case 'csavepal': case 'csczoom': case 'calloctab': case 'cfreetab': case 'cscantab': case 'cneartab':
        case 'cscsun': case 'cdarkpal': case 'cscdark': case 'cscfollow': case 'cscview': case 'cfilm':
        case 'cpointpix': case 'czoom': case 'cload': case 'cunload': case 'cwakeup':
        case 'ckill': case 'cvprint': case 'csprinti': case 'csprinta': case 'clocate': case 'ctab':
        case 'crandom': case 'cleave': case 'cprotect': case 'cclock':
        case 'cwlive': case 'cswitching': case 'cclipping':
          break;
        default:
          warn(`unmodeled opcode ${instr.op} at 0x${instr.addr.toString(16)}`);
          break;
      }
      pc = next;
    }
    this.pc = pc;
    if (result === 'exit' || result === 'error') this.dead = true;
    return { yield: result, placements, steps };
  }

  /** Run activations until the script sleeps, exits or `maxFrames` frames pass (a `cstop` yield resumes on the next frame without a wake-up). */
  settle(env: SceneEnv, maxFrames = 8): AlisYield {
    let y: AlisYield = 'stop';
    for (let i = 0; i < maxFrames && !this.sleeping && !this.dead; i++) y = this.activate(env).yield;
    return y;
  }

  /** `cwakeup` from another entity: clear the sleep flag (the next frame resumes after the `csleep`). */
  wake(): void {
    this.sleeping = false;
  }
}

/**
 * One interpreter activation over a single decompressed script's bytecode,
 * starting at `entry` and running until the script's first yield (`cstop`/
 * `csleep`). Kept for single-frame callers; the persistent multi-script
 * scene lives in `ishar-scene.ts`.
 */
export function runIsharScene(data: Uint8Array, entry: number, env: SceneEnv): RunResult {
  const r = new AlisScriptRunner(data, '', entry);
  const { placements, steps } = r.activate(env);
  return { placements, warnings: r.warnings, steps };
}

/**
 * `oprnd`: a pseudo-random number below `range`, a pure function of
 * `seed` (the value popped from the eval stack), unlike `ornd`, which
 * advances the engine's shared generator. Behaviour measured against the
 * reference VM: the seed is rotated left by 10 bits (16-bit), mapped
 * through h = (h * 0x7ab7 - 0x77f) mod 2^16, and the result is the high
 * word of range * h. Ishar 1 ENCONT `+0x500` spreads a monster across the
 * view with it, seeded by the monster's slot number.
 */
export function seededRandom(seed: number, range: number): number {
  let h = seed & 0xffff;
  h = ((h << 10) | (h >>> 6)) & 0xffff;
  h = (Math.imul(h, 0x7ab7) - 0x77f) & 0xffff;
  return Math.floor(((range & 0xffff) * h) / 0x10000);
}

function applyBinary(op: string, lhs: number, rhs: number, warn: (m: string) => void): number {
  // opernames.c: comparisons yield -1/0, and/or/xor are bitwise on D7.
  switch (op) {
    case 'oadd': return lhs + rhs;
    case 'osub': return lhs - rhs;
    case 'omul': return Math.imul(lhs, rhs);
    case 'odiv': return rhs === 0 ? 0 : Math.trunc(lhs / rhs);
    case 'omod': return rhs === 0 ? 0 : lhs % rhs;
    case 'oand': return lhs & rhs;
    case 'oor': return lhs | rhs;
    case 'oxor': return lhs ^ rhs;
    case 'oeqv': return ~(lhs ^ rhs);
    case 'oegal': return lhs === rhs ? -1 : 0;
    case 'odiff': return lhs !== rhs ? -1 : 0;
    case 'oinfeg': return lhs <= rhs ? -1 : 0;
    case 'osupeg': return lhs >= rhs ? -1 : 0;
    case 'oinf': return lhs < rhs ? -1 : 0;
    case 'osup': return lhs > rhs ? -1 : 0;
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
