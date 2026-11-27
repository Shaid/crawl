/**
 * The battle round driver: turn order over the verified rules, with the two action routines supplied by the caller.
 *
 * `rules2.ts roundLoop` is the harness-verified model of CODE+0x12A22 `fight()`, but its two actions (the party command menu CODE+0x119C2, the monster turn
 * CODE+0x1064C) are scripted stubs and it runs a whole battle in one call, so a shell cannot interleave orders. This module is the same control flow cut at the
 * round boundary, with the actions as callbacks. It decides nothing itself: every write it makes is one `roundLoop` makes (battle start, the per-round flag
 * clear and status decay, the actor selection scan), and `round.test.ts` proves the equivalence by running both on identical memory with the same scripted
 * effects and comparing every byte of the A4 window. The actions themselves live in `engine.ts` and call only verified rules.
 */
import type { Mem } from '../rules-mem';
import { g } from '../rules-mem';
import { randRange } from '../rules';
import { battleOver, encounterGroups, initMonsters } from '../rules2';

export type Side = 'party' | 'monster';
export interface Actors {
  /** the party member at slot `idx` takes its turn (must set its own acted flag A4-24128[idx], as the real command routine does) */
  party(idx: number): void;
  /** the monster in slot `idx` takes its turn (A4-1309 is already `idx`; the real monster turn sets its own acted flag A4-24138[idx]) */
  monster(idx: number): void;
}

/** the setup of `fight()`: mode 2 (combat), group sizes (10.1), slot init (10.1), the acting-member cursor A4-1272 = rand(1, party) - 1 */
export function startBattle(m: Mem): void {
  m.w8(g(-31154), 2);
  m.w8(g(-24103), 0);
  m.w8(g(-1310), 0);
  encounterGroups(m);
  initMonsters(m);
  m.w8(g(-1272), (randRange(m, 1, m.r16(g(-31066))) - 1) & 0xff);
}

/** a new round: all acted flags clear, then every monster with a status bit besides bit 0 rolls it off (10.3) */
export function beginRound(m: Mem, o: { noDecay?: boolean } = {}): void {
  for (let i = 0; i < 10; i++) m.w8(g(-24138) + i, 0);
  for (let i = 0; i < 8; i++) m.w8(g(-24128) + i, 0);
  let n = m.r8(g(-30654));
  if (n > 10) n = 10;
  for (let i = 0; i < n; i++) {
    const f = m.r8(g(-1305) + i) & 0xfe;
    if (f) {
      let r = randRange(m, 1, m.r8(g(-4574) + i)) & 0xff;
      r &= 0xfe;
      r ^= 0xfe;
      r &= f;
      m.w8(g(-1305) + i, o.noDecay ? f : r);
    }
  }
}

/** who acts next: the unacted monster with the highest initiative and the unacted member with the highest +0x6E; the party wins ties (10.3). null = the round is over. */
export function pickActor(m: Mem, o: { monsterFirst?: boolean } = {}): { side: Side; idx: number } | null {
  m.w8(g(-1269), 0);
  m.w8(g(-24119), 0);
  m.w8(g(-1271), 0);
  m.w8(g(-24120), 0);
  let k = m.r8(g(-30654));
  if (k > 10) k = 10;
  for (let i = 0; i < k; i++) {
    if (m.r8(g(-24138) + i) === 0 && m.r8(g(-1294) + i) > m.r8(g(-24120))) {
      m.w8(g(-24120), m.r8(g(-1294) + i));
      m.w8(g(-1271), i);
    }
  }
  for (let i = 0; i < m.r8(g(-31065)); i++) {
    if (m.r8(g(-24128) + i) === 0) {
      const slot = ((m.r16(g(-31082) + 2 * i) << 16) >> 16);
      const v = m.r8(g(-10814) + slot * 130 + 110);
      if (v > m.r8(g(-24119))) {
        m.w8(g(-24119), v);
        m.w8(g(-1269), i);
      }
    }
  }
  const pi = m.r8(g(-24119));
  const mi = m.r8(g(-24120));
  const partyActs = o.monsterFirst ? pi !== 0 && pi > mi : pi !== 0 && pi >= mi;
  if (partyActs) return { side: 'party', idx: m.r8(g(-1269)) };
  if (mi !== 0) return { side: 'monster', idx: m.r8(g(-1271)) };
  return null;
}

/**
 * One whole round: new-round bookkeeping, then actors in turn until nobody is left or the battle is over (CODE+0x13282 after every action).
 * Returns true when the battle is over (after the round's last action, as `fight()` tests it).
 */
export function battleRound(m: Mem, act: Actors, o: { monsterFirst?: boolean; noDecay?: boolean } = {}): boolean {
  beginRound(m, o);
  for (;;) {
    const a = pickActor(m, o);
    if (!a) break;
    if (a.side === 'party') act.party(a.idx);
    else { m.w8(g(-1309), a.idx); act.monster(a.idx); }
    if (battleOver(m) !== 0) return true;
  }
  return battleOver(m) !== 0;
}
