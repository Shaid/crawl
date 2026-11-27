/**
 * Wizardry 6 (Amiga) remake engine: the third implementation of tools/remake/engine.ts. A thin, UI-free layer over the harness-verified rules in `tools/wizardry6/*.ts`.
 * The party, the monster groups and every global the rules read live in one sparse byte image on the game's own A4 layout (`image.ts`: the relocated DATA hunk of the
 * user's `Bane`, SCENARIO.HDR, the maze blocks of scenario.dbs), so the rules run on it exactly as they ran in the Unicorn oracle. Combat runs through the verified round
 * (`CombatWorld.gameRound`, adopted over the engine's own memory: nothing is re-implemented); movement is `movement.ts tryMove` on the walker's level planes, followed by the
 * game's per-cell entity dispatch (`entities.ts dispatchEntities`), the scripted-spot test and the per-step world tick (`itemuse.ts stepTick`).
 * W6 is step based: a `step` consumes commands, never time; `step(st, [])` does nothing.
 *
 * Evidence grades in the notes as in docs/wizardry6/amiga/game-rules.md: harness = diffed against the retail 68k code, code = read from it, hyp = a guess, stub = the engine stands in.
 */
import { Mem, s16, type Effect } from '../combat';
import { CombatWorld, LAYOUT, type PartyPlan } from '../combat-sim';
import { W6Rng, levelsGained, levelUpAttributes, levelUpHpStamina, spellTierAfterLevel } from '../rules';
import { tryMove, rawWall, type MoveResult } from '../movement';
import { dispatchEntities, entityKind3, entityKind6, entityKind16, findEntity, markFired } from '../entities';
import { entityKind4, exploreEntry, scriptedTest, setRegion, zoneIndicator } from '../scripted';
import { encounterGroup, encounterMonster, getField } from '../randenc';
import { restParty, stepTick, disarmChest } from '../itemuse';
import { startEncounter, type EncounterIO } from '../encounter';
import { lootRoll, type LootItem } from '../endcombat';
import { giveItem, lootBlocksExit, removeListEntry, chestTreasureStep } from '../divvy';
import { chestTrap, pickTrap } from '../traps';
import { canAct, inspectChest, pickLock } from '../thief';
import { applyRuns, baseImage, diffRuns, freshMem, A4, L2_BASE, L2_STRIDE, L3_BASE, L3_STRIDE, LEVELS, SEC1, SEC4, SEC7 } from './image';
import { parseLevel, type W6Level } from './levels';
import { CLASS_NAMES, RACE_NAMES, STARTER_PARTY, writeCharacter, type CharTemplate } from './party';
import type { Ctx } from '../planner';
import type { Engine, FileSet, Detection, CoverageRow } from '../../remake/engine';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** the user's own files: exact sizes of the Amiga release (`Bane` is the executable, the rest the game's data files) */
export const REQUIRED: Record<string, number> = { 'Bane': 354372, 'scenario.dbs': 188980, 'scenario.hdr': 414 };

export interface W6World {
  base: Map<number, number>;
  scenario: Uint8Array;
  levels: W6Level[];
  /** the 14 class XP tables (scenario.dbs section 0: 16 big-endian longs each) */
  xp: number[][];
  /** message text by id (4000 + spell id = spell name, 5300 + trap id = trap name); absent = names fall back to ids */
  msg?: (id: number) => string | undefined;
}

export type Dir = 'forward' | 'back' | 'left' | 'right';
export type W6Cmd =
  | { kind: 'move'; dir: Dir }
  | { kind: 'turn'; by: 1 | -1 }
  | { kind: 'camp' }
  | { kind: 'pickLock'; who: number }
  /** combat orders for one member, used by the next `round` (an unordered member attacks the first living monster) */
  | { kind: 'plan'; member: number; plan: PartyPlan }
  /** the same order for every member (the shell's one-key run / hide) */
  | { kind: 'planAll'; plan: PartyPlan }
  | { kind: 'round' }
  | { kind: 'take'; who: number; index: number }
  | { kind: 'takeAll' }
  | { kind: 'leaveLoot' }
  | { kind: 'chestInspect'; who: number }
  | { kind: 'chestDisarm'; who: number; trap: number }
  | { kind: 'chestOpen'; who: number }
  | { kind: 'chestLeave' }
  /** debug / stub entry points for what the entity kinds would do */
  | { kind: 'encounter'; id?: number }
  | { kind: 'chest'; trapMask?: number; treasure?: number }
  | { kind: 'warp'; level: number; x: number; y: number; facing?: number };

export type W6Event = { tick: number; what: string; [k: string]: unknown };
export type Mode = 'explore' | 'combat' | 'loot' | 'chest' | 'over';
export interface Pose { level: number; x: number; y: number; facing: number }

export interface FightInfo {
  round: number;
  scripted: boolean;
  /** monster ids of the groups as created at the start */
  ids: number[];
  /** orders given for the next round, by party slot */
  plans: (PartyPlan | null)[];
}
export interface ChestInfo { trap: number; treasure: number; disarmed: boolean; sprung: boolean }

export interface W6State {
  world: W6World;
  seed: number;
  tick: number;
  m: Mem;
  rng: W6Rng;
  mode: Mode;
  pose: Pose;
  /** where the party stood before its last step (the retreat after a successful run, hyp) */
  prev: Pose | null;
  fight: FightInfo | null;
  chest: ChestInfo | null;
  /** does turning in place also run the world tick? (code reading of LAB_08A7 says yes, not confirmed in play; default off) */
  tickOnTurn: boolean;
}

export interface W6NewGame { party?: CharTemplate[]; tickOnTurn?: boolean; level?: number; x?: number; y?: number; facing?: number }

const G = (d: number): number => A4 + d;
const CHEST_ADDR = 0x4a0000;
const ctx = (st: W6State): Ctx => ({ m: st.m, rng: st.rng, a4: A4 });
const P = (i: number): number => A4 - 17922 + i * 0x1b0;
const cstr = (m: Mem, a: number, max: number): string => { let s = ''; for (let k = 0; k < max; k++) { const c = m.u8(a + k); if (c === 0) break; s += String.fromCharCode(c); } return s; };

/** seed -> the three 16-bit words of the game's generator (`W6Rng`). The original seeds from the clock (its seed source was not traced, TODO w6-rng-seed), so any mapping is the engine's own: splitmix32. */
export function seedToRng(seed: number): [number, number, number] {
  let z = seed >>> 0;
  const next = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z; t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0; t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
    return (t ^ (t >>> 16)) >>> 0;
  };
  return [1 + (next() % 30268), 1 + (next() % 30306), 1 + (next() % 30322)];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const itemRecord = (w: W6World, id: number): Uint8Array => w.scenario.subarray(SEC1.off + id * SEC1.size, SEC1.off + (id + 1) * SEC1.size);
const be16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
export const itemRec = (w: W6World) => (id: number) => { const r = itemRecord(w, id); return { w28: be16(r, 28), b60: r[60], b69: r[69] }; };
export const lootItem = (w: W6World) => (id: number): LootItem => { const r = itemRecord(w, id); return { w20: be16(r, 20), b22: r[22], b23: r[23], w30: be16(r, 30), b59: r[59], b60: r[60], b61: r[61] }; };
const itemName = (w: W6World, id: number): string => { const r = itemRecord(w, id); let s = ''; for (let k = 0; k < 20 && r[k]; k++) s += String.fromCharCode(r[k]); return s || `#${id}`; };

/** the loader the game's LoadRecord is: scenario section 4 (250 x 222 bytes) into the group's record slot */
function encounterIO(st: W6State): EncounterIO {
  const sc = st.world.scenario;
  return {
    loadMonster: (id, dest) => { for (let k = 0; k < SEC4.size; k++) st.m.w8(dest + k, sc[SEC4.off + id * SEC4.size + k]); },
    formation: () => 0,
    picture: () => undefined,
  };
}

const level = (st: W6State): W6Level => st.world.levels[st.pose.level];
const regionAt = (L: W6Level, x: number, y: number): number => L.planes.region?.[y * L.width + x] ?? -1;

/** write the party position into the game's globals (level, region, local x/y, facing, absolute maze x/y, the level-block pointers) */
function syncPose(st: W6State): void {
  const m = st.m, L = level(st), { x, y } = st.pose;
  const region = regionAt(L, x, y), o = L.links.regionOrigin[region];
  m.w16(G(-18340), st.pose.level);
  m.w16(G(-18330), region < 0 ? 0 : region);
  m.w16(G(-18334), o ? x - o.x : 0); m.w16(G(-18332), o ? y - o.y : 0);
  m.w16(G(-18328), st.pose.facing);
  m.w16(G(-18338), L.origin.x + x); m.w16(G(-18336), L.origin.y + y);
  m.w32(G(-18462), L2_BASE + st.pose.level * L2_STRIDE);
  m.w32(G(-18458), L3_BASE + st.pose.level * L3_STRIDE);
  m.w32(G(-18306), G(-15102));
}

/** LAB_073F (CODE+0x103e8): the level load. The transient trigger table is reloaded from the persistent one, the scripted-spot bit-map is cleared and each armed spot floods its region. */
function enterLevel(st: W6State, lv: number): void {
  const m = st.m;
  st.pose.level = lv;
  syncPose(st);
  for (let k = 0; k < 10; k++) m.w8(G(-18290) + lv * 10 + k, m.u8(G(-30310) + lv * 10 + k));
  for (let k = 0; k < 96; k++) m.w8(G(-18018) + k, 0);
  const c = ctx(st), blk = L2_BASE + lv * L2_STRIDE;
  for (let r = 0; r < 12; r++) for (let k = 0; k < 5; k++) {
    const sx = getField(c, blk + 1274, r * 5 + k, 3), sy = getField(c, blk + 1298, r * 5 + k, 3);
    if (sx + sy > 0) setRegion(c, r, sx, sy, 1);
  }
}

const doorsFromMem = (m: Mem): number[] => [0, 1, 2, 3].map(d => m.u16(G(-18146 + 2 * d)));
const setDoors = (m: Mem, d: number[]): void => d.forEach((v, k) => m.w16(G(-18146 + 2 * k), v));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
type Emit = (what: string, extra?: Record<string, unknown>) => void;

function emitFx(st: W6State, fx: Effect[], emit: Emit): void {
  for (const [name, hex] of fx) {
    if (name === 'LAB_05B1') emit('message', { id: parseInt(hex.slice(0, 4), 16), text: st.world.msg?.(parseInt(hex.slice(0, 4), 16)) });
    else if (name === 'LAB_078D') emit('message', { id: parseInt(hex.slice(0, 4), 16), text: st.world.msg?.(parseInt(hex.slice(0, 4), 16)) });
    else if (name === 'LAB_0A1E') emit('member-died', { member: parseInt(hex.slice(0, 4), 16), name: charName(st.m, parseInt(hex.slice(0, 4), 16)) });
  }
}

function charName(m: Mem, i: number): string { return cstr(m, P(i), 10); }
const partySize = (m: Mem): number => s16(m.u16(G(-15306)));

/** the entity kinds the engine runs. Kinds 3, 4, 5, 6, 16 are harness-verified; 1 and 7 are the position / door arms of the walker's own `arrive`; the others are STUBS (an event is reported, nothing happens). */
function runEntity(st: W6State, emit: Emit, name: string, fx: Effect[], args?: string): void {
  const c = ctx(st), m = st.m, B = L3_BASE + st.pose.level * L3_STRIDE;
  const idx = s16(m.u16(G(-18148)));
  switch (name) {
    case 'LAB_05D4': {   // kind 1: teleport. Sub-type 3 and anything above 6 do nothing; the mark mode is bits 10-11 of the entity word; the facing is never written.
      const sub = m.u16(B + 2 * idx), w = m.u16(B + 576 + 2 * idx);
      if (sub === 3 || sub > 6) return;
      markFired(c, (w >> 10) & 3);
      const dest = level(st).links.teleportDest[idx];
      if (!dest) { m.w16(G(-18610), 9); return; }
      setDoors(m, [0, 0, 0, 0]);
      emit('teleport', { to: dest.level === st.pose.level ? null : dest.level, x: dest.x, y: dest.y });
      st.pose = { level: dest.level, x: dest.x, y: dest.y, facing: st.pose.facing };
      return;
    }
    case 'LAB_05EA': {   // kind 7: per-direction door state; the mark mode is bits 5-6 of the operand byte
      const w = m.u16(B + 576 + 2 * idx);
      setDoors(m, [0, 1, 2, 3].map(d => (w >> (d * 2)) & 3));
      markFired(c, (m.u8(B + 1584 + idx) >> 5) & 3);
      return;
    }
    case 'LAB_05DA': entityKind3(c, fx); return;
    case 'LAB_062B': entityKind16(c, fx); return;
    case 'LAB_0685': entityKind6(c); return;
    case 'LAB_062F': entityKind4(c, fx); return;
    case 'LAB_05B1': fx.push(['LAB_05B1', args ?? '']); return;
    default: emit('entity-unmodelled', { routine: name, kind: m.u8(B + 864 + idx) });
  }
}

/** the per-cell entity scan LAB_06B6 followed by what its handlers asked for (a teleport re-scans at the destination, an encounter ends the scan) */
function scanCell(st: W6State, emit: Emit): boolean {
  const m = st.m;
  for (let guard = 0; guard < 1; guard++) {
    const startLevel = st.pose.level;
    syncPose(st);
    const blk = L3_BASE + st.pose.level * L3_STRIDE, region = m.u16(G(-18330));
    m.w16(G(-18148), m.u8(blk + 1728 + region));
    m.w16(G(-18610), 5);
    const fx: Effect[] = [];
    let moved = false;
    dispatchEntities(ctx(st), (name, f, args) => {
      const before = `${st.pose.level},${st.pose.x},${st.pose.y}`;
      runEntity(st, emit, name, f, args);
      if (`${st.pose.level},${st.pose.x},${st.pose.y}` !== before) {
        moved = true;
        // a teleport: the game's scan restarts at the destination (the handler clears the continue flag, -10918)
        m.w16(G(-10918), 0);
        if (st.pose.level !== startLevel) enterLevel(st, st.pose.level); else syncPose(st);
        m.w16(G(-18148), m.u8(L3_BASE + st.pose.level * L3_STRIDE + 1728 + m.u16(G(-18330))));
      }
    }, fx);
    emitFx(st, fx, emit);
    void moved;
    const state = s16(m.u16(G(-18610)));
    if (state === 5) return true;
    if (state === 10 || state === 0x12) return false;
    if (state === 0x15) { emit('event-state', { operand: s16(m.u16(G(-15296))), note: 'shop / event screens are not modelled (stub)' }); m.w16(G(-18610), 5); return true; }
    m.w16(G(-18610), 5);   // 9: the scan ended
    return true;
  }
  return true;
}

/** a fight starts for the id in -15102 (written by a trigger or a wandering roll) */
function beginFight(st: W6State, emit: Emit): void {
  const m = st.m, c = ctx(st);
  for (let g = 0; g < 7; g++) {
    m.w16(G(-15266 + 4 * g), LAYOUT.memBase >> 16); m.w16(G(-15264 + 4 * g), (LAYOUT.memBase + g * LAYOUT.memStride) & 0xffff);
    m.w16(G(-15294 + 4 * g), LAYOUT.recBase >> 16); m.w16(G(-15292 + 4 * g), (LAYOUT.recBase + g * LAYOUT.recStride) & 0xffff);
  }
  const np = partySize(m);
  m.w8(G(-15305), np);
  const scripted = s16(m.u16(G(-15100))) > 0;
  const ids: number[] = [];
  const io = encounterIO(st);
  const load = io.loadMonster;
  io.loadMonster = (id, dest) => { ids.push(id); load(id, dest); };
  startEncounter(c, io);
  m.w16(G(-18610), 0xd);
  for (let i = 0; i < np; i++) m.w8(LAYOUT.memBase + i * 44 + 0x26, PARTY_AC);   // armour class: stub, see coverage()
  st.fight = { round: 0, scripted, ids, plans: Array.from({ length: np }, () => null) };
  st.mode = 'combat';
  emit('encounter', { scripted, groups: groupsView(st).map(g => ({ name: g.name, count: g.count })) });
}
/** the party's armour class byte while the equipment-derived AC is not modelled (lower is better) */
const PARTY_AC = 5;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const groupCount = (st: W6State): number => s16(st.m.u16(G(-15140)));
const gb = (g: number): number => LAYOUT.memBase + g * LAYOUT.memStride;
const gr = (g: number): number => LAYOUT.recBase + g * LAYOUT.recStride;

export interface GroupView { name: string; count: number; living: number; hp: number[]; id: number }
function groupsView(st: W6State): GroupView[] {
  const m = st.m, out: GroupView[] = [];
  for (let g = 1; g <= groupCount(st); g++) {
    const n = m.u8(gb(g) + 413), flag = m.u8(gb(g) + 412);
    const name = cstr(m, gr(g) + (flag << 5) + (n === 1 ? 0 : 16), 16);
    const hp: number[] = [];
    for (let i = 0; i < n; i++) hp.push(m.s16(gb(g) + i * 44 + 2));
    out.push({ name, count: n, living: Array.from({ length: n }, (_, i) => i).filter(i => m.u8(gb(g) + i * 44 + 0x22) < 3 && m.s16(gb(g) + i * 44 + 2) > 0).length, hp, id: m.u8(gb(g) + 410) });
  }
  return out;
}

/** a CombatWorld over THIS state's memory and generator (nothing is copied): the verified round, hide/run, end-of-fight chain run through it */
function adopt(st: W6State): CombatWorld {
  const m = st.m;
  const sizes = Array.from({ length: groupCount(st) }, (_, k) => m.u8(gb(k + 1) + 413));
  const w = Object.create(CombatWorld.prototype) as CombatWorld;
  Object.assign(w, {
    mem: m, rng: st.rng, partySize: partySize(m), groupSizes: sizes, log: [], evaded: [], groupIds: st.fight?.ids ?? [], io: encounterIO(st), casts: [], breaths: [], flee: [], castFx: [],
    itemRec: itemRec(st.world), actions: [],
  });
  return w;
}

function memberLabel(st: W6State, s: string): string {
  const [g, i] = s.split('.').map(Number);
  if (g === 0) return charName(st.m, i);
  const gv = groupsView(st)[g - 1];
  return gv ? `${gv.name}${gv.count > 1 ? ' ' + (i + 1) : ''}` : s;
}

function levelUps(st: W6State, emit: Emit): void {
  const m = st.m, np = partySize(m);
  for (let i = 0; i < np; i++) {
    const p = P(i);
    if (m.u8(p + 417) !== 0) continue;
    const cls = m.u8(p + 415), table = st.world.xp[cls];
    const n = levelsGained(table, m.u16(p + 36), m.u32(p + 12) | 0);
    for (let k = 0; k < n; k++) {
      const lvl = m.u16(p + 36) + 1;
      m.w16(p + 36, lvl);
      const attrs = Array.from({ length: 8 }, (_, a) => m.u8(p + 300 + a));
      const g = levelUpHpStamina(st.rng, cls, attrs[0], attrs[3], lvl, m.u8(p + 431));
      m.w16(p + 24, m.u16(p + 24) + g.hp); m.w16(p + 26, m.u16(p + 26) + g.hp);
      m.w16(p + 28, m.u16(p + 28) + g.stamina); m.w16(p + 30, m.u16(p + 30) + g.stamina);
      levelUpAttributes(st.rng, attrs);
      attrs.forEach((v, a) => m.w8(p + 300 + a, v));
      m.w8(p + 416, spellTierAfterLevel(lvl, m.u8(p + 416)));
      emit('level-up', { member: i, name: charName(m, i), level: lvl, hp: g.hp, stamina: g.stamina });
    }
  }
}

function endFight(st: W6State, emit: Emit, w: CombatWorld): void {
  const m = st.m;
  const id = s16(m.u16(G(-15296)));
  let treasure: { rec: Uint8Array; item: (id: number) => LootItem } | undefined;
  if (id !== -1 && id >= 0 && id < 200) treasure = { rec: st.world.scenario.subarray(SEC7.off + id * SEC7.size, SEC7.off + (id + 1) * SEC7.size), item: lootItem(st.world) };
  const pool = m.u32(G(-15300)) | 0;
  const { victory, fx } = w.finishFight(treasure);
  emitFx(st, fx, emit);
  const gold0 = 0; void gold0;
  st.fight = null;
  if (s16(m.u16(G(-18608))) === 8 || !Array.from({ length: partySize(m) }, (_, i) => m.u8(P(i) + 417)).some(c => c === 0)) {
    st.mode = 'over'; emit('party-wiped'); return;
  }
  if (victory) {
    emit('victory', { xpPool: pool });
    levelUps(st, emit);
    if (s16(m.u16(G(-3114))) > 0) { st.mode = 'loot'; emit('loot', { items: lootList(st).map(l => l.name) }); return; }
  }
  toExplore(st, emit, false);
}

/** back on the map after a fight / loot: the entry half of LAB_08A7 (clears the cell's scripted region unless the party fled, state 0x17), which can itself start the scripted fight again */
function toExplore(st: W6State, emit: Emit, fled: boolean): void {
  const m = st.m;
  if (fled) {
    if (st.prev) { const p = st.prev; if (p.level !== st.pose.level) { st.pose = { ...p }; enterLevel(st, p.level); } else st.pose = { ...p }; emit('retreat', { x: st.pose.x, y: st.pose.y }); }
    m.w16(G(-18608), 0x17);
  }
  st.mode = 'explore';
  syncPose(st);
  const fx: Effect[] = [];
  const started = exploreEntry(ctx(st), fx);
  if (started) { emit('scripted-spot'); beginFight(st, emit); }
}

export interface LootEntry { id: number; name: string; qty: number; mustTake: boolean }
function lootList(st: W6State): LootEntry[] {
  const m = st.m, n = s16(m.u16(G(-3114)));
  return Array.from({ length: Math.max(0, n) }, (_, k) => { const id = m.u16(G(-5446 + 2 * k)); return { id, name: itemName(st.world, id), qty: m.u16(G(-8674 + 2 * k)), mustTake: m.u16(G(-3100 + 2 * k)) === 1 }; });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function doRound(st: W6State, emit: Emit): void {
  const f = st.fight!, m = st.m;
  const w = adopt(st);
  w.partyPolicy = (_w, i) => f.plans[i] ?? { act: 'attack' };
  const np = partySize(m);
  w.gameRound();
  f.round++;
  for (const l of w.log) emit('attack', { actor: memberLabel(st, l.actor), target: memberLabel(st, l.target), kind: l.kind, damage: Math.max(0, l.hpBefore - l.hpAfter), killed: l.killed });
  for (const c of w.casts) emit('cast', { actor: memberLabel(st, c.actor), spell: c.spell, name: st.world.msg?.(4000 + c.spell), power: c.power, target: c.target, fizzled: c.fizzled, backfired: c.backfired });
  for (const b of w.breaths) emit('breath', { actor: memberLabel(st, b.actor), type: b.type });
  for (const x of w.flee) emit(x.act, { actor: memberLabel(st, x.actor), ok: x.ok });
  for (const a of w.actions) emit(a.act, { actor: memberLabel(st, a.actor) });
  f.plans = Array.from({ length: np }, () => null);
  const fled = w.hasFled();
  const monstersLeft = groupsView(st).some(g => g.living > 0);
  const partyLeft = Array.from({ length: np }, (_, i) => m.u8(LAYOUT.memBase + i * 44 + 0x22) < 3 && m.s16(LAYOUT.memBase + i * 44 + 2) > 0).filter(Boolean).length;
  if (fled) {
    const wp = adopt(st);
    wp.finishFight();   // upkeep and sort for the fled party (no treasure)
    st.fight = null;
    emit('fled');
    toExplore(st, emit, true);
    return;
  }
  if (!monstersLeft || partyLeft === 0) endFight(st, emit, adopt(st));
}

function doCamp(st: W6State, emit: Emit): void {
  const c = ctx(st), fx: Effect[] = [];
  const interrupted = restParty(c, fx) === 1;
  emit('camp', { interrupted });
  if (interrupted) startWandering(st, emit);
}
/** a wandering encounter: the pick (harness) and its start; also what stepTick does inline */
function startWandering(st: W6State, emit: Emit): void {
  const m = st.m, c = ctx(st);
  const id = encounterMonster(c, encounterGroup(c, s16(m.u16(G(-18330)))));
  m.w16(m.u32(G(-18306)), id);
  m.w16(G(-15100), 0); m.w16(G(-15128), 0); m.w16(G(-18610), 10);
  emit('wandering', { id });
  beginFight(st, emit);
}

const REL: Record<Dir, number> = { forward: 0, right: 1, back: 2, left: 3 };

function doMove(st: W6State, dir: Dir, emit: Emit): void {
  const L = level(st), m = st.m;
  const r: MoveResult = tryMove(L.planes, L.links, st.pose.x, st.pose.y, (st.pose.facing + REL[dir]) & 3, st.pose.facing, doorsFromMem(m), false);
  if (r.kind === 'death') {
    for (let i = 0; i < partySize(m); i++) { m.w8(P(i) + 417, 3); m.w16(P(i) + 24, 0); }
    st.mode = 'over';
    emit('death', { message: r.message, text: st.world.msg?.(r.message) });
    return;
  }
  if (r.kind !== 'moved') { emit(r.kind, { message: r.message, text: r.message ? st.world.msg?.(r.message) : undefined }); return; }
  st.prev = { ...st.pose };
  st.pose = { level: st.pose.level, x: r.x, y: r.y, facing: st.pose.facing };
  setDoors(m, [0, 0, 0, 0]);
  if (r.doorOpened) emit('door-open');
  if (r.warped) emit('warp', { x: r.x, y: r.y });
  emit('step', { x: r.x, y: r.y });
  afterStep(st, emit);
}

/** everything after a movement command: entity scan, scripted-spot test, the world tick, the zone message */
function afterStep(st: W6State, emit: Emit): void {
  const m = st.m, c = ctx(st);
  if (!scanCell(st, emit)) { beginFight(st, emit); return; }
  syncPose(st);
  if (scriptedTest(c)) { emit('scripted-spot'); beginFight(st, emit); return; }
  const fx: Effect[] = [];
  if (!stepTick(c, fx)) {
    emitFx(st, fx, emit);
    const state = s16(m.u16(G(-18610)));
    if (state === 8) { st.mode = 'over'; emit('party-wiped'); return; }
    if (state === 10) { emit('wandering', { id: m.u16(m.u32(G(-18306))) }); beginFight(st, emit); return; }
  }
  emitFx(st, fx, emit);
  const zf: Effect[] = []; zoneIndicator(c, zf); emitFx(st, zf, emit);
  m.w16(G(-18610), 5);
}

function doPickLock(st: W6State, who: number, emit: Emit): void {
  const m = st.m, c = ctx(st), fx: Effect[] = [];
  syncPose(st);
  const face = st.pose.facing;
  const doors = doorsFromMem(m);
  if (doors[face] !== 1 && doors[face] !== 2) { emit('no-lock'); return; }
  if (canAct(c, who, fx) === 0) { emit('cannot-act', { who }); return; }
  const blk = L3_BASE + st.pose.level * L3_STRIDE;
  const idx = findEntity(c, m.u16(G(-18334)), m.u16(G(-18332)), m.u16(G(-18330)), m.u8(blk + 1728 + m.u16(G(-18330))));
  if (idx < 0) { emit('no-lock'); return; }
  const res = pickLock(c, who, idx, { keyAvailable: () => 1, key: () => 0x0d, timer: () => 0 }, fx);
  emit(res === 0 ? 'lock-opened' : res === 1 ? 'lock-failed' : 'lock-stuck', { who });
}

// ---- chest (the entity kinds that place chests are open: this is the verified decision chain behind a debug entry point) -------------------------------------------------------
function startChest(st: W6State, mask: number, treasure: number, emit: Emit): void {
  const m = st.m, c = ctx(st), fx: Effect[] = [];
  for (let k = 0; k < 40; k++) m.w8(CHEST_ADDR + k, 0);
  m.w8(CHEST_ADDR + 36, mask & 0xff); m.w8(CHEST_ADDR + 37, (mask >> 8) & 0xff);
  pickTrap(c, CHEST_ADDR, fx);
  const trap = m.u16(G(-3236));
  const name = st.world.msg?.(5300 + trap) ?? `TRAP ${trap}`;
  for (let k = 0; k < 20; k++) m.w8(G(-3214) + k, k < name.length ? name.charCodeAt(k) : 0);
  for (let k = 0; k < 20; k++) m.w8(G(-3194) + k, 0);
  m.w16(G(-3134), 0);
  m.w16(G(-15296), treasure);
  st.chest = { trap, treasure, disarmed: false, sprung: false };
  st.mode = 'chest';
  emit('chest', {});
}
function springTrap(st: W6State, who: number, emit: Emit): void {
  const fx: Effect[] = [];
  chestTrap(ctx(st), st.chest!.trap, who, fx);
  st.chest!.sprung = true;
  emit('trap', { trap: st.chest!.trap, name: st.world.msg?.(5300 + st.chest!.trap) });
  if (!Array.from({ length: partySize(st.m) }, (_, i) => st.m.u8(P(i) + 417)).some(c => c === 0)) { st.mode = 'over'; st.chest = null; emit('party-wiped'); }
}
function doChest(st: W6State, cmd: W6Cmd, emit: Emit): void {
  const c = ctx(st), m = st.m, fx: Effect[] = [], ch = st.chest!;
  switch (cmd.kind) {
    case 'chestInspect': {
      if (canAct(c, cmd.who, fx) === 0) { emit('cannot-act', { who: cmd.who }); return; }
      inspectChest(c, 0, cmd.who, fx);
      const n = s16(m.u16(G(-3134)));
      emit('inspect', { who: cmd.who, letters: Array.from({ length: n }, (_, k) => String.fromCharCode(m.u8(G(-3194) + k))).join('') });
      return;
    }
    case 'chestDisarm': {
      if (ch.disarmed) { emit('already-disarmed'); return; }
      if (canAct(c, cmd.who, fx) === 0) { emit('cannot-act', { who: cmd.who }); return; }
      const r = disarmChest(c, cmd.who, cmd.trap);
      if (r === 1) { ch.disarmed = true; emit('disarmed', { who: cmd.who }); }
      else if (r === -1) { emit('disarm-failed', { who: cmd.who }); if (!ch.sprung) springTrap(st, cmd.who, emit); }
      else emit('disarm-retry', { who: cmd.who });
      return;
    }
    case 'chestOpen': {
      if (!ch.disarmed && !ch.sprung) springTrap(st, cmd.who, emit);   // hyp: opening an armed chest springs its trap (the open handler CODE+0x4fb10 is read, not run)
      if (st.mode !== 'chest') return;
      chestTreasureStep(c, fx);
      const id = ch.treasure;
      lootRoll(c, st.world.scenario.subarray(SEC7.off + id * SEC7.size, SEC7.off + (id + 1) * SEC7.size), lootItem(st.world), fx);
      emit('chest-opened');
      st.chest = null;
      levelUps(st, emit);
      if (s16(m.u16(G(-3114))) > 0) { st.mode = 'loot'; emit('loot', { items: lootList(st).map(l => l.name) }); } else st.mode = 'explore';
      return;
    }
    case 'chestLeave': st.chest = null; st.mode = 'explore'; emit('chest-left'); return;
    default: return;
  }
}

function doLoot(st: W6State, cmd: W6Cmd, emit: Emit): void {
  const c = ctx(st), m = st.m;
  if (cmd.kind === 'take') {
    const list = lootList(st);
    if (cmd.index < 0 || cmd.index >= list.length || m.u8(P(cmd.who) + 417) !== 0) { emit('refused', { why: 'take' }); return; }
    const r = giveItem(c, cmd.who, cmd.index, lootItem(st.world));
    if (r === -1) { emit('pack-full', { who: cmd.who }); return; }
    emit('taken', { who: cmd.who, name: list[cmd.index].name });
    removeListEntry(c, cmd.index);
  } else if (cmd.kind === 'takeAll') {
    // policy (hyp, the divvy screen's input loop is UI): each item to the first healthy member whose pack has room, starting with member 0
    for (let n = 0; n < 40 && s16(m.u16(G(-3114))) > 0; n++) {
      const name = lootList(st)[0].name;
      let ok = false;
      for (let who = 0; who < partySize(m) && !ok; who++) if (m.u8(P(who) + 417) === 0 && giveItem(c, who, 0, lootItem(st.world)) !== -1) { ok = true; emit('taken', { who, name }); removeListEntry(c, 0); }
      if (!ok) { emit('pack-full', {}); break; }
    }
  }
  if (cmd.kind === 'leaveLoot' || s16(m.u16(G(-3114))) === 0) {
    if (lootBlocksExit(c)) { emit('loot-blocked', { message: 0x13f5 }); return; }
    m.w16(G(-3114), 0);
    toExplore(st, emit, false);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function stepCmd(st: W6State, cmd: W6Cmd, emit: Emit): void {
  const refuse = (why: string) => emit('refused', { why, cmd: cmd.kind });
  switch (st.mode) {
    case 'over': return refuse('game over');
    case 'combat':
      if (cmd.kind === 'plan') { if (cmd.member >= 0 && cmd.member < st.fight!.plans.length) st.fight!.plans[cmd.member] = cmd.plan; else refuse('no such member'); return; }
      if (cmd.kind === 'planAll') { st.fight!.plans = st.fight!.plans.map(() => cmd.plan); return; }
      if (cmd.kind === 'round') return doRound(st, emit);
      return refuse('in combat');
    case 'loot':
      if (cmd.kind === 'take' || cmd.kind === 'takeAll' || cmd.kind === 'leaveLoot') return doLoot(st, cmd, emit);
      return refuse('loot screen');
    case 'chest':
      if (cmd.kind === 'leaveLoot') return doChest(st, { kind: 'chestLeave' }, emit);
      if (cmd.kind === 'chestInspect' || cmd.kind === 'chestDisarm' || cmd.kind === 'chestOpen' || cmd.kind === 'chestLeave') return doChest(st, cmd, emit);
      return refuse('at a chest');
    default: break;
  }
  switch (cmd.kind) {
    case 'move': return doMove(st, cmd.dir, emit);
    case 'turn':
      st.pose.facing = (st.pose.facing + cmd.by) & 3; syncPose(st); emit('turn', { facing: st.pose.facing });
      if (st.tickOnTurn) afterStep(st, emit);
      return;
    case 'camp': return doCamp(st, emit);
    case 'pickLock': return doPickLock(st, cmd.who, emit);
    case 'encounter': {
      syncPose(st);
      if (cmd.id === undefined) { startWandering(st, emit); return; }
      st.m.w16(st.m.u32(G(-18306)), cmd.id);
      st.m.w16(G(-15100), 0); st.m.w16(G(-15128), 0); st.m.w16(G(-18610), 10);
      return beginFight(st, emit);
    }
    case 'chest': return startChest(st, cmd.trapMask ?? 0xfffe, cmd.treasure ?? 1, emit);
    case 'warp': {
      st.pose = { level: cmd.level, x: cmd.x, y: cmd.y, facing: cmd.facing ?? st.pose.facing }; st.prev = null;
      enterLevel(st, cmd.level); toExplore(st, emit, false); emit('warp', { level: cmd.level, x: cmd.x, y: cmd.y });
      return;
    }
    default: return refuse('not while exploring');
  }
}

export function stepState(st: W6State, cmds: W6Cmd[]): W6Event[] {
  const out: W6Event[] = [];
  for (const cmd of cmds) {
    st.tick++;
    const emit: Emit = (what, extra) => out.push({ tick: st.tick, what, ...extra });
    stepCmd(st, cmd, emit);
    st.m.wrote.clear();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function newGameState(world: W6World, seed: number, opts?: W6NewGame): W6State {
  const m = freshMem(world.base);
  const rng = new W6Rng(seedToRng(seed));
  const L12 = world.levels[opts?.level ?? 12];
  const ent = L12.entrance;
  const pose: Pose = { level: L12.id, x: opts?.x ?? ent?.x ?? 0, y: opts?.y ?? ent?.y ?? 0, facing: opts?.facing ?? ent?.facing ?? 0 };
  const st: W6State = { world, seed, tick: 0, m, rng, mode: 'explore', pose, prev: null, fight: null, chest: null, tickOnTurn: opts?.tickOnTurn ?? false };
  const party = opts?.party ?? STARTER_PARTY;
  m.w16(G(-15306), party.length);
  const c = ctx(st);
  party.forEach((t, i) => writeCharacter(c, i, t, id => itemRecord(world, id), lootItem(world)));
  m.w16(G(-3114), 0);
  m.w16(G(-18610), 5); m.w16(G(-18608), 5);
  m.w32(G(-18302), 0);
  m.w16(G(-18148), 0xffff);
  enterLevel(st, pose.level);
  toExplore(st, () => undefined, false);
  st.tick = 0; m.wrote.clear();
  return st;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface MemberView {
  name: string; cls: string; race: string; level: number; hp: number; maxHp: number; stamina: number; maxStamina: number; xp: number; gold: number;
  /** condition byte +417: 0 healthy, 3 dead (names of the in-between values are open) */
  cond: number; sp: [number, number][]; weapon: string; items: string[]; spells: { id: number; name: string; realm: number; level: number; cost: number }[];
  /** exhaustion counter (+292/+293): the camp-by-force trigger */
  tired: boolean;
}
export interface W6View {
  tick: number; mode: Mode; gameOver: boolean;
  pose: Pose; levelId: number; region: number; local: { x: number; y: number }; clock: number;
  ahead: { code: number; door: 'none' | 'closed' | 'locked' | 'jammed' };
  party: MemberView[];
  fight: { round: number; scripted: boolean; groups: GroupView[]; plans: (string | null)[] } | null;
  loot: LootEntry[];
  chest: { disarmed: boolean; sprung: boolean; letters: string } | null;
}

const planText = (p: PartyPlan | null): string | null => (p ? (p.act === 'cast' ? `cast ${p.spell}` : p.act) : null);

function memberView(st: W6State, i: number): MemberView {
  const m = st.m, p = P(i), inFight = st.mode === 'combat';
  const D = LAYOUT.memBase + i * 44;
  const known: MemberView['spells'] = [];
  for (let s = 0; s < 82; s++) if ((m.u8(p + 392 + (s >> 3)) >> (s & 7)) & 1) {
    const row = G(-31698 + s * 6);
    known.push({ id: s, name: st.world.msg?.(4000 + s) ?? `spell ${s}`, realm: m.u8(row), level: m.u8(row + 1), cost: m.u8(row + 2) });
  }
  const items: string[] = [];
  for (let k = 0; k < m.u8(p + 428); k++) items.push(itemName(st.world, m.u16(p + 64 + 8 * k)));
  for (let k = 0; k < m.u8(p + 429); k++) items.push(itemName(st.world, m.u16(p + 64 + 8 * (k + 10))));
  const wslot = m.u8(p + 272);
  return {
    name: charName(m, i), cls: CLASS_NAMES[m.u8(p + 415)] ?? '?', race: RACE_NAMES[m.u8(p + 413)] ?? '?', level: m.u16(p + 36),
    hp: inFight ? m.s16(D + 2) : m.s16(p + 24), maxHp: m.s16(p + 26), stamina: inFight ? m.s16(D + 6) : m.s16(p + 28), maxStamina: m.s16(p + 30), xp: m.u32(p + 12), gold: m.u32(p + 20),
    cond: inFight ? m.u8(D + 0x22) : m.u8(p + 417), sp: Array.from({ length: 6 }, (_, r): [number, number] => [m.s16(p + 40 + 4 * r), m.s16(p + 42 + 4 * r)]),
    weapon: wslot !== 0xff ? itemName(st.world, m.u16(p + 64 + 8 * wslot)) : 'bare hands', items, spells: known, tired: m.u8(p + 292) > 0 || m.u8(p + 293) > 0,
  };
}

function viewOf(st: W6State): W6View {
  const m = st.m, L = level(st), np = partySize(m);
  const region = regionAt(L, st.pose.x, st.pose.y), o = L.links.regionOrigin[region];
  const dir = st.pose.facing;
  const raw = rawWall(L.planes, st.pose.x, st.pose.y, dir);   // the raw wall value ahead (features ignored), the read TryMove makes
  const door = doorsFromMem(m)[dir];
  const letters = st.chest ? Array.from({ length: Math.max(0, s16(m.u16(G(-3134)))) }, (_, k) => String.fromCharCode(m.u8(G(-3194) + k))).join('') : '';
  return {
    tick: st.tick, mode: st.mode, gameOver: st.mode === 'over',
    pose: { ...st.pose }, levelId: st.pose.level, region, local: { x: o ? st.pose.x - o.x : 0, y: o ? st.pose.y - o.y : 0 }, clock: m.u32(G(-18302)),
    ahead: { code: raw, door: door === 1 ? 'locked' : door === 2 ? 'jammed' : raw === 3 ? 'closed' : 'none' },
    party: Array.from({ length: np }, (_, i) => memberView(st, i)),
    fight: st.fight ? { round: st.fight.round, scripted: st.fight.scripted, groups: groupsView(st), plans: st.fight.plans.map(planText) } : null,
    loot: st.mode === 'loot' ? lootList(st) : [],
    chest: st.chest ? { disarmed: st.chest.disarmed, sprung: st.chest.sprung, letters } : null,
  };
}

// ---- save / restore -------------------------------------------------------------------------------------------------------------------------------------------------------------
function saveState(st: W6State): Uint8Array {
  const o = { v: 1, seed: st.seed, tick: st.tick, rng: st.rng.s, mode: st.mode, pose: st.pose, prev: st.prev, fight: st.fight, chest: st.chest, tickOnTurn: st.tickOnTurn, mem: diffRuns(st.m, st.world.base) };
  return new TextEncoder().encode(JSON.stringify(o));
}
function restoreState(world: W6World, bytes: Uint8Array): W6State {
  const o = JSON.parse(new TextDecoder().decode(bytes));
  if (o.v !== 1) throw new Error('wizardry6: unknown save version');
  const m = freshMem(world.base);
  applyRuns(m, o.mem);
  const rng = new W6Rng(o.rng);
  return { world, seed: o.seed, tick: o.tick, m, rng, mode: o.mode, pose: o.pose, prev: o.prev, fight: o.fight, chest: o.chest, tickOnTurn: o.tickOnTurn };
}

// ---- world loading --------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface W6Assets { levels: W6Level[]; msg?: (id: number) => string | undefined }

function buildWorld(files: FileSet, a: W6Assets | undefined): W6World {
  const get = (n: string): Uint8Array => { const b = files.read(n); if (!b) throw new Error(`wizardry6: ${n} missing`); return b; };
  if (!a || a.levels.length < LEVELS) throw new Error('wizardry6: the dungeon levels are not bound (W6Engine.withAssets; npm run w6:levels generates them)');
  const scenario = get('scenario.dbs');
  const xp = Array.from({ length: 14 }, (_, t) => Array.from({ length: 16 }, (_, l) => { const o = (t * 16 + l) * 4; return ((scenario[o] << 24) | (scenario[o + 1] << 16) | (scenario[o + 2] << 8) | scenario[o + 3]) | 0; }));
  return { base: baseImage(get('Bane'), scenario, get('scenario.hdr')), scenario, levels: a.levels, xp, msg: a.msg };
}

export function makeEngine(assets?: W6Assets): Engine<W6World, W6State, W6Cmd, W6Event, W6View> & { withAssets(a: W6Assets): ReturnType<typeof makeEngine> } {
  return {
    id: 'wizardry6',
    /** step based: nothing happens without a command; `tickMs` is only the shell's input polling period */
    timing: { tickMs: 100, mode: 'turn' },
    detect(files: FileSet): Detection | null {
      for (const [n, size] of Object.entries(REQUIRED)) if (files.size(n) !== size) return null;
      const exe = files.read('Bane');
      if (exe && (exe[0] !== 0 || exe[1] !== 0 || exe[2] !== 3 || exe[3] !== 0xf3)) return null;
      return { engine: 'wizardry6', variant: 'amiga', title: 'Wizardry VI: Bane of the Cosmic Forge (Amiga)', evidence: Object.entries(REQUIRED).map(([n, s]) => `${n} ${s} bytes`) };
    },
    load(files: FileSet, variant: string): W6World {
      if (variant !== 'amiga') throw new Error(`wizardry6: unknown variant ${variant}`);
      return buildWorld(files, assets);
    },
    newGame: (world, seed, opts) => newGameState(world, seed, opts as W6NewGame | undefined),
    step: stepState,
    view: viewOf,
    save: saveState,
    restore: restoreState,
    coverage: () => COVERAGE,
    withAssets: a => makeEngine(a),
  };
}
export const W6Engine = makeEngine();

/** parse the walker's level files (`dungeon/levelNN.json`) */
export const parseLevels = (raws: unknown[]): W6Level[] => raws.map(parseLevel);

export function describeEvent(e: W6Event): string {
  const t = (k: string) => String(e[k] ?? '');
  switch (e.what) {
    case 'step': return `steps to (${e.x},${e.y})`;
    case 'turn': return `turns ${'NESW'[e.facing as number]}`;
    case 'bump': return 'ouch';
    case 'locked': return 'the door is locked';
    case 'bounce': return 'the way is barred';
    case 'death': return `the party dies: ${e.text ?? `message ${e.message}`}`;
    case 'door-open': return 'the door opens';
    case 'teleport': return `teleported${e.to !== null && e.to !== undefined ? ` to level ${e.to}` : ''} (${e.x},${e.y})`;
    case 'warp': return 'the party is carried elsewhere';
    case 'message': return `message ${e.id}${e.text ? `: ${e.text}` : ''}`;
    case 'wandering': return `wandering monsters (id ${e.id})`;
    case 'scripted-spot': return 'the party triggers a scripted fight';
    case 'encounter': return `encounter: ${(e.groups as { name: string; count: number }[]).map(g => `${g.count} ${g.name}`).join(', ')}`;
    case 'attack': return `${t('actor')} attacks ${t('target')}${(e.damage as number) > 0 ? ` for ${e.damage}` : ' and misses'}${e.killed ? ' - it falls' : ''}`;
    case 'cast': return `${t('actor')} casts ${e.name ?? `spell ${e.spell}`}${e.fizzled ? ' - fizzles' : e.backfired ? ' - backfires' : ''}`;
    case 'breath': return `${t('actor')} breathes`;
    case 'hide': return `${t('actor')} ${e.ok ? 'hides' : 'fails to hide'}`;
    case 'run': return `${t('actor')} ${e.ok ? 'runs' : 'fails to run'}`;
    case 'fled': return 'the party flees';
    case 'retreat': return `the party retreats to (${e.x},${e.y})`;
    case 'victory': return `victory (xp pool ${e.xpPool})`;
    case 'level-up': return `${t('name')} reaches level ${e.level}`;
    case 'member-died': return `${t('name')} dies`;
    case 'party-wiped': return 'the party is lost';
    case 'loot': return `treasure: ${(e.items as string[]).join(', ') || 'gold only'}`;
    case 'taken': return `${(e.who as number) + 1} takes ${t('name')}`;
    case 'camp': return e.interrupted ? 'the camp is interrupted' : 'the party camps';
    case 'chest': return 'a chest';
    case 'inspect': return `inspect: ${e.letters || '(nothing yet)'}`;
    case 'disarmed': return 'the trap is disarmed';
    case 'trap': return `the trap goes off: ${e.name ?? e.trap}`;
    case 'refused': return `(${e.cmd}: ${e.why})`;
    default: return e.what;
  }
}

/** grades follow docs/wizardry6/amiga/game-rules.md "W6 rules status" (harness = diffed against the retail 68k code under Unicorn, code = read not run, hyp = a guess, stub / open = not modelled) */
const COVERAGE: CoverageRow[] = [
  { area: 'RNG', grade: 'harness', note: 'W6Rng is the game\'s three-word generator; the seed -> state mapping is the engine\'s own (the original\'s seed source is untraced, w6-rng-seed)' },
  { area: 'Movement: TryMove, doors, pits, level-1 warp', grade: 'harness', note: 'movement.ts on the walker\'s planes; runtime unlocks (-18136 water crossing) not wired (w6-move-runtime-state)' },
  { area: 'Entity kinds 1 teleport, 7 door state', grade: 'harness', note: 'parity-verified arms of the walker arrival; here run inside the verified LAB_06B6 scan' },
  { area: 'Entity kinds 3, 4, 5, 6, 16 (messages, scripted fights, key switch)', grade: 'harness', note: 'entities.ts / scripted.ts; kind 3 shop / event states (0x15) are reported, not played' },
  { area: 'Entity kinds 2, 8-13, 21-25 (second messages, ambush, pits, puzzles, fountains)', grade: 'stub', note: 'reported as entity-unmodelled; TODO w6-stubbed-entity-kinds' },
  { area: 'Scripted-spot regions and zone indicator', grade: 'harness', note: 'game-rules 11.2; armed at level load (LAB_073F, code)' },
  { area: 'Per-step world tick: hunger, regen, poison, forced camp, wipe', grade: 'harness', note: 'stepTick; whether turning in place also ticks is open (option tickOnTurn, default off)' },
  { area: 'Wandering encounters (0.5 percent per step) and the pick', grade: 'harness', note: '10.4' },
  { area: 'Encounter start, groups, companions, identification', grade: 'harness', note: 'LAB_0A31 on the real monster records of scenario.dbs; formation cells and pictures are presentation (not modelled)' },
  { area: 'Combat round: planner, order of play, executor, attack resolver, weapon effects, status', grade: 'harness', note: 'CombatWorld.gameRound adopted over the engine\'s own memory; parity-tested' },
  { area: 'Spells in combat: cast gate, 82 spell ids, summons, breath, hide, run, use item, party swap', grade: 'harness', note: '7-9, 10.2; use item needs the item to carry a spell word' },
  { area: 'Spells out of combat (LAB_1D0D)', grade: 'code', note: 'read, not harnessed; not exposed as a command' },
  { area: 'End of fight: upkeep, compaction, decay, XP split, treasure roll', grade: 'harness', note: '11.4' },
  { area: 'Loot hand-out (give item, list), victory renumbering', grade: 'harness', note: '12.5; the divvy screen\'s cursor loop is UI: takeAll is the engine\'s policy (hyp)' },
  { area: 'Level-up on XP', grade: 'hyp', note: 'level count, HP/stamina, attributes, spell tier are the verified pieces (1.5); that they run immediately after the XP award is not confirmed' },
  { area: 'Camp', grade: 'harness', note: 'restParty, 2.5 percent interruption' },
  { area: 'Chest: pick trap, inspect, disarm, trap effects, treasure', grade: 'harness', note: '12.2, 12.3; chests have no map entity yet (debug \'chest\' command); that opening an armed chest springs the trap is hyp' },
  { area: 'Pick a locked door', grade: 'harness', note: 'pickLock tumbler game with a scripted poll (the last round counts)' },
  { area: 'Flee: retreat after a successful run', grade: 'hyp', note: 'LAB_08E4 walks the party back along its path; the engine returns it to its previous cell' },
  { area: 'Monster morale, flee, surprise', grade: 'code', note: 'established absent by a code census (11.3)' },
  { area: 'Character creation, starting HP / stamina / skills, equipment AC and resists', grade: 'stub', note: 'the new-game party is the engine\'s fixed template (party.ts); the party AC byte is a constant; equip copy item+24 -> record+240 is a hypothesis' },
  { area: 'Shops, inns, NPC talk, training, the other entity-driven screens', grade: 'open', note: 'UI and events (state 0x15), not modelled' },
  { area: 'Thief skills other than disarm / inspect / pick, trap-effect map triggers', grade: 'open', note: 'w6-world-rules' },
  { area: 'SNES variant', grade: 'open', note: 'not attempted: the rules are the Amiga executable\'s; the SNES data uses different level/map formats (docs/wizardry6/snes)' },
];
