/**
 * Might & Magic II (Amiga) remake engine: the second implementation of tools/remake/engine.ts. A thin, UI-free layer over the harness-verified rules in
 * `tools/mm2/rules*.ts`. The party, roster, monsters and every global live in one memory image on the game's own A4 layout (`image.ts`), so the rules run on it
 * exactly as they ran in the Unicorn oracle. The engine adds only what the rules do not model: loading the user's files, the map pages and movement (the walker's
 * `stepParty`), the glue that turns a command into a sequence of verified rules (the "action routines" the harness stubbed), a seed -> RNG mapping, JSON save /
 * restore and a view model. MM2 is turn based: a `step` consumes commands, never time; a `step` with no commands does nothing.
 *
 * Evidence grades used in the notes: harness = the routine is diffed against the retail 68k code; code = read from the code, not run; hyp = a guess marked as such.
 */
import { FlatMem, dataImage, MON_BASE } from './image';
import { g } from '../rules-mem';
import { randRange, charPtr, partyAttack, spellSpCost, spellGemGate, spellSpGate, xpAward, SPELL_COST_SLOT, SPELL_GEMS_SLOT } from '../rules';
import { pickTargetMelee, pickTargetRanged, monsterTurn, monsterSpecial, resolvePartyHit, damageMonster, monsterDies, treasure } from '../rules3';
import { monsterMelee, damageChar } from '../rules';
import { characterFlee, encounter, type PromptScript } from '../rules2';
import { castSpell, castCombat, castNonCombat, monsterSpellVerb, partyEffect, advanceTime, callForHelp, equipCommand, NC_SPELLS, CB_SPELLS, type CastIo } from '../rules4';
import { loadTable, loadAttribRecord, rosterToggle, unlockDoor, bashDoor, shopPrice, buyItem, chargeCast, castNonCombat2, NC_SPELLS2 } from '../rules5';
import { monsterAdvance, monsterHitOne, monsterSpray, monsterCondAll, monsterCondOne, payPool, shareGold, shareGems, sellItem, hallLoop } from '../rules6';
import { rest as restParty } from '../rules';
import { startBattle, battleRound } from './round';
import { decodeAttrib, type AttribRecord } from '../attrib';
import { decodeMonsters } from '../monsters';
import { decodeItems } from '../items';
import { stepParty, setFacing, type ScreenLike } from '../../walker-mm/maze3d';
import type { Engine, FileSet, Detection, CoverageRow } from '../../remake/engine';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const REQUIRED: Record<string, number> = { 'mm2': 181524, 'map.dat': 30720, 'attrib.dat': 3840, 'monsters.dat': 6656, 'items.dat': 5120, 'spells.dat': 256, 'roster.dat': 8320 };
const ROSTER = -10814, CH = 130;
const CLASS_NAMES = ['Knight', 'Paladin', 'Archer', 'Cleric', 'Sorcerer', 'Robber', 'Ninja', 'Barbarian'];

export interface Mm2World {
  img: Uint8Array;
  map: Uint8Array;
  attribRaw: Uint8Array;
  attrib: AttribRecord[];
  monstersRaw: Uint8Array;
  itemsRaw: Uint8Array;
  spellsRaw: Uint8Array;
  rosterRaw: Uint8Array;
  monsterNames: string[];
  itemNames: string[];
}

export type Order =
  | { kind: 'attack'; target?: number }
  | { kind: 'shoot'; target?: number }
  | { kind: 'cast'; spell: number; target?: number }
  | { kind: 'run' }
  | { kind: 'wait' };

export type Mm2Cmd =
  | { kind: 'move'; dir: 'forward' | 'back' }
  | { kind: 'turn'; by: 1 | -1 }
  | { kind: 'rest' }
  | { kind: 'unlock'; char?: number }
  | { kind: 'bash' }
  | { kind: 'equip'; char: number; slot: number }
  | { kind: 'cast'; char: number; spell: number; target?: number }
  | { kind: 'encounter' }
  | { kind: 'prompt'; choice: 'attack' | 'hide' | 'run' | 'bribe'; bribe?: { what: 'food' | 'gold' | 'gems'; amount: number } }
  | { kind: 'round'; orders?: (Order | null)[] }
  | { kind: 'takeLoot'; char: number }
  | { kind: 'shopBuy'; char: number; item: number; plus?: number }
  | { kind: 'shopSell'; char: number; slot: number }
  | { kind: 'train'; char: number }
  | { kind: 'warp'; screen: number; x?: number; y?: number; facing?: number };

export type Mm2Event = { tick: number; what: string; [k: string]: unknown };
export type Mode = 'explore' | 'prompt' | 'battle' | 'over';

export interface Prompt { surprise: number; monsters: { id: number; name: string }[]; count: number }

export interface Mm2State {
  world: Mm2World;
  seed: number;
  tick: number;
  mem: FlatMem;
  /** the 60 screens, 512 bytes each (page 0 visual, page 1 collision); doors opened in play are written back here */
  maps: Uint8Array;
  facing: number;
  mode: Mode;
  prompt: Prompt | null;
  round: number;
  /** rolled treasure not yet taken: item id, charges, flags */
  loot: { id: number; uses: number; flags: number }[];
  /** per step probability (percent) of a wandering encounter [hyp: the step handler's own roll is not harnessed] */
  wanderPct: number;
  /** the screen whose pages are loaded (the position bytes are the truth; a rule that moves the party is followed by `followScreen`) */
  screen: number;
  /** where the party stepped from on its last step (the `retreat` destination [hyp]) */
  from: { screen: number; x: number; y: number } | null;
}

const A = g;
const SCREEN = -31218, PX = -31217, PY = -31216, OUTDOOR = -31202, MODE = -31154, MCOUNT = -30654, SLOTTYPE = -4574, HP = -1338, STATUS = -1305;
const PSIZE = -31066, PSLOTS = -31082;
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;

/** seed -> the game's 32-bit LCG state `A4-24802` (the original seeds it with `srand(clock)`, a 16-bit value: a seed below 65536 is exactly `srand(seed)`; any larger one is a state the game could not reach) */
export function seedToRng(seed: number): number { return seed >>> 0; }

const b64 = (u: Uint8Array): string => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function loadMem(world: Mm2World): FlatMem {
  const m = FlatMem.fresh(world.img);
  // the overlay's table loaders (rules5 `loadTable`, harness 14.1): items (byte-swapping the gold word), spells, monsters into their allocation
  loadTable(m, 'items', Array.from(world.itemsRaw));
  loadTable(m, 'spells', Array.from(world.spellsRaw));
  loadTable(m, 'monsters', Array.from(world.monstersRaw), MON_BASE);
  return m;
}

/** the roster file into the 48 resident records: word and long fields are little endian on disk and byte-swapped on load (roster.ts, asm 0x3290) */
function loadRoster(m: FlatMem, raw: Uint8Array) {
  const base = A(ROSTER);
  for (let k = 0; k < 48; k++) {
    const o = k * CH;
    for (let i = 0; i < CH; i++) m.w8(base + o + i, raw[o + i]);
    for (const f of [0x58, 0x5a, 0x5c, 0x5e, 0x60, 0x74, 0x76]) m.w16(base + o + f, raw[o + f] | (raw[o + f + 1] << 8));
    for (const f of [0x62, 0x66]) m.w32(base + o + f, (raw[o + f] | (raw[o + f + 1] << 8) | (raw[o + f + 2] << 16) | (raw[o + f + 3] << 24)) >>> 0);
  }
}

const alive = (m: FlatMem, slot: number) => m.r8(charPtr(m, slot) + 38) < 0x80;

function screensOf(st: Mm2State): ScreenLike[] {
  return st.world.attrib.map((a, i) => ({
    index: i, visual: st.maps.subarray(i * 512, i * 512 + 256), collision: st.maps.subarray(i * 512 + 256, i * 512 + 512),
    neighbors: [...a.neighbours], outdoor: a.surfaceFlag !== 0, mapWalls: false, surface: a.surfaceFlag,
  }));
}

/** write the live pages (A4-21946 / A4-21690) back into `maps` (a door the rules opened persists for this game) */
function flushPages(st: Mm2State) {
  const m = st.mem, sc = m.r8(A(SCREEN)), o = sc * 512;
  for (let i = 0; i < 256; i++) { st.maps[o + i] = m.r8(A(-21946) + i); st.maps[o + 256 + i] = m.r8(A(-21690) + i); }
}
/** make `screen` the current one: pages, the attrib record (rules5 `loadAttribRecord`, harness 14.3), the area-type flag, position and facing bytes */
function enterScreen(st: Mm2State, screen: number, x: number, y: number, facing: number) {
  const m = st.mem;
  st.screen = screen;
  m.w8(A(SCREEN), screen);
  for (let i = 0; i < 256; i++) { m.w8(A(-21946) + i, st.maps[screen * 512 + i]); m.w8(A(-21690) + i, st.maps[screen * 512 + 256 + i]); }
  m.w32(A(-31222), 0);
  loadAttribRecord(m, Array.from(st.world.attribRaw.subarray(screen * 64, screen * 64 + 64)));
  m.w8(A(OUTDOOR), st.world.attrib[screen].surfaceFlag !== 0 ? 1 : 0);   // hyp: A4-31202 = 1 is the overland (spell location gate, door unlock, group sizes)
  m.w8(A(PX), x); m.w8(A(PY), y);
  st.facing = facing & 3;
  syncCell(st);
}
/** facing mask / shift (`A4-21976` / `A4-21975`) and the collision byte of the party's cell (`A4-21974`) */
function syncCell(st: Mm2State) {
  const m = st.mem, f = setFacing(st.facing);
  m.w8(A(-21976), f.mask); m.w8(A(-21975), f.shift);
  m.w8(A(-21974), m.r8(A(-21690) + (m.r8(A(PY)) << 4) + m.r8(A(PX))));
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function newGameState(world: Mm2World, seed: number, o: Mm2NewGame = {}): Mm2State {
  const mem = loadMem(world);
  const st: Mm2State = { world, seed, tick: 0, mem, maps: Uint8Array.from(world.map), facing: 0, mode: 'explore', prompt: null, round: 0, loot: [], wanderPct: o.wanderPct ?? 0, screen: 0, from: null };
  const m = mem;
  m.w32(A(-24802), seedToRng(seed));
  loadRoster(m, world.rosterRaw);
  for (let k = 0; k < 8; k++) m.w16(A(PSLOTS) + 2 * k, 0xffff);
  m.w16(A(PSIZE), 0);
  m.w8(A(-31150), o.difficulty ?? 2);   // hyp: A4-31150 is the difficulty setting (0..3); 2 = unchanged power
  const party = o.party ?? [0, 1, 2, 3, 4, 5];
  party.forEach((idx, n) => { m.w8(A(-24162), n); m.w8(A(-24161), 0); rosterToggle(m, idx); });
  const at = world.attrib[o.screen ?? 0];
  const ent = at.entryCoord;
  enterScreen(st, o.screen ?? 0, o.x ?? (ent & 15), o.y ?? (ent >> 4), o.facing ?? 0);
  // each character wields the first thing in the pack (the starters carry their weapon there): the real equip command (harness 13.6)
  if (o.equipAll !== false) for (let s = 0; s < s16(m.r16(A(PSIZE))); s++) equipCommand(m, charPtr(m, s), { keys: [], picks: [0x41], kills: [] });
  return st;
}
export interface Mm2NewGame { party?: number[]; screen?: number; x?: number; y?: number; facing?: number; wanderPct?: number; difficulty?: number; equipAll?: boolean }

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
type Emit = (what: string, d?: Record<string, unknown>) => void;
const partyN = (m: FlatMem) => s16(m.r16(A(PSIZE)));

interface Mon { slot: number; id: number; hp: number; status: number }
function monsters(m: FlatMem): Mon[] {
  const n = Math.min(m.r8(A(MCOUNT)), 10), out: Mon[] = [];
  for (let i = 0; i < n; i++) out.push({ slot: i, id: m.r8(A(SLOTTYPE) + i), hp: m.r16(A(HP) + 2 * i), status: m.r8(A(STATUS) + i) });
  return out;
}

/** the `damage_monster` outcome as the spell engine's scripted "kills" list: every consumer calls `shift()` once per hit, and the answer comes from the real rule (harness 11.4) */
const killOracle = (m: FlatMem): number[] => ({ shift: () => { damageMonster(m); return m.r16(A(-3852)) === 0xffff ? 1 : 0; } }) as unknown as number[];

function memberAble(m: FlatMem, idx: number): boolean { return m.r8(charPtr(m, idx) + 38) < 0x10; }

// ---- party actions (the stubbed CODE+0x119C2, composed of verified rules) ------------------------------------------------------------------------------------------------------
function partyAct(st: Mm2State, idx: number, order: Order | null, emit: Emit) {
  const m = st.mem;
  m.w8(A(-24128) + idx, m.r8(A(-24128) + idx) + 1);   // the command routine counts the member's turn first (rules2 doc 10.3)
  const ch = charPtr(m, idx);
  if (!memberAble(m, idx)) { emit('skip', { char: idx, cond: m.r8(ch + 38) }); return; }
  const o: Order = order ?? { kind: 'attack', target: 0 };
  if (o.kind === 'wait') { emit('wait', { char: idx }); return; }
  if (o.kind === 'run') {
    const was = partyN(m); m.w8(A(-1269), idx);
    characterFlee(m);
    emit(partyN(m) < was ? 'char-fled' : 'flee-failed', { char: idx });
    return;
  }
  if (o.kind === 'attack' || o.kind === 'shoot') {
    const ranged = o.kind === 'shoot';
    const n = Math.max(1, Math.min(ranged ? m.r8(A(MCOUNT)) : m.r8(A(-1316)), 10));
    const target = Math.min(o.target ?? 0, n - 1);
    m.w8(A(-24114), ranged ? 1 : 0);
    const before = monsters(m);
    partyAttack(m, target);
    const dmg = m.r16(A(-3852)), hits = m.r8(A(-24113)), crit = m.r8(A(-24106));
    m.w8(A(-1269), idx);
    resolvePartyHit(m);
    m.w8(A(-24114), 0);
    const after = monsters(m);
    emit(ranged ? 'shoot' : 'swing', { char: idx, target, hits, damage: dmg, crit, killed: before.length > after.length });
    if (before.length > after.length) emit('monster-dead', { slot: target });
    return;
  }
  castParty(st, idx, o.spell, o.target ?? 0, emit);
}

/** cast spell `spell` (0..95) by party member `idx`: the real gates (SP, gems, combat / location), the real cast command and handler, the real charge (harness 13, 14.5) */
function castParty(st: Mm2State, idx: number, spell: number, target: number, emit: Emit): boolean {
  const m = st.mem, ch = charPtr(m, idx), rec = A(-11006) + 2 * spell;
  if (!spellKnown(m, ch, spell)) { emit('cast-refused', { char: idx, spell, why: 'unknown' }); return false; }
  if (m.r8(ch + 38) & 0x02) { emit('cast-refused', { char: idx, spell, why: 'silenced' }); return false; }   // hyp: condition bit 1 = silenced (message table, rest clears it)
  spellSpCost(m, ch, rec);
  const gem = spellGemGate(m, ch, rec); if (!gem.ok) { emit('cast-refused', { char: idx, spell, why: 'gems' }); return false; }
  const sp = spellSpGate(m, ch); if (!sp.ok) { emit('cast-refused', { char: idx, spell, why: 'sp' }); return false; }
  m.w8(A(-31064), 0);
  const hpBefore = monsters(m);
  const calls = castSpell(m, ch, spell + 1);
  const disp = calls.find(c => c[0] === 'dispCB' || c[0] === 'dispNC');
  if (!disp) { m.w16(A(SPELL_COST_SLOT), 0); m.w16(A(SPELL_GEMS_SLOT), 0); emit('cast-refused', { char: idx, spell, why: calls.map(c => c[0] + c[1].join(':')).join(',') || 'gate' }); return false; }
  const io: CastIo & { ikeys: number[] } = { keys: [0x41 + target], picks: [0x31 + target, 0x31 + target], kills: killOracle(m), ikeys: [] };
  m.killHook = () => monsterDies(m);
  try {
    if (disp[0] === 'dispCB') {
      if (!CB_SPELLS.includes(spell)) { emit('cast-unmodelled', { char: idx, spell }); m.w16(A(SPELL_COST_SLOT), 0); m.w16(A(SPELL_GEMS_SLOT), 0); return false; }
      castCombat(m, spell, io);
    } else if (NC_SPELLS.includes(spell)) castNonCombat(m, spell, io);
    else if (NC_SPELLS2.includes(spell)) castNonCombat2(m, spell, io);
    else { emit('cast-unmodelled', { char: idx, spell }); m.w16(A(SPELL_COST_SLOT), 0); m.w16(A(SPELL_GEMS_SLOT), 0); return false; }
  } finally { m.killHook = null; }
  const ok = m.r8(A(-31064)) !== 0;
  if (ok) chargeCast(m); else { m.w16(A(SPELL_COST_SLOT), 0); m.w16(A(SPELL_GEMS_SLOT), 0); }
  const after = monsters(m);
  emit(ok ? 'cast' : 'cast-fizzled', { char: idx, spell, killed: hpBefore.length - after.length });
  for (let k = 0; k < hpBefore.length - after.length; k++) emit('monster-dead', { by: 'spell' });
  return ok;
}

/** hyp: the spell book is 6 bytes (+0x51..+0x56) of the character's own school, bit (n & 7) of byte (n >> 3) for spell n of 0..47 (Sorcerer 0..47, Cleric 48..95) */
function spellKnown(m: FlatMem, ch: number, spell: number): boolean {
  const n = spell % 48;
  return (m.r8(ch + 0x51 + (n >> 3)) >> (n & 7)) & 1 ? true : false;
}
export function knownSpells(m: FlatMem, slot: number): number[] {
  const ch = charPtr(m, slot), cls = m.r8(ch + 15), out: number[] = [];
  if (cls !== 3 && cls !== 4 && cls !== 1 && cls !== 2) return out;
  const base = cls === 3 || cls === 1 ? 48 : 0;   // hyp: Cleric / Paladin cast the cleric list, Sorcerer / Archer the sorcerer list
  for (let n = 0; n < 48; n++) if (spellKnown(m, ch, n)) out.push(base + n);
  return out;
}

// ---- monster actions (CODE+0x1064C and its leaves) ---------------------------------------------------------------------------------------------------------------------------------------
function monsterAct(st: Mm2State, idx: number, emit: Emit) {
  const m = st.mem;
  const calls = monsterTurn(m);
  const who = idx;
  for (const [name, args] of calls) {
    switch (name) {
      case 'pickMelee': pickTargetMelee(m); break;
      case 'pickRanged': pickTargetRanged(m); break;
      case 'attack': {
        const target = m.r8(A(-1272)), hpBefore = m.r16(charPtr(m, target) + 94), condBefore = m.r8(charPtr(m, target) + 38);
        const r = monsterMelee(m);
        const [dmg, hits] = r.calls[0][1];
        randRange(m, 1, 8);   // CODE+0xFF42 also draws the attack verb: rand(1,8) (game-rules 4.1); its place before or after the damage is hyp
        if (hits > 0) {
          m.w8(A(-22064), 0); m.w8(A(-22063), 0); m.w8(A(-22062), 0xff);   // hyp: a melee hit carries no luck / percentage save and no damage type
          damageChar(m, charPtr(m, target), dmg, A(-22064), A(-22063), A(-22062));
          monsterSpecial(m);
        }
        const ch = charPtr(m, target);
        emit('monster-attack', { mon: who, target, hits, damage: dmg, hp: m.r16(ch + 94), lost: Math.max(0, hpBefore - m.r16(ch + 94)), down: m.r8(ch + 38) !== condBefore });
        break;
      }
      case 'advance': {
        for (const [n2] of monsterAdvance(m)) if (n2 === 'help') { const c0 = m.r8(A(MCOUNT)); callForHelp(m); if (m.r8(A(MCOUNT)) > c0) emit('reinforcements', { count: m.r8(A(MCOUNT)) }); }
        emit('monster-advance', { mon: who });
        break;
      }
      case 'spell': {
        const verb = m.r8(A(-4540));
        const hp0 = Array.from({ length: partyN(m) }, (_, i) => m.r16(charPtr(m, i) + 94));
        for (const [leaf, la] of monsterSpellVerb(m, verb)) {
          if (leaf === 'spray1') monsterSpray(m);
          else if (leaf === 'sprayAll') monsterHitOne(m);
          else if (leaf === 'cond') monsterCondAll(m, la[0]);
          else if (leaf === 'cond2') monsterCondOne(m, la[0]);
          else emit('monster-effect-unmodelled', { verb, leaf });
        }
        emit('monster-spell', { mon: who, verb, lost: hp0.map((h, i) => Math.max(0, h - m.r16(charPtr(m, i) + 94))) });
        break;
      }
      case 'special': emit('monster-special-unmodelled', { mon: who }); break;   // CODE+0x1042C: open (game-rules 11.1)
      case 'partyEffect': {
        m.killHook = () => monsterDies(m);
        try { partyEffect(m, [args[0], args[1], args[2]], killOracle(m)); } finally { m.killHook = null; }
        break;
      }
      default: break;   // 'show': UI highlight
    }
  }
}

// ---- battle -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function enterBattle(st: Mm2State, emit: Emit) {
  const m = st.mem;
  startBattle(m);
  st.mode = 'battle'; st.round = 0; st.prompt = null;
  emit('battle-start', { monsters: monsters(m).map(x => ({ id: x.id, name: st.world.monsterNames[x.id], hp: x.hp })), queued: Math.max(0, m.r8(A(MCOUNT)) - 10), melee: m.r8(A(-1316)), surprise: m.r8(A(-31083)) });
}

function endBattle(st: Mm2State, emit: Emit) {
  const m = st.mem;
  const victory = m.r8(A(MCOUNT)) === 0;
  const fled = m.r8(A(-24140)) !== 0 || m.r8(A(-1315)) !== 0;
  const anyLive = Array.from({ length: partyN(m) }, (_, i) => alive(m, i)).some(Boolean);
  m.w8(A(MODE), 0);
  if (victory && anyLive) {
    const pool = m.r32(A(-28614));
    const r = xpAward(m);
    emit('xp', { share: m.r32(A(-28614)), pool });
    // gold and gems the monsters dropped (killReward, harness 4.6): to the first living real member, then shared out (rules6 pool routines) [hyp: the UI hand-over is not harnessed]
    const gold = m.r32(A(-16144)), gems = m.r16(A(-16146));
    const first = Array.from({ length: partyN(m) }, (_, i) => i).find(i => alive(m, i) && s16(m.r16(A(PSLOTS) + 2 * i)) < 24) ?? 0;
    if (gold || gems) {
      const c = charPtr(m, first);
      m.w32(c + 0x66, (m.r32(c + 0x66) + gold) >>> 0); m.w16(c + 0x5c, m.r16(c + 0x5c) + gems);
      shareGold(m, first); shareGems(m, first);
      m.w32(A(-16144), 0); m.w16(A(-16146), 0);
      emit('spoils', { gold, gems });
    }
    if (r.treasure) {
      treasure(m);
      st.loot = [];
      for (let i = 0; i < 3; i++) { const id = m.r8(A(-16156) + i); if (id) st.loot.push({ id, uses: m.r8(A(-16150) + i), flags: m.r8(A(-16153) + i) }); }
      for (let i = 0; i < 3; i++) { m.w8(A(-16156) + i, 0); m.w8(A(-16153) + i, 0); m.w8(A(-16150) + i, 0); }
      m.w8(A(-24105), 0); m.w8(A(-24104), 0);
      emit('loot', { items: st.loot.map(l => ({ id: l.id, name: st.world.itemNames[l.id] })) });
    }
    st.mode = 'explore';
    emit('victory', {});
  } else if (!anyLive && !victory) {
    st.mode = 'over'; emit('party-wiped', {});
  } else if (fled && !victory) {
    clearMonsters(m); st.mode = 'explore'; emit('battle-fled', {});
  } else { st.mode = 'over'; emit('party-wiped', {}); }
  if (victory) clearMonsters(m);
}
function clearMonsters(m: FlatMem) { m.w8(A(MCOUNT), 0); for (let i = 0; i < 11; i++) m.w8(A(SLOTTYPE) + i, 0); }

function runRound(st: Mm2State, orders: (Order | null)[], emit: Emit) {
  const m = st.mem; st.round++;
  emit('round', { n: st.round });
  const over = battleRound(m, { party: i => partyAct(st, i, orders[i] ?? null, emit), monster: i => monsterAct(st, i, emit) });
  if (over) endBattle(st, emit);
}

// ---- encounters -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function prepEncounter(m: FlatMem) { clearMonsters(m); m.w8(A(-31083), 0); m.w8(A(-4564), 0); }

function startEncounter(st: Mm2State, emit: Emit) {
  const m = st.mem; prepEncounter(m);
  // preview on a copy: monster list and the surprise roll do not depend on the answer, so the prompt can show them before the choice is made and the real run replays the same draws
  const c = m.clone();
  encounter(c, { keys: [0x41, 0x41], nums: [], pays: [] });
  const ids = Array.from({ length: Math.min(c.r8(A(MCOUNT)), 10) }, (_, i) => c.r8(A(SLOTTYPE) + i));
  st.prompt = { surprise: c.r8(A(-31083)), monsters: ids.map(id => ({ id, name: st.world.monsterNames[id] })), count: c.r8(A(MCOUNT)) };
  st.mode = 'prompt';
  emit('encounter', { surprise: st.prompt.surprise, monsters: st.prompt.monsters.map(x => x.name), count: st.prompt.count });
  if (st.prompt.surprise === 3) answerPrompt(st, { kind: 'prompt', choice: 'attack' }, emit);   // the monsters surprised the party: no prompt (10.2)
}

function answerPrompt(st: Mm2State, cmd: Extract<Mm2Cmd, { kind: 'prompt' }>, emit: Emit) {
  const m = st.mem, pr = st.prompt!;
  const ack = pr.surprise !== 0 && pr.surprise !== 3 ? [0x20] : [];
  const key = { attack: 0x41, hide: 0x48, run: 0x52, bribe: 0x42 }[cmd.choice];
  const sc: PromptScript = { keys: [...ack, key], nums: [], pays: [] };
  if (cmd.choice === 'bribe') {
    const b = cmd.bribe ?? { what: 'gold', amount: 0 };
    sc.keys.push({ food: 0x31, gold: 0x32, gems: 0x33 }[b.what]); sc.nums.push(b.amount);
    // does the encounter reach the payment? ask a copy (the payment itself must not happen unless it does)
    const probe = encounter(m.clone(), { ...sc, keys: [...sc.keys], nums: [...sc.nums], pays: [1] });
    const pay = probe.calls.find(c => c[0] === 'payFood' || c[0] === 'payGold' || c[0] === 'payGems');
    if (pay) sc.pays.push(payPool(m, b.what, pay[1][0]));
  }
  const r = encounter(m, sc);
  st.prompt = null;
  if (r.calls.some(c => c[0] === 'battle')) { emit('fight', { choice: cmd.choice }); enterBattle(st, emit); return; }
  if (r.calls.some(c => c[0] === 'retreat')) {
    clearMonsters(m);
    if (st.from) enterScreen(st, st.from.screen, st.from.x, st.from.y, st.facing);   // hyp: CODE+0x11646 moves the party back to where it came from
    st.mode = 'explore'; emit('retreated', {}); return;
  }
  clearMonsters(m); st.mode = 'explore';
  emit(m.r8(A(-30653)) ? 'avoided' : 'encounter-ended', { choice: cmd.choice });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function movement(st: Mm2State, cmd: Extract<Mm2Cmd, { kind: 'move' | 'turn' }>, emit: Emit) {
  const m = st.mem;
  if (cmd.kind === 'turn') { st.facing = (st.facing + cmd.by + 4) & 3; syncCell(st); emit('turn', { facing: st.facing }); return; }
  const x = m.r8(A(PX)), y = m.r8(A(PY)), sc = m.r8(A(SCREEN));
  const face = cmd.dir === 'back' ? (st.facing + 2) & 3 : st.facing;
  flushPages(st);
  const p = stepParty(face, x, y, sc, screensOf(st));
  if (p.screen === sc && p.x === x && p.y === y) { emit('blocked', { x, y, facing: st.facing }); return; }
  st.from = { screen: sc, x, y };
  if (p.screen !== sc) enterScreen(st, p.screen, p.x, p.y, st.facing); else { m.w8(A(PX), p.x); m.w8(A(PY), p.y); syncCell(st); }
  advanceTime(m, 1);   // the step handler's tick (game-rules 15.5, code; advance_time itself is harnessed)
  emit('step', { screen: p.screen, x: p.x, y: p.y });
  if (m.r8(A(-21690) + (p.y << 4) + p.x) & 0x80) emit('event-cell', { screen: p.screen, x: p.x, y: p.y });   // event.dat triggers are not executed (stub)
  if (st.wanderPct > 0 && (randRange(m, 1, 100) & 0xff) <= st.wanderPct) startEncounter(st, emit);
}

function restCmd(st: Mm2State, emit: Emit) {
  const m = st.mem;
  const r = restParty(m);
  emit('rest', { interrupted: r.calls.length > 0, food: Array.from({ length: partyN(m) }, (_, i) => m.r8(charPtr(m, i) + 37)) });
  if (r.calls.length) { m.w16(A(-31158), 0); startEncounter(st, emit); }   // the rest roll "interrupted by an encounter" (rules.ts doc); the mode word is put back [hyp]
}

function doorCmd(st: Mm2State, kind: 'unlock' | 'bash', char: number | undefined, emit: Emit) {
  const m = st.mem; syncCell(st);
  const cell = A(-21690) + (m.r8(A(PY)) << 4) + m.r8(A(PX)), was = m.r8(cell);
  const calls = kind === 'unlock' ? unlockDoor(m, { pickfx: 1, member: char ?? 0 }) : bashDoor(m, { pickfx: 1 });
  const opened = m.r8(cell) !== was;
  const trap = calls.some(c => c[0] === 'F1A90E');
  if (trap) { /* the trap's damage half (rules5 trapEffect): the effect id the UI picker would choose is not modelled; it is applied as effect 1 */ }
  flushPages(st); syncCell(st);
  emit(opened ? 'door-open' : 'door-holds', { by: kind, trap });
}

function trainCmd(st: Mm2State, char: number, emit: Emit) {
  const m = st.mem, ch = charPtr(m, char), lv = m.r8(ch + 0x20), gold = m.r32(ch + 0x66), hp = m.r16(ch + 0x60);
  if (m.r8(A(SCREEN)) >= 10) { emit('train-refused', { why: 'no hall here' }); return; }   // hyp: the halls are the town screens (hall tables are indexed by the screen, 14.x)
  hallLoop(m, char, [0x54]);
  const lv2 = m.r8(ch + 0x20);
  emit(lv2 > lv ? 'trained' : 'train-refused', { char, level: lv2, gold: gold - m.r32(ch + 0x66), hp: m.r16(ch + 0x60) - hp });
}

function shopBuyCmd(st: Mm2State, cmd: Extract<Mm2Cmd, { kind: 'shopBuy' }>, emit: Emit) {
  const m = st.mem, ch = charPtr(m, cmd.char);
  // a one-line shop: the stock arrays the price and buy routines read (harness 14.5); mode 0 = a plain shop [hyp for the numeric mode: only 5 (selling) and 6 (flat list) are special]
  m.w32(A(-23102), ch); m.w16(A(-23248), 0);
  m.w8(A(-23052), cmd.item); m.w8(A(-23064), 0); m.w8(A(-23070), (cmd.plus ?? 0) & 0x3f);
  m.w32(A(-23046), A(-16126) + 20 * cmd.item);
  const price = shopPrice(m, 0);
  m.w32(A(-23094), price);
  const gold = m.r32(ch + 0x66);
  const msgs = buyItem(m, 0);
  emit(msgs[0] === 0 ? 'bought' : 'buy-refused', { char: cmd.char, item: cmd.item, name: st.world.itemNames[cmd.item], price, msg: msgs[0], gold: m.r32(ch + 0x66), before: gold });
}
function shopSellCmd(st: Mm2State, cmd: Extract<Mm2Cmd, { kind: 'shopSell' }>, emit: Emit) {
  const m = st.mem, ch = charPtr(m, cmd.char);
  m.w32(A(-23102), ch); m.w16(A(-23248), 5);
  for (let s = 0; s < 6; s++) { m.w8(A(-23052) + s, m.r8(ch + 0x3a + s)); m.w8(A(-23070) + s, m.r8(ch + 0x46 + s) & 0x3f); m.w32(A(-23046) + 4 * s, A(-16126) + 20 * m.r8(ch + 0x3a + s)); m.w32(A(-23094) + 4 * s, shopPrice(m, s)); }
  const gold = m.r32(ch + 0x66), msgs = sellItem(m, cmd.slot);
  emit(msgs[0] === 0 ? 'sold' : 'sell-refused', { char: cmd.char, slot: cmd.slot, msg: msgs[0], gained: m.r32(ch + 0x66) - gold });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export function stepState(st: Mm2State, cmds: Mm2Cmd[]): Mm2Event[] {
  const events: Mm2Event[] = [];
  for (const cmd of cmds) {
    st.tick++;
    const emit: Emit = (what, d = {}) => events.push({ tick: st.tick, what, ...d });
    const m = st.mem;
    if (st.mode === 'over') { emit('refused', { cmd: cmd.kind, why: 'game over' }); continue; }
    const needs = (modes: Mode[]) => { if (modes.includes(st.mode)) return true; emit('refused', { cmd: cmd.kind, why: st.mode }); return false; };
    switch (cmd.kind) {
      case 'move': case 'turn': if (needs(['explore'])) movement(st, cmd, emit); break;
      case 'rest': if (needs(['explore'])) restCmd(st, emit); break;
      case 'unlock': case 'bash': if (needs(['explore'])) doorCmd(st, cmd.kind, cmd.kind === 'unlock' ? cmd.char : undefined, emit); break;
      case 'equip': if (needs(['explore'])) { const calls = equipCommand(m, charPtr(m, cmd.char), { keys: [], picks: [0x41 + cmd.slot], kills: [] }); emit('equip', { char: cmd.char, msg: calls.filter(c => c[0] === 'msg').map(c => c[1][0]) }); } break;
      case 'cast': if (needs(['explore', 'battle'])) { m.w8(A(MODE), st.mode === 'battle' ? 2 : 0); castParty(st, cmd.char, cmd.spell, cmd.target ?? 0, emit); if (st.mode === 'explore') followScreen(st); } break;
      case 'encounter': if (needs(['explore'])) startEncounter(st, emit); break;
      case 'prompt': if (needs(['prompt'])) answerPrompt(st, cmd, emit); break;
      case 'round': if (needs(['battle'])) runRound(st, cmd.orders ?? [], emit); break;
      case 'takeLoot': if (needs(['explore'])) takeLoot(st, cmd.char, emit); break;
      case 'shopBuy': if (needs(['explore'])) shopBuyCmd(st, cmd, emit); break;
      case 'shopSell': if (needs(['explore'])) shopSellCmd(st, cmd, emit); break;
      case 'train': if (needs(['explore'])) trainCmd(st, cmd.char, emit); break;
      case 'warp': if (needs(['explore'])) { flushPages(st); enterScreen(st, cmd.screen, cmd.x ?? (st.world.attrib[cmd.screen].entryCoord & 15), cmd.y ?? (st.world.attrib[cmd.screen].entryCoord >> 4), cmd.facing ?? 0); emit('warp', { screen: cmd.screen }); } break;
    }
  }
  return events;
}
/** a spell may have moved the party (Teleport, Town Portal, Surface ...): the position bytes are the truth, reload the pages when the screen changed */
function followScreen(st: Mm2State) {
  const m = st.mem, sc = m.r8(A(SCREEN));
  if (sc < 60 && sc !== st.screen) { const x = m.r8(A(PX)), y = m.r8(A(PY)); m.w8(A(SCREEN), st.screen); flushPages(st); enterScreen(st, sc, x, y, st.facing); }
  else syncCell(st);
}

function takeLoot(st: Mm2State, char: number, emit: Emit) {
  const m = st.mem, ch = charPtr(m, char);
  const taken: number[] = [];
  for (const l of [...st.loot]) {
    let k = 0; while (k < 6 && m.r8(ch + 0x3a + k) !== 0) k++;
    if (k === 6) break;
    m.w8(ch + 0x3a + k, l.id); m.w8(ch + 0x40 + k, l.uses); m.w8(ch + 0x46 + k, l.flags);   // hyp: the hand-over (UI) puts the rolled charge byte in the flag slot, the use count in the charge slot
    taken.push(l.id); st.loot.splice(st.loot.indexOf(l), 1);
  }
  emit('loot-taken', { char, items: taken.map(id => st.world.itemNames[id]) });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface Mm2View {
  tick: number; mode: Mode;
  pose: { screen: number; x: number; y: number; facing: number };
  outdoor: boolean;
  /** the wall field in front of the party in the current screen: page-0 code (0 open, 1 wall, 2 door, 3 torch wall) and whether it is blocked (page 1) */
  ahead: { code: number; blocked: boolean; locked: boolean };
  clock: { day: number; year: number; sub: number };
  party: { name: string; cls: string; level: number; xp: number; hp: number; maxHp: number; sp: number; maxSp: number; gems: number; gold: number; food: number; cond: number; ac: number; alive: boolean; able: boolean; spells: number[]; equipped: string[]; pack: string[] }[];
  prompt: Prompt | null;
  battle: { round: number; melee: number; queued: number; monsters: { slot: number; id: number; name: string; hp: number; status: number }[] } | null;
  loot: { id: number; name: string }[];
  gameOver: boolean;
}

const idList = (m: FlatMem, ch: number, off: number) => Array.from({ length: 6 }, (_, i) => m.r8(ch + off + i));

export const Mm2Engine: Engine<Mm2World, Mm2State, Mm2Cmd, Mm2Event, Mm2View> = {
  id: 'mm2',
  /** turn based: nothing happens without a command; `tickMs` is only the shell's input polling period */
  timing: { tickMs: 100, mode: 'turn' },
  detect(files: FileSet): Detection | null {
    for (const [n, size] of Object.entries(REQUIRED)) if (files.size(n) !== size) return null;
    const exe = files.read('mm2');
    if (exe && (exe[0] !== 0 || exe[1] !== 0 || exe[2] !== 3 || exe[3] !== 0xf3)) return null;
    return { engine: 'mm2', variant: 'amiga', title: 'Might and Magic II: Gates to Another World (Amiga)', evidence: Object.entries(REQUIRED).map(([n, s]) => `${n} ${s} bytes`) };
  },
  load(files: FileSet, variant: string): Mm2World {
    if (variant !== 'amiga') throw new Error(`mm2: unknown variant ${variant}`);
    const get = (n: string) => { const b = files.read(n); if (!b) throw new Error(`mm2: ${n} missing`); return b; };
    const attribRaw = get('attrib.dat'), monstersRaw = get('monsters.dat'), itemsRaw = get('items.dat');
    return {
      img: dataImage(get('mm2')), map: get('map.dat'), attribRaw, attrib: decodeAttrib(attribRaw), monstersRaw, itemsRaw, spellsRaw: get('spells.dat'), rosterRaw: get('roster.dat'),
      monsterNames: decodeMonsters(monstersRaw).map(r => r.name), itemNames: decodeItems(itemsRaw).map(r => r.name),
    };
  },
  newGame(world, seed, opts?: unknown) { return newGameState(world, seed, opts as Mm2NewGame | undefined); },
  step: stepState,
  view(st): Mm2View {
    const m = st.mem, n = partyN(m);
    const x = m.r8(A(PX)), y = m.r8(A(PY)), sc = st.screen, f = setFacing(st.facing);
    const cell = m.r8(A(-21946) + (y << 4) + x), col = m.r8(A(-21690) + (y << 4) + x);
    const code = (cell & f.mask) >> f.shift;
    const calendar = A(-31198) + 2 * s16(m.r16(A(-31158)));
    const name = (ids: number[]) => ids.filter(i => i !== 0 && i !== 0xff).map(i => st.world.itemNames[i] ?? `#${i}`);
    return {
      tick: st.tick, mode: st.mode, pose: { screen: sc, x, y, facing: st.facing }, outdoor: m.r8(A(OUTDOOR)) === 1,
      ahead: { code, blocked: collisionBlocked(col, st.facing), locked: code === 2 && collisionBlocked(col, st.facing) },
      clock: { day: m.r16(calendar), year: m.r16(A(-31178) + 2 * s16(m.r16(A(-31158)))), sub: m.r16(A(-31156)) },
      party: Array.from({ length: n }, (_, i) => {
        const ch = charPtr(m, i);
        const nm = Array.from({ length: 11 }, (_, k) => m.r8(ch + k)).filter(c => c >= 0x20 && c < 0x7f).map(c => String.fromCharCode(c)).join('').trim();
        const cond = m.r8(ch + 38);
        return { name: nm, cls: CLASS_NAMES[m.r8(ch + 15)] ?? '?', level: m.r8(ch + 0x20), xp: m.r32(ch + 0x62), hp: m.r16(ch + 0x5e), maxHp: m.r16(ch + 0x74), sp: m.r16(ch + 0x58), maxSp: m.r16(ch + 0x5a), gems: m.r16(ch + 0x5c), gold: m.r32(ch + 0x66), food: m.r8(ch + 0x25), cond, ac: m.r8(ch + 0x24), alive: cond < 0x80, able: cond < 0x10, spells: knownSpells(m, i), equipped: name(idList(m, ch, 0x28)), pack: name(idList(m, ch, 0x3a)) };
      }),
      prompt: st.prompt,
      battle: st.mode === 'battle' ? { round: st.round, melee: m.r8(A(-1316)), queued: Math.max(0, m.r8(A(MCOUNT)) - 10), monsters: monsters(m).map(q => ({ ...q, name: st.world.monsterNames[q.id] ?? `#${q.id}` })) } : null,
      loot: st.loot.map(l => ({ id: l.id, name: st.world.itemNames[l.id] })),
      gameOver: st.mode === 'over',
    };
  },
  save(st): Uint8Array {
    const o = { v: 1, seed: st.seed, tick: st.tick, facing: st.facing, mode: st.mode, prompt: st.prompt, round: st.round, loot: st.loot, wanderPct: st.wanderPct, screen: st.screen, from: st.from, mem: b64(st.mem.win), maps: b64(st.maps) };
    return new TextEncoder().encode(JSON.stringify(o));
  },
  restore(world, bytes): Mm2State {
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (o.v !== 1) throw new Error('mm2: unknown save version');
    const mem = loadMem(world);
    mem.win.set(unb64(o.mem));
    return { world, seed: o.seed, tick: o.tick, mem, maps: unb64(o.maps), facing: o.facing, mode: o.mode, prompt: o.prompt, round: o.round, loot: o.loot, wanderPct: o.wanderPct, screen: o.screen, from: o.from };
  },
  coverage(): CoverageRow[] { return COVERAGE; },
};

/** collision byte `col` blocks a step in direction `facing` (0 N, 1 E, 2 S, 3 W): page-1 bit pairs are W,S,E,N = bits 0, 2, 4, 6 (0x55 mask) */
const collisionBlocked = (col: number, facing: number) => ((col >> [6, 4, 2, 0][facing & 3]) & 1) !== 0;

export function describeEvent(e: Mm2Event): string {
  const n = (c: unknown) => `member ${(c as number) + 1}`;
  switch (e.what) {
    case 'step': return `steps to (${e.x},${e.y})`;
    case 'blocked': return 'the way is blocked';
    case 'turn': return `turns ${'NESW'[e.facing as number]}`;
    case 'encounter': return `${e.count} monster(s): ${(e.monsters as string[]).slice(0, 4).join(', ')}${e.surprise === 2 ? ' - you surprise them' : e.surprise === 3 ? ' - they surprise you' : ''}`;
    case 'fight': return 'battle is joined';
    case 'avoided': return 'the encounter is avoided';
    case 'retreated': return 'the party retreats';
    case 'battle-start': return 'battle';
    case 'round': return `round ${e.n}`;
    case 'swing': return `${n(e.char)} hits ${e.hits}x for ${e.damage}${e.killed ? ' - it dies' : ''}`;
    case 'shoot': return `${n(e.char)} shoots ${e.hits}x for ${e.damage}`;
    case 'cast': return `${n(e.char)} casts spell ${e.spell}${e.killed ? ` - ${e.killed} die` : ''}`;
    case 'cast-refused': return `${n(e.char)} cannot cast ${e.spell} (${e.why})`;
    case 'monster-attack': return `monster ${(e.mon as number) + 1} hits ${n(e.target)} ${e.hits}x for ${e.damage}`;
    case 'monster-dead': return 'a monster dies';
    case 'xp': return `each survivor gains ${e.share} experience`;
    case 'loot': return `treasure: ${(e.items as { name: string }[]).map(i => i.name).join(', ')}`;
    case 'victory': return 'victory';
    case 'party-wiped': return 'the party is dead';
    case 'rest': return 'the party rests';
    case 'door-open': return 'the door opens';
    case 'door-holds': return 'the door holds';
    case 'bought': return `${n(e.char)} buys ${e.name} for ${e.price}`;
    case 'trained': return `${n(e.char)} is now level ${e.level}`;
    default: return e.what;
  }
}

/** the coverage report: grades follow docs/mm2/amiga/game-rules.md "MM2 rules status" (harness = diffed against the retail 68k code, code = read not run, hyp = a guess, open, stub = the engine stands in for something unmodelled) */
const COVERAGE: CoverageRow[] = [
  { area: 'RNG, rand(lo,hi)', grade: 'harness', note: 'seed maps onto the 32-bit LCG state; the original seeds it with a 16-bit srand' },
  { area: 'Monster records, encounter generation, budget, group sizes', grade: 'harness', note: 'game-rules 3, 10.1' },
  { area: 'Encounter prompt: surprise, Hide, Run, Bribe', grade: 'harness', note: '10.2; the bribe payments are the verified pool routines (15.2)' },
  { area: 'Turn order and the round loop', grade: 'harness', note: '10.3; the engine round driver is proven equal to roundLoop (round.test.ts)' },
  { area: 'Party melee and ranged attacks, damage and death of monsters', grade: 'harness', note: '4.2, 11.4' },
  { area: 'Monster turn: flee, ability gate, melee / ranged / advance / spell', grade: 'harness', note: '11.1, 11.2, 15.1; monsters special CODE+0x1042C is open (stub)' },
  { area: 'Monster melee damage to a character, saves, 30 special effects', grade: 'harness', note: '4.1, 4.3, 11.3; the save flags of a melee hit are hyp (none)' },
  { area: 'Monster spell verbs and the four leaves', grade: 'harness', note: '13.5, 15.1; verbs 9, 11-14, 29 (v140E..v141F) are not derived (event only)' },
  { area: 'Party spells: cast command, gates, 51 combat + 25 non-combat handlers, charge', grade: 'harness', note: '13, 14.5, 14.6, 15.1; the spell book bit order and who casts which list are hyp' },
  { area: 'End of battle: XP split, kill reward, treasure roll', grade: 'harness', note: '4.6, 4.7, 12.3; the hand-over of gold / gems / loot to the party is the engine\'s policy (hyp, UI)' },
  { area: 'Rest, world clock and ageing', grade: 'harness', note: '5.5, 13.7; how much time a rest advances is open (the clock is not advanced by rest)' },
  { area: 'Doors: unlock, bash', grade: 'harness', note: '14.4; the trap effect picker is UI (the damage half is harnessed, 15.7, not wired)' },
  { area: 'Equipment: equip command, compatibility, AC', grade: 'harness', note: '12.1, 13.6' },
  { area: 'Shop: price, buy, sell', grade: 'harness', note: '14.5, 15.3; the engine builds a one-item shop (stock lists come from event.dat, not executed)' },
  { area: 'Hall of Training: eligibility, cost, level gain', grade: 'harness', note: '5.4, 12.2, 15.4; which town screen holds a hall is hyp' },
  { area: 'Character creation, roster party toggle', grade: 'harness', note: '14.2, 15.6; not exposed as commands (a new game takes the roster\'s starter characters); starting gold is 0 (census)' },
  { area: 'Movement on the real maps (map.dat, attrib.dat neighbours)', grade: 'code', note: 'the walker\'s stepParty (Vairn-derived collision rule); passability skills and overland terrain classes are open (mm2-overland-passability-0x9424)' },
  { area: 'Wandering encounters', grade: 'stub', note: 'the step handler\'s encounter roll is not harnessed; a percentage per step is an engine option (default off)' },
  { area: 'Retreat after a successful Run', grade: 'hyp', note: 'CODE+0x11646 is not harnessed; the party is put back where it came from' },
  { area: 'event.dat scripts (signs, shops, inns, quests, teleports, fixed monsters)', grade: 'stub', note: 'event cells are reported, not executed (opcode disassembler exists: event-vm.ts)' },
  { area: 'Food outside rest', grade: 'harness', note: 'none exists (closed census, 14.7)' },
  { area: 'Party command menu, main command loop', grade: 'open', note: 'UI; the engine\'s commands stand in for it (key map recorded in 14.7)' },
  { area: 'Traps on squares, chest disarm', grade: 'stub', note: 'the rules are harnessed (15.6, 15.7), the squares that trigger them live in event.dat' },
  { area: 'Spells moving the party between screens, other entity kinds, quests', grade: 'open', note: 'handlers run; their screen loading is the engine\'s' },
];
