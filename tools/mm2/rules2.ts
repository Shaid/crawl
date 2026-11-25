/**
 * Might & Magic II (Amiga) game rules, pass 2: encounter setup, turn order and the round loop.
 * Ported from the game's own 68000 code and diffed against the retail executable under Unicorn
 * (tools/mm2/rules_oracle/, vectors in tools/mm2/rules_oracle/vectors/); see
 * docs/mm2/amiga/game-rules.md section 10 for offsets and evidence grades.
 * Conventions as in rules.ts (CODE+0x... = root CODE hunk, A4-n = SAS/C small data, 16-bit ints).
 */
import { type Mem, g } from './rules-mem.ts';
import { randRange, unpackMonster, charPtr, partyPower } from './rules.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
/** truncating signed 16-bit division as the 68k DIVS (quotient only) */
const divs = (a: number, b: number) => Math.trunc(s16(a) / b);

export type Calls = [string, number[]][];

/* ------------------------------------------------------- group sizes */

/**
 * CODE+0x11D0C encounter_groups(): sets the melee group size A4-1316 (monsters that can reach the
 * party) and the party's own front rank A4-24141.
 *   A4-1316 == 0 on entry: indoor (A4-31202 == 0) 3 + rand(10,39)/10 ; else party/2 + rand(10,69)/10
 *   surprise A4-31083 == 2: /2 ; == 3: x2 ; then capped to the monster count (A4-30654) and 10
 *   A4-24141: indoor (3 + rand(10,79)/10) >> 1 ; else partySize (A4-31065), and when >= 6
 *     rand(10,39)/10/2 + partySize - 2 ; surprise 3: x2 ; surprise 2: (party < 2 ? 2 : party) - 1 ;
 *     capped to the party size.
 */
export function encounterGroups(m: Mem, o: { noSurprise?: boolean } = {}): void {
  if (m.r8(g(-1316)) === 0) {
    let v: number;
    if (m.r8(g(-31202)) === 0) v = (divs(randRange(m, 10, 39), 10) + 3) & 0xff;
    else {
      const half = divs(m.r16(g(-31066)), 2) & 0xff;
      v = (half + divs(randRange(m, 10, 69), 10)) & 0xff;
    }
    m.w8(g(-1316), v);
  }
  const sup = o.noSurprise ? 0 : m.r8(g(-31083));
  if (sup === 2) m.w8(g(-1316), m.r8(g(-1316)) >> 1);
  if (sup === 3) m.w8(g(-1316), (m.r8(g(-1316)) * 2) & 0xff);
  if (m.r8(g(-1316)) > m.r8(g(-30654))) m.w8(g(-1316), m.r8(g(-30654)));
  if (m.r8(g(-1316)) > 10) m.w8(g(-1316), 10);
  if (m.r8(g(-31202)) === 0) {
    const q = divs(randRange(m, 10, 79), 10) & 0xff;
    m.w8(g(-24141), (q + 3) >> 1);
  } else {
    m.w8(g(-24141), m.r8(g(-31065)));
    if (m.r8(g(-24141)) >= 6) {
      const q = (divs(randRange(m, 10, 39), 10) & 0xff) >> 1;
      m.w8(g(-24141), (q + m.r8(g(-31065)) - 2) & 0xff);
    }
  }
  if (sup === 3) m.w8(g(-24141), (m.r8(g(-24141)) * 2) & 0xff);
  if (sup === 2) {
    if (s16(m.r16(g(-31066))) < 2) m.w8(g(-24141), 2);
    m.w8(g(-24141), (m.r8(g(-24141)) - 1) & 0xff);
  }
  if (m.r8(g(-24141)) > m.r8(g(-31065))) m.w8(g(-24141), m.r8(g(-31065)));
}

/* ------------------------------------------------- monster slot init */

export const MS = {
  uses: -1283, // u8[11] ability uses left (record speed high nibble + 1)
  init: -1294, // u8[11] initiative (record byte 0x18 decode)
  status: -1305, // u8[11] status bits
  hp: -1338, // u16[11] hit points
} as const;

/** CODE+0x11C2C: unpack battle slot `i` and copy hp / initiative / ability uses into the per-slot arrays. */
export function initMonsterSlot(m: Mem, i: number): void {
  unpackMonster(m, i);
  m.w8(g(MS.status) + i, 0);
  m.w16(g(MS.hp) + 2 * i, m.r16(g(-4512)));
  m.w8(g(MS.init) + i, m.r8(g(-4529)));
  m.w8(g(MS.uses) + i, m.r8(g(-4538)));
}

/** CODE+0x11C82: clear the 11 per-slot arrays, then init slots 0..min(count,10) (count > 10 initialises all 11). */
export function initMonsters(m: Mem, o: { cap10?: boolean } = {}): void {
  for (let i = 0; i < 11; i++) {
    m.w8(g(MS.uses) + i, 0);
    m.w8(g(MS.init) + i, 0);
    m.w8(g(MS.status) + i, 0);
    m.w16(g(MS.hp) + 2 * i, 0);
  }
  let n = m.r8(g(-30654));
  if (n > 10) n = o.cap10 ? 10 : 11;
  for (let i = 0; i < n; i++) initMonsterSlot(m, i);
}

/* ------------------------------------------------------- battle over */

/** CODE+0x13282: 1 when the battle is over (no monsters, empty party, flag A4-1315, or nobody with condition <= 0x10), else 0. */
export function battleOver(m: Mem, o: { anyUnable?: boolean } = {}): number {
  let c = 1;
  if (m.r8(g(-30654)) === 0) return 1;
  if (m.r16(g(-31066)) === 0) return 1;
  if (m.r8(g(-1315)) !== 0) return 1;
  const n = s16(m.r16(g(-31066)));
  for (let i = 0; i < n; i++) {
    const ch = charPtr(m, i);
    if (o.anyUnable ? m.r8(ch + 38) > 0x10 : m.r8(ch + 38) <= 0x10) c--;
    if (c === 0) break;
  }
  return c;
}

/* ------------------------------------------------------ reinforcement */

/**
 * CODE+0x11F0A encounter_add_group(): picks a monster record for the next group and appends it to the slot table.
 *   a = tbl[A4-31150] (u8[4] at A4-28608) + partyHalfLevel (A4-28610) + 1, + (d100 <61:0 <81:1 <96:2 else 3), capped 14
 *   a = rand(1, a) clamped to [A4-22030, A4-22031]  (map min / max monster tier)
 *   record index = (a-1)*16 + rand(1,16) - 1  (so the tier is index >> 4, as melee reads it)
 *   n = rand(1, reinforcement count of that record (A4-4535)); n copies go into free slots (< 11), the rest
 *   of n is added to the monster count anyway (queued off screen), capped 0xF0; wrap -> 0xFA.
 */
export function encounterAddGroup(m: Mem, o: { noClamp?: boolean } = {}): void {
  let a = (m.r8(g(-28608) + m.r8(g(-31150))) + m.r8(g(-28610)) + 1) & 0xff;
  const r = randRange(m, 1, 100) & 0xff;
  const t = r < 0x3d ? 0 : r < 0x51 ? 1 : r < 0x60 ? 2 : 3;
  a = (a + t) & 0xff;
  if (a > 13) a = 14;
  a = randRange(m, 1, a) & 0xff;
  if (!o.noClamp) {
    if (a > m.r8(g(-22031))) a = m.r8(g(-22031));
    if (a < m.r8(g(-22030))) a = m.r8(g(-22030));
  }
  a = (a - 1) & 0xff;
  a = (a * 16) & 0xff;
  a = (a + (randRange(m, 1, 16) & 0xff) - 1) & 0xff;
  const save = m.r8(g(-4574));
  m.w8(g(-4574), a);
  unpackMonster(m, 0);
  m.w8(g(-4574), save);
  let n = randRange(m, 1, m.r8(g(-4535))) & 0xff;
  if (m.r8(g(-30654)) < 11) {
    do {
      const c = m.r8(g(-30654));
      m.w8(g(-30654), (c + 1) & 0xff);
      m.w8(g(-4574) + c, a);
      if (m.r8(g(-30654)) >= 11) break;
      n = (n - 1) & 0xff;
    } while (n !== 0);
  }
  if (n > 0xf0) n = 0xf0;
  m.w8(g(-30654), (m.r8(g(-30654)) + n) & 0xff);
  if (m.r8(g(-30654)) < n) m.w8(g(-30654), 0xfa);
}


/**
 * CODE+0x12072 encounter_budget(): sets A4-28609 = 1 ("encounter complete") when the group strengths
 * sum (each monster counts (recordIndex >> 4) + 1; monsters beyond the 10 visible slots count as the 11th slot's
 * strength each) reaches the party power A4-28618 (rules.ts partyPower), or the monster count reaches the
 * map's limit A4-22032, or 250.
 */
export function encounterBudget(m: Mem, o: { noMapLimit?: boolean } = {}): void {
  let sum = 0;
  m.w8(g(-28609), 0);
  let n = m.r8(g(-30654));
  if (n > 10) n = 10;
  for (let i = 0; i < n; i++) sum += (m.r8(g(-4574) + i) >> 4) + 1;
  const cnt = m.r8(g(-30654));
  if (cnt > 10) {
    const extra = (cnt - 10) & 0xff;
    const t = (m.r8(g(-4564)) >> 4) + 1;
    for (let i = 0; i < extra; i++) sum += t;
  }
  if (!(sum >>> 0 < m.r32(g(-28618)))) m.w8(g(-28609), (m.r8(g(-28609)) + 1) & 0xff);
  if (m.r8(g(-28609)) === 0) {
    if (!o.noMapLimit && m.r8(g(-30654)) >= m.r8(g(-22032))) m.w8(g(-28609), (m.r8(g(-28609)) + 1) & 0xff);
    else if (m.r8(g(-30654)) >= 250) m.w8(g(-28609), (m.r8(g(-28609)) + 1) & 0xff);
  }
}

/** CODE+0x1213E encounter_generate(): adds monster groups (11F0A) until the budget (12072) says the encounter is complete. */
export function encounterGenerate(m: Mem, o: { noMapLimit?: boolean } = {}): number {
  let groups = 0;
  encounterBudget(m, o);
  while (m.r8(g(-28609)) === 0) {
    encounterAddGroup(m);
    encounterBudget(m, o);
    groups++;
  }
  return groups;
}

/* ------------------------------------------------- one character runs */

/**
 * CODE+0x116B0 character_flee(): the acting character (A4-1269) runs when rand(1,100) < A4-22029 (map evade %,
 * hyp: loaded with the map). On success A4-24140 = 1, the party shrinks by one, the last member's slot (and acted flag
 * A4-24128[]) is moved into the runner's place, the last slot is emptied, A4-24141 is clamped to the party size,
 * the acting character resets to 0 and the party panel is redrawn (A4-31066 != 0).
 */
export function characterFlee(m: Mem, o: { noCompact?: boolean } = {}): Calls {
  const calls: Calls = [];
  const r = randRange(m, 1, 100) & 0xff;
  if (!(r < m.r8(g(-22029)))) return calls;
  m.w8(g(-24140), 1);
  m.w16(g(-31066), m.r16(g(-31066)) - 1);
  if (!(m.r8(g(-1269)) > m.r8(g(-31065))) && !o.noCompact) {
    const last = s16(m.r16(g(-31066)));
    const fl = m.r8(g(-24128) + last);
    const sl = m.r16(g(-31082) + 2 * last);
    const cur = m.r8(g(-1269));
    m.w8(g(-24128) + cur, fl);
    m.w16(g(-31082) + 2 * cur, sl);
    m.w16(g(-31082) + 2 * last, 0xffff);
  }
  if (m.r8(g(-24141)) > m.r8(g(-31065))) m.w8(g(-24141), m.r8(g(-31065)));
  m.w8(g(-1272), 0);
  if (m.r16(g(-31066)) !== 0) calls.push(['ui12848', []]);
  return calls;
}

/* ------------------------------------------------------- round loop */

/** Effect the stubbed action routines had in a vector: [code, a, b] (see rules.py gen_round). */
export type ActEffect = [number, number, number];

/**
 * CODE+0x12A22 combat round loop (turn order). The two action routines (party CODE+0x119C2, monster
 * CODE+0x1064C) and the UI/XP/wipe routines are stubs in the vectors; a stub models only the byte every real action
 * writes first: the acting side's acted flag (A4-24128[char] / A4-24138[mon] += 1; the monster action also
 * sets A4-1309 = slot) plus one scripted effect:
 *   1 A4-1315 = 1   2 A4-30654 = 0   3 every member condition = 0x81   4 monster a initiative = 0
 *   5 monster a status |= b   6 party member a working initiative (+0x6E) = b   (0 none)
 * Round = each side's unacted member with the highest initiative acts, the party on ties
 * (monster init A4-1294[], character +0x6E), until nobody is left; then statuses decay and acted flags reset.
 */
export function roundLoop(m: Mem, script: ActEffect[], o: { monsterFirst?: boolean; noDecay?: boolean } = {}): { calls: Calls; used: number } {
  const calls: Calls = [];
  let used = 0;
  const effect = (): ActEffect => script[used++] ?? [1, 0, 0];
  const apply = (e: ActEffect): void => {
    const [c, a, b] = e;
    if (c === 1) m.w8(g(-1315), 1);
    else if (c === 2) m.w8(g(-30654), 0);
    else if (c === 3) {
      for (let k = 0; k < m.r16(g(-31066)); k++) m.w8(charPtr(m, k) + 38, 0x81);
    } else if (c === 4) m.w8(g(-1294) + a, 0);
    else if (c === 5) m.w8(g(-1305) + a, m.r8(g(-1305) + a) | b);
    else if (c === 6) m.w8(charPtr(m, a) + 110, b);
  };
  m.w8(g(-31154), 2);
  m.w8(g(-24103), 0);
  m.w8(g(-1310), 0);
  calls.push(['ui135be', []]);
  encounterGroups(m);
  initMonsters(m);
  m.w8(g(-1272), (randRange(m, 1, m.r16(g(-31066))) - 1) & 0xff);
  calls.push(['ui3266', [0, 16, 12]]);
  for (;;) {
    // new round
    let over = 0;
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
    calls.push(['ui129cc', []]);
    calls.push(['ui12848', []]);
    for (;;) {
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
          const v = m.r8(charPtr(m, i) + 110);
          if (v > m.r8(g(-24119))) {
            m.w8(g(-24119), v);
            m.w8(g(-1269), i);
          }
        }
      }
      const pi = m.r8(g(-24119));
      const mi = m.r8(g(-24120));
      const partyActs = o.monsterFirst ? pi !== 0 && pi > mi : pi !== 0 && pi >= mi;
      if (partyActs) {
        const idx = m.r8(g(-1269));
        const e = effect();
        m.w8(g(-24128) + idx, (m.r8(g(-24128) + idx) + 1) & 0xff);
        calls.push(['pact', [idx, ...e]]);
        apply(e);
      } else if (mi !== 0) {
        const idx = m.r8(g(-1271));
        const e = effect();
        m.w8(g(-1309), idx);
        m.w8(g(-24138) + idx, (m.r8(g(-24138) + idx) + 1) & 0xff);
        calls.push(['mact', [idx, ...e]]);
        apply(e);
      } else over++;
      if (over === 0) over = battleOver(m);
      if (over !== 0) break;
    }
    if (battleOver(m) !== 0) break;
  }
  if (m.r8(g(-30654)) === 0) calls.push(['xp', []]);
  else if (m.r8(g(-24140)) !== 0 || m.r8(g(-1315)) !== 0) calls.push(['retreat', []]);
  return { calls, used };
}

/* ------------------------------------------------ encounter prompt */

const toUpper = (c: number) => (c > 0x60 && c <= 0x7a ? c - 0x20 : c);

/** CODE+0x04B60: average of party member byte +0x1E (16-bit sum / party size), low byte, capped 255 (A4-24142 afterwards). */
export function partyAvg1E(m: Mem): number {
  let sum = 0;
  const n = s16(m.r16(g(-31066)));
  for (let i = 0; i < n; i++) sum = (sum + m.r8(charPtr(m, i) + 30)) & 0xffff;
  let q = Math.floor(sum / m.r16(g(-31066))) & 0xffff;
  if (q > 0xff) q = 0xff;
  return q & 0xff;
}

/** CODE+0x09980: length of a NUL terminated string without trailing spaces. */
function trimmedLen(m: Mem, a: number): number {
  let p = a;
  while (m.r8(p) !== 0) p++;
  p--;
  while (m.r8(p) === 0x20) p--;
  return (p + 1 - a) & 0xffff;
}

/** Scripted answers for the stubbed input routines (key CODE+0x097A2, number prompt 0x03EE0, bribe payments 0x06C66/0x06ACE/0x06B9A). */
export interface PromptScript {
  keys: number[];
  nums: number[];
  pays: number[];
}

/**
 * CODE+0x12C6E encounter(): builds the monster list (or tops a scripted one up), rolls surprise, runs the prompt
 *   A-Attk  B-Bribe  H-Hide  R-Run
 * and starts the fight (CODE+0x12A22, stub `battle`). Rolls (d = rand(1,100)):
 *   surprise (only when A4-31083 == 0): d <= 40 and d <= avg(+0x1E) -> 2 (party surprises the monsters);
 *     else, unless A4-31142 is set, d >= 90 -> 3 (monsters surprise the party; no prompt, fight starts)
 *   Hide  : d < avg(+0x1E)  -> encounter avoided (A4-30653 = 1), else Attack
 *   Run   : surprise 2 always; else rand(1,100) < A4-22029 (map evade %); success calls CODE+0x11646 `retreat`, else Attack
 *   Bribe : sub key 1 Food / 2 Gold / 3 Gems, amount from the number prompt (b = low byte; Gold b += high byte);
 *     Food/Gems need b >= first monster's record index; each needs the monster's treasure flag
 *     (A4-4546 / -4545 / -4544) and d >= A4-22025 (map bribe threshold) and the payment routine to accept; success avoids the fight.
 * The monster list display (UI) is not modelled; its reads/writes of the working monster struct are.
 */
export function encounter(m: Mem, sc: PromptScript, o: { noSurprise?: boolean; hideAlways?: boolean } = {}): { calls: Calls } {
  const calls: Calls = [];
  const keys = [...sc.keys];
  const nums = [...sc.nums];
  const pays = [...sc.pays];
  const getKey = (submenu: boolean): number => {
    const k = keys.length ? keys.shift()! : submenu ? 0x1b : 0x41;
    calls.push(['key', [k]]);
    return k;
  };
  let num = 1;
  for (const d of [-1306, -30653, -24104, -24105, -24140, -24141, -1316, -24139, -1311, -1312, -1313, -1314, -1315, -1308, -1307]) m.w8(g(d), 0);
  m.w32(g(-28614), 0);
  const saved = m.r8(g(-31154));
  let i = 0;
  while (i < 10 && m.r8(g(-4574) + i) !== 0) i++;
  if (m.r8(g(-4564)) !== 0) i = (i + m.r8(g(-30654))) & 0xff;
  m.w8(g(-30654), i);
  partyPower(m);
  const s0 = m.r8(g(-31083));
  if (s0 < 0x80) encounterGenerate(m);
  else m.w8(g(-31083), (s0 - 0x80) & 0xff);
  if (m.r8(g(-30654)) === 0) {
    m.w8(g(-30654), 1);
    m.w8(g(-4574), (randRange(m, 1, 16) - 1) & 0xff);
  }
  let k = Math.min(m.r8(g(-30654)), 10);
  m.w8(g(-24142), partyAvg1E(m));
  unpackMonster(m, 0);
  for (let j = 0; j < k; j++) unpackMonster(m, j);
  if (m.r8(g(-30654)) > 10) {
    k = (m.r8(g(-30654)) - 10) & 0xff;
    unpackMonster(m, 10);
    if (k !== 1) {
      const len = trimmedLen(m, g(-4562));
      if (toUpper(m.r8(g(-4562) + s16(len - 1))) !== 0x53) {
        m.w16(g(-24966), 0);
        m.w16(g(-24966), 1);
      }
    }
  }
  m.w8(g(-29148), 0xfd);
  if (m.r8(g(-31083)) === 0) {
    const r = randRange(m, 1, 100) & 0xff;
    if (!o.noSurprise && r <= 0x28 && r <= m.r8(g(-24142))) m.w8(g(-31083), 2);
    else if (!o.noSurprise && m.r8(g(-31142)) === 0 && r >= 0x5a) m.w8(g(-31083), 3);
  }
  if (m.r8(g(-31083)) !== 0) {
    while (getKey(false) === 0);
  }
  const bribeThr = m.r8(g(-22025));
  unpackMonster(m, 0);
  if (m.r8(g(-31083)) !== 3) {
    for (;;) {
      let key = toUpper(getKey(false) & 0xff);
      const r = randRange(m, 1, 100) & 0xff;
      if (key === 0x53) key = 0x58;
      if (key === 0x42) {
        do key = getKey(true);
        while (key !== 0x1b && key !== 0x31 && key !== 0x32 && key !== 0x33);
        if (key !== 0x1b) {
          num = nums.length ? nums.shift()! : 0;
          calls.push(['num', [num]]);
        }
        if (key !== 0x1b && num !== 0) {
          let b = num & 0xff;
          if (key === 0x32) b = (b + (num >> 8)) & 0xff;
          else if (!(b >= m.r8(g(-4574)))) key = 0x41;
          const pay = (name: string, arg: number): number => {
            const ret = pays.length ? pays.shift()! : 0;
            calls.push([name, [arg, ret]]);
            return ret;
          };
          if (key === 0x31) {
            key = 0x41;
            if (m.r8(g(-4546)) !== 0 && r >= bribeThr && pay('payFood', b)) {
              key = 0x53;
              m.w8(g(-30653), 1);
            }
          }
          if (key === 0x32) {
            key = 0x41;
            if (m.r8(g(-4545)) !== 0 && r >= bribeThr && pay('payGold', num)) {
              key = 0x53;
              m.w8(g(-30653), 1);
            }
          }
          if (key === 0x33) {
            key = 0x41;
            if (m.r8(g(-4544)) !== 0 && r >= bribeThr && pay('payGems', num)) {
              key = 0x53;
              m.w8(g(-30653), 1);
            }
          }
        }
      }
      if (key === 0x48) {
        if (r < m.r8(g(-24142)) || o.hideAlways) {
          m.w8(g(-30653), 1);
          key = 0x53;
        } else key = 0x41;
      }
      if (key === 0x52) {
        if (m.r8(g(-31083)) === 2 || (randRange(m, 1, 100) & 0xff) < m.r8(g(-22029))) {
          calls.push(['retreat', []]);
          key = 0x53;
        } else key = 0x41;
      }
      if (key === 0x41) calls.push(['battle', []]);
      if (key === 0x52 || key === 0x41 || key === 0x42 || key === 0x48 || key === 0x53) break;
    }
  } else calls.push(['battle', []]);
  m.w8(g(-31154), saved);
  m.w8(g(-21960), 0xff);
  return { calls };
}
