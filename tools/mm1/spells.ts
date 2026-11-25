/**
 * Might & Magic I (DOS/EGA) spell casting, ported from `MM.EXE` (see docs/mm1/dosega/game-rules.md section 4).
 *
 * Two cast menus share one data set: the COMBAT cast `comcast` (CODE+0xC7C7, effect handlers via the word table DS:0x39E2) and the
 * NON-COMBAT cast `qcast` (CODE+0x8794, handlers via DS:0x2BEB).  Both pick (spell level 1..7, slot 1..8) from `wait_` keys, derive
 * the 0..93 spell number (cleric list 0..46, sorcerer list 47..93 for classes 3 and 5), then gate on the per-spell flag byte
 * (DS:0xC5DC + n) and cost byte (DS:0xC63A + n: bit 7 = SP cost is the caster level, low 7 bits = gem cost).
 *
 * Like rules.ts the ports run against the strict memory of rules-mem.ts: only bytes the real code read may be read, the write set
 * must equal the game's, and the stubbed UI callees (ptext, cout, pdec, clropt, escl, noises, dosound, delay, pmonst, pmonname,
 * pcharn, pnums, puttoscr, wait_ = scripted key) are recorded as calls in order.
 */
import { type Mem } from './rules-mem.ts';
import { random, monsterResist, saveMonster, saveChar, resistRoll, applyDamageMonster, applyDamageChar, resetAc, setMony, resMon2, BDW_TEXT, CHARP, DMGTOT, MONTAB, NMON, type Call } from './rules.ts';

const u8 = (v: number) => v & 0xff;
export const SPD_FLAGS = 0xc5dc, SPD_COST = 0xc63a, COMBAT_TABLE = 0x39e2, MRESL = 0x318a;
const PARTYTAB = 0x3ca8, NPARTY = 0x3bc0, CURIDX = 0x3bf4, PARTYG = 0x3855;
/** engine parameter bytes: 3C82 = saving throw applies, 3C83 = resistance kind (1..8, 0 none), 3C84 = number of monsters, 3C85 = value */
const P_SAVE = 0x3c82, P_RES = 0x3c83, P_CNT = 0x3c84, P_VAL = 0x3c85;
const CHARPOS = 0x3cb6, MONPTR = 0x3cb4, STARTNUM = 0x398a, MON0 = 0x3ad8;

export class Exit extends Error {
  stop: number;
  constructor(stop: number) { super(`exit ${stop.toString(16)}`); this.stop = stop; }
}
/** the CF flag after `random` (CODE+0x451B): its last compare is `al < n`, INC keeps CF, so it always returns with CF = 1 */

/** Spell number for menu keys (level 0..6, slot 0..7): CODE+0xC852..0xC897 */
export function spellIndex(cls: number, level: number, slot: number): number {
  return (cls === 3 || cls === 5 ? 0x2f : 0) + slot + 8 * Math.min(level, 4) + 5 * Math.max(level - 4, 0);
}

/** deliberately wrong variants, used only by the null-control tests (each must disagree with the game on some vector) */
export type Wrong = 'sorcListBase' | 'abilityNoChance' | 'abilityCarry' | 'spCostIgnoresLevel' | 'noMonsterResist' | 'noSaveHalving' | 'noKindQuarter' | 'healNoCap' | 'gemNoBorrow' | 'skipPartyHit' | 'itemNoCharge' | 'itemKeepSpent';
export class Caster {
  calls: Call[] = [];
  /** handler address last dispatched (coverage bookkeeping for the tests) */
  reached = 0;
  private ki = 0;
  protected m: Mem;
  protected keys: number[];
  protected wrong: Wrong | undefined;
  constructor(m: Mem, keys: number[], wrong?: Wrong) { this.m = m; this.keys = keys; this.wrong = wrong; }
  // ---- stubbed UI callees ----
  ui(name: string, args: number[] = []) { this.calls.push([name, args]); }
  ptext() { this.calls.push(['ptext', [this.m.r16(BDW_TEXT), this.m.r8(0x3bdc), this.m.r8(0x3bdd)]]); }
  cout(al: number) { this.ui('cout', [al & 0xff]); }
  clropt() { this.ui('clropt'); }
  escl() { this.ui('escl'); }
  delay() { this.ui('delay'); }
  pmonst() { this.ui('pmonst'); }
  pmonname(bp: number) { this.ui('pmonname', [bp]); }
  wait(): number { const k = this.ki < this.keys.length ? this.keys[this.ki++] : 0x1b; this.ui('wait_', [k]); return k; }
  text(p: number) { this.m.w16(BDW_TEXT, p); }
  at(col: number, row: number) { this.m.w8(0x3bdc, col); this.m.w8(0x3bdd, row); }
  inc(a: number) { this.m.w8(a, this.m.r8(a) + 1); }
  /** apply a recorded sub-port that returns its own UI calls */
  sub(r: { calls: Call[] }) { this.calls.push(...r.calls); }
  /** CODE+0xCB6F `stars` */
  stars() {
    const m = this.m;
    m.w8(0x3bb8, m.r8(0x3bdc));
    m.w8(0x3bdc, m.r8(0x3bdc) + 4);
    this.ptext();
    this.inc(0x3bdc);
    m.w16(BDW_TEXT, 0x39de); this.ptext();
    m.w8(0x3bdc, m.r8(0x3bb8));
    m.w16(BDW_TEXT, 0x39de); this.ptext();
    this.ui('noises');
  }
  /** CODE+0xCA87 `retfspl` */
  retfspl(): never {
    const bp = this.m.r16(CURIDX) & 0xff;
    this.m.w8(PARTYG + bp, 1);
    throw new Exit(0xc5e1);
  }
  // ---- monster selection helpers ----
  getod(bx: number): number { return this.m.r8(this.m.r16(0x132) + bx); }
  /** CODE+0xC250 `setmony3`: bp preserved, DS:38B2 = slot index of the pointer in DS:3CB4 */
  setmony3() { setMony(this.m); }
  setmony2(bl: number): number {
    this.m.w16(MONPTR, this.m.r16(MONTAB + 2 * bl));
    return setMony(this.m);
  }
  /** CODE+0xD9E4: first monster is the target */
  firstTarget() {
    const m = this.m;
    m.w8(STARTNUM, 0);
    m.w8(MONPTR, m.r8(MONTAB)); m.w8(MONPTR + 1, m.r8(MONTAB + 1));
    this.setmony3();
    m.w8(P_CNT, 0xf);
  }
}

/** The combat cast menu. `keys` is the scripted `wait_` input (ESC when exhausted). Returns the stop address (CODE offset) and calls. */
export class ComCast extends Caster {
  run(): { stop: number; calls: Call[] } {
    try { this.menu(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('comcast fell through');
  }
  /** c9ac: stars; delay; retfvqr */
  protected finish(): never { this.stars(); this.delay(); throw new Exit(0xc5e1); }
  private menu() {
    const m = this.m;
    this.clropt(); this.escl();
    m.w8(0x393b, 0);
    m.w8(0x3bdc, 7); m.w8(0x3bdd, 0x14); this.text(0x398b); this.ptext();
    m.w8(0x3bdc, m.r8(0x3bdc) - 1);
    let al: number;
    const chr = () => m.r16(CHARP);
    for (;;) {
      al = this.wait();
      if (al === 0x1b) throw new Exit(0xc7c4);
      if (al < 0x31 || al >= 0x38) continue;
      al = u8(al - 0x31);
      if (al >= m.r8(chr() + 0x30)) continue;
      break;
    }
    m.w8(0x3985, al);
    this.cout(al + 0x31);
    this.inc(0x3bdd);
    m.w8(0x3bdc, 0x13); this.text(0x39a1); this.ptext();
    m.w8(0x3bdc, m.r8(0x3bdc) - 1);
    for (;;) {
      al = this.wait();
      if (al === 0x1b) throw new Exit(0xc7c4);
      if (al < 0x31 || al >= 0x39) continue;
      const bl = m.r8(0x3985);
      if (bl >= 4 && al >= 0x36) continue;
      break;
    }
    al = u8(al - 0x31);
    m.w8(0x3986, al);
    this.cout(al + 0x31);
    const cls = m.r8(chr() + 0x14);
    al = cls === 3 || cls === 5 ? (this.wrong === 'sorcListBase' ? 0x2e : 0x2f) : 0;
    al = u8(al + m.r8(0x3986));
    if (m.r8(0x3985) !== 0) {
      let bl = 0;
      for (;;) {
        al = u8(al + 8); bl++;
        if (bl === m.r8(0x3985)) break;
        if (bl !== 4) continue;
        do { al = u8(al + 5); bl++; } while (bl < m.r8(0x3985));
        break;
      }
    }
    m.w8(0x3987, al);
    this.inc(0x3985);
    m.w8(0x3988, m.r8(0x3985));
    const idx = m.r16(0x3987) & 0xff;
    if (m.r8(SPD_COST + idx) >= 0x80) m.w8(0x3988, m.r8(chr() + 0x24));
    // ---- spell points ----
    let ok = true;
    if (m.r8(chr() + 0x2c) === 0) {
      const cost = m.r8(SPD_COST + (m.r16(0x3987) & 0xff));
      if (cost >= 0x80 && this.wrong !== 'spCostIgnoresLevel') ok = m.r8(chr() + 0x24) <= m.r8(chr() + 0x2b);
      else ok = m.r8(0x3985) <= m.r8(chr() + 0x2b);
    }
    if (!ok) { this.clropt(); this.at(5, 0x15); this.text(0x38dc); return this.finish(); }
    // ---- gems ----
    const gem = m.r8(SPD_COST + (m.r16(0x3987) & 0xff)) & 0x7f;
    m.w8(0x3989, gem);
    if (gem !== 0 && m.r8(chr() + 0x32) === 0 && m.r8(chr() + 0x31) < gem) {
      this.clropt(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 9); this.text(0x38f4); return this.finish();
    }
    return this.castTail();
  }
  /** CODE+0xC95F..: flag gates, targeting, payment (DS:3988 SP / 3989 gems), item charge, handler dispatch (entered directly by `useitem`) */
  protected castTail(): never {
    const m = this.m;
    const chr = () => m.r16(CHARP);
    // ---- flags ----
    const fl = (): number => m.r8(SPD_FLAGS + (m.r16(0x3987) & 0xff));
    if (fl() & 2) { this.clropt(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 8); this.text(0x3911); return this.finish(); }
    if (fl() & 0x10) {
      if ((this.getod(0) & 0x80) === 0) { this.clropt(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0xa); this.text(0x3904); return this.finish(); }
    }
    if (fl() & 4) {
      m.w8(0x3bdc, 0x16); m.w8(0x3bdd, 0x17); this.text(0x39b0);
      if (this.pickCharacter()) throw new Exit(0xc5e1);
    } else if (fl() & 8) {
      m.w8(0x3bdc, 0x16); m.w8(0x3bdd, 0x17); this.text(0x39cf);
      if (this.pickGroup()) throw new Exit(0xc5e1);
    } else this.confirm();
    // ---- pay ----
    const c = chr();
    let sp = m.r8(c + 0x2b) - m.r8(0x3988);
    m.w8(c + 0x2b, sp);
    m.w8(c + 0x2c, m.r8(c + 0x2c) - (sp < 0 ? 1 : 0));
    let gm = m.r8(c + 0x31) - m.r8(0x3989);
    m.w8(c + 0x31, gm);
    m.w8(c + 0x32, m.r8(c + 0x32) - (gm < 0 && this.wrong !== 'gemNoBorrow' ? 1 : 0));
    const handler = m.r16(COMBAT_TABLE + 2 * (m.r16(0x3987) & 0xff));
    this.reached = handler;
    this.c773();
    m.w8(P_SAVE, 0); m.w8(P_RES, 0); m.w8(P_CNT, 0); m.w8(P_VAL, 0);
    if (m.r8(0x3c10) & 2) { this.clropt(); m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 5); this.text(0x3921); return this.finish(); }
    this.handler(handler);
    return this.castDone();
  }
  /** CODE+0xCA6E: "the spell worked" message, stars, delay, mark the caster as having acted */
  protected castDone(): never {
    const m = this.m;
    this.clropt(); m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0xe); this.text(0x39ab);
    this.stars(); this.delay();
    return this.retfspl();
  }
  /** CODE+0xC773: item charge bookkeeping when the cast came from an item (DS:393B != 0): decrement the charge, remove a spent item */
  protected c773() {
    const m = this.m;
    if (m.r8(0x393b) === 0 || this.wrong === 'itemNoCharge') return;
    const bp = m.r16(0x3c89) & 0xff;
    let bl = m.r8(0x3c88);
    const chr = m.r16(CHARP);
    if (bl !== 0) {
      bl = u8(bl - 1);
      m.w8(chr + bp, bl);
      if (bl !== 0) return;
    }
    if (m.r8(0x3c87) < 0x46 || this.wrong === 'itemKeepSpent') return;
    m.w8(chr + (m.r16(0x3c87) & 0xff), 0xff);
    m.w8(chr + (m.r16(0x3c89) & 0xff), 0);
  }
  /** c9f5: "(A)ll / Enter" confirmation */
  private confirm() {
    const m = this.m;
    m.w8(0x3bdc, 0x18); m.w8(0x3bdd, 0x17); this.text(0x39bf); this.ptext();
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) throw new Exit(0xc5e1);
      if (k === 0x41 || k === 0x0d) return;
    }
  }
  /** CODE+0xCAAE: choose a party member; true = cancelled (CF) */
  private pickCharacter(): boolean {
    const m = this.m;
    this.ptext();
    this.cout(m.r8(NPARTY) + 0x30); this.cout(0x27); this.cout(0x3f);
    this.escl();
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) return true;
      if (k < 0x31) continue;
      const sel = u8(k - 0x31);
      if (sel >= m.r8(NPARTY)) continue;
      m.w16(CHARPOS, m.r16(PARTYTAB + 2 * sel));
      return false;
    }
  }
  /** CODE+0xCAFF: choose a monster; true = cancelled (CF). One monster: no prompt, falls into the confirmation (`pop ax; jmp 0xC9F5`) */
  private pickGroup(): boolean {
    const m = this.m;
    if (m.r8(NMON) === 1) {
      m.w8(STARTNUM, 0);
      m.w8(MONPTR, m.r8(MONTAB)); m.w8(MONPTR + 1, m.r8(MONTAB + 1));
      this.setmony3();
      this.confirm();
      return false;
    }
    this.ptext();
    this.cout(m.r8(NMON) + 0x40); this.cout(0x27); this.cout(0x3f);
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) return true;
      if (k < 0x41) continue;
      const sel = u8(k - 0x41);
      if (sel >= m.r8(NMON)) continue;
      m.w8(STARTNUM, sel);
      const bl = u8(sel << 1);
      m.w8(MONPTR, m.r8(MONTAB + bl)); m.w8(MONPTR + 1, m.r8(MONTAB + bl + 1));
      this.setmony3();
      return false;
    }
  }
  // ---- engines ----
  /** CODE+0xCD63: header for a multi-monster spell */
  protected cd63() {
    const m = this.m;
    this.clropt(); m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0);
    m.w16(BDW_TEXT, m.r16(CHARP)); this.ptext();
    this.inc(0x3bdc);
    this.text(0x3ad9); this.ptext();
    m.w8(MON0, m.r8(NMON));
  }
  /** CODE+0xCD8D: blank the two message rows and print the current target's name */
  protected cd8d() {
    const m = this.m;
    for (let bl = 0; bl < 0x28; bl++) { this.ui('puttoscr'); this.ui('puttoscr'); }
    m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0);
    let al = u8(m.r8(STARTNUM) + m.r8(NMON));
    const borrow = al < m.r8(MON0);
    al = u8(al - m.r8(MON0));
    if (borrow) al = 0;
    this.pmonname(al);
  }
  protected cdcc() { this.inc(0x3bdc); this.text(0x361a); this.ptext(); }
  /** monster resist kinds (DS:0x318A table of code pointers 0xA7EA..0xA80D): CF = the monster is of that kind (+0x1A mask test) */
  private mresl(kind: number): number {
    const m = this.m;
    const MASK = [0x40, 0x20, 0x60, 0x10, 8, 4, 2, 1];
    const target = m.r16(MRESL + 2 * kind);
    const idx = [0xa7ea, 0xa7ef, 0xa7f4, 0xa7f9, 0xa7fe, 0xa803, 0xa808, 0xa80d].indexOf(target);
    if (idx < 0) throw new Error('unexpected mresl entry');
    m.w8(0x3bb8, MASK[idx]);
    const v = m.r8(m.r16(MONPTR) + 0x1a) & m.r8(0x3bb8);
    return v === m.r8(0x3bb8) ? 1 : 0;
  }
  private nextTarget(): boolean {
    const m = this.m;
    this.inc(STARTNUM);
    const al0 = m.r8(MON0);
    if (al0 <= m.r8(STARTNUM)) return false;
    const al = u8(m.r8(NMON) + m.r8(STARTNUM));
    if (al < m.r8(MON0)) return false;
    const idx = u8(u8(al - m.r8(MON0)) << 1);
    m.w8(MONPTR, m.r8(MONTAB + idx)); m.w8(MONPTR + 1, m.r8(MONTAB + idx + 1));
    this.setmony3();
    this.delay();
    return true;
  }
  /** `jmp 0xCBAE` condition engine: sets status bits P_VAL on up to P_CNT monsters starting at the chosen one */
  condEngine(): never {
    const m = this.m;
    this.cd63();
    for (;;) {
      this.cd8d();
      let affected = true;
      if (this.wrong !== 'noMonsterResist' && monsterResist(m)) affected = false;
      else if (m.r8(P_SAVE) !== 0) { saveMonster(m); if (m.r8(0x31b2) !== 0) affected = false; }
      if (affected && (m.r16(P_RES) & 0xff) !== 0) {
        let bp = (m.r16(P_RES) & 0xff) - 1;
        if (bp >= 8) bp = 0;
        if (this.mresl(bp)) affected = false;
      }
      if (!affected) this.cdcc();
      else {
        const bp = m.r16(0x38b2);
        m.w8(0x3879 + bp, m.r8(0x3879 + bp) | m.r8(P_VAL));
        let b = 0, a = m.r8(P_VAL);
        for (;;) { const c = a & 1; a >>= 1; if (c) break; b++; if (b >= 8) break; }
        m.w16(BDW_TEXT, m.r16(0x3a9e + 2 * b));
        this.inc(0x3bdc); this.ptext();
      }
      m.w8(P_CNT, m.r8(P_CNT) - 1);
      if (m.r8(P_CNT) === 0) break;
      this.pmonst();
      if (!this.nextTarget()) break;
    }
    this.pmonst(); this.delay();
    return this.retfspl();
  }
  /** `jmp 0xCC84` damage engine: P_VAL damage to up to P_CNT monsters (monster resistance, saving throw halves, resist kind quarters) */
  dmgEngine(): never {
    const m = this.m;
    this.cd63();
    m.w8(DMGTOT, m.r8(P_VAL));
    for (;;) {
      this.cd8d();
      if (this.wrong !== 'noMonsterResist' && monsterResist(m)) this.cdcc();
      else {
        if (m.r8(P_SAVE) !== 0) { saveMonster(m); if (m.r8(0x31b2) !== 0 && this.wrong !== 'noSaveHalving') m.w8(DMGTOT, m.r8(DMGTOT) >> 1); }
        if ((m.r16(P_RES) & 0xff) !== 0) {
          let bp = (m.r16(P_RES) & 0xff) - 1;
          if (bp >= 8) bp = 0;
          if (this.mresl(bp) && this.wrong !== 'noKindQuarter') { m.w8(DMGTOT, m.r8(DMGTOT) >> 1); m.w8(DMGTOT, m.r8(DMGTOT) >> 1); }
        }
        if (m.r8(DMGTOT) === 0) this.cdcc();
        else {
          this.inc(0x3bdc);
          this.inopsh();
          const bp = m.r16(0x38b2);
          if (m.r8(DMGTOT) >= m.r8(0x3888 + bp)) { this.inc(0x3bdd); m.w8(0x3bdc, 0); this.text(0x3829); this.ptext(); }
          m.w8(0x2e7f, 1);
          this.sub(applyDamageMonster(m));
          m.w8(0x2e7f, 0);
        }
      }
      m.w8(P_CNT, m.r8(P_CNT) - 1);
      if (m.r8(P_CNT) === 0) break;
      this.inc(STARTNUM);
      if (m.r8(MON0) <= m.r8(STARTNUM)) break;
      const al = u8(m.r8(NMON) + m.r8(STARTNUM));
      if (al < m.r8(MON0)) break;
      const idx = u8(u8(al - m.r8(MON0)) << 1);
      m.w8(MONPTR, m.r8(MONTAB + idx)); m.w8(MONPTR + 1, m.r8(MONTAB + idx + 1));
      this.setmony3();
      this.delay();
      m.w8(DMGTOT, m.r8(P_VAL));
    }
    this.pmonst(); this.delay();
    return this.retfspl();
  }
  /** CODE+0xB424 `inopsh`: "<n> point(s) of damage" line */
  inopsh() {
    const m = this.m;
    this.text(0x3583); this.ptext();
    m.w8(0x3c14, m.r8(DMGTOT)); this.ui('pdec');
    this.inc(0x3bdc);
    this.text(0x358a); this.ptext();
    if (m.r8(DMGTOT) >= 2) this.cout(0x53);
    this.inc(0x3bdc);
    if (m.r8(0x3bdc) >= 0x1e) { m.w8(0x3bdc, m.r8(0x3bdc) - 1); this.cout(0x21); }
    else { this.text(0x3590); this.ptext(); }
  }
  /** CODE+0xCE21 heal engine: HP (+0x33, 16 bit) += DS:3AE8 capped at the maximum (+0x37), then clears the "unconscious" bit */
  heal() {
    const m = this.m;
    const ch = m.r16(CHARPOS);
    m.w8(0x3ae9, m.r8(ch + 0x33));
    m.w8(0x3aea, m.r8(ch + 0x34));
    const s = m.r8(0x3ae9) + m.r8(0x3ae8);
    m.w8(0x3ae9, s);
    if (s > 255) { this.inc(0x3aea); if (m.r8(0x3aea) === 0) m.w8(0x3aea, m.r8(0x3aea) - 1); }
    const hi = m.r8(0x3aea), mh = m.r8(ch + 0x38);
    let over = false;
    if (hi > mh) over = true;
    else if (hi === mh) over = m.r8(0x3ae9) > m.r8(ch + 0x37);
    if (over && this.wrong !== 'healNoCap') { m.w8(ch + 0x33, m.r8(ch + 0x37)); m.w8(ch + 0x34, m.r8(ch + 0x38)); }
    else { m.w8(ch + 0x33, m.r8(0x3ae9)); m.w8(ch + 0x34, m.r8(0x3aea)); }
    this.cea8();
  }
  private cea8() {
    const m = this.m;
    const ch = m.r16(CHARPOS);
    const al = m.r8(ch + 0x3f);
    if (al >= 0x80) return;
    m.w8(m.r16(CHARPOS) + 0x3f, al & 0xbf);
  }
  /** CODE+0xD9FE: "the spell fails" */
  protected fail(): never {
    const m = this.m;
    this.clropt(); this.text(0x3ba9); m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0xa);
    this.stars();
    const bp = m.r16(CURIDX) & 0xff;
    m.w8(PARTYG + bp, 1);
    this.delay();
    throw new Exit(0xc7c4);
  }
  /** `pop ax; jmp donespel` tail shared by several handlers (CODE+0xCF8F) */
  private doneParty(): never {
    const bp = this.m.r16(CURIDX) & 0xff;
    this.m.w8(PARTYG + bp, 1);
    throw new Exit(0xc7c4);
  }
  /** the 3 random(10) sum used by several damage spells (CODE+0xD7E4..0xD80B) */
  private d10x(n: number, base: number): number { let v = base; for (let i = 0; i < n; i++) v = u8(random(this.m, 10) + v); return v; }
  private partyFx(addr: number, plus: number) { const m = this.m; m.w8(addr, u8(m.r8(m.r16(CHARP) + 0x24) + plus)); }
  /** CODE+0xB475 `mdmga_s`: apply the spell to every party member (resist, save, damage) */
  protected partyDamage() {
    const m = this.m;
    const saved = m.r16(CHARP);
    let bl = 0;
    do {
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      m.w8(0x3582, bl);
      this.mdmga();
      this.delay();
      bl = u8(m.r8(0x3582) + 1);
    } while (bl < m.r8(NPARTY));
    m.w16(CHARP, saved);
  }
  /** CODE+0xB3FD..: one party member suffers P_VAL damage (resists/saves reduce it) */
  protected mdmga() {
    const m = this.m;
    m.w8(0x3581, 1);
    m.w8(DMGTOT, m.r8(P_VAL));
    try {
      this.b5ac(); this.b5f7(); this.b615();
    } catch (e) { if (e instanceof Abort) return; throw e; }
    if (m.r8(0x3ca5) !== 0) m.w8(DMGTOT, m.r8(DMGTOT) >> 1);
    this.inopsh();
    this.sub(applyDamageChar(m));
  }
  protected b5ac() {
    const m = this.m;
    for (let bl = 0; bl < 0x28; bl++) { this.ui('puttoscr'); this.ui('puttoscr'); }
    m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0);
    m.w16(BDW_TEXT, m.r16(CHARP)); this.ptext();
    this.inc(0x3bdc);
    if (m.r8(P_SAVE) === 0) return;
    if (resistRoll(m, 0)) return;
    this.innoef(); throw new Abort();
  }
  protected innoef() { this.text(0x361a); this.ptext(); }
  protected b5f7() {
    const m = this.m;
    if (m.r8(P_RES) === 0) return;
    saveChar(m);
    if (m.r8(0x31b1) === 0) return;
    if (m.r8(0x3581) === 0) { this.innoef(); throw new Abort(); }
    m.w8(DMGTOT, m.r8(DMGTOT) >> 1);
  }
  protected b615() {
    const m = this.m;
    const al = m.r8(P_CNT);
    if (al === 0 || al > 7) return;
    if (resistRoll(m, al)) return;
    if (m.r8(0x3581) === 0) { this.innoef(); throw new Abort(); }
    m.w8(DMGTOT, m.r8(DMGTOT) >> 1); m.w8(DMGTOT, m.r8(DMGTOT) >> 1);
  }
  /** CODE+0xCFA1: kill the current monster (condition 0xFF) */
  protected killMonster() {
    const bp = this.m.r16(0x38b2);
    this.m.w8(0x3879 + bp, 0xff);
    this.ui('dosound', [9]);
  }
  /** turn/dispel tail (CODE+0xCF69): report kills, compact the list */
  private turnTail(): never {
    const m = this.m;
    if (m.r8(0x3aec) === 0) return this.noEffectDone();
    this.clropt(); this.text(0x3aed); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 5); this.ptext();
    return this.cf86();
  }
  private cf86(): never {
    resMon2(this.m); this.pmonst(); this.delay();
    return this.doneParty();
  }
  private noEffectDone(): never {
    const m = this.m;
    this.clropt(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0xf); this.text(0x3b0b); this.ptext(); this.delay();
    return this.doneParty();
  }
  private handler(a: number) {
    const m = this.m;
    const chr = () => m.r16(CHARP);
    const tgt = () => m.r16(CHARPOS);
    const cnt = () => m.r8(NPARTY);
    switch (a) {
      case 0xcdd4: case 0xd4bb: { // Awaken: clear the sleep bit of every living member
        let bl = 0;
        do {
          m.w16(CHARPOS, m.r16(PARTYTAB + u8(bl << 1)));
          const al = m.r8(m.r16(CHARPOS) + 0x3f);
          if (al < 0x80) m.w8(m.r16(CHARPOS) + 0x3f, al & 0xfe);
          bl++;
        } while (bl < cnt());
        return;
      }
      case 0xce02: this.inc(0x3ca2); return;
      case 0xce07: this.inc(P_SAVE); m.w8(P_RES, 7); m.w8(P_VAL, 2); this.inc(P_CNT); return this.condEngine();
      case 0xce1c: m.w8(0x3ae8, 8); this.heal(); return;
      case 0xcebd: case 0xd05e: case 0xd0a1: case 0xd0ba: case 0xd10a: case 0xd11a: case 0xd26e: case 0xd2f6: case 0xd2c1: case 0xd307:
      case 0xd3a1: case 0xd3c2: case 0xd49f: case 0xd511: case 0xd6ac: case 0xd6be: case 0xd719: case 0xd761: case 0xd785: case 0xd85c:
      case 0xd861: case 0xd929: case 0xd99a:
        return;
      case 0xcebe: { // heal: sum of level d10 (8-bit cap 0xFA)
        const lv = m.r8(chr() + 0x24);
        let bl = lv;
        m.w8(0x3ae8, 0);
        do {
          const s = random(m, 10) + m.r8(0x3ae8);
          m.w8(0x3ae8, s);
          if (s > 255) { m.w8(0x3ae8, 0xfa); break; }
          bl = u8(bl - 1);
        } while (bl !== 0);
        this.heal(); return;
      }
      case 0xcef0: this.partyFx(0x3c95, 0x14); return;
      case 0xd02f: this.partyFx(0x3c96, 0x14); return;
      case 0xd03f: this.partyFx(0x3c97, 0x14); return;
      case 0xd04f: this.partyFx(0x3c98, 0x14); return;
      case 0xd0fb: this.partyFx(0x3c99, 0x14); return;
      case 0xd10b: this.partyFx(0x3c9a, 0x14); return;
      case 0xd960: this.partyFx(0x3c9b, 0x14); return;
      case 0xd850: m.w8(0x3ca1, m.r8(chr() + 0x24)); return;
      case 0xd505: m.w8(0x3c9d, m.r8(chr() + 0x24)); return;
      case 0xcf00: return this.turn(false);
      case 0xd441: return this.turn(true);
      case 0xcfce: m.w8(0x3ae8, 0x10); this.heal(); return;
      case 0xcfd9: {
        if (m.r8(chr() + 0x12) !== m.r8(tgt() + 0x12)) return this.fail();
        if (m.r8(tgt() + 0x24) !== m.r8(tgt() + 0x23)) return this.fail();
        m.w8(tgt() + 0x24, m.r8(tgt() + 0x24) + 2);
        m.w8(0x3ae8, 6); this.heal(); return;
      }
      case 0xd00a: { m.w8(P_VAL, random(m, 6)); m.w8(P_VAL, u8(random(m, 6) + m.r8(P_VAL))); this.inc(P_SAVE); this.inc(P_CNT); m.w8(P_RES, 6); return this.dmgEngine(); }
      case 0xd05f: this.inc(P_SAVE); m.w8(P_RES, 7); this.inc(P_CNT); m.w8(P_VAL, 4); return this.condEngine();
      case 0xd074: case 0xd54d: this.inc(P_SAVE); m.w8(P_RES, 6); this.inc(P_CNT); m.w8(P_VAL, 0x20); return this.condEngine();
      case 0xd089: { const al = m.r8(tgt() + 0x3f); if (al >= 0x80) return this.fail(); m.w8(tgt() + 0x3f, al & 0xfd); return; }
      case 0xd0a2: { const al = m.r8(tgt() + 0x3f); if (al >= 0x80) return this.fail(); m.w8(tgt() + 0x3f, al & 0xdf); return; }
      case 0xd0bb: this.inc(P_SAVE); this.inc(P_RES); this.inc(P_CNT); return this.d6x3();
      case 0xd0ec: this.inc(P_SAVE); this.inc(P_CNT); m.w8(P_RES, 4); return this.d6x3();
      case 0xd11b: case 0xd6d4: { // group damage that also hits the party when aimed at the melee group
        if (m.r8(STARTNUM) < m.r8(0x3c11)) {
          this.cd63();
          m.w8(P_VAL, u8(u8(m.r8(chr() + 0x24) << 1) + 4));
          this.inc(P_SAVE); this.inc(P_RES);
          if (a === 0xd11b) m.w8(P_CNT, 3); else this.inc(P_CNT);
          if (this.wrong !== 'skipPartyHit') this.partyDamage();
        }
        if (a === 0xd11b) {
          m.w8(P_SAVE, 1); m.w8(P_RES, 2); m.w8(P_CNT, 3);
          m.w8(P_VAL, u8(random(m, 0x1d) + 3));
          return this.dmgEngine();
        }
        m.w8(P_SAVE, 1); m.w8(P_RES, 1); m.w8(P_CNT, 5); m.w8(P_VAL, 0);
        return this.levelDice();
      }
      case 0xd168: {
        if (m.r8(tgt() + 0x24) !== m.r8(tgt() + 0x23)) return this.fail();
        m.w8(tgt() + 0x24, m.r8(tgt() + 0x24) + 3);
        m.w8(0x3ae8, 0xa); this.heal(); return;
      }
      case 0xd18c: {
        this.firstTarget();
        this.inc(P_SAVE); m.w8(P_RES, 0);
        const x = random(m, 10); m.w8(0x3bb8, x);
        m.w8(P_VAL, u8(random(m, 10) + m.r8(0x3bb8)));
        return this.dmgEngine();
      }
      case 0xd1b0: case 0xd8d0: return this.goz();
      case 0xd26f: this.firstTarget(); this.inc(P_SAVE); m.w8(P_RES, 6); m.w8(P_CNT, m.r8(0x3c11)); m.w8(P_VAL, 0x80); return this.condEngine();
      case 0xd289: {
        let al = m.r8(tgt() + 0x3f);
        if (al >= 0x80) return this.fail();
        m.w8(tgt() + 0x3f, al & 0x80);
        if (m.r8(tgt() + 0x34) === 0 && m.r8(tgt() + 0x33) === 0) m.w8(tgt() + 0x33, 1);
        m.w8(0x3ae8, 1); this.heal(); return;
      }
      case 0xd2c2: {
        if (!(m.r8(tgt() + 0x24) < m.r8(tgt() + 0x23))) return this.fail();
        const al = u8(random(m, 5) + m.r8(tgt() + 0x24));
        if (al < m.r8(tgt() + 0x23)) m.w8(tgt() + 0x24, al);
        else m.w8(tgt() + 0x24, m.r8(tgt() + 0x23));
        return;
      }
      case 0xd308: {
        m.w8(0x3b18, 0);
        for (let bl = 3; bl > 0; bl--) m.w8(0x3b18, u8(random(m, 10) + m.r8(0x3b18)));
        let bl = 0;
        do {
          m.w16(CHARPOS, m.r16(PARTYTAB + u8(bl << 1)));
          m.w8(0x3ae8, m.r8(0x3b18));
          this.heal();
          bl++;
        } while (bl < cnt());
        this.firstTarget();
        m.w8(P_VAL, m.r8(0x3b18)); m.w8(P_RES, 5); this.inc(P_SAVE);
        return this.dmgEngine();
      }
      case 0xd35b: {
        if (m.r8(tgt() + 0x3f) !== 0xc0) return this.fail();
        const r = random(m, 100);
        if (r === 0x64) { m.w8(tgt() + 0x3f, 0xff); return this.fail(); }
        if (r >= 0x5b) return this.fail();
        m.w8(tgt() + 0x3f, 0); m.w8(tgt() + 0x33, 1); m.w8(tgt() + 0x34, 0);
        return;
      }
      case 0xd3a2: {
        if (m.r8(tgt() + 0x3f) !== 0xe0) return this.fail();
        m.w8(tgt() + 0x3f, 0); m.w8(0x3ae8, 1); this.heal(); return;
      }
      case 0xd3c3: {
        if (m.r8(chr() + 0x11) !== m.r8(chr() + 0x12)) return this.fail();
        if (m.r8(0x3b19) !== 0) return this.fail();
        this.inc(0x3b19);
        const s = m.r8(chr() + 0x25) + 5;
        if (s > 255) return this.fail();
        m.w8(chr() + 0x25, s);
        let bl = 0;
        do {
          m.w16(CHARPOS, m.r16(PARTYTAB + u8(bl << 1)));
          if (m.r8(tgt() + 0x3f) !== 0xff) {
            m.w8(tgt() + 0x3f, 0);
            let al = m.r8(tgt() + 0x35); m.w8(tgt() + 0x33, al); m.w8(tgt() + 0x37, al);
            al = m.r8(tgt() + 0x36); m.w8(tgt() + 0x34, al); m.w8(tgt() + 0x38, al);
          }
          bl++;
        } while (bl < cnt());
        return;
      }
      case 0xd481: { const al = u8(m.r8(chr() + 0x24) + 0x19); for (const o of [0x3c95, 0x3c96, 0x3c97, 0x3c98, 0x3c99, 0x3c9a]) m.w8(o, al); return; }
      case 0xd4a0: m.w8(P_VAL, u8(random(m, 0x33) + 0x31)); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 1); return this.dmgEngine();
      case 0xd4be: {
        let bl = m.r8(chr() + 0x24);
        m.w8(P_VAL, 0);
        do { m.w8(P_VAL, u8(random(m, 4) + m.r8(P_VAL))); bl = u8(bl - 1); } while (bl !== 0);
        m.w8(P_RES, 5); this.inc(P_CNT); return this.dmgEngine();
      }
      case 0xd4ed: m.w8(P_VAL, random(m, 6)); this.inc(P_SAVE); m.w8(P_RES, 1); this.inc(P_CNT); return this.dmgEngine();
      case 0xd512: this.inc(P_SAVE); m.w8(P_RES, 8); m.w8(P_CNT, 5); m.w8(P_VAL, 0x10); return this.condEngine();
      case 0xd528: m.w8(P_VAL, random(m, 6)); m.w8(P_VAL, u8(random(m, 6) + m.r8(P_VAL))); this.inc(P_SAVE); this.inc(P_CNT); m.w8(P_RES, 2); return this.dmgEngine();
      case 0xd550: return this.identify();
      case 0xd69b: m.w8(tgt() + 0x18, u8(random(m, 4) + m.r8(tgt() + 0x18))); return;
      case 0xd6ad: m.w8(tgt() + 0x1e, u8(random(m, 4) + m.r8(tgt() + 0x1e))); return;
      case 0xd6bf: this.inc(P_SAVE); m.w8(P_RES, 7); this.inc(P_CNT); m.w8(P_VAL, 1); return this.condEngine();
      case 0xd715: this.inc(0x3ca3); return;
      case 0xd71a: this.inc(P_SAVE); m.w8(P_CNT, 3); m.w8(P_RES, 2); return this.levelDice();
      case 0xd74d: for (const o of [0x3c08, 0x3c09, 0x3c0a, 0x3c0b, 0x3c0c]) m.w8(o, 1); this.ui('pnums'); return;
      case 0xd762: {
        let bl = 0;
        do {
          this.setmony2(bl);
          let al = m.r8(m.r16(MONPTR) + 0x15) >> 1;
          if (al === 0) al = 1;
          m.w8(m.r16(MONPTR) + 0x15, al);
          bl++;
        } while (bl < m.r8(NMON));
        return;
      }
      case 0xd786: {
        let bl = 0;
        do {
          const bp = this.setmony2(bl);
          let al = u8(m.r8(0x386a + bp) - 1);
          if (al === 0) al = 1;
          m.w8(0x386a + bp, al);
          bl++;
        } while (bl < m.r8(NMON));
        this.firstTarget();
        this.inc(P_SAVE); m.w8(P_VAL, 2); return this.dmgEngine();
      }
      case 0xd7b5: if (m.r8(STARTNUM) < m.r8(0x3c11)) return this.fail();
        this.inc(P_SAVE); m.w8(P_RES, 0); m.w8(P_CNT, 5); m.w8(P_VAL, 0x40); return this.condEngine();
      case 0xd7d7: this.inc(P_SAVE); this.inc(P_CNT); m.w8(P_RES, 3); m.w8(P_VAL, this.d10x(3, m.r8(P_VAL))); return this.dmgEngine();
      case 0xd80e: this.inc(P_SAVE); this.inc(P_CNT); m.w8(P_RES, 4); m.w8(P_VAL, random(m, 10)); m.w8(P_VAL, this.d10x(3, m.r8(P_VAL))); return this.dmgEngine();
      case 0xd825: this.inc(P_SAVE); m.w8(P_RES, 0); this.inc(P_CNT); m.w8(P_VAL, 8); return this.condEngine();
      case 0xd83a: m.w8(P_SAVE, 0); m.w8(P_RES, 6); this.inc(P_CNT); m.w8(P_VAL, 0x80); return this.condEngine();
      case 0xd85d: this.inc(0x3ca4); return;
      case 0xd862: {
        const r = random(m, 100);
        const lim = this.getod(0x26);
        if (r < (lim & 0xff)) return this.fail();
        throw new Exit(0x9a46);
      }
      case 0xd87c: {
        const al = m.r8(0x3c11);
        if (al >= m.r8(NMON)) return this.fail();
        m.w8(STARTNUM, al);
        const bl = u8(al << 1);
        m.w8(MONPTR, m.r8(MONTAB + bl)); m.w8(MONPTR + 1, m.r8(MONTAB + bl + 1));
        this.setmony3();
        m.w8(P_SAVE, 1); m.w8(P_RES, 3); m.w8(P_CNT, 0xf); m.w8(P_VAL, 0);
        for (let bx = 5; bx > 0; bx--) m.w8(P_VAL, u8(random(m, 10) + m.r8(P_VAL)));
        return this.dmgEngine();
      }
      case 0xd8d3: return this.dispel(false);
      case 0xd940: return this.dispel(true);
      case 0xd92a: this.firstTarget(); m.w8(P_SAVE, 0); m.w8(P_RES, 0); m.w8(P_VAL, random(m, 0x1e)); return this.dmgEngine();
      case 0xd970: {
        this.inc(P_SAVE); this.firstTarget(); m.w8(P_RES, 5);
        let al = u8(random(m, 0x78) + 1 + m.r8(chr() + 0x24));      // `adc` straight after `random`: CF = 1 is added
        if (al >= 0x78) al = 0x78;
        m.w8(P_VAL, al);
        return this.dmgEngine();
      }
      case 0xd996: this.inc(0x3ca5); return;
      case 0xd99b: {
        this.firstTarget();
        const r = random(m, 100);
        if (r < 0x14) return this.fail();
        this.inc(P_SAVE);
        if (r >= 0x32) {
          let bl = random(m, 8), al = 1;
          while (--bl !== 0) al = u8(al << 1);
          m.w8(P_VAL, al); return this.condEngine();
        }
        let bl = random(m, 4), al = 0xa;
        while (--bl !== 0) al = u8(al << 1);
        m.w8(P_VAL, al); return this.dmgEngine();
      }
      default: throw new Error(`unported comcast handler ${a.toString(16)}`);
    }
  }
  /** CODE+0xD0C7: 3 x d6 -> P_VAL then damage engine (the second variant reached via 0xD0EC) */
  private d6x3(): never {
    const m = this.m;
    m.w8(P_VAL, random(m, 6));
    m.w8(P_VAL, u8(random(m, 6) + m.r8(P_VAL)));
    m.w8(P_VAL, u8(random(m, 6) + m.r8(P_VAL)));
    return this.dmgEngine();
  }
  /** CODE+0xD728: P_VAL += d6 per caster level, damage engine */
  private levelDice(): never {
    const m = this.m;
    const lv = m.r8(m.r16(CHARP) + 0x24);
    if (lv !== 0) { let bl = lv; do { m.w8(P_VAL, u8(random(m, 6) + m.r8(P_VAL))); bl = u8(bl - 1); } while (bl !== 0); }
    return this.dmgEngine();
  }
  /** CODE+0xCF00 / 0xD441: turn undead (monsters with +0x19 bit 7 are destroyed on a level-dependent roll / always) */
  private turn(all: boolean): never {
    const m = this.m;
    const chr = m.r16(CHARP);
    if (m.r8(chr + 0x11) !== m.r8(chr + 0x12)) return this.fail();
    if (!all) {
      if (m.r8(0x3aeb) !== 0) return this.noEffectDone();
      this.inc(0x3aeb);
    } else m.w8(0x3aec, 0);
    let bl = 0;
    do {
      this.setmony2(bl);
      if (m.r8(m.r16(MONPTR) + 0x19) >= 0x80) {
        if (!all) {
          const idx = m.r16(0x38b2);
          m.w8(0x3bb8, u8(u8(m.r8(0x3c29 + idx) << 1) + 0xa));
          const al = u8(random(m, 0x14) + m.r8(m.r16(CHARP) + 0x24));
          if (!(al < m.r8(0x3bb8))) { this.killMonster(); this.inc(0x3aec); }
        } else { this.killMonster(); this.inc(0x3aec); }
      }
      bl++;
    } while (bl < m.r8(NMON));
    return this.turnTail();
  }
  /** CODE+0xD1C6: dispel everything (clear the party effect bytes, reset every member, clear every monster's condition) */
  protected goz(): void {
    const m = this.m;
    const r = random(m, 100);
    const lim = this.getod(0x26);
    if (!(r >= (lim & 0xff))) return this.fail();
    this.gozClear();
  }
  /** CODE+0xD1C6 `goz34` */
  protected gozClear(): void {
    const m = this.m;
    for (let bl = 0; bl < 0x13; bl++) m.w8(0x3c95 + bl, 0);
    m.w8(0x3b16, m.r8(CHARP)); m.w8(0x3b17, m.r8(CHARP + 1));
    let bp = 0;
    do {
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      m.w8(0x3bb9, bp);
      const c = m.r16(CHARP);
      for (const o of [0x15, 0x17, 0x19, 0x1b, 0x1d, 0x1f, 0x21, 0x23, 0x2f]) m.w8(c + o + 1, m.r8(c + o));
      resetAc(m);
      for (let o = 0x58; o < 0x68; o += 2) m.w8(c + o + 1, m.r8(c + o));
      const al = m.r8(m.r16(CHARP) + 0x3f);
      if (al < 0x80) m.w8(m.r16(CHARP) + 0x3f, al & 0xf9);
      bp = u8(u8(m.r16(0x3bb9) & 0xff) + 2);
    } while ((bp >> 1) < m.r8(NPARTY));
    m.w8(CHARP, m.r8(0x3b16)); m.w8(CHARP + 1, m.r8(0x3b17));
    m.w8(0x3b16, m.r8(MONPTR)); m.w8(0x3b17, m.r8(MONPTR + 1));
    let bl = 0;
    do {
      const b = this.setmony2(bl);
      m.w8(0x3879 + b, 0);
      bl++;
    } while (bl < m.r8(NMON));
    m.w8(MONPTR, m.r8(0x3b16)); m.w8(MONPTR + 1, m.r8(0x3b17));
    this.setmony3();
  }
  /** CODE+0xD8D3 / 0xD940: destroy one monster unless it resists / saves */
  private dispel(second: boolean): never {
    const m = this.m;
    this.cd63();
    m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0);
    this.pmonname(m.r16(STARTNUM) & 0xff);
    this.inc(0x3bdc);
    if (!second) {
      if (m.r8(m.r16(MONPTR) + 0x19) >= 0x80) return this.d904();
    }
    if (monsterResist(m)) return this.d904();
    saveMonster(m);
    if (m.r8(0x31b2) !== 0) return this.d904();
    this.text(second ? 0x3b87 : 0x3332); this.ptext();
    this.killMonster();
    return this.cf86();
  }
  private d904(): never { this.text(0x361a); this.ptext(); return this.cf86(); }
  /** CODE+0xD550 Identify Monster: stat sheet of the chosen monster */
  private identify(): never {
    const m = this.m;
    this.clropt(); m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0);
    this.pmonname(m.r16(STARTNUM) & 0xff);
    this.cout(0x3a);
    m.w8(0x3bdc, 0x15); this.text(0x3b3c); this.ptext();
    let bp = m.r16(0x38b2);
    m.w8(0x3c14, m.r8(0x3888 + bp)); this.ui('pdec');
    this.inc(0x3bdc); this.inc(0x3bdc);
    this.text(0x3b54); this.ptext();
    bp = m.r16(0x38b2);
    m.w8(0x3c14, m.r8(0x386a + bp)); this.ui('pdec');
    m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0);
    this.text(0x3b6c); this.ptext();
    const mp = () => m.r16(MONPTR);
    m.w8(0x3c14, m.r8(mp() + 0x15)); this.ui('pdec');
    m.w8(0x3bdc, 0x15); this.text(0x3b42); this.ptext();
    this.cout(m.r8(mp() + 0x1b) !== 0 ? 0x59 : 0x4e);
    m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0);
    this.text(0x3b2c); this.ptext();
    m.w8(0x3c14, m.r8(mp() + 0x14)); this.ui('pdec');
    m.w8(0x3bdc, 0x15); this.text(0x3b5a); this.ptext();
    { const al = m.r8(mp() + 0x1c); this.cout(al > 0 && al < 0x80 ? 0x59 : 0x4e); }
    m.w8(0x3bdd, 0x17); m.w8(0x3bdc, 0);
    this.text(0x3b1a); this.ptext();
    m.w8(0x3c14, m.r8(mp() + 0x13)); this.ui('pdec');
    m.w8(0x3bdc, 0x15); this.text(0x3b75); this.ptext();
    this.cout((m.r8(mp() + 0x19) & 0x7f) !== 0 ? 0x59 : 0x4e);
    this.wait();
    return this.doneParty();
  }
}
class Abort extends Error {}

/** CODE+0xAF49 `ability`: a monster's special action. Fields of the acting monster: +0x1C ability id (1..32), +0x1D use chance (percent),
 *  +0x1E low nibble uses left. The 32 handlers (DS:0x33CF) set the engine bytes (3C82 magic-resist applies, 3C83 saving throw
 *  applies / on breath weapons the element, 3C84 element kind, 3C85 value) and end in one of four engines: random-target damage
 *  (0xB3FA), whole-party damage (0xB470), random-target status (0xB4B1) or whole-party status (0xB50E). Stops: 0x9E94 the action was
 *  taken; stop = -1 means no ability this turn (melee follows). */
/** The combat item use `useitem` (CODE+0xC5FD): choose an item (1-6 / A-F); a stat item changes the stat, a spell item enters the combat cast at 0xC95F with no SP / gem cost. */
export class UseItem extends ComCast {
  runItem(): { stop: number; calls: Call[] } {
    try { this.useitem(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('useitem fell through');
  }
  private retfvqr2() { for (const n of ['home', 'pdatal', 'pround', 'pmonst', 'pinit', 'pcharn', 'pnums']) this.ui(n); }
  private useitem() {
    const m = this.m;
    let bx = 0, bp = 0, found = false;
    for (;;) {
      if (m.r8(PARTYTAB + bx) === m.r8(CHARP) && m.r8(PARTYTAB + bx + 1) === m.r8(CHARP + 1)) { found = true; break; }
      bx = u8(bx + 2); bp = u8(bp + 1);
      if (bp >= m.r8(NPARTY)) break;
    }
    if (!found) bp = 0;
    bp = u8(bp + 1);
    this.ui('viewch', [bp]);
    for (;;) {                                  // 0xC635: the prompt
      this.ui('clrtext4'); this.escl();
      m.w8(0x3bdc, 7); m.w8(0x3bdd, 0x14); this.text(0x393c); this.ptext();
      let k: number;
      let item: { id: number; slot: number } | undefined;
      while (!item) {
        k = this.wait();
        if (k === 0x1b) throw new Exit(0xc5e1);
        if (k < 0x31) continue;
        if (k < 0x37) { m.w8(0x3c86, u8(k - 0x31)); m.w8(0x3939, 0x40); m.w8(0x393a, 0x46); }
        else {
          if (k < 0x41 || k >= 0x47) continue;
          m.w8(0x3c86, u8(k - 0x41)); m.w8(0x3939, 0x46); m.w8(0x393a, 0x4c);
        }
        let slot = m.r16(0x3939) & 0xff, nth = 0;
        for (;;) {
          const id = m.r8(m.r16(CHARP) + slot);
          if (id !== 0) {
            if (nth === m.r8(0x3c86)) { item = { id, slot }; break; }
            nth++;
          }
          slot = u8(slot + 1);
          if (slot >= m.r8(0x393a)) break;
        }
      }
      m.w8(0x3c86, item.id); m.w8(0x3c87, item.slot);
      m.w8(0x3c89, u8(item.slot + 0x0c));
      m.w8(0x3c88, m.r8(m.r16(CHARP) + u8(item.slot + 0x0c)));
      this.getInfo(item.id);
      let bad = 0;
      if (m.r8(0x3cec) === 0) bad = 0x3957;
      else if (m.r8(0x3cea) !== 1 && m.r8(0x3c87) >= 0x46) bad = 0x3978;
      else if (m.r8(0x3c88) === 0) bad = 0x3968;
      if (bad) {
        this.clropt(); this.text(bad); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 8); this.stars(); this.delay();
        continue;
      }
      this.inc(0x393b);
      const sp = m.r8(0x3cec);
      if (sp !== 0xff) {
        const t = m.r16(0x3cec) & 0xff;
        m.w8(m.r16(CHARP) + t, u8(m.r8(0x3ced) + m.r8(m.r16(CHARP) + t)));
        this.c773();
        this.ui('viewch', [m.r8(0x2686)]);
        return this.castDone();
      }
      m.w8(0x3987, m.r8(0x3ced)); m.w8(0x3988, 0); m.w8(0x3989, 0);
      this.retfvqr2(); this.escl();
      return this.castTail();
    }
  }
  /** CODE+0x46CB getinfo (see world.ts) */
  private getInfo(id: number) {
    const m = this.m;
    const base = id < 0x56 ? 0x917a + 0x18 * (id - 1) : 0x9972 + 0x18 * (id - 0x56);
    m.w16(BDW_TEXT, base);
    for (let i = 0; i < 0x0e; i++) m.w8(0x3cda + i, m.r8(base + i));
    m.w8(0x3cda + 0x0e, 0);
    for (let i = 0x0e; i < 0x19; i++) m.w8(0x3cda + i + 1, m.r8(base + i));
  }
}

export class MonsterAbility extends ComCast {
  override run(): { stop: number; calls: Call[] } {
    try { this.ability(); } catch (e) {
      if (e instanceof Exit) return { stop: e.stop, calls: this.calls };
      throw e;
    }
    return { stop: -1, calls: this.calls };
  }
  private ability(): void {
    const m = this.m;
    const mon = () => m.r16(MONPTR);
    const bp = m.r16(0x38b2);
    if ((m.r8(0x3879 + bp) & 8) !== 0) { this.text(0x33bd); this.inc(0x3bdc); this.ptext(); throw new Exit(0x9e94); }
    const id0 = m.r8(mon() + 0x1c);
    if (id0 === 0 || id0 >= 0x80) return;
    const chance = m.r8(mon() + 0x1d);
    m.w8(0x3bb8, chance);
    const r = random(m, 100);
    if (this.wrong !== 'abilityNoChance' && r >= m.r8(0x3bb8)) return;
    if ((m.r8(mon() + 0x1e) & 0xf) === 0) return;
    m.w8(mon() + 0x1e, m.r8(mon() + 0x1e) - 1);
    const id = m.r8(mon() + 0x1c);
    if (id === 0 || id >= 0x21) return;
    const handler = m.r16(0x33cf + 2 * (id - 1));
    m.w8(P_SAVE, 0); m.w8(P_RES, 0); m.w8(P_CNT, 0); m.w8(P_VAL, 0);
    this.inc(0x3bdc);
    try { this.abilityHandler(handler); } catch (e) { if (!(e instanceof Abort)) throw e; }
    throw new Exit(0x9e94);
  }
  /** CODE+0xB3D3: casting gate for the "spell-like" abilities (anti-magic zone or the monster asleep/silenced = fizzles) */
  private b3d3(): void {
    const m = this.m;
    if ((m.r8(0x3c10) & 2) !== 0) { this.text(0x3564); this.ptext(); throw new Abort(); }
    const bp = m.r16(0x38b2);
    if ((m.r8(0x3879 + bp) & 6) !== 0) { this.text(0x3564); this.ptext(); throw new Abort(); }
    this.text(0x357a); this.ptext();
  }
  private b3c9(): void { this.text(0x355a); this.ptext(); }
  /** CODE+0xB547: a random living party member (or the first living one) becomes the current character */
  private pickMember(): void {
    const m = this.m;
    this.cout(0x3a);
    let bl = u8(random(m, m.r8(NPARTY)) - 1);
    bl = u8(bl << 1);
    m.w8(CHARP, m.r8(PARTYTAB + bl)); m.w8(CHARP + 1, m.r8(PARTYTAB + bl + 1));
    if ((m.r8(m.r16(CHARP) + 0x3f) & 0xc0) === 0) return;
    for (let b = 0; ; ) {
      const p = u8(b << 1);
      m.w8(CHARP, m.r8(PARTYTAB + p)); m.w8(CHARP + 1, m.r8(PARTYTAB + p + 1));
      if ((m.r8(m.r16(CHARP) + 0x3f) & 0xc0) === 0) return;
      b++;
      if (!(b < m.r8(NPARTY))) return;
    }
  }
  /** CODE+0xB3FA: damage one random member */
  private hitOne(): void { this.pickMember(); this.mdmga(); }
  /** CODE+0xB470: damage every member */
  private hitAll(): void { this.cout(0x3a); this.partyDamage(); }
  /** CODE+0xB4B4: status P_VAL on the current member (with the same resist / save gates as damage) */
  private condOne(): void {
    const m = this.m;
    m.w8(0x3581, 0);
    try {
      this.b5ac(); this.b5f7(); this.b615();
    } catch (e) { if (e instanceof Abort) return; throw e; }
    const al = m.r8(P_VAL);
    this.setCond(al);
    let bx = 0;
    if (al === 0) bx = 10;
    else if (al >= 0x80) bx = al === 0xc0 ? 7 : al === 0xa0 ? 8 : al === 0xff ? 9 : 10;
    else { let a = al; for (;;) { const c = a & 1; a >>= 1; if (c) break; bx++; if (bx > 255) break; } }
    m.w16(BDW_TEXT, m.r16(0x359b + 2 * bx)); this.ptext();
    this.cout(0x21);
  }
  /** CODE+0xA6D3 `setcondi` on the current character */
  private setCond(al: number): void {
    const m = this.m;
    m.w8(0x3bb8, al);
    const c = m.r16(CHARP);
    const cond = m.r8(c + 0x3f);
    if (cond < 0x80) m.w8(c + 0x3f, cond | al);
    else if (m.r8(0x3bb8) >= 0x80) m.w8(c + 0x3f, m.r8(c + 0x3f) | m.r8(0x3bb8));
  }
  private condOneRandom(): void { this.pickMember(); this.condOne(); }
  /** CODE+0xB50E: status on every member */
  private condAll(): void {
    const m = this.m;
    this.cout(0x3a);
    let bl = 0;
    do {
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      m.w8(0x3582, bl);
      this.condOne();
      this.delay();
      bl = u8(m.r8(0x3582) + 1);
    } while (bl < m.r8(NPARTY));
  }
  private levelSum(step: number): void {
    const m = this.m;
    const bp = m.r16(0x38b2);
    let bl = m.r8(0x3c29 + bp);
    // the loop branches back to the `mov al, step` AFTER the clc, so the carry of one pass is added into the next
    let cf = 0;
    if (bl !== 0) do { const t = step + m.r8(P_VAL) + cf; cf = t > 255 && this.wrong !== 'abilityCarry' ? 1 : 0; m.w8(P_VAL, u8(t)); bl = u8(bl - 1); } while (bl !== 0);
  }
  private abilityHandler(a: number): void {
    const m = this.m;
    const rnd = (n: number, add: number) => m.w8(P_VAL, u8(random(m, n) + add));
    switch (a) {
      case 0xafe3: { this.b3d3(); this.text(0x340f); this.ptext(); const s = 1 + m.r8(0x3ca6); if (s <= 255) m.w8(0x3ca6, s); return; }
      case 0xaffc: this.b3d3(); this.text(0x3417); this.ptext(); this.inc(P_SAVE); rnd(0x10, 4); return this.hitOne();
      case 0xb01a: this.b3c9(); this.text(0x3424); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 1); this.levelSum(6); return this.hitOne();
      case 0xb04d: this.b3d3(); this.text(0x3429); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_VAL, 2); return this.condAll();
      case 0xb069: this.text(0x3433); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 6); m.w8(P_VAL, 0x10); return this.condAll();
      case 0xb083: this.text(0x3441); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 4); m.w8(P_VAL, random(m, 0x10)); return this.hitAll();
      case 0xb0a0: this.b3d3(); this.text(0x344d); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 7); m.w8(P_VAL, 1); return this.condAll();
      case 0xb0c1: {
        this.b3d3(); this.text(0x3453); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 5); m.w8(P_VAL, 0x20);
        const bp = m.r16(0x38b2);
        if (m.r8(0x3c29 + bp) >= 5) return this.condAll();
        return this.condOneRandom();
      }
      case 0xb0f0: this.b3d3(); this.text(0x345c); this.ptext(); this.gozClear(); return;
      case 0xb100: this.b3d3(); this.text(0x3464); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 3); rnd(0x25, 5); return this.hitOne();
      case 0xb127: this.b3c9(); this.text(0x3473); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 6); m.w8(P_VAL, 0xa0); return this.condAll();
      case 0xb144: {
        this.text(0x347f); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 6);
        let bp = m.r16(0x38b2);
        m.w8(P_VAL, random(m, m.r8(0x3888 + bp)));
        bp = m.r16(0x38b2);
        m.w8(0x3888 + bp, 0); m.w8(0x3879 + bp, 0xff);
        resMon2(m);
        return this.hitAll();
      }
      case 0xb178: {
        this.b3d3(); this.text(0x3487); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 1);
        this.levelSum(6);
        m.w8(P_VAL, u8(random(m, m.r8(P_VAL)) + 4));
        return this.hitAll();
      }
      case 0xb1bb: {
        this.b3c9(); this.text(0x3424); this.ptext(); this.inc(P_RES); m.w8(P_CNT, 1);
        this.levelSum(8);
        m.w8(P_VAL, random(m, m.r8(P_VAL)));
        return this.hitAll();
      }
      case 0xb1f7: this.text(0x3491); this.ptext(); this.inc(P_RES); m.w8(P_VAL, 0xa0); return this.condOneRandom();
      case 0xb20c: this.b3d3(); this.text(0x3497); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 4); rnd(0x1f, 9); return this.hitOne();
      case 0xb233: this.text(0x34a2); this.ptext(); this.inc(P_RES); rnd(0x15, 0x27); return this.hitOne();
      case 0xb24e: this.b3d3(); this.text(0x34bb); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_CNT, 2); rnd(0x29, 9); return this.hitOne();
      case 0xb275: this.b3d3(); this.text(0x34c5); this.ptext(); this.inc(P_SAVE); rnd(0xe, 0x10); return this.hitAll();
      case 0xb293: {
        this.b3d3(); this.text(0x34d3); this.ptext();
        let bl = 0;
        do {
          const bp = u8(bl << 1);
          m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
          m.w8(m.r16(CHARP) + 0x2b, 0); m.w8(m.r16(CHARP) + 0x2c, 0);
          bl++;
        } while (bl < m.r8(NPARTY));
        this.gozClear(); return;
      }
      case 0xb2dc: this.b3d3(); this.text(0x34df); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_VAL, 0xc0); return this.condOneRandom();
      case 0xb2f8: this.b3d3(); this.text(0x34ef); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); rnd(0x33, 0x31); return this.hitOne();
      case 0xb31a: this.b3d3(); this.text(0x34f7); this.ptext(); this.inc(P_SAVE); this.inc(P_RES); m.w8(P_VAL, 0xff); return this.condOneRandom();
      case 0xb336: this.text(0x3506); this.ptext(); m.w8(P_VAL, 0x64); return this.hitOne();
      case 0xb347: m.w8(P_CNT, 6); return this.breath(0);
      case 0xb352: m.w8(P_CNT, 3); return this.breath(1);
      case 0xb35d: m.w8(P_CNT, 2); return this.breath(2);
      case 0xb368: return this.breath(3);
      case 0xb36e: m.w8(P_CNT, 4); return this.breath(4);
      case 0xb379: m.w8(P_CNT, 1); return this.breath(5);
      case 0xb384: return this.breath(6);
      case 0xb3b1: this.text(0x3554); this.ptext(); this.inc(P_RES); m.w8(P_VAL, random(m, 0xc)); return this.hitAll();
      default: throw new Error(`unported ability handler ${a.toString(16)}`);
    }
  }
  /** CODE+0xB387: breath weapon k (0..6): damage = the monster's current HP to the whole party */
  private breath(k: number): void {
    const m = this.m;
    m.w8(0x3516, k);
    this.b3c9();
    m.w16(BDW_TEXT, m.r16(0x3517 + 2 * m.r8(0x3516))); this.ptext();
    const bp = m.r16(0x38b2);
    m.w8(P_VAL, m.r8(0x3888 + bp));
    this.inc(P_RES);
    return this.hitAll();
  }
}
