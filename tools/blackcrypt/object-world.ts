/**
 * Black Crypt (Amiga): the headless OBJECT WORLD. One A4Mem image in the game's own layout (object table, cell map, character records, event queue, globals) driven by the
 * verified routines of rules-spell9.ts / rules-spell.ts: the tick loop (counter, generator scan every 16 ticks, due events popped while head.due == tick), the party-state spells
 * through the real dispatcher (incl. RAISE DEAD and TELEPORT with their UI answers supplied by the caller), door open, inventory weight (pickup / drop rule), vitals, REMOVE TRAP,
 * CREATE WALL with its expiry, buff expiries. It complements CombatSim (which owns the melee / monster-VM chain on a MoveWorld): the remake core is this memory model plus the
 * monster chain; unifying the two is the next step (see game-rules.md section 13.7).
 *
 * Evidence per piece (see game-rules.md section 13): harness = diffed against the 68k; code = read from the disassembly only (event 0x22 / 0x29 / 0x15 handlers, the pop loop).
 * Not here (not verified): traps / glyphs triggering on walk-in, locks and keys, loot drops on death, item use (except 0x8D-0x90), possession / stone application.
 */
import { BcRng, type RuleTables } from './rules';
import { A4Mem } from './rules-spell';
import { popDue } from './rules-pop';
import { OBJ, CELL, QN, allocObj, unlinkObj, insertObj, adjustWeight, openDoor, castSpell9, scheduleEvent, activationScan, stepCost, adjustVitals } from './rules-spell9';

const CH = (k: number) => 0x1758 + 0xa8 * k;
export type WorldLog = { tick: number; what: string; [k: string]: unknown };

export class ObjectWorld {
  a = new A4Mem();
  rng: BcRng;
  log: WorldLog[] = [];
  /** ids handed out by `newObject` start here; 1..39 are free for the caller's fixed objects, 40.. are the free list the game allocates from */
  private nextFixed = 1;
  t: RuleTables;
  constructor(t: RuleTables, seed: string, freeIds = 60) {
    this.t = t;
    this.rng = new BcRng(seed);
    const a = this.a;
    // free list 40.. in order, node pool: all 150 event nodes on the free list, active list empty
    a.setW(OBJ(0) + 0x12, 40);
    for (let i = 0; i < freeIds; i++) a.setW(OBJ(40 + i) + 0x12, i + 1 < freeIds ? 41 + i : 0);
    for (let i = 0; i < 150; i++) a.setB(QN(i) + 9, i + 1 < 150 ? i + 1 : 0x96);
    a.setB(0x173e, 0); a.setB(0x173f, 0x96);
    for (let i = 0; i < 4; i++) a.setW(0x1e74 + 2 * i, i);
    a.setW(0x174a, 1);   // in-dungeon screen mode
  }
  get tick(): number { return ((this.a.w(0x1750) << 16) | this.a.w(0x1752)) >>> 0; }
  private setTick(v: number) { this.a.setW(0x1750, v >>> 16); this.a.setW(0x1752, v & 0xffff); }
  note(what: string, extra: Record<string, unknown> = {}) { this.log.push({ tick: this.tick, what, ...extra }); }

  // ---- building the world
  party(x: number, y: number, facing: number) { this.a.setW(0x1742, x); this.a.setW(0x1740, y); this.a.setW(0x1744, facing); }
  character(i: number, f: { cls: number; level: number; hp: number; maxHp: number; str?: number; dex?: number; stat65?: number; stat66?: number; maxStr?: number; spells?: number[] }) {
    const a = this.a, c = CH(i);
    a.setW(c, f.cls); a.setB(c + 0x5e, f.level); a.setW(c + 0x4e, f.hp); a.setW(c + 0x50, f.maxHp);
    a.setB(c + 0x65, f.stat65 ?? 12); a.setB(c + 0x66, f.stat66 ?? 12); a.setB(c + 0x6e, f.maxStr ?? 20); a.setB(c + 0x72, f.dex ?? 12); a.setB(c + 0x68, f.dex ?? 12); a.setB(c + 0x64, f.str ?? 12);
    a.setW(c + 0x56, 5000); a.setW(c + 0x52, 3000); a.setW(c + 0x54, 3000);
    for (let s = 0; s < 5; s++) a.setB(c + 0x49 + s, f.spells?.[s] ?? 0xff);
  }
  /** a plain object record: gfx / type word, structure type (+5), and any of the words */
  object(id: number, f: { w0?: number; b5?: number; b7?: number; w8?: number; wA?: number; wC?: number; wE?: number; w10?: number; next?: number }) {
    const a = this.a, o = OBJ(id);
    if (f.w0 !== undefined) a.setW(o, f.w0); if (f.b5 !== undefined) a.setB(o + 5, f.b5); if (f.b7 !== undefined) a.setB(o + 7, f.b7);
    if (f.w8 !== undefined) a.setW(o + 8, f.w8); if (f.wA !== undefined) a.setW(o + 0xa, f.wA); if (f.wC !== undefined) a.setW(o + 0xc, f.wC);
    if (f.wE !== undefined) a.setW(o + 0xe, f.wE); if (f.w10 !== undefined) a.setW(o + 0x10, f.w10); if (f.next !== undefined) a.setW(o + 0x12, f.next);
    return id;
  }
  /** put a chain of object ids on a square (links them in the order given) */
  square(x: number, y: number, chain: number[], flags = 0) {
    for (let i = 0; i < chain.length; i++) this.a.setW(OBJ(chain[i]) + 0x12, chain[i + 1] ?? 0);
    const v = ((chain[0] ?? 0) | flags) >>> 0;
    this.a.setW(CELL(x, y), v >>> 16); this.a.setW(CELL(x, y) + 2, v & 0xffff);
  }
  chain(x: number, y: number): number[] {
    const out: number[] = []; let id = (((this.a.w(CELL(x, y)) << 16) | this.a.w(CELL(x, y) + 2)) >>> 0) & 0xfff;
    while (id !== 0 && out.length < 64) { out.push(id); id = this.a.w(OBJ(id) + 0x12); }
    return out;
  }
  fixedId(): number { return this.nextFixed++; }

  // ---- events (the real queue)
  schedule(type: number, delay: number, a1 = 0, a2 = 0, a3 = 0, a4 = 0, wd = 0) { scheduleEvent(this.a, type, (this.tick + delay) >>> 0, a1, a2, a3, a4, wd); }
  /** one tick: counter++, the generator / activation scan every 16 ticks, then the due-event pop loop (rules-pop.ts, HARNESS: only events whose due == tick fire, in queue order) */
  step(): void {
    const t = (this.tick + 1) >>> 0; this.setTick(t);
    if ((t & 15) === 0) activationScan(this.a, this.rng, t);
    const wallBefore = new Set<number>();
    popDue(this.a, {
      unknown: ev => this.note('event (not simulated here)', { type: ev.type, a1: ev.a1, a2: ev.a2, a3: ev.a3, wd: ev.wd }),
      applied: ev => {
        if (ev.type >= 0x1e && ev.type <= 0x25 && ev.type !== 0x22) this.note('expiry', { type: ev.type, a1: ev.a1, a2: ev.a2, a3: ev.a3 });
        else if (ev.type === 0x22) this.note(this.a.b(0x1748) === 1 ? 'wall expired' : 'wall expiry: nothing there', { x: ev.a1, y: ev.a2 });
        else if (ev.type === 0x29) this.note('timer 0x29', { x: ev.a1, y: ev.a2, type: ev.a3 });
        else if (ev.type === 0x15) this.note('hit-ready', { ch: ev.a1, hand: ev.a3 });
      },
    });
    void wallBefore;
  }
  run(ticks: number, each?: (w: ObjectWorld) => void): void { for (let i = 0; i < ticks; i++) { this.step(); if (each) each(this); } }

  // ---- party actions
  /** cast the spell in slot `slot` of the active character through the real dispatcher; events it asks for are scheduled in the queue. `ui` carries the UI answers (target pick, map pick). */
  cast(active: number, slot: number, ui: { pick?: number; map?: number } = {}) {
    this.a.setW(0x1a14, active);
    const r = castSpell9(this.a, this.rng, this.t, slot, this.tick, ui);
    for (const e of r.events) scheduleEvent(this.a, e.type, e.due, e.a1, e.a2, e.a3, 0, 0);
    this.note('cast', { active, spell: this.a.b(0x1e86), spent: r.spent, failed: r.failed });
    return r;
  }
  openDoor(x: number, y: number) { openDoor(this.a, x, y); this.note('door open', { x, y }); }
  /** pickup rule (harness: weight): the weight routine accepts or refuses ("too heavy"); on success the object leaves its square. Hand / pack placement is not modelled. */
  pickup(ch: number, item: number, x: number, y: number): boolean {
    if (!adjustWeight(this.a, ch, item, 0)) { this.note('pickup refused (too heavy)', { ch, item }); return false; }
    unlinkObj(this.a, item, x, y); this.note('pickup', { ch, item }); return true;
  }
  /** drop: the weight leaves the character and the object joins the END of the party square's chain with a random sub-square (harness: insert, weight) */
  drop(ch: number, item: number): void {
    adjustWeight(this.a, ch, 0, item);
    const x = this.a.w(0x1742), y = this.a.w(0x1740), ch_ = this.chain(x, y);
    insertObj(this.a, this.rng, { id: ch_[ch_.length - 1] ?? 0 }, item, x, y); this.note('drop', { ch, item });
  }
  /** one party step cost (harness) */
  stepCost() { return stepCost(this.a, this.t.statBonusT1); }
  vitals(ch: number, dE: number, dF: number, dW: number) { return adjustVitals(this.a, this.t.statBonusT1, ch, dE & 0xffff, dF & 0xffff, dW & 0xffff); }
  hp(ch: number) { return this.a.sw(CH(ch) + 0x4e); }
  /** allocate from the game's free list (harness) */
  alloc(): number { return allocObj(this.a); }
}
