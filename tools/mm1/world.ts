/**
 * Might & Magic I (DOS/EGA) world rules from `MM.EXE` (docs/mm1/dosega/game-rules.md section 5): the non-combat cast `qcast`
 * (CODE+0x8794, handlers via DS:0x2BEB), item use `use` (CODE+0x8619) and the combat item use `useitem` (CODE+0xC5FD).
 * Strict memory + stub-call log like spells.ts; every `jmp` out of the routine is a recorded stop address.
 */
import { type Mem } from './rules-mem.ts';
import { random, resetAc, BDW_TEXT, CHARP, type Call } from './rules.ts';
import { Caster, Exit, SPD_FLAGS, SPD_COST } from './spells.ts';

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
