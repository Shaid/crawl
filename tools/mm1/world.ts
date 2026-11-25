/**
 * Might & Magic I (DOS/EGA) world rules from `MM.EXE` (docs/mm1/dosega/game-rules.md section 5): the non-combat cast `qcast`
 * (CODE+0x8794, handlers via DS:0x2BEB), item use `use` (CODE+0x8619) and the combat item use `useitem` (CODE+0xC5FD).
 * Strict memory + stub-call log like spells.ts; every `jmp` out of the routine is a recorded stop address.
 */
import { type Mem } from './rules-mem.ts';
import { random, resetAc, BDW_TEXT, CHARP, type Call } from './rules.ts';
import { Caster, Exit, SPD_FLAGS, SPD_COST } from './spells.ts';
import { divide } from './after.ts';

const u8 = (v: number) => v & 0xff;
export const QCAST_TABLE = 0x2beb;
const PARTYTAB = 0x3ca8, NPARTY = 0x3bc0, CHARPOS = 0x3cb6;
export const BACKVIEW = 0x74b6, GETVIEWO = 0x6e46, DRAW = 0xf45, OKREST = 0x6f98, LOADNEXT = 0x509d, MFORWARD = 0x4d7e;

export type WorldWrong = 'qcastNoBorrow' | 'qcastHealNoCap' | 'qcastResetNoRes' | 'qcastAgeNoFloor' | 'qcastWrongCostGate' | 'qcastAddNoSat' | 'useNoCharge' | 'useStatNoAdd';

/** CODE+0x72DD resetsts: current = base for the seven attributes (+0x15..+0x23 pairs) and the level pair at +0x2F */
export function resetSts(m: Mem): void {
  const c = m.r16(CHARP);
  for (const o of [0x15, 0x17, 0x19, 0x1b, 0x1d, 0x1f, 0x21, 0x23, 0x2f]) m.w8(c + o + 1, m.r8(c + o));
}
/** CODE+0x73C2 resetres: current = base for the 8 resistances (pairs +0x58 -> +0x59 ... +0x66 -> +0x67) */
export function resetRes(m: Mem): void {
  const c = m.r16(CHARP);
  for (let bp = 0x58; bp < 0x68; bp += 2) m.w8(c + bp + 1, m.r8(c + bp));
}

export class QCast extends Caster {
  w: WorldWrong | undefined;
  reachedHandler = 0;
  constructor(m: Mem, keys: number[], w?: WorldWrong) { super(m, keys); this.w = w; }
  private get me() { return this.m.r16(CHARP); }
  private get cp() { return this.m.r16(CHARPOS); }
  // ---- stubbed callees ----
  private clrtext4() { this.ui('clrtext4'); }
  private stop(a: number): never { throw new Exit(a); }
  private esctext() { const m = this.m; m.w8(0x3bdd, 0x18); m.w8(0x3bdc, 0); this.text(0x2b05); this.ptext(); }
  private noises(a: number) { this.ui('noises', [a]); }
  private delayt() { this.ui('delayt'); }
  /** ddal 0x899C */
  private ddal(): never { this.ptext(); this.noises(2); this.delayt(); return this.stop(BACKVIEW); }
  /** 0x971F failure: the handler's return address is discarded (`pop ax`) */
  private fail(): never {
    const m = this.m;
    this.clrtext4(); this.text(0x2e67); m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0xa); return this.ddal();
  }
  /** setgraph then a jump out (the handler's `pop ax` dropped its return address) */
  private gfxExit(stop: number): never { this.ui('setgraph'); return this.stop(stop); }
  run(): { stop: number; calls: Call[] } {
    try { this.main(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('qcast fell through');
  }
  /** the spell number / cost bookkeeping shared by `qcast` and the item path, entered at 0x894F with 3C5A..3C5C set */
  private main() {
    const m = this.m;
    m.w8(0x2b52, 0);
    const me = this.me;
    if (m.r8(me + 0x30) === 0) this.stop(GETVIEWO);
    if (m.r8(me + 0x2b) === 0 && m.r8(me + 0x2c) === 0) this.stop(GETVIEWO);
    this.clrtext4(); this.esctext();
    m.w8(0x3bdc, 7); m.w8(0x3bdd, 0x14); this.text(0x2b9f); this.ptext();
    m.w8(0x3bdc, m.r8(0x3bdc) - 1);
    let al: number;
    for (;;) {
      al = this.wait();
      if (al === 0x1b) this.stop(BACKVIEW);
      if (al < 0x31 || al >= 0x38) continue;
      al = u8(al - 0x31);
      if (al >= m.r8(this.me + 0x30)) continue;
      break;
    }
    m.w8(0x3c58, al);
    this.cout(al + 0x31);
    this.inc(0x3bdd);
    m.w8(0x3bdc, 0x13); this.text(0x2bb5); this.ptext();
    m.w8(0x3bdc, m.r8(0x3bdc) - 1);
    for (;;) {
      al = this.wait();
      if (al === 0x1b) this.stop(BACKVIEW);
      if (al < 0x31 || al >= 0x39) continue;
      if (m.r8(0x3c58) >= 4 && al >= 0x36) continue;
      break;
    }
    al = u8(al - 0x31);
    m.w8(0x3c59, al);
    this.cout(al + 0x31);
    const cls = m.r8(this.me + 0x14);
    al = cls === 3 || cls === 5 ? 0x2f : 0;
    al = u8(al + m.r8(0x3c59));
    if (m.r8(0x3c58) !== 0) {
      let bl = 0;
      for (;;) {
        al = u8(al + 8); bl++;
        if (bl === m.r8(0x3c58)) break;
        if (bl !== 4) continue;
        do { al = u8(al + 5); bl++; } while (bl < m.r8(0x3c58));
        break;
      }
    }
    m.w8(0x3c5a, al);
    this.inc(0x3c58);
    m.w8(0x3c5b, m.r8(0x3c58));
    this.spellGates();
  }
  /** CODE+0x8888..: cost / SP / gem / flag gates for spell 3C5A with SP cost 3C5B (3C5C gems), then targeting, payment, handler */
  protected spellGates(fromItem = false) {
    const m = this.m;
    const sp = (): number => m.r16(0x3c5a) & 0xff;
    if (!fromItem) {
      if (m.r8(SPD_COST + sp()) >= 0x80) m.w8(0x3c5b, m.r8(this.me + 0x24));
      if (m.r8(this.me + 0x2c) === 0) {
        const lvCost = m.r8(SPD_COST + (m.r16(0x3c5a) & 0xff)) >= 0x80;
        const ok = lvCost ? m.r8(this.me + 0x24) <= m.r8(this.me + 0x2b) : m.r8(0x3c58) <= m.r8(this.me + 0x2b);
        if (!ok) { this.clrtext4(); m.w8(0x3bdc, 5); m.w8(0x3bdd, 0x15); this.text(0x2de6); this.ddal(); }
      }
      const gem = m.r8(SPD_COST + sp()) & 0x7f;
      m.w8(0x3c5c, gem);
      if (gem !== 0 && m.r8(this.me + 0x32) === 0 && m.r8(this.me + 0x31) < gem) {
        this.clrtext4(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 9); this.text(0x2e06); this.ddal();
      }
    }
    const fl = (): number => m.r8(SPD_FLAGS + (m.r16(0x3c5a) & 0xff));
    if (fl() & 1) { this.clrtext4(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0xa); this.text(0x2e33); this.ddal(); }
    if (fl() & 0x10) {
      if ((this.getod(0) & 0x80) === 0) { this.clrtext4(); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0xa); this.text(0x2e1e); this.ddal(); }
    }
    if (fl() & 4) {
      this.ui('namestxt');
      m.w8(0x3bdc, 0x16); m.w8(0x3bdd, 0x17); this.text(0x2bcc);
      if (this.withWhom()) this.stop(BACKVIEW);
    } else {
      m.w8(0x3bdc, 0x18); m.w8(0x3bdd, 0x17); this.text(0x2bdb); this.ptext();
      for (;;) {
        const k = this.wait();
        if (k === 0x1b) this.stop(BACKVIEW);
        if (k === 0x0d) break;
      }
    }
    // ---- pay ----
    const me = this.me;
    const s = m.r8(me + 0x2b) - m.r8(0x3c5b);
    m.w8(me + 0x2b, s);
    m.w8(me + 0x2c, m.r8(me + 0x2c) - (s < 0 && this.w !== 'qcastNoBorrow' ? 1 : 0));
    const g = m.r8(me + 0x31) - m.r8(0x3c5c);
    m.w8(me + 0x31, g);
    m.w8(me + 0x32, m.r8(me + 0x32) - (g < 0 ? 1 : 0));
    const handler = m.r16(QCAST_TABLE + 2 * sp());
    this.reachedHandler = handler;
    this.itemCharge();
    if (m.r8(0x3c10) & 2) {
      this.clrtext4(); m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 5); this.text(0x2e47); this.ddal();
    }
    this.handler(handler);
    this.successTail();
  }
  /** 0x8A37: "the spell worked" message, AC refresh of the whole party, short delay, back to the view */
  private successTail(): never {
    const m = this.m;
    this.clrtext4();
    m.w8(0x3bdd, 0x16); m.w8(0x3bdc, 0xe); this.text(0x2bbf); this.ptext();
    this.noises(2);
    this.resAllAc();
    this.ui('dl1', [2]);
    return this.stop(BACKVIEW);
  }
  /** CODE+0x8619 `use`: pick an item (1-6 / A-F), read its record, then either a stat change or the item's spell (cast path from 0x894F) */
  runUse(): { stop: number; calls: Call[] } {
    try { this.use(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('use fell through');
  }
  private use() {
    const m = this.m;
    this.clrtext4();
    m.w8(0x2b52, 0);
    m.w8(0x3bdc, 7); m.w8(0x3bdd, 0x14); this.text(0x2b53); this.ptext();
    this.esctext();
    let k: number;
    for (;;) {
      k = this.wait();
      if (k === 0x1b) this.stop(BACKVIEW);
      if (k < 0x31) continue;
      if (k < 0x37) { m.w8(0x3c86, u8(k - 0x31)); m.w8(0x2b50, 0x40); m.w8(0x2b51, 0x46); }
      else {
        if (k < 0x41 || k >= 0x47) continue;
        m.w8(0x3c86, u8(k - 0x41)); m.w8(0x2b50, 0x46); m.w8(0x2b51, 0x4c);
      }
      let bp = m.r16(0x2b50) & 0xff;
      let bl = 0, id = 0;
      let found = false;
      for (;;) {
        id = m.r8(m.r16(CHARP) + bp);
        if (id !== 0) {
          if (bl === m.r8(0x3c86)) { found = true; break; }
          bl++;
        }
        bp = u8(bp + 1);
        if (bp >= m.r8(0x2b51)) break;
      }
      if (!found) continue;
      m.w8(0x3c86, id); m.w8(0x3c87, bp);
      m.w8(0x3c89, u8(bp + 0x0c));
      m.w8(0x3c88, m.r8(m.r16(CHARP) + u8(bp + 0x0c)));
      this.getInfo(m.r8(0x3c86));
      if (m.r8(0x3cec) === 0) { this.clrtext4(); this.text(0x2b6e); return this.useMsg(); }
      if (m.r8(0x3cea) !== 1 && m.r8(0x3c87) >= 0x46) { this.clrtext4(); this.text(0x2a2e); return this.useMsg(); }
      if (m.r8(0x3c88) === 0) { this.clrtext4(); this.text(0x2b87); return this.useMsg(); }
      this.inc(0x2b52);
      const sp = m.r8(0x3cec);
      if (sp !== 0xff) {
        const t = (m.r16(0x3cec) & 0xff);
        m.w8(m.r16(CHARP) + t, this.w === 'useStatNoAdd' ? m.r8(0x3ced) : u8(m.r8(0x3ced) + m.r8(m.r16(CHARP) + t)));
        this.itemCharge();
        return this.successTail();
      }
      m.w8(0x3c5a, m.r8(0x3ced)); m.w8(0x3c5b, 0); m.w8(0x3c5c, 0);
      return this.spellGates(true);
    }
  }
  private useMsg(): never { const m = this.m; m.w8(0x3bdc, 9); m.w8(0x3bdd, 0x15); return this.ddal(); }
  /** CODE+0x8747: item charge bookkeeping (only when the spell came from an item: DS:2B52 != 0) */
  protected itemCharge() {
    const m = this.m;
    if (m.r8(0x2b52) === 0 || this.w === 'useNoCharge') return;
    const bp = m.r16(0x3c89) & 0xff;
    let bl = m.r8(0x3c88);
    const me = this.me;
    if (bl !== 0) {
      bl = u8(bl - 1);
      m.w8(me + bp, bl);
      if (bl !== 0) return;
    }
    if (m.r8(0x3c87) < 0x46) return;
    m.w8(me + (m.r16(0x3c87) & 0xff), 0xff);
    m.w8(me + (m.r16(0x3c89) & 0xff), 0);
  }
  /** CODE+0x73DF resallac: recompute AC of every party member (current character pointer restored afterwards) */
  protected resAllAc() {
    const m = this.m;
    m.w8(0x3bb8, m.r8(CHARP)); m.w8(0x3bb9, m.r8(CHARP + 1));
    let bl = 0;
    do {
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      m.w8(0x3bba, bl);
      resetAc(m);
      bl = u8(m.r8(0x3bba) + 1);
    } while (bl < m.r8(NPARTY));
    m.w8(CHARP, m.r8(0x3bb8)); m.w8(CHARP + 1, m.r8(0x3bb9));
  }
  /** CODE+0x82C8 withwhop22: choose a party member -> DS:3CB6; true = cancelled */
  private withWhom(): boolean {
    const m = this.m;
    this.ptext();
    this.cout(m.r8(NPARTY) + 0x30); this.cout(0x27); this.cout(0x3f);
    this.esctext();
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) { this.ui('clr13to19'); this.ui('btmview'); return true; }
      if (k < 0x31 || k >= 0x37) continue;
      const sel = u8(k - 0x31);
      if (sel >= m.r8(NPARTY)) continue;
      m.w16(CHARPOS, m.r16(PARTYTAB + 2 * sel));
      this.ui('clr13to19'); this.ui('btmview');
      return false;
    }
  }
  // ---- handlers ----
  private heal(amount: number) {      // CODE+0x8A79 with DS:2CA7 = amount
    const m = this.m;
    m.w8(0x2ca7, amount);
    this.heal79();
  }
  private heal79() {
    const m = this.m;
    const cp = this.cp;
    m.w8(0x2ca8, m.r8(cp + 0x33)); m.w8(0x2ca9, m.r8(cp + 0x34));
    const sum = m.r8(0x2ca8) + m.r8(0x2ca7);
    m.w8(0x2ca8, sum);
    if (sum > 0xff) {
      m.w8(0x2ca9, m.r8(0x2ca9) + 1);
      if (m.r8(0x2ca9) === 0) m.w8(0x2ca9, m.r8(0x2ca9) - 1);
    }
    // 16-bit compare with max HP (+0x37/+0x38)
    const hi = m.r8(0x2ca9), mhi = m.r8(cp + 0x38);
    let capped = false;
    if (hi > mhi) capped = true;
    else if (hi === mhi) { const lo = m.r8(0x2ca8); capped = lo > m.r8(cp + 0x37) && this.w !== 'qcastHealNoCap'; }
    if (this.w === 'qcastHealNoCap') capped = false;
    if (capped) { m.w8(cp + 0x33, m.r8(cp + 0x37)); m.w8(cp + 0x34, m.r8(cp + 0x38)); }
    else { m.w8(cp + 0x33, m.r8(0x2ca8)); m.w8(cp + 0x34, m.r8(0x2ca9)); }
    this.unconscious();
  }
  /** CODE+0x8B10: clear the unconscious bit (0x40) of +0x3F unless the high bit is set */
  private unconscious() {
    const m = this.m, cp = this.cp;
    const al = m.r8(cp + 0x3f);
    if (al & 0x80) return;
    m.w8(cp + 0x3f, al & 0xbf);
  }
  private partyEffect(addr: number) { const m = this.m; m.w8(addr, m.r8(this.me + 0x24) + 0x14); }
  /** clear status bits of the target (+0x3F) unless the high bit is set */
  private clearStatus(mask: number) {
    const m = this.m, cp = this.cp;
    const al = m.r8(cp + 0x3f);
    if (al & 0x80) this.fail();
    m.w8(cp + 0x3f, al & mask);
  }
  private handler(h: number) {
    const m = this.m;
    switch (h) {
      case 0x8af1: return;
      case 0x8a74: return this.heal(8);
      case 0x8b27: m.w8(0x3c9c, m.r8(0x3c9c) + 1); return this.gfxExit(DRAW);
      case 0x8b33: {
        m.w8(0x2ca7, 0);
        let bl = m.r8(this.me + 0x24);
        for (;;) {
          const al = random(m, 10);
          const s = al + m.r8(0x2ca7);
          m.w8(0x2ca7, s);
          if (s > 0xff) { m.w8(0x2ca7, 0xfa); break; }
          bl = u8(bl - 1);
          if (bl === 0) break;
        }
        return this.heal79();
      }
      case 0x8b63: return this.heal(0x10);
      case 0x8b6b: return this.partyEffect(0x3c95);
      case 0x8b7b: return this.partyEffect(0x3c96);
      case 0x8b8b: return this.partyEffect(0x3c97);
      case 0x8b9b: return this.partyEffect(0x3c98);
      case 0x8bab: return this.partyEffect(0x3c99);
      case 0x8bbb: return this.partyEffect(0x3c9a);
      case 0x8bcb: return this.partyEffect(0x3c9b);
      case 0x8bdb: {
        const al = m.r8(this.me + 0x3e);
        if (al >= 0x28) return this.fail();
        m.w8(this.me + 0x3e, al + 6); return;
      }
      case 0x8bf5: return this.clearStatus(0xfd);
      case 0x8c0e: return this.clearStatus(0xdf);
      case 0x8c27: m.w8(0x3c9c, m.r8(0x3c9c) + 0x13); m.w8(0x3c9c, m.r8(0x3c9c) + 1); return this.gfxExit(DRAW);
      case 0x8c33: {
        let bl = m.r8(NPARTY);
        for (let i = 0; i < 6; i++) {
          m.w8(m.r16(PARTYTAB + 2 * i) + 0x6d, 0);
          bl = u8(bl - 1);
          if (bl === 0) return;
        }
        return;
      }
      case 0x8c77: m.w8(0x3c9f, m.r8(0x3c9f) + 1); return;
      case 0x8c7c: return this.clearStatus(0xf7);
      case 0x8c95: return this.clearStatus(0xef);
      case 0x8cae: { const cp = this.cp; m.w8(cp + 0x12, m.r8(cp + 0x11)); return; }
      case 0x8cc3: {
        if (this.getod(0x2e) & 4) return this.fail();
        m.w8(0x3c38, this.getod(0x2a)); m.w8(0x3c39, this.getod(0x2b));
        this.ui('setgraph');
        this.getod(0x27); this.getod(0x28); this.getod(0x29);
        return this.stop(LOADNEXT);
      }
      case 0x8d11: return this.h8d11();
      case 0x8d9f: return this.h8d9f();
      case 0x8de4: return this.h8de4();
      case 0x8e3a: return this.h8e3a();
      case 0x8ea3: return this.h8ea3();
      case 0x8ef8: return this.h8ef8();
      case 0x8f28: return this.h8f28();
      case 0x8f91: { const al = u8(m.r8(this.me + 0x24) + 0x19); for (let i = 0; i < 6; i++) m.w8(0x3c95 + i, al); return; }
      case 0x8fa9: return this.h8fa9();
      case 0x9017: return this.h9017();
      case 0x910f: m.w8(0x3c9d, m.r8(this.me + 0x24)); return;
      case 0x911c: return this.h911c();
      case 0x927a: return this.h927a();
      case 0x9321: m.w8(0x3c9e, m.r8(this.me + 0x24)); return;
      case 0x932e: return this.h932e();
      case 0x9403: m.w8(0x3ca0, m.r8(this.me + 0x24)); return;
      case 0x9410: m.w8(0x3ca1, m.r8(this.me + 0x24)); return;
      case 0x941d: if (m.r8(0x3c10) & 8) return this.fail(); return this.gfxExit(OKREST);
      case 0x942e: return this.h942e();
      case 0x9539: this.ui('setgraph'); m.w8(0x3c10, 0); return this.stop(MFORWARD);
      case 0x9545: return this.h9545();
      case 0x9603: m.w8(0x3be8, 0x1a); m.w8(0x3be9, 0xb); m.w8(0x3bea, 3); m.w8(0x3c38, 7); m.w8(0x3c39, 0); return this.h9709();
      case 0x9625: return this.h9625();
      default: throw new Error('qcast handler ' + h.toString(16));
    }
  }
  /** 0x9709: leave for the map loader */
  private h9709(): never {
    const m = this.m;
    this.ui('setgraph');
    m.r8(0x3be8); m.r8(0x3be9); m.r16(0x3bea);
    return this.stop(LOADNEXT);
  }
  private h8d11() {
    const m = this.m;
    const al = random(m, 100);
    const need = this.getod(0x26);
    if (al < need) return this.fail();
    for (let bl = 0; bl < 0x13; bl++) m.w8(0x3c95 + bl, 0);
    m.w8(0x2caa, m.r8(CHARP)); m.w8(0x2cab, m.r8(CHARP + 1));
    let bp = 0;
    for (;;) {
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      m.w8(0x3bb9, bp & 0xff);
      resetSts(m); resetAc(m);
      if (this.w !== 'qcastResetNoRes') resetRes(m);
      const c = m.r16(CHARP);
      const s = m.r8(c + 0x3f);
      if (!(s & 0x80)) m.w8(c + 0x3f, s & 0xf9);
      bp = m.r16(0x3bb9) & 0xff;
      bp = u8(bp + 1); bp = u8(bp + 1);
      if ((bp >> 1) >= m.r8(NPARTY)) break;
    }
    m.w8(CHARP, m.r8(0x2caa)); m.w8(CHARP + 1, m.r8(0x2cab));
  }
  private h8d9f() {
    const m = this.m, cp = this.cp;
    const s = m.r8(cp + 0x3f);
    if (s & 0x80) return this.fail();
    m.w8(cp + 0x3f, s & 0x80);
    if (m.r8(cp + 0x34) === 0 && m.r8(cp + 0x33) === 0) m.w8(cp + 0x33, 1);
    m.w8(0x2ca7, 1);
    this.heal79();
  }
  private h8de4() {
    const m = this.m, cp = this.cp;
    const cur = m.r8(cp + 0x24);
    if (cur >= m.r8(cp + 0x23)) return this.fail();
    let al = u8(random(m, 5) + m.r8(cp + 0x24));
    if (al < m.r8(cp + 0x23)) { m.w8(cp + 0x24, al); return; }
    m.w8(cp + 0x24, m.r8(cp + 0x23));
  }
  private h8e3a() {
    const m = this.m;
    const al = m.r8(this.cp + 0x3f);
    if (al === 0xff || (al & 0xc0) !== 0xc0) return this.fail();
    const r = random(m, 100);
    if (r === 0x64) { m.w8(this.cp + 0x3f, 0xff); this.noises(3); return this.fail(); }
    if (r >= 0x5b) return this.fail();
    m.w8(this.cp + 0x3f, m.r8(this.cp + 0x3f) === 0xe0 ? 0xa0 : 0);
    this.h8e8a();
  }
  private h8e8a() { const m = this.m, cp = this.cp; m.w8(cp + 0x33, 1); m.w8(cp + 0x34, 0); }
  private h8ea3() {
    const m = this.m;
    if (random(m, 100) >= 0x4b) {
      let al = u8(0x0a + m.r8(this.cp + 0x25));
      if (al >= 0xc9) al = 0xc8;
      m.w8(this.cp + 0x25, al);
      while (al < 0x13) { al = 0xc8; m.w8(this.cp + 0x25, al); }
      return this.fail();
    }
    const d = random(m, 10);
    m.w8(0x2cac, d);
    const al = m.r8(this.cp + 0x25) - m.r8(0x2cac);
    if (al >= 0 && al >= 0x12 && this.w !== 'qcastAgeNoFloor') { m.w8(this.cp + 0x25, al); return; }
    m.w8(this.cp + 0x25, 0x12);
  }
  private h8ef8() {
    const m = this.m;
    const al = m.r8(this.cp + 0x3f);
    if (al === 0xff || (al & 0xa0) !== 0xa0) return this.fail();
    m.w8(this.cp + 0x3f, m.r8(this.cp + 0x3f) === 0xe0 ? 0xc0 : 0);
    this.h8e8a();
  }
  private h8f28() {
    const m = this.m;
    this.clrtext4(); this.esctext();
    m.w8(0x3bdc, 0xa); m.w8(0x3bdd, 0x14); this.text(0x2cad); this.ptext();
    let k: number;
    for (;;) {
      k = this.wait();
      if (k === 0x1b) return this.fail();
      if (k < 0x31 || k >= 0x36) continue;
      break;
    }
    m.w8(0x3bb8, k);
    if (this.getod(0x2e) & 8) return this.fail();
    const bl = u8(m.r8(0x3bb8) - 0x31);
    m.w8(0x3be8, m.r8(0x2d82 + bl)); m.w8(0x3be9, m.r8(0x2d87 + bl)); m.w8(0x3bea, 1);
    m.w8(0x3c38, m.r8(0x2d8c + bl)); m.w8(0x3c39, m.r8(0x2d91 + bl));
    return this.h9709();
  }
  private h8fa9() {
    const m = this.m;
    if (m.r8(this.cp + 0x3f) !== 0xff) return this.fail();
    let al = m.r8(this.cp + 0x25) + 0x0a;
    if (al > 0xff || al >= 0xc9) al = 0xc8;
    m.w8(this.cp + 0x25, al);
    if (random(m, 100) >= 0x4c) return this.fail();
    al = u8(m.r8(this.cp + 0x1b) - 1);
    if (al === 0) al = 1;
    m.w8(this.cp + 0x1b, al); m.w8(this.cp + 0x1c, al);
    m.w8(this.cp + 0x3f, 0);
    this.heal(1);
  }
  /** 0x9017 inventory scan: list the character's six item slots with a magic marker */
  private h9017() {
    const m = this.m;
    this.clrtext4(); this.esctext();
    m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 1); this.text(0x2cc2); this.ptext();
    m.w8(0x3bdc, 0x14);
    let bl = 0, bp = 0x46;
    m.w8(0x2cc0, bl); m.w8(0x2cbf, bp);
    const me = () => m.r16(CHARP);
    for (;;) {
      const al = m.r8(me() + bp);
      if (al === 0) {
        bp = m.r16(0x2cbf) & 0xff; bp = u8(bp + 1);
        m.w8(0x2cbf, bp);
        if (bp < 0x4c) continue;
        break;
      }
      m.w8(0x2cc1, al);
      this.cout(bl + 0x41); this.cout(0x29);
      const v = m.r8(0x2cc1);
      const ranges: [number, boolean][] = [[0xc, true], [0x3d, false], [0x42, true], [0x56, false], [0x5d, true], [0x79, false], [0x80, true], [0x9c, false], [0x9e, true], [0xff, false]];
      let plain = true;
      for (const [lim, no] of ranges) if (v < lim) { plain = no; break; }
      if (plain) this.cout(0x4e);
      else {
        this.cout(0x59);
        this.inc(0x3bdc);
        this.cout(0x28);
        const idx = u8(m.r8(0x2cbf) + 0x0c);
        m.w8(0x3c14, m.r8(me() + idx));
        this.ui('pdec', [m.r8(0x3c14)]);
        this.cout(0x29);
      }
      if (m.r8(0x3bdc) < 0x1e) m.w8(0x3bdc, 0x1e);
      else { this.inc(0x3bdd); m.w8(0x3bdc, 0x14); }
      bl = u8(m.r8(0x2cc0) + 1);
      m.w8(0x2cc0, bl);
      if (bl >= 6) break;
      bp = m.r16(0x2cbf) & 0xff; bp = u8(bp + 1);
      m.w8(0x2cbf, bp);
      if (bp >= 0x4c) break;
    }
    for (;;) { if (this.wait() === 0x1b) this.stop(BACKVIEW); }
  }
  private h911c() {
    const m = this.m;
    this.clrtext4();
    m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0); this.text(0x2cd2); this.ptext();
    const a = this.getod(0x25);
    let skip = false;
    if (a === 0) this.text(0x2cf7);
    else if (a & 0x80) {
      if (a === 0xff) { this.text(0x2cdd); this.ptext(); skip = true; }
      else if (a === 0xfe) this.text(0x2ce5);
      else this.text(0x2ced);
    } else {
      this.cout(this.getod(0x25) + 0x30);
      this.text(0x2d00);
    }
    if (!skip) {
      this.ptext();
      m.w8(0x3bdc, 0x15); this.text(0x2d09); this.ptext();
      this.cout(this.getod(0x23) & 0x7f); this.cout(0x2d); this.cout(this.getod(0x24) & 0x7f);
      this.inc(0x3bdd); m.w8(0x3bdc, 0x15); this.text(0x2d16); this.ptext();
      if (this.getod(0x25) !== 0) {
        m.w8(0x3c14, this.getod(0x2a)); this.ui('pdec', [m.r8(0x3c14)]);
        m.w8(0x3bdc, 0x23); this.cout(0x59); this.cout(0x3d);
        m.w8(0x3c14, this.getod(0x2b)); this.ui('pdec', [m.r8(0x3c14)]);
        this.inc(0x3bdd); m.w8(0x3bdc, 0x16); this.text(0x2d22); this.ptext();
      }
      m.w8(0x3c14, m.r8(0x3c38)); this.ui('pdec', [m.r8(0x3c14)]);
      m.w8(0x3bdc, 0x23); this.cout(0x59); this.cout(0x3d);
      m.w8(0x3c14, m.r8(0x3c39)); this.ui('pdec', [m.r8(0x3c14)]);
      this.inc(0x3bdd); m.w8(0x3bdc, 0x16); this.text(0x2d2d); this.ptext();
      const d = m.r8(0x3c3d);
      let bl = 0xd7;
      if (d & 0x80) bl = 0xce;
      else if (d & 0x20) bl = 0xc5;
      else if (d & 0x08) bl = 0xd3;
      this.cout(bl & 0x7f);
    }
    this.esctext();
    for (;;) { if (this.wait() === 0x1b) this.stop(BACKVIEW); }
  }
  private h927a() {
    const m = this.m;
    const dir = (): number => m.r8(0x3c3d);
    if (m.r8(0x3c3c) & dir()) return this.fail();
    let bp = m.r16(0x3c3a) & 0xff;
    if (m.r8(0x3dfa + bp) & dir() & 0x55) return this.fail();
    bp = u8(m.r8(0x3c3a) + m.r8(0x3c41));
    if (m.r8(0x3cfa + bp) & dir()) return this.fail();
    if (m.r8(0x3dfa + bp) & dir() & 0x55) return this.fail();
    const d = dir();
    if (d === 0xc0) { if (m.r8(0x3c39) >= 0xe) return this.fail(); m.w8(0x3c39, m.r8(0x3c39) + 1); m.w8(0x3c39, m.r8(0x3c39) + 1); }
    else if (d === 0x30) { if (m.r8(0x3c38) >= 0xe) return this.fail(); m.w8(0x3c38, m.r8(0x3c38) + 1); m.w8(0x3c38, m.r8(0x3c38) + 1); }
    else if (d === 0x0c) { if (m.r8(0x3c39) < 2) return this.fail(); m.w8(0x3c39, m.r8(0x3c39) - 1); m.w8(0x3c39, m.r8(0x3c39) - 1); }
    else { if (m.r8(0x3c38) < 2) return this.fail(); m.w8(0x3c38, m.r8(0x3c38) - 1); m.w8(0x3c38, m.r8(0x3c38) - 1); }
    return this.gfxExit(DRAW);
  }
  private h932e() {
    const m = this.m;
    for (;;) {
      this.clrtext4(); this.esctext();
      m.w8(0x3bdc, 9); m.w8(0x3bdd, 0x14); this.text(0x2d38); this.ptext();
      let k: number;
      for (;;) {
        k = this.wait();
        if (k === 0x1b) return this.fail();
        if (k < 0x41 || k >= 0x46) continue;
        break;
      }
      this.dec(0x3bdc);
      m.w8(0x2d36, k); this.cout(k);
      m.w8(0x2d36, u8(m.r8(0x2d36) - 0x41));
      this.inc(0x3bdd); m.w8(0x3bdc, 0x10); this.text(0x2d48); this.ptext();
      let restart = false;
      for (;;) {
        k = this.wait();
        if (k === 0x1b) { restart = true; break; }
        if (k < 0x31 || k >= 0x35) continue;
        break;
      }
      if (restart) continue;
      m.w8(0x2d37, k); this.dec(0x3bdc); this.cout(k);
      m.w8(0x3bdc, 0x18); m.w8(0x3bdd, 0x17); this.text(0x2bdb); this.ptext();
      for (;;) {
        k = this.wait();
        if (k === 0x1b) { restart = true; break; }
        if (k === 0x0d) break;
      }
      if (restart) continue;
      let bl = u8(m.r8(0x2d37) - 0x31);
      if (bl !== 0) do { m.w8(0x2d36, u8(5 + m.r8(0x2d36))); bl = u8(bl - 1); } while (bl !== 0);
      bl = m.r8(0x2d36);
      m.w8(0x3be8, m.r8(0x2d96 + bl)); m.w8(0x3be9, m.r8(0x2daa + bl));
      m.w8(0x3c38, m.r8(0x2dbe + bl)); m.w8(0x3c39, m.r8(0x2dd2 + bl));
      m.w8(0x3bea, 2);
      return this.h9709();
    }
  }
  private dec(a: number) { this.m.w8(a, this.m.r8(a) - 1); }
  private h942e() {
    const m = this.m;
    for (;;) {
      this.clrtext4(); this.esctext();
      m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0xa); this.text(0x2d53); this.ptext();
      let k: number;
      for (;;) {
        k = this.wait();
        if (k === 0x1b) this.stop(BACKVIEW);
        if (k === 0x4e || k === 0x45 || k === 0x53 || k === 0x57) break;
      }
      m.w8(0x2d51, k); this.dec(0x3bdc); this.cout(k);
      this.inc(0x3bdd); m.w8(0x3bdc, 0xb); this.text(0x2d69); this.ptext();
      let restart = false;
      for (;;) {
        k = this.wait();
        if (k === 0x1b) { restart = true; break; }
        if (k < 0x30 || k > 0x39) continue;
        break;
      }
      if (restart) continue;
      m.w8(0x2d52, k); this.dec(0x3bdc); this.cout(k);
      m.w8(0x3bdc, 0x18); m.w8(0x3bdd, 0x17); this.text(0x2bdb); this.ptext();
      for (;;) {
        k = this.wait();
        if (k === 0x1b) { restart = true; break; }
        if (k === 0x0d) break;
      }
      if (restart) continue;
      if (this.getod(0x2e) & 2) return this.fail();
      m.w8(0x2d52, u8(m.r8(0x2d52) - 0x30));
      const dir = m.r8(0x2d51), n = m.r8(0x2d52);
      if (dir === 0x4e) { let al = u8(m.r8(0x3c39) + n); if (al >= 0x10) al = u8(al - 0x10); m.w8(0x3c39, al); }
      else if (dir === 0x45) { let al = u8(m.r8(0x3c38) + n); if (al >= 0x10) al = u8(al - 0x10); m.w8(0x3c38, al); }
      else if (dir === 0x53) { let al = m.r8(0x3c39) - n; if (al < 0) al = u8(al + 0x10); m.w8(0x3c39, al); }
      else { let al = m.r8(0x3c38) - n; if (al < 0) al = u8(al + 0x10); m.w8(0x3c38, al); }
      return this.gfxExit(DRAW);
    }
  }
  /** pick the n-th (1 = A) non-empty item slot of the current character -> bp; false when the key is out of range */
  private pickItemSlot(bl: number): number | undefined {
    const m = this.m;
    let bp = 0x46;
    for (;;) {
      if (m.r8(m.r16(CHARP) + bp) !== 0) { bl = u8(bl - 1); if (bl === 0) return bp; }
      bp = u8(bp + 1);
      if (bp >= 0x4c) return undefined;
    }
  }
  private itemPrompt(): number | undefined {
    const m = this.m;
    this.clrtext4(); this.esctext();
    m.w8(0x3bdc, 0xa); m.w8(0x3bdd, 0x14); this.text(0x2a75); this.ptext();
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) return undefined;
      if (k < 0x41 || k >= 0x47) continue;
      const bp = this.pickItemSlot(u8(k - 0x40));
      if (bp !== undefined) return bp;
    }
  }
  private h9545() {
    const m = this.m;
    const bp0 = this.itemPrompt();
    if (bp0 === undefined) return this.fail();
    m.w8(0x2d7e, bp0); m.w8(0x2d7f, u8(bp0 + 0x0c));
    this.getInfo(m.r8(m.r16(CHARP) + bp0));
    if (random(m, 100) === 0x64) {
      m.w8(m.r16(CHARP) + (m.r16(0x2d7e) & 0xff), 0);
      m.w8(m.r16(CHARP) + (m.r16(0x2d7f) & 0xff), 0);
      return this.fail();
    }
    const slot = () => m.r16(CHARP) + (m.r16(0x2d7f) & 0xff);
    if (m.r8(slot()) === 0) return this.fail();
    const al = u8(random(m, 4) + m.r8(slot()));
    m.w8(slot(), al < m.r8(0x3cee) ? al : m.r8(0x3cee));
  }
  private h9625() {
    const m = this.m;
    const src = this.itemPrompt();
    if (src === undefined) return this.fail();
    m.w8(0x2d80, src);
    let bp = 0x46;
    for (;;) {
      if (m.r8(m.r16(CHARP) + bp) === 0) break;
      bp = u8(bp + 1);
      if (bp >= 0x4c) return this.fail();
    }
    m.w8(0x2d81, bp);
    if (random(m, 100) === 0x64) {
      const s = m.r16(0x2d80) & 0xff;
      m.w8(m.r16(CHARP) + s, 0);
      m.w8(m.r16(CHARP) + u8(s + 0x0c), 0);
      return this.fail();
    }
    const id = m.r8(m.r16(CHARP) + (m.r16(0x2d80) & 0xff));
    if (id >= 0xe6) return this.fail();
    m.w8(m.r16(CHARP) + (m.r16(0x2d81) & 0xff), id);
    m.w8(0x2d80, 0);
    m.w8(m.r16(CHARP) + u8(m.r8(0x2d81) + 0x0c), m.r8(0x2d80));
  }
  /** CODE+0x46CB getinfo: copy the 24-byte item record (item `al`) into DS:3CDA.. (14 bytes, a zero, then bytes 14..23) */
  protected getInfo(id: number) {
    const m = this.m;
    const base = id < 0x56 ? 0x917a + 0x18 * (id - 1) : 0x9972 + 0x18 * (id - 0x56);
    m.w16(BDW_TEXT, base);
    for (let i = 0; i < 0x0e; i++) m.w8(0x3cda + i, m.r8(base + i));
    m.w8(0x3cda + 0x0e, 0);
    for (let i = 0x0e; i < 0x19; i++) m.w8(0x3cda + i + 1, m.r8(base + i));
  }
}

/** `ph2` (CODE+0x40E1) as a UI model: logs the call and moves the text cursor (row DS:3BC3, column DS:3BC4) past the string at DS:3BD4 */
export function ph2Model(m: Mem, calls: Call[]) {
  calls.push(['ph2', [m.r16(BDW_TEXT), m.r8(0x3bc3), m.r8(0x3bc4)]]);
  let p = m.r16(BDW_TEXT), x = m.r8(0x3bc4), y = m.r8(0x3bc3);
  if (x >= 0x28) { x = 0x27; y = u8(y - 1); }
  for (;;) {
    const c = m.r8(p);
    if (c === 0) break;
    p++;
    if (c === 0x0d) { x = 0; y = u8(y + 1); continue; }
    x++;
    if (x >= 0x28) { x = 0; y = u8(y + 1); }
  }
  m.w8(0x3bc4, x); m.w8(0x3bc3, y);
}

export type SurpriseWrong = 'surprNoGoldWipe' | 'surprRunNoParty' | 'surprAlignNoClamp';

/** The encounter greeting CODE+0x3206..0x3740 (after the group is built): who surprised whom, then the Attack / Retreat / Bribe / Surrender menu.
 *  `ph2` (CODE+0x40E1) is modelled as its effect on the text cursor only (DS:3BC3 row, 3BC4 column); exhausted scripted keys cycle N, A. */
/** a caster whose exhausted key script cycles through `tail` instead of answering ESC (menus without an ESC exit) */
export class TailCaster extends Caster {
  protected tail: number[] = [0x1b];
  private tailI = 0;
  private qi = 0;
  wait(): number {
    const k = this.qi < this.keys.length ? this.keys[this.qi++] : this.tail[this.tailI++ % this.tail.length];
    this.ui('wait_', [k]);
    return k;
  }
}

export class Surprise extends TailCaster {
  w: SurpriseWrong | undefined;
  constructor(m: Mem, keys: number[], w?: SurpriseWrong) { super(m, keys); this.w = w; this.tail = [0x4e, 0x41]; }
  private stop(a: number): never { throw new Exit(a); }
  private ph2() { ph2Model(this.m, this.calls); }
  private msg(row: number, col: number, text: number) { const m = this.m; m.w8(0x3bc3, row); m.w8(0x3bc4, col); this.text(text); this.ph2(); }
  run(): { stop: number; calls: Call[] } {
    try { this.main(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('encounter greeting fell through');
  }
  private clr() { this.ui('clrtext4'); }
  /** CODE+0x35F8: one 1d100 roll against DS:3C8F; true = failed (CF) */
  private roll(): boolean { const m = this.m; return random(m, 100) > m.r8(0x3c8f); }
  private main() {
    const m = this.m;
    do { m.w8(0x3bc4, 0x1f); this.text(0x1906); this.ph2(); } while ((m.r16(0x3bc3) & 0xff) < 0x10);
    this.ui('monstpix', [m.r8(0x3c26)]);
    this.clr();
    const flag = m.r8(0x3c19);
    if (flag !== 0) {
      if (flag & 0x80) return this.monstersSurprised();
      const r = random(m, 100);
      if (r <= this.getod(0x15)) return this.partySurprised();
    }
    if (m.r8(0x3ca0) === 0) {
      const r = random(m, 100);
      if (r <= this.getod(0x14)) return this.monstersSurprised();
    }
    return this.menu();
  }
  private partySurprised() {          // 0x3270
    const m = this.m;
    this.msg(0x15, 2, 0x181f);
    this.inc(0x3bc3);
    this.msg(m.r8(0x3bc3), 0xb, 0x1842);
    for (;;) {
      const k = this.wait();
      if (k === 0x59) return this.menu();
      if (k === 0x4e) return this.end();
    }
  }
  private monstersSurprised() {       // 0x32A3
    this.msg(0x15, 6, 0x1852);
    this.m.w8(0x3c19, 0xff);
    return this.fight();
  }
  private menu(): never {
    const m = this.m;
    for (;;) {
      this.clr();
      this.msg(0x15, 0, 0x17e3);
      this.inc(0x3bc3);
      m.w8(0x3bc4, 0xa); this.text(0x1805); this.ph2();
      let k: number;
      for (;;) { k = this.wait(); if (k === 0x41 || k === 0x52 || k === 0x53 || k === 0x42) break; }
      if (k === 0x41) return this.attack();
      if (k === 0x52) return this.retreat();
      if (k === 0x53) return this.surrender();
      if (this.bribe()) continue;
    }
  }
  private attack(): never {
    for (let i = 0; i < 3; i++) if (!this.roll()) { this.alignUp(); return this.combatMsg(); }
    return this.combatMsg();
  }
  private combatMsg(): never { this.clr(); this.msg(0x15, 0x10, 0x186e); return this.fight(); }
  private retreat(): never {
    const m = this.m;
    const r = random(m, 110);
    if (r < 100) {
      if (r > this.getod(0x16)) { this.clr(); this.msg(0x15, 0xb, 0x1876); return this.fight(); }
      if (this.w !== 'surprRunNoParty' && m.r8(0x3c1d) >= m.r8(NPARTY) && this.roll()) { this.clr(); this.msg(0x15, 5, 0x1885); return this.fight(); }
    }
    return this.moveParty(0x17, 0x18);
  }
  private moveParty(a: number, b: number): never {
    const m = this.m;
    m.w8(0x3c38, this.getod(a)); m.w8(0x3c39, this.getod(b));
    return this.end();
  }
  private surrender(): never {
    const m = this.m;
    const no = (): never => { this.clr(); this.msg(0x15, 2, 0x18a0); return this.fight(); };
    if (random(m, 100) > this.getod(0x19)) return no();
    if (random(m, 100) > m.r8(0x3c8f)) return no();
    m.w8(0x3c38, this.getod(0x1a)); m.w8(0x3c39, this.getod(0x1b));
    const r = random(m, 200);
    if (r < 0x33) { /* nothing taken */ }
    else if (r < 0x97) this.wipe(0x39, 3);
    else if (r < 0xa1) this.wipe(0x31, 2);
    else if (r < 0xab) this.wipe(0x3e, 1);
    else if (r < 0xbf) { this.wipe(0x3e, 1); this.wipe(0x39, 3); }
    else if (r < 0xc8) { this.wipe(0x39, 3); this.wipe(0x31, 2); }
    else { this.wipe(0x31, 2); this.wipe(0x3e, 1); this.wipe(0x39, 3); }
    return this.end();
  }
  /** returns true when the menu is to be shown again (the offer was declined) */
  private bribe(): boolean {
    const m = this.m;
    this.clr();
    if (this.roll()) {
      if (m.r8(0x17e2) === 0) this.alignDown();
      this.msg(0x15, 0xc, 0x18c3);
      return this.fight();
    }
    if (random(m, 7) === 5 && m.r8(0x17e0) === 0) return this.end();
    this.inc(0x17e0); this.inc(0x17e2);
    this.msg(0x15, 5, 0x18cf);
    m.w8(0x3bc3, 0x15); m.w8(0x3bc4, 0x16);
    const r = random(m, 100);
    let bl: number;
    if (r < 6) { this.text(0x18f1); this.ph2(); bl = 3; }
    else if (r < 0x10) { this.text(0x18f6); this.ph2(); bl = 2; }
    else { this.text(0x18ec); this.ph2(); bl = 1; }
    m.w8(0x3bba, bl);
    for (;;) {
      const k = this.wait();
      if (k === 0x4e) return true;
      if (k === 0x59) break;
    }
    if (random(m, 100) > this.getod(0x1c)) { this.clr(); this.msg(0x15, 0xe, 0x18fb); return this.fight(); }
    const what = m.r8(0x3bba);
    if (what === 2) this.wipe(0x3e, 1);
    else if (what === 3) this.wipe(0x31, 2);
    else if (this.w !== 'surprNoGoldWipe') this.wipe(0x39, 3);
    return this.end();
  }
  /** CODE+0x3607/361E/3625 via 0x3634: zero `n` consecutive bytes from record offset `off` in every party member */
  private wipe(off: number, n: number) {
    const m = this.m;
    for (let k = 0; k < n; k++) {
      let bl = m.r8(NPARTY);
      for (let i = 0; i < 6; i++) {
        m.w8(m.r16(PARTYTAB + 2 * i) + off + k, 0);
        bl = u8(bl - 1);
        if (bl === 0) break;
      }
    }
  }
  /** CODE+0x3503: the party is no longer in a fight: clear the asleep/stunned bit (+0x3F bit 0) of the living and redraw */
  private end(): never {
    const m = this.m;
    this.clr();
    for (let bl = 0; bl < m.r8(NPARTY); bl++) {
      m.w16(CHARPOS, m.r16(PARTYTAB + u8(bl << 1)));
      const al = m.r8(m.r16(CHARPOS) + 0x3f);
      if (!(al & 0x80)) m.w8(m.r16(CHARPOS) + 0x3f, al & 0xfe);
    }
    return this.stop(0x45f7);
  }
  /** CODE+0x3551: the fight starts (with an alignment notice when the party's alignment changed) */
  private fight(): never {
    const m = this.m;
    if (m.r8(0x17e1) !== 0) { this.msg(0x17, 8, 0x1910); this.ui('noises', [2]); }
    return this.stop(0x4fef);
  }
  /** CODE+0x36D0: set the character's alignment (+0x12) and flag that it changed */
  private setAlign(al: number) {
    const m = this.m, c = m.r16(CHARP);
    if (m.r8(c + 0x12) === al) return;
    m.w8(m.r16(CHARP) + 0x12, al);
    this.inc(0x17e1);
  }
  /** CODE+0x3675: every member's alignment counter (+0x6F) goes up one (stops at 0x20) */
  private alignUp() {
    const m = this.m;
    m.w8(CHARP, m.r8(PARTYTAB)); m.w8(CHARP + 1, m.r8(PARTYTAB + 1));
    let bl = 0;
    do {
      const c = m.r16(CHARP);
      const al = m.r8(c + 0x6f);
      if (al !== 0x20 || this.w === 'surprAlignNoClamp') {
        const n = u8(al + 1);
        m.w8(m.r16(CHARP) + 0x6f, n);
        if (n === 0x20) this.setAlign(3);
        else if (n === 0x10) this.setAlign(2);
      }
      bl++;
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
    } while (bl < m.r8(NPARTY));
  }
  /** CODE+0x36E6: the counters go down one (not below 0) */
  private alignDown() {
    const m = this.m;
    m.w8(CHARP, m.r8(PARTYTAB)); m.w8(CHARP + 1, m.r8(PARTYTAB + 1));
    let bl = 0;
    do {
      const c = m.r16(CHARP);
      const al = m.r8(c + 0x6f);
      if (al !== 0) {
        const n = u8(al - 1);
        m.w8(m.r16(CHARP) + 0x6f, n);
        if (n === 0) this.setAlign(1);
        else if (n === 0x10) this.setAlign(2);
      }
      bl++;
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
    } while (bl < m.r8(NPARTY));
  }
}

export type RestWrong = 'restNoHalve' | 'restNoAge' | 'restNoLevelCut' | 'restKeepStatus';

/** Resting: `rest` CODE+0x6EE5 (prompt, ambush roll) and `okrest` CODE+0x6F98 (per-member recovery, aging, food, spell points) */
export class Rest extends TailCaster {
  w: RestWrong | undefined;
  constructor(m: Mem, keys: number[], w?: RestWrong) { super(m, keys); this.w = w; this.tail = [0x59]; }
  private stop(a: number): never { throw new Exit(a); }
  private clr() { this.ui('clrbtm2'); }
  private ph2() { ph2Model(this.m, this.calls); }
  run(entry: 'rest' | 'okrest' = 'rest'): { stop: number; calls: Call[] } {
    try { if (entry === 'rest') this.rest(); else this.okrest(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('rest fell through');
  }
  private rest(): never {
    const m = this.m;
    this.clr();
    if (m.r8(0x3c10) & 8) {
      this.ui('noises', [2]); this.text(0x28af); m.w8(0x3bc4, 2); m.w8(0x3bc3, 0x15); this.ph2();
      m.w8(0x3bb8, this.wait()); this.clr(); return this.stop(0x4cdc);
    }
    this.text(0x28cf); m.w8(0x3bc4, 0); m.w8(0x3bc3, 0x15); this.ph2();
    for (;;) {
      const k = this.wait();
      if (k === 0x4e) { this.clr(); return this.stop(0x4cd6); }
      if (k === 0x59) break;
    }
    const n = this.getod(0x2c);
    if (n === 0 || random(m, n) !== n) return this.okrest();
    this.clr();
    const pick = random(m, m.r8(NPARTY));
    m.w8(0x3bba, pick);
    for (let bl = 0; bl < m.r8(NPARTY); bl++) {
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      const c = m.r16(CHARP), al = m.r8(c + 0x3f);
      if (!(al & 0x80) && bl !== m.r8(0x3bba)) m.w8(c + 0x3f, al | 1);
    }
    return this.stop(0x45fd);
  }
  private okrest(): never {
    const m = this.m;
    for (let bl = 0; bl < 0x12; bl++) m.w8(0x3c95 + bl, 0);
    let bl = 0, bp = 0;
    do {
      m.w8(0x3bba, bl); m.w8(0x3bb9, bp);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); bp = u8(bp + 1);
      m.w8(CHARP + 1, m.r8(PARTYTAB + bp));
      this.member();
      bl = u8(m.r8(0x3bba) + 1);
      bp = u8(u8((m.r16(0x3bb9) & 0xff) + 1) + 1);
    } while (bl < m.r8(NPARTY));
    this.clr();
    this.text(0x28e0); m.w8(0x3bc4, 0); m.w8(0x3bc3, 0x15); this.ph2();
    this.ui('pnames');
    m.w8(0x3bb8, this.wait()); this.clr();
    return this.stop(0x4cdc);
  }
  private dec(c: number, off: number) {
    const m = this.m;
    const v = u8(m.r8(c + off) - 1);
    m.w8(c + off, v);
    if (v === 0) this.stop(0x7100);          // the game spins forever here (jmp $)
  }
  /** CODE+0x7016: one member rests */
  private member() {
    const m = this.m;
    const c = m.r16(CHARP);
    if (m.r8(c + 0x3f) & 0x80) return;
    this.maxSp();
    resetSts(m); resetAc(m); resetRes(m);
    if (this.w !== 'restKeepStatus') m.w8(c + 0x3f, m.r8(c + 0x3f) & 0x98);
    if (m.r8(c + 0x33) === 0 && m.r8(c + 0x34) === 0) m.w8(c + 0x33, 1);
    if (this.w !== 'restNoAge') {
      const d = m.r8(c + 0x26) + 1;
      m.w8(c + 0x26, d);
      if (d > 0xff) { const y = m.r8(c + 0x25) + 1; m.w8(c + 0x25, y); if (y > 0xff) m.w8(c + 0x25, 0xff); }
    }
    const roll = u8(random(m, 0x46) + 0x50);
    if (roll < m.r8(c + 0x25)) { m.w8(c + 0x3f, 0xc0); return; }
    const age = (): number => m.r8(c + 0x25);
    if (age() >= 0x3c) {
      this.dec(c, 0x18); this.dec(c, 0x1c); this.dec(c, 0x1e);
      if (age() >= 0x46) {
        this.dec(c, 0x18); this.dec(c, 0x1c); this.dec(c, 0x1e);
        if (age() >= 0x50) { this.dec(c, 0x18); this.dec(c, 0x18); }
      }
    }
    // food and recovery
    const food = m.r8(c + 0x3e);
    if (food === 0) return;
    m.w8(c + 0x3e, u8(food - 1));
    if (!(m.r8(c + 0x3f) & 0x10)) { m.w8(c + 0x37, m.r8(c + 0x35)); m.w8(c + 0x38, m.r8(c + 0x36)); }
    else if (this.w !== 'restNoHalve') {
      const hi = m.r8(c + 0x38); m.w8(c + 0x38, hi >> 1);
      m.w8(c + 0x37, ((hi & 1) << 7) | (m.r8(c + 0x37) >> 1));
    }
    if (m.r8(c + 0x3f) & 8) return;
    m.w8(c + 0x33, m.r8(c + 0x37)); m.w8(c + 0x34, m.r8(c + 0x38));
    m.w8(c + 0x2b, m.r8(c + 0x2d)); m.w8(c + 0x2c, m.r8(c + 0x2e));
  }
  /** CODE+0x71CD: maximum spell points = (bracket of INT or PER) x (level, or level-6 for the non-casting classes) */
  private maxSp() {
    const m = this.m;
    const c = m.r16(CHARP);
    m.w8(0x3c69, m.r8(c + 0x16)); m.w8(0x3c6a, m.r8(c + 0x1a)); m.w8(0x3c6b, m.r8(c + 0x24));
    m.w8(0x3c6c, 3); m.w8(0x3c6d, 0); m.w8(0x3c6e, 0);
    if (m.r8(c + 0x30) !== 0) {
      const cls = m.r8(c + 0x14);
      let stat: number | undefined;
      if (cls === 4) stat = m.r8(0x3c6a);
      else if (cls === 5) stat = m.r8(0x3c69);
      else {
        const lv = m.r8(0x3c6b);
        if (lv >= 7) {
          m.w8(0x3c6b, u8(lv - (this.w === 'restNoLevelCut' ? 0 : 6)));
          stat = m.r8(c + 0x14) === 2 ? m.r8(0x3c6a) : m.r8(0x3c69);
        }
      }
      if (stat !== undefined) {
        const T: [number, number][] = [[0x28, 10], [0x23, 9], [0x1e, 8], [0x1b, 7], [0x18, 6], [0x15, 5], [0x13, 4], [0x11, 3], [0xf, 2], [0xd, 1]];
        const hit = T.find(([lim]) => stat! >= lim);
        let d = 0;
        if (hit) d = hit[1]; else if (stat < 5) d = -3; else if (stat < 7) d = -2; else if (stat < 9) d = -1;
        for (let i = 0; i < Math.abs(d); i++) m.w8(0x3c6c, m.r8(0x3c6c) + (d > 0 ? 1 : -1));
        let bl = m.r8(0x3c6b);
        do {
          const s = m.r8(0x3c6c) + m.r8(0x3c6d);
          m.w8(0x3c6d, s);
          m.w8(0x3c6e, m.r8(0x3c6e) + (s > 0xff ? 1 : 0));
          bl = u8(bl - 1);
        } while (bl !== 0);
      }
    }
    m.w8(c + 0x2d, m.r8(0x3c6d)); m.w8(c + 0x2e, m.r8(0x3c6e));
  }
}

export type StepWrong = 'stepIgnoreDoorLayer' | 'stepNoEncounterRoll' | 'stepTurnSwap' | 'stepEdgeWrap';

/** One step of the party in the maze: forward CODE+0x4D7E, back 0x4E81, turn 0x4F43 / 0x4F7A. DS:3C3C = wall byte of the cell (2 bits per side, W,S,E,N from the low bits),
 *  DS:3C10 = second layer (doors), DS:3C3D..3C40 = side masks front/right/back/left (0xC0 N, 0x30 E, 0x0C S, 0x03 W), DS:3C38/3C39 = x/y, DS:3C18 = encounter flag. */
export class Step extends Caster {
  w: StepWrong | undefined;
  constructor(m: Mem, w?: StepWrong) { super(m, []); this.w = w; }
  private stop(a: number): never { throw new Exit(a); }
  private noises(a: number) { this.ui('noises', [a]); }
  run(entry: number): { stop: number; calls: Call[] } {
    try {
      if (entry === 0x4d7e) this.forward();
      else if (entry === 0x4e81) this.back();
      else if (entry === 0x4f43) this.turn(true);
      else this.turn(false);
    } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('step fell through');
  }
  /** CODE+0x4DE9 / 0x4EA5: clear DS:3C78.., roll the random-encounter flag (1 in getod(0x1D)) */
  private roll() {
    const m = this.m;
    for (let i = 0; i < 8; i++) m.w8(0x3c78 + i, 0);
    if (this.w === 'stepNoEncounterRoll') return;
    const n = this.getod(0x1d);
    const r = random(m, n);
    if (r === (this.getod(0x1d) & 0xff)) m.w8(0x3c18, 1);
  }
  private forward() {
    const m = this.m;
    const front = m.r8(0x3c3c) & m.r8(0x3c3d);
    if (front !== 0) {
      if ((m.r8(0x3c10) & 0x55 & m.r8(0x3c3d)) !== 0 && this.w !== 'stepIgnoreDoorLayer') this.stop(0x4734);
      let bx: number;
      if ((m.r8(0x3c3c) & m.r8(0x3c3d) & 0x55) === 0) bx = 1;
      else if ((m.r8(0x3c3c) & m.r8(0x3c3d) & 0xaa) === 0) bx = 0;
      else bx = 2;
      if (this.getod(bx + 0x1e) === 4 && m.r8(0x3c9f) === 0) {
        this.noises(1); this.text(0x2107); this.stop(0x4fbf);
      }
    } else if ((m.r8(0x3c10) & 0x55 & m.r8(0x3c3d)) !== 0) {
      this.text(0x1eed); this.noises(1); this.stop(0x4fbf);
    }
    this.roll();
    this.move(true);
  }
  private back() {
    const m = this.m;
    if (m.r8(0x3c3c) & m.r8(0x3c40)) { this.noises(1); this.stop(0x4cd6); }
    if (m.r8(0x3c10) & 0x55 & m.r8(0x3c40)) { this.noises(1); this.stop(0x4cd6); }
    this.roll();
    this.move(false);
  }
  /** step one cell along the facing (forward) or against it (back); crossing the map edge leaves for the exit loader */
  private move(fwd: boolean) {
    const m = this.m;
    const d = m.r8(0x3c3d);
    const ax = (a: number, inc: boolean, hi: number, lo: number) => {
      const v = m.r16(a) & 0xff;
      if (inc) { if (v >= 0xf) this.stop(hi); m.w8(a, m.r8(a) + 1); }
      else { if (v === 0) this.stop(lo); m.w8(a, m.r8(a) - 1); }
      this.stop(DRAW);
    };
    // forward: N = y+1, E = x+1, S = y-1, W = x-1; back reverses
    if (d === 0xc0) return ax(0x3c39, fwd, 0x4ff8, 0x504c);
    if (d === 0x30) return ax(0x3c38, fwd, 0x5022, 0x5076);
    if (d === 0x0c) return ax(0x3c39, !fwd, 0x4ff8, 0x504c);
    return ax(0x3c38, !fwd, 0x5022, 0x5076);
  }
  private turn(right: boolean) {
    const m = this.m;
    if (right) {
      let bl = m.r8(0x3c3f);
      m.w8(0x3c3f, m.r8(0x3c3d)); m.w8(0x3c3d, m.r8(0x3c3e)); m.w8(0x3c3e, m.r8(0x3c40)); m.w8(0x3c40, bl);
      bl = m.r8(0x3c43);
      m.w8(0x3c43, m.r8(0x3c41)); m.w8(0x3c41, m.r8(0x3c42)); m.w8(0x3c42, m.r8(0x3c44)); m.w8(0x3c44, bl);
    } else {
      let bl = m.r8(0x3c3e);
      m.w8(0x3c3e, m.r8(0x3c3d)); m.w8(0x3c3d, m.r8(0x3c3f)); m.w8(0x3c3f, m.r8(0x3c40)); m.w8(0x3c40, bl);
      bl = m.r8(0x3c42);
      m.w8(0x3c42, m.r8(0x3c41)); m.w8(0x3c41, m.r8(0x3c43)); m.w8(0x3c43, m.r8(0x3c44)); m.w8(0x3c44, bl);
    }
    this.stop(DRAW);
  }
}

export type PoolWrong = 'poolFoodNoCap' | 'poolGoldNoSat' | 'poolShareNoRemainder';

/** Party pooling: `gather` CODE+0x74BC (everyone's gems / gold / food into the current member) and `share` CODE+0x7763 (split evenly, remainder to the current member).
 *  Gems = 16 bit (+0x31,+0x32), gold = 24 bit (+0x39..+0x3B), food = 8 bit (+0x3E, cap 40 when gathering). The overflow of a sum saturates its top byte at 0xFF. */
export class Pool extends Caster {
  w: PoolWrong | undefined;
  constructor(m: Mem, keys: number[], w?: PoolWrong) { super(m, keys); this.w = w; }
  private stop(a: number): never { throw new Exit(a); }
  run(entry: 'gather' | 'share'): { stop: number; calls: Call[] } {
    try { if (entry === 'gather') this.gather(); else this.share(); } catch (e) { if (e instanceof Exit) return { stop: e.stop, calls: this.calls }; throw e; }
    throw new Error('pool fell through');
  }
  private ddal(): never { this.ptext(); this.ui('noises', [2]); this.ui('delayt'); return this.stop(BACKVIEW); }
  private esctext() { const m = this.m; m.w8(0x3bdd, 0x18); m.w8(0x3bdc, 0); this.text(0x2b05); this.ptext(); }
  /** CODE+0x833F pall: the three "(1) .. (3) .." prompt lines */
  private pall() {
    const m = this.m;
    m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0x14); this.text(0x2b16); this.ptext();
    this.inc(0x3bdd); m.w8(0x3bdc, 0x14); this.text(0x2b1e); this.ptext();
    this.inc(0x3bdd); m.w8(0x3bdc, 0x14); this.text(0x2b26); this.ptext();
  }
  private head(row: number, col: number, text: number) {
    const m = this.m;
    this.ui('clrtext4'); m.w8(0x3bdd, 0x14); m.w8(0x3bdc, col); this.text(text); this.ptext(); this.pall(); this.esctext();
    void row;
  }
  private n(): number { return this.m.r8(NPARTY); }
  private cp(i: number): number { return this.m.r16(PARTYTAB + 2 * i); }
  private cur(): number { return this.m.r16(CHARP); }
  /** `walk`: the game keeps its pointer into the party table in a DS word and bumps it by 2 per member; the final word values are part of the footprint */
  private walk(ptr: number, f: (c: number) => boolean | void) {
    const m = this.m;
    m.w16(ptr, PARTYTAB);
    let bl = 0;
    do {
      const c = m.r16(m.r16(ptr));
      const stop = f(c);
      if (stop === true) return;
      m.w16(ptr, m.r16(ptr) + 1); m.w16(ptr, m.r16(ptr) + 1);
      bl = u8(bl + 1);
    } while (bl < this.n());
  }
  private maxf(): never {
    const m = this.m;
    this.ui('clrtext4'); m.w8(0x3bdd, 0x15); m.w8(0x3bdc, 0xb); this.text(0x293f);
    return this.ddal();
  }
  private gather() {
    const m = this.m;
    this.head(0x14, 7, 0x2b2e);
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) this.stop(BACKVIEW);
      if (k === 0x31) { this.gatherGems(); return this.stop(BACKVIEW); }
      if (k === 0x32) { this.gatherGold(); return this.stop(BACKVIEW); }
      if (k === 0x33) { this.gatherFood(); return this.stop(BACKVIEW); }
    }
    void m;
  }
  private gatherFood() {
    const m = this.m;
    m.w16(0x290e, PARTYTAB);
    m.w8(0x3c86, 0);
    let overflow = false;
    this.walk(0x290a, (c) => {
      const s = m.r8(c + 0x3e) + m.r8(0x3c86);
      m.w8(0x3c86, s);
      if (s > 0xff || (u8(s) >= 0x29 && this.w !== 'poolFoodNoCap')) { overflow = true; return true; }
    });
    if (overflow) this.maxf();
    this.walk(0x290e, (c) => { m.w8(c + 0x3e, 0); });
    m.w8(this.cur() + 0x3e, m.r8(0x3c86));
  }
  private gatherGems() {
    const m = this.m;
    m.w8(0x3c86, 0); m.w8(0x3c87, 0);
    this.walk(0x2920, (c) => { const s = m.r8(c + 0x31) + m.r8(0x3c86); m.w8(0x3c86, s); if (s > 0xff) m.w8(0x3c87, m.r8(0x3c87) + 1); });
    let sat = false;
    this.walk(0x291e, (c) => { const s = m.r8(c + 0x32) + m.r8(0x3c87); m.w8(0x3c87, s); if (s > 0xff) { m.w8(0x3c87, 0xff); sat = true; return true; } });
    void sat;
    this.walk(0x291c, (c) => { m.w8(c + 0x31, 0); });
    this.walk(0x291a, (c) => { m.w8(c + 0x32, 0); });
    m.w8(this.cur() + 0x31, m.r8(0x3c86)); m.w8(this.cur() + 0x32, m.r8(0x3c87));
  }
  private gatherGold() {
    const m = this.m;
    m.w8(0x3c86, 0); m.w8(0x3c87, 0); m.w8(0x3c88, 0);
    this.walk(0x2918, (c) => {
      const s = m.r8(c + 0x39) + m.r8(0x3c86); m.w8(0x3c86, s);
      if (s > 0xff) { m.w8(0x3c87, m.r8(0x3c87) + 1); if (m.r8(0x3c87) === 0) m.w8(0x3c88, m.r8(0x3c88) + 1); }
    });
    this.walk(0x2916, (c) => { const s = m.r8(c + 0x3a) + m.r8(0x3c87); m.w8(0x3c87, s); if (s > 0xff) m.w8(0x3c88, m.r8(0x3c88) + 1); });
    this.walk(0x2914, (c) => { const s = m.r8(c + 0x3b) + m.r8(0x3c88); m.w8(0x3c88, s); if (s > 0xff && this.w !== 'poolGoldNoSat') { m.w8(0x3c88, 0xff); return true; } });
    this.walk(0x290c, (c) => { m.w8(c + 0x39, 0); });
    this.walk(0x2910, (c) => { m.w8(c + 0x3a, 0); });
    this.walk(0x2912, (c) => { m.w8(c + 0x3b, 0); });
    const c = this.cur();
    m.w8(c + 0x39, m.r8(0x3c86)); m.w8(c + 0x3a, m.r8(0x3c87)); m.w8(c + 0x3b, m.r8(0x3c88));
  }
  private share() {
    this.head(0x14, 8, 0x2953);
    for (;;) {
      const k = this.wait();
      if (k === 0x1b) this.stop(BACKVIEW);
      if (k === 0x31) { this.shareGems(); return this.stop(BACKVIEW); }
      if (k === 0x32) { this.shareGold(); return this.stop(BACKVIEW); }
      if (k === 0x33) { this.shareFood(); return this.stop(BACKVIEW); }
    }
  }
  private div() {
    const m = this.m;
    m.w8(0x3c8c, m.r8(NPARTY)); m.w8(0x3c8d, 0);
    divide(m);
  }
  private shareFood() {
    const m = this.m;
    for (let i = 0; i < 4; i++) m.w8(0x3c86 + i, 0);
    this.walk(0x2908, (c) => { const s = m.r8(c + 0x3e) + m.r8(0x3c86); m.w8(0x3c86, s); if (s > 0xff) m.w8(0x3c87, m.r8(0x3c87) + 1); });
    this.div();
    this.walk(0x2906, (c) => { m.w8(c + 0x3e, m.r8(0x3c86)); });
    if (this.w !== 'poolShareNoRemainder') m.w8(this.cur() + 0x3e, m.r8(0x3c8a) + m.r8(this.cur() + 0x3e));
  }
  private shareGems() {
    const m = this.m;
    for (let i = 0; i < 4; i++) m.w8(0x3c86 + i, 0);
    m.w16(0x2904, PARTYTAB); m.w16(0x2902, PARTYTAB);
    let bl = 0;
    do {
      const c1 = m.r16(m.r16(0x2904));
      let s = m.r8(c1 + 0x31) + m.r8(0x3c86); m.w8(0x3c86, s);
      if (s <= 0xff) { /* no carry */ } else { m.w8(0x3c87, m.r8(0x3c87) + 1); if (m.r8(0x3c87) === 0) m.w8(0x3c88, m.r8(0x3c88) + 1); }
      const c2 = m.r16(m.r16(0x2902));
      s = m.r8(c2 + 0x32) + m.r8(0x3c87); m.w8(0x3c87, s);
      if (s > 0xff) m.w8(0x3c88, m.r8(0x3c88) + 1);
      m.w16(0x2904, m.r16(0x2904) + 1); m.w16(0x2904, m.r16(0x2904) + 1);
      m.w16(0x2902, m.r16(0x2902) + 1); m.w16(0x2902, m.r16(0x2902) + 1);
      bl = u8(bl + 1);
    } while (bl < this.n());
    this.div();
    this.walk(0x2900, (c) => { m.w8(c + 0x31, m.r8(0x3c86)); });
    this.walk(0x28fe, (c) => { m.w8(c + 0x32, m.r8(0x3c87)); });
    const c = this.cur();
    const s = m.r8(0x3c8a) + m.r8(c + 0x31);
    m.w8(c + 0x31, s);
    if (s > 0xff) m.w8(c + 0x32, m.r8(c + 0x32) + 1);
  }
  private shareGold() {
    const m = this.m;
    m.w16(0x295e, PARTYTAB); m.w16(0x2960, PARTYTAB); m.w16(0x2962, PARTYTAB);
    for (let i = 0; i < 4; i++) m.w8(0x3c86 + i, 0);
    let bl = 0;
    for (;;) {
      let c = m.r16(m.r16(0x295e));
      let s = m.r8(c + 0x39) + m.r8(0x3c86); m.w8(0x3c86, s);
      if (s > 0xff) { m.w8(0x3c87, m.r8(0x3c87) + 1); if (m.r8(0x3c87) === 0) { m.w8(0x3c88, m.r8(0x3c88) + 1); if (m.r8(0x3c88) === 0) m.w8(0x3c89, m.r8(0x3c89) + 1); } }
      c = m.r16(m.r16(0x2960));
      s = m.r8(c + 0x3a) + m.r8(0x3c87); m.w8(0x3c87, s);
      if (s > 0xff) { m.w8(0x3c88, m.r8(0x3c88) + 1); if (m.r8(0x3c88) === 0) m.w8(0x3c89, m.r8(0x3c89) + 1); }
      c = m.r16(m.r16(0x2962));
      s = m.r8(c + 0x3b) + m.r8(0x3c88); m.w8(0x3c88, s);
      if (s > 0xff) m.w8(0x3c89, m.r8(0x3c89) + 1);
      for (const p of [0x295e, 0x2960, 0x2962]) { m.w16(p, m.r16(p) + 1); m.w16(p, m.r16(p) + 1); }
      bl = u8(bl + 1);
      if (bl >= this.n()) break;
    }
    this.div();
    this.walk(0x2964, (c) => { m.w8(c + 0x39, m.r8(0x3c86)); });
    this.walk(0x2966, (c) => { m.w8(c + 0x3a, m.r8(0x3c87)); });
    this.walk(0x2968, (c) => { m.w8(c + 0x3b, m.r8(0x3c88)); });
    const cc = this.cur();
    let s = m.r8(0x3c8a) + m.r8(cc + 0x39);
    m.w8(cc + 0x39, s);
    if (s > 0xff) {
      s = m.r8(cc + 0x3a) + 1; m.w8(cc + 0x3a, s);
      if (s > 0xff) m.w8(cc + 0x3b, m.r8(cc + 0x3b) + 1);
    }
  }
}
