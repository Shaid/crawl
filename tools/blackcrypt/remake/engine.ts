/**
 * Black Crypt (Amiga) remake engine: the first implementation of tools/remake/engine.ts. A thin, UI-free layer over the harness-verified rules in `../bc-sim.ts` (one merged world
 * on the game's own A4 layout). It adds only what the sim lacks: map loading from the user's `bcdfs`, a new-game party and kit, map changes through stairs, a seed -> RNG mapping,
 * JSON save / restore, and a view model. No rule logic lives here.
 */
import { BcSim, type Cmd, type BcConfig } from '../bc-sim';
import { startingParty } from '../combat-sim';
import type { RuleTables, WeaponBase } from '../rules';
import type { AiScripts } from '../rules-monster';
import { OBJ, CELL, QN, activationScan, scheduleEvent } from '../rules-spell9';
import { parseBcdfs, entrancePose, isMonster, type BcMap } from './bcdfs';
import { loadMapInto } from './world-load';
import type { Engine, FileSet, Detection, CoverageRow } from '../../remake/engine';
import { CLASS_TEMPLATES, CLASS_FIRST_PAGE, defaultParty, checkDraft, portraitIndex, type CharDraft } from './chargen';

export type { CharDraft };

export type { Cmd as BcCmd };
export type BcEvent = { tick: number; what: string; [k: string]: unknown };
export interface BcRulesData { tables: RuleTables; weaponBase: WeaponBase; scripts: AiScripts; spells?: BcConfig['spells'] }
export interface BcWorld { rules: BcRulesData; maps: BcMap[]; /** 20 starting-kit records (4 characters x 5), when bcdfp was supplied */ kit: Uint8Array[] | null }

const CH = (k: number) => 0x1758 + 0xa8 * k;
const BCDFS_SIZE = 171005, KIT_OFFSET = 0x585c;
export const TICK_MS = 160;   // SetIdlePeriod(10): 8 vblanks PAL (game-rules 10.1)
const CLASS_NAMES = ['FIGHTER', 'CLERIC', 'MAGIC USER', 'DRUID'];
/** the char-record words that survive a map change (light, compass, wizard sight, detect, haste, cursor item) */
const CARRY_WORDS = [0x1754, 0x1e28, 0x1e2a, 0x1e2c, 0x1e2e, 0x1a22];
const CARRY_EVENTS = new Set([0x14, 0x15, 0x1e, 0x1f, 0x20, 0x21, 0x23, 0x24, 0x25]);

/** seed -> the game's 6-byte RNG state (the original seeds from the clock; any deterministic mapping will do) */
export function seedToRng(seed: number): string {
  let z = (seed >>> 0) + 0x9e3779b9; let out = '';
  for (let i = 0; i < 6; i++) { z = Math.imul(z ^ (z >>> 15), 0x85ebca6b) >>> 0; z = (z + 0x6d2b79f5) >>> 0; out += ((z >>> 8) & 0xff).toString(16).padStart(2, '0'); }
  return out;
}

export class BcState {
  sim!: BcSim;
  map = 1;
  seed: number;
  names = CLASS_NAMES.slice();
  /** absolute portrait index (0..35, bcdfo) per character */
  portraits = [0, 9, 18, 27];
  world: BcWorld;
  constructor(world: BcWorld, seed: number) { this.world = world; this.seed = seed; }
}

function makeSim(world: BcWorld, seed: number): BcSim {
  return new BcSim({ tables: world.rules.tables, weaponBase: world.rules.weaponBase, scripts: world.rules.scripts, spells: world.rules.spells, seed: seedToRng(seed) }, 0);
}

/** the new-game party (docs 1.3) plus the 20-record starting kit when available. Hyp: kit item ids 1..20 in the table's order, 5 per character, in pack row 0 */
function newParty(sim: BcSim, world: BcWorld, drafts: CharDraft[]) {
  startingParty(world.rules.tables).forEach((c, k) => {
    const d = drafts[k], t = world.rules.tables;
    const [str, int, wis, dex, con] = d.stats;
    // armour = T1[DEX] + 6 + 2 (game-rules 8.8); the name is also written at rec+2 so a save carries it (code, 12 characters + NUL)
    sim.setChar(k, { ...c, str, int, wis, dex, con, ac: t.statBonusT1[dex] + 6 + 2 });
    const o = CH(k); for (let i = 0; i < 13; i++) sim.a.setB(o + 2 + i, i < d.name.length ? d.name.charCodeAt(i) : 0);
    // class-dependent bytes +0x46 = first book page, copied to +0x47, +0x48 = 1 (code; meaning hyp)
    sim.a.setB(o + 0x46, CLASS_FIRST_PAGE[k]); sim.a.setB(o + 0x47, CLASS_FIRST_PAGE[k]); sim.a.setB(o + 0x48, 1);
  });
  // only page 0 of each of the three books starts owned (game-rules A.1, code): pages 0, 5, 10
  if (sim.book) sim.book.owned = sim.book.pageHead.map((_h, p) => (CLASS_FIRST_PAGE.includes(p as 0 | 5 | 10) ? 1 : 0));
  if (!world.kit) return;
  const slotWords = [0x16, 0x18, 0x1e, 0x20, 0x22];
  world.kit.forEach((rec, i) => {
    const id = i + 1; for (let b = 0; b < 20; b++) sim.a.setB(OBJ(id) + b, rec[b]);
    sim.give(Math.floor(i / 5), id, slotWords[i % 5]);
  });
}
const kitReserved = (world: BcWorld) => new Set(world.kit ? Array.from({ length: 20 }, (_, i) => i + 1) : []);

function enterMap(st: BcState, map: number, reserved: Set<number>) {
  const m = st.world.maps[map - 1]; if (!m) throw new Error(`no map ${map}`);
  loadMapInto(st.sim, m, reserved);
  st.map = map;
}

/** the stairs follow-up (`+0x16C62`, map load I/O, game-rules 14.7 open): keep the characters, what they carry, the buffs and the clock; everything else is the destination map */
function changeMap(st: BcState, map: number) {
  const old = st.sim, oa = old.a;
  const carried = new Set<number>();
  const take = (id: number) => { if (!id || carried.has(id)) return; carried.add(id); const o = OBJ(id); if (oa.b(o + 5) === 0x13 || oa.b(o + 5) === 0x23) for (let c = oa.w(o + 0xc); c && !carried.has(c); c = oa.w(OBJ(c) + 0x12)) take(c); };
  for (let k = 0; k < 4; k++) { for (let i = 0; i < 18; i++) take(oa.w(CH(k) + 0x16 + 2 * i)); for (let i = 0; i < 5; i++) take(oa.w(CH(k) + 0x3a + 2 * i)); }
  take(oa.w(0x1a22));
  const events: { type: number; due: number; a1: number; a2: number; a3: number; a4: number; wd: number }[] = [];
  for (let n = oa.b(0x173f), g = 0; n !== 0x96 && g < 200; n = oa.b(QN(n) + 9), g++) {
    const t = oa.b(QN(n) + 4);
    if (CARRY_EVENTS.has(t)) events.push({ type: t, due: ((oa.w(QN(n)) << 16) | oa.w(QN(n) + 2)) >>> 0, a1: oa.b(QN(n) + 5), a2: oa.b(QN(n) + 6), a3: oa.b(QN(n) + 7), a4: oa.b(QN(n) + 8), wd: oa.w(QN(n) + 0xa) });
  }
  const fresh = makeSim(st.world, st.seed);
  fresh.rng = old.rng; fresh.book = old.book; fresh.monsterIds = [];
  const na = fresh.a;
  for (let o = CH(0); o < CH(4); o++) na.setB(o, oa.b(o));
  for (const id of carried) for (let b = 0; b < 20; b++) na.setB(OBJ(id) + b, oa.b(OBJ(id) + b));
  for (const o of [0x1750, 0x1752, 0x1742, 0x1740, 0x1744, ...CARRY_WORDS]) na.setW(o, oa.w(o));
  for (let k = 0; k < 4; k++) na.setW(0x1e74 + 2 * k, oa.w(0x1e74 + 2 * k));
  st.sim = fresh;
  enterMap(st, map, carried);
  for (const e of events) scheduleEvent(na, e.type, e.due, e.a1, e.a2, e.a3, e.a4, e.wd);
  activationScan(na, fresh.rng, fresh.tick);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface BcView {
  tick: number; map: number; pose: { map: number; x: number; y: number; facing: number };
  party: { name: string; portrait: number; /** the book page open (+0x47) */ page: number; cls: number; level: number; xp: number; hp: number; maxHp: number; food: number; water: number; energy: number; alive: boolean; spells: number[]; hands: [number, number]; pack: number[] }[];
  /** what is on the square ahead */
  ahead: { x: number; y: number; wall: boolean; monsters: { id: number; gfx: number; hp: number }[]; structures: { id: number; type: number; state: number }[]; items: { id: number; gfx: number }[] };
  light: number; resting: boolean; gameOver: boolean; cursor: number;
  /** the spell book: null when the engine was loaded without the book tables */
  book: { pages: { page: number; owned: boolean; spells: { id: number; level: number; timer: number }[] }[] } | null;
  /** the squares in sight, depth 0 (own square) to 3 and lateral -1 (left) .. 1 (right) of the facing, in the walker's `project()` convention, each with its live contents */
  scene: BcSceneCell[];
}
/** one square of the live scene: structures carry the open bit of the door word (+0x0E bit 0) */
export interface BcSceneCell {
  depth: number; lateral: number; x: number; y: number;
  monsters: { id: number; gfx: number; hp: number }[];
  structures: { id: number; type: number; state: number; open: boolean }[];
  items: { id: number; gfx: number }[];
}
/** a live object of a square as its 20-byte on-disk record (the walker's entity record is built from these bytes) */
export interface BcEntity { id: number; monster: boolean; raw: number[] }
export const SCENE_DEPTH = 3;

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export const BcEngine = {
  id: 'blackcrypt',
  timing: { tickMs: TICK_MS },

  detect(files: FileSet): Detection | null {
    const need = ['bcdfs', 'bcdfp', 'bcdft'];
    if (!need.every(n => files.has(n))) return null;
    const ev = [`bcdfs ${files.size('bcdfs')} B`];
    if (files.size('bcdfs') !== BCDFS_SIZE) return null;
    const b = files.read('bcdfs')!;
    const off = (i: number) => ((b[4 * i] << 24) | (b[4 * i + 1] << 16) | (b[4 * i + 2] << 8) | b[4 * i + 3]) >>> 0;
    if (off(0) !== 0) return null;   // 13 ascending map offsets, the first is 0
    for (let i = 1; i < 13; i++) if (off(i) <= off(i - 1) || off(i) >= b.length) return null;
    return { engine: 'blackcrypt', variant: 'amiga', title: 'Black Crypt (Amiga)', evidence: [...ev, 'bcdfp', 'bcdft'] };
  },

  /** `rules` come from the shell / tests (the committed vectors or `rules-tables.json`): the engine itself reads only the maps and the starting kit from the user's files */
  load(files: FileSet, _variant: string, rules?: BcRulesData): BcWorld {
    if (!rules) throw new Error('BcEngine.load needs the rules data (use BcEngine.withRules)');
    const bcdfs = files.read('bcdfs'); if (!bcdfs) throw new Error('bcdfs missing');
    const maps = parseBcdfs(bcdfs);
    const p = files.read('bcdfp');
    let kit: Uint8Array[] | null = null;
    if (p && p.length >= KIT_OFFSET + 400) { kit = Array.from({ length: 20 }, (_, i) => p.slice(KIT_OFFSET + 20 * i, KIT_OFFSET + 20 * i + 20)); if (kit.some(r => r[0] !== 0)) kit = null; }
    return { rules, maps, kit };
  },
  /** the contract's `load(files, variant)` with the rules bound */
  withRules(rules: BcRulesData) { return { ...BcEngine, load: (f: FileSet, v: string) => BcEngine.load(f, v, rules) }; },

  /** `party`: the four created characters in class order (Fighter, Cleric, Magic User, Druid); default = the class templates. An invalid draft throws with every reason. */
  newGame(world: BcWorld, seed: number, opts: { map?: number; pose?: { x: number; y: number; facing: number }; party?: CharDraft[] } = {}): BcState {
    const st = new BcState(world, seed);
    st.sim = makeSim(world, seed);
    const map = opts.map ?? 1;
    const drafts = opts.party ?? defaultParty();
    if (drafts.length !== 4) throw new Error(`a party is four characters, got ${drafts.length}`);
    const problems = drafts.flatMap((d, k) => checkDraft(k, d).map(m => `${CLASS_TEMPLATES[k].name}: ${m}`));
    if (problems.length) throw new Error(`invalid party: ${problems.join('; ')}`);
    st.names = drafts.map(d => d.name); st.portraits = drafts.map((d, k) => portraitIndex(k, d));
    newParty(st.sim, world, drafts);
    enterMap(st, map, kitReserved(world));
    const p = opts.pose ?? entrancePose(world.maps[map - 1]);
    st.sim.party(p.x, p.y, p.facing);
    activationScan(st.sim.a, st.sim.rng, st.sim.tick);
    return st;
  },

  step(st: BcState, cmds: Cmd[] = []): BcEvent[] {
    const sim = st.sim;
    sim.step1(cmds);
    const out = sim.log.splice(0) as BcEvent[];
    const ch = out.find(e => e.what === 'map-change' && typeof e.map === 'number' && e.map >= 1 && e.map <= st.world.maps.length && e.map !== st.map);
    if (ch) { changeMap(st, ch.map as number); out.push({ tick: st.sim.tick, what: 'map-loaded', map: ch.map }); }
    return out;
  },

  view(st: BcState): BcView {
    const a = st.sim.a, x = a.w(0x1742), y = a.w(0x1740), f = a.w(0x1744);
    const [dx, dy] = DIRS[f], ax = x + dx, ay = y + dy;
    const wall = (((a.w(CELL(x, y)) << 16 | a.w(CELL(x, y) + 2)) >>> 0) & (0x1000 << f)) !== 0;
    const ahead: BcView['ahead'] = { x: ax, y: ay, wall, monsters: [], structures: [], items: [] };
    if (ax >= 0 && ay >= 0 && ax < 64 && ay < 64) for (const id of st.sim.chain(ax, ay)) {
      const g = a.w(OBJ(id)), t = a.b(OBJ(id) + 5);
      if (g & 0x8000) ahead.monsters.push({ id, gfx: g, hp: a.sw(OBJ(id) + 8) });
      else if (t >= 0x10 && t !== 0x15) ahead.structures.push({ id, type: t, state: a.w(OBJ(id) + 0xe) });
      else ahead.items.push({ id, gfx: g });
    }
    const party = [0, 1, 2, 3].map(k => {
      const o = CH(k);
      return { name: st.names[k], portrait: st.portraits[k], page: a.b(o + 0x47), cls: a.w(o), level: a.b(o + 0x5e), xp: ((a.w(o + 0xa0) << 16) | a.w(o + 0xa2)) >>> 0, hp: a.sw(o + 0x4e), maxHp: a.sw(o + 0x50), food: a.sw(o + 0x52), water: a.sw(o + 0x54), energy: a.sw(o + 0x56),
        alive: a.sw(o + 0x4e) > 0, spells: [0, 1, 2, 3, 4].map(i => a.b(o + 0x49 + i)).filter(v => v !== 0xff), hands: [a.w(o + 0x1c), a.w(o + 0x1a)] as [number, number], pack: Array.from({ length: 18 }, (_, i) => a.w(o + 0x16 + 2 * i)) };
    });
    const scene: BcSceneCell[] = [];
    const [rx, ry] = DIRS[(f + 1) & 3];
    for (let depth = 0; depth <= SCENE_DEPTH; depth++) for (const lateral of [-1, 0, 1]) {
      const cx = x + dx * depth + rx * lateral, cy = y + dy * depth + ry * lateral;
      const cell: BcSceneCell = { depth, lateral, x: cx, y: cy, monsters: [], structures: [], items: [] };
      for (const e of BcEngine.entitiesAt(st, cx, cy)) {
        const g = (e.raw[0] << 8) | e.raw[1], t = e.raw[5];
        if (e.monster) cell.monsters.push({ id: e.id, gfx: g, hp: a.sw(OBJ(e.id) + 8) });
        else if (t >= 0x10 && t !== 0x15) cell.structures.push({ id: e.id, type: t, state: (e.raw[0xe] << 8) | e.raw[0xf], open: (e.raw[0xf] & 1) !== 0 });
        else cell.items.push({ id: e.id, gfx: g });
      }
      scene.push(cell);
    }
    const bk = st.sim.book;
    const book = bk ? { pages: bk.pageHead.map((head, page) => { const spells: { id: number; level: number; timer: number }[] = []; for (let id = head, g = 0; id !== 0xff && g < 8; id = bk.next[id], g++) spells.push({ id, level: bk.level[id], timer: bk.timers[id] }); return { page, owned: !!bk.owned[page], spells }; }) } : null;
    return { tick: st.sim.tick, map: st.map, pose: { map: st.map, x, y, facing: f }, party, ahead, light: a.w(0x1754), resting: a.w(0x1746) !== 0, gameOver: st.sim.gameOver, cursor: a.w(0x1a22), book, scene };
  },

  /**
   * Turn character `ch`'s open page (+0x47) to `page`: only an owned page, and only inside the character's own book (pages 0-4 / 5-9 / 10-14). Not harness-verified (the book UI
   * click paths are code-read only, game-rules A.1); returns whether the page was opened.
   */
  openPage(st: BcState, ch: number, page: number): boolean {
    const bk = st.sim.book; if (!bk || page < 0 || page >= bk.pageHead.length || !bk.owned[page]) return false;
    if (Math.floor(page / 5) !== Math.floor(CLASS_FIRST_PAGE[ch] / 5)) return false;
    st.sim.a.setB(CH(ch) + 0x47, page); return true;
  },
  /**
   * A page item read in the book (+0x0F3A0, code): the page's owned flag is set. **Stub:** which character may read it (item word +0xE), the page-chain order and whether the item is consumed
   * are not modelled; the caller decides. Returns false when there is no book or the page is already owned.
   */
  learnPage(st: BcState, page: number): boolean {
    const bk = st.sim.book; if (!bk || page < 0 || page >= bk.owned.length || bk.owned[page]) return false;
    bk.owned[page] = 1; return true;
  },

  /** every object on a square (monsters, structures, floor items) as raw records, chain order; empty off the map */
  entitiesAt(st: BcState, x: number, y: number): BcEntity[] {
    if (x < 0 || y < 0 || x >= 64 || y >= 64) return [];
    const a = st.sim.a;
    return st.sim.chain(x, y).map(id => ({ id, monster: (a.w(OBJ(id)) & 0x8000) !== 0, raw: Array.from({ length: 20 }, (_, i) => a.b(OBJ(id) + i)) }));
  },

  save(st: BcState): Uint8Array {
    const keys = [...st.sim.a.m.keys()].sort((p, q) => p - q);
    const rng = (st.sim.rng as unknown as { s: number[] }).s;
    const doc = { v: 1, engine: 'blackcrypt', seed: st.seed, map: st.map, names: st.names, portraits: st.portraits, gameOver: st.sim.gameOver, monsterIds: st.sim.monsterIds, nextFixed: (st.sim as unknown as { nextFixed: number }).nextFixed,
      rng, book: st.sim.book, a4: { k: keys, b: keys.map(k => st.sim.a.m.get(k)!) } };
    return new TextEncoder().encode(JSON.stringify(doc));
  },
  restore(world: BcWorld, bytes: Uint8Array): BcState {
    const d = JSON.parse(new TextDecoder().decode(bytes));
    if (d.engine !== 'blackcrypt' || d.v !== 1) throw new Error('not a Black Crypt save');
    const st = new BcState(world, d.seed);
    st.sim = makeSim(world, d.seed); st.map = d.map; st.names = d.names; st.portraits = d.portraits ?? [0, 9, 18, 27];
    st.sim.a.m = new Map<number, number>(d.a4.k.map((k: number, i: number) => [k, d.a4.b[i]]));
    (st.sim.rng as unknown as { s: number[] }).s = d.rng;
    st.sim.gameOver = d.gameOver; st.sim.monsterIds = d.monsterIds; (st.sim as unknown as { nextFixed: number }).nextFixed = d.nextFixed; st.sim.book = d.book;
    return st;
  },

  coverage(): CoverageRow[] {
    return [
      { area: 'melee, weapons, swing timing', grade: 'harness' }, { area: 'monster behaviour VM, pursuit, ranged, activation, generators', grade: 'harness' },
      { area: 'death, loot, XP, level-up, DamageCharacter', grade: 'harness' }, { area: 'event queue, expiries', grade: 'harness' }, { area: 'party spells (9 + RAISE DEAD, TELEPORT), rays, 20 simple spells', grade: 'harness' },
      { area: 'doors, enter test, traps, plates, glyphs, pits, keys, item use, boss items', grade: 'harness', note: 'executor, glyph, pit, keys, shell are harnessed (pass 8)' },
      { area: 'vitals, hunger, weight, light counter', grade: 'harness' }, { area: 'map load from bcdfs', grade: 'code', note: 'records verbatim; runtime ids are sequential (hyp)' },
      { area: 'stairs / map change', grade: 'stub', note: 'characters, carried items, buffs and clock kept; +0x16C62 itself is open' },
      { area: 'starting kit and party', grade: 'hyp', note: 'bcdfp 0x585C records, ids 1-20; start pose = first corridor square' }, { area: 'rest, LIGHT, held-party click whitelist', grade: 'code' },
      { area: 'spell book memorise / recharge', grade: 'harness', note: 'memoriseClick / rechargeTick; needs rules.spells (BcEngine.withRules); initial owned pages 0 / 5 / 10 code, page items (learnPage) stub' },
      { area: 'character creation', grade: 'code', note: 'names, stats (min..20, pool 25), portraits; templates game-rules 1.3; whether the screen demands a spent pool is hyp; no creation UI' },
    ];
  },
};

export function describeEvent(e: BcEvent): string {
  const n = (k: string) => String(e[k] ?? '');
  switch (e.what) {
    case 'swing': return `${CLASS_NAMES[e.ch as number] ?? 'char'} swings: ${e.hit ? `hits for ${n('dmg')}` : 'misses'}`;
    case 'monster-hit': return `monster #${n('P')} hits ${CLASS_NAMES[e.ch as number]} for ${n('dmg')}`;
    case 'monster-dead': return `monster #${n('P')} dies`;
    case 'blocked': return `blocked (${n('why')})`;
    case 'door open': return 'the door opens';
    case 'trap': return 'a trap is sprung';
    case 'pickup': return `${CLASS_NAMES[e.ch as number]} picks up item ${n('item')}`;
    case 'cast': return `${CLASS_NAMES[e.ch as number]} casts spell ${n('spell')}`;
    case 'death': return `${CLASS_NAMES[e.ch as number]} dies`;
    case 'game-over': return 'the party has fallen';
    case 'levelup': return `${CLASS_NAMES[e.ch as number]} reaches level ${n('level')}`;
    case 'map-loaded': return `map ${n('map')}`;
    default: return e.what;
  }
}
void isMonster;
/** compile-time check that the engine satisfies the shell contract */
export const _contract: Engine<BcWorld, BcState, Cmd, BcEvent, BcView> = BcEngine;
