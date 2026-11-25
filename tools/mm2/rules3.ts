/**
 * Might & Magic II (Amiga) game rules, pass 2: damage applied to monsters, death handling, monster-side effects.
 * Ported from the game's 68000 code and diffed against the retail executable under Unicorn
 * (tools/mm2/rules_oracle/); see docs/mm2/amiga/game-rules.md section 11. Conventions as in rules.ts.
 */
import { type Mem, g } from './rules-mem.ts';
import { charPtr, killReward, luckSave, monsterUsesAbility, randRange, statBonus, unpackMonster } from './rules.ts';

type Calls = [string, number[]][];

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;

/**
 * CODE+0x10C66 quest_kill(): every party member whose byte +0x78 equals the dying monster's record index and whose
 * +0x7C bit 0 is set gets +0x7C bit 1 set (hyp: +0x78 = quest target monster, bit 0 = quest accepted, bit 1 = target slain).
 */
export function questKill(m: Mem, o: { ignoreFlag?: boolean } = {}): void {
  const id = m.r8(g(-4574) + m.r8(g(-1309)));
  for (let i = 0; i < s16(m.r16(g(-31066))); i++) {
    const ch = charPtr(m, i);
    const t = m.r8(ch + 120);
    if (t !== 0 && t === id && (o.ignoreFlag || m.r8(ch + 124) & 1)) m.w8(ch + 124, m.r8(ch + 124) | 2);
  }
}

/**
 * CODE+0x10CCE remove_monster(): count -= 1, the melee group (A4-1316) is clamped to the new count, and every
 * per-slot array (status, initiative, uses, hp, acted flag, slot type) of slots after A4-1309 shifts down one place
 * (only when the removed slot is one of the 10 visible ones).
 */
export function removeMonster(m: Mem, o: { noShift?: boolean } = {}): void {
  m.w8(g(-30654), (m.r8(g(-30654)) - 1) & 0xff);
  if (m.r8(g(-1316)) > m.r8(g(-30654))) m.w8(g(-1316), m.r8(g(-30654)));
  if (m.r8(g(-1309)) < 10) {
    let n = m.r8(g(-30654));
    if (n > 9) n = 10;
    if (m.r8(g(-30654)) !== 0 && !o.noShift) {
      for (let i = m.r8(g(-1309)); i < n; i++) {
        m.w8(g(-1305) + i, m.r8(g(-1305) + i + 1));
        m.w8(g(-1294) + i, m.r8(g(-1294) + i + 1));
        m.w8(g(-1283) + i, m.r8(g(-1283) + i + 1));
        m.w16(g(-1338) + 2 * i, m.r16(g(-1338) + 2 * (i + 1)));
        m.w8(g(-24138) + i, m.r8(g(-24138) + i + 1));
        m.w8(g(-4574) + i, m.r8(g(-4574) + i + 1));
      }
    }
  }
}

/**
 * CODE+0x10E5E monster_dies(): quest bookkeeping, the kill reward (rules.ts killReward, 4.6), the death message
 * (re-unpacks the victim), removal from the slot table, and for slot 10 (the aggregate of queued monsters) the XP
 * of all `count - 9` queued monsters at once with the count reset to 10.
 */
export function monsterDies(m: Mem, o: { noQueueXp?: boolean } = {}): void {
  questKill(m);
  killReward(m);
  unpackMonster(m, m.r8(g(-1309)));
  removeMonster(m);
  if (m.r8(g(-1309)) >= 10) {
    const k = (m.r8(g(-30654)) - 9) & 0xff;
    m.w8(g(-30654), 10);
    if (!o.noQueueXp) for (let j = 0; j < k; j++) m.w32(g(-28614), (m.r32(g(-28614)) + m.r32(g(-4510))) >>> 0);
  }
}

/**
 * CODE+0x10EAC damage_monster(): A4-3852 damage to the monster in slot A4-1309 (clamped to 10). Its status byte
 * is wiped unless it is > 0x80, then bit 4 (asleep) cleared and bit 0 set; hp (`u16 A4-1338[slot]`) -= damage
 * when hp > damage, otherwise the monster dies (damage >= hp kills) and A4-3852 becomes 0xFFFF.
 */
export function damageMonster(m: Mem, o: { gtKills?: boolean; keepStatus?: boolean } = {}): void {
  if (m.r8(g(-1309)) > 10) m.w8(g(-1309), 10);
  const slot = m.r8(g(-1309));
  let st = m.r8(g(-1305) + slot);
  if (!(st > 0x80) && !o.keepStatus) st = 0;
  st &= 0xef;
  st |= 1;
  m.w8(g(-1305) + slot, st);
  const hp = m.r16(g(-1338) + 2 * slot);
  const dmg = m.r16(g(-3852));
  if (o.gtKills ? hp >= dmg : hp > dmg) m.w16(g(-1338) + 2 * slot, hp - dmg);
  else {
    monsterDies(m);
    m.w16(g(-3852), 0xffff);
  }
}

/**
 * CODE+0x11040 resolve_party_hit(): applies a party attack's total (A4-3852) to the target monster (A4-1309).
 * The monster is immune (message only, no damage) when its record byte 0x19 field `A4-4528` is non-zero and
 * `A4-4528 - 1` equals the attacker's sex byte (+0x0C: so field 1 = immune to male attackers, 2 = to female, 3 = to none)
 * or when the record's mres bit 2 (`A4-4516`) is set. Otherwise a non-zero total is handed to damage_monster.
 * The weapon bytes the routine also loads (+0x4C/+0x4E) are not used afterwards.
 */
export function resolvePartyHit(m: Mem, o: { noSexImmunity?: boolean } = {}): void {
  let immune = 0;
  const ch = charPtr(m, m.r8(g(-1269)));
  let w = m.r8(g(-4528));
  if (w !== 0 && !o.noSexImmunity) {
    w--;
    if (w === m.r8(ch + 12)) immune++;
  }
  if (immune === 0 && m.r8(g(-4516)) !== 0) immune++;
  if (immune === 0 && m.r16(g(-3852)) !== 0) damageMonster(m);
}

/** CODE+0x10332 target for a monster's ranged/spell attack: a random living member, scanning forward with wrap (quirk: after a wrap the stale record pointer decides, so slot 0 can be chosen while dead). Sets A4-1272. */
export function pickTargetRanged(m: Mem, o: { fresh?: boolean } = {}): void {
  let r = (randRange(m, 1, m.r16(g(-31066))) - 1) & 0xff;
  for (;;) {
    let ch = charPtr(m, r);
    if (m.r8(ch + 38) >= 0x80) {
      r = (r + 1) & 0xff;
      const nch = charPtr(m, r);
      if (!o.fresh) ch = nch;
      if (r >= m.r8(g(-31065))) {
        r = 0;
        if (o.fresh) ch = charPtr(m, 0);
      }
    }
    if (m.r8(g(-1272)) >= m.r8(g(-31065))) m.w8(g(-1272), 0);
    if (m.r8(ch + 38) >= 0x80) continue;
    m.w8(g(-1272), r);
    return;
  }
}

/**
 * CODE+0x103BA target for a monster's melee attack: walks the party rotation A4-1272 inside the front rank
 * A4-24141 (grown, up to the party size, when the walk has gone round it) until it lands on a member whose
 * condition has neither the unconscious (0x40) nor the dead (0x80) bit.
 */
export function pickTargetMelee(m: Mem, o: { ignoreFront?: boolean } = {}): void {
  let i = 0;
  do {
    if (i >= m.r8(g(-24141))) {
      m.w8(g(-24141), (m.r8(g(-24141)) + 1) & 0xff);
      if (m.r8(g(-24141)) > m.r8(g(-31065))) m.w8(g(-24141), m.r8(g(-31065)));
    } else m.w8(g(-1272), (m.r8(g(-1272)) + 1) & 0xff);
    if (m.r8(g(-1272)) >= m.r8(g(-24141)) && !o.ignoreFront) m.w8(g(-1272), 0);
    if (m.r8(g(-1272)) >= m.r8(g(-31065))) m.w8(g(-1272), 0);
    i = (i + 1) & 0xff;
  } while (m.r8(charPtr(m, m.r8(g(-1272))) + 38) & 0xc0);
}

/**
 * CODE+0x1064C monster_turn(): decision logic of one monster action. Leaf actions are stubs in the vectors
 * (logged): `show` 0x1265E, `pickMelee` 0x103BA / `pickRanged` 0x10332 then `attack` (monster melee roll 4.1),
 * `advance` 0x10118, `spell` 0x10002, `special` 0x1042C, `partyEffect(1,slot,v)` 0x10894.
 *   status & 0x30 (asleep/held): no action.                     status >= 0x80: applies the party effect `A4-1313` (tables A4-28454/-28446).
 *   status & 0x40: no action (message).                         flee: unless A4-1314, tbl[A4-28442][record oabil bits 5-6] < A4-28610 (party half level)
 *   and rand(1,100) <= 50 -> the monster leaves the fight (removed without reward).
 *   else ability gate (4.5) fails: in melee range (slot < A4-1316) melee; else with sabil bit 6 and rand(1,100) <= 80 ranged; else `advance`.
 *   ability gate passes: pabil verb v = A4-4540: v < 0x0F, 0x1D or >= 0x1F -> spell; otherwise `special` if status bit 1 else spell.
 */
export function monsterTurn(m: Mem, o: { noFlee?: boolean } = {}): Calls {
  const calls: Calls = [];
  const slot = m.r8(g(-1271));
  m.w8(g(-1309), slot);
  m.w8(g(-24138) + slot, (m.r8(g(-24138) + slot) + 1) & 0xff);
  unpackMonster(m, slot);
  m.w8(g(-1270), 0);
  const st = m.r8(g(-1305) + slot);
  if (st & 0x30) return calls;
  if (st >= 0x80) {
    m.w8(g(-1339), 2);
    let k = m.r8(g(-1313));
    if (k) k--;
    m.w16(g(-1342), m.r16(g(-28454) + 2 * k));
    const v = m.r8(g(-28446) + k);
    calls.push(['partyEffect', [1, slot, v]]);
    return calls;
  }
  if (st & 0x40) {
    calls.push(['show', [slot]]);
    m.w8(g(-1310), 1);
    return calls;
  }
  let flee = 0;
  if (m.r8(g(-1314)) === 0) {
    const thr = m.r8(g(-28442) + m.r8(g(-4534)));
    if (thr < m.r8(g(-28610)) && !o.noFlee && randRange(m, 1, 100) <= 0x32) flee++;
  }
  if (flee) {
    m.w8(g(-24103), 1);
    unpackMonster(m, m.r8(g(-1309)));
    removeMonster(m);
    m.w8(g(-24103), 0);
  } else {
    calls.push(['show', [slot]]);
    m.w8(g(-1310), 1);
    if (!monsterUsesAbility(m)) {
      if (slot < m.r8(g(-1316))) {
        m.w8(g(-24114), 0);
        m.w8(g(-1339), 0);
        calls.push(['pickMelee', []], ['attack', []]);
      } else if (m.r8(g(-4526)) !== 0 && randRange(m, 1, 100) <= 0x50) {
        m.w8(g(-24114), 1);
        calls.push(['pickRanged', []]);
        m.w8(g(-1339), 0);
        calls.push(['attack', []]);
      } else calls.push(['advance', []]);
    } else {
      const v = m.r8(g(-4540));
      if (v < 0x0f || v === 0x1d || v >= 0x1f) calls.push(['spell', []]);
      else if (m.r8(g(-1305) + slot) & 2) calls.push(['special', []]);
      else calls.push(['spell', []]);
    }
  }
  m.w8(g(-24114), 0);
  if (m.r8(g(-1310)) !== 0) calls.push(['show', [slot]]); // hides the highlight set by the first show
  m.w8(g(-1310), 0);
  return calls;
}

/* ------------------------------------------------ condition effects */

const R_PTR = -22070; // u32: target character record of the effect being applied
const R_RES = -22066; // u16: 1 when the effect took

/** Names the game prints for sabil/spell effect ids 1..30 (message table A4-28366). */
export const EFFECT_NAMES = ['lost gold', 'lost gems', 'is poisoned', 'is diseased', 'falls asleep', 'is cursed', 'is silenced', 'is paralyzed', 'collapses', 'dies', 'turns to stone', 'is eradicated!!', 'lost item', 'lost backpack', 'lost food', 'lost all food', 'lost all gold', 'lost all gems', 'lost valuables', 'is aged', 'is aged', 'lost statistics', 'lost statistics', 'lost statistics', 'lost level', 'lost level', 'lost experience', 'items scrambled', 'lost spell points', 'is assassinated'] as const;

/** CODE+0x1ECC4 save(i): i == 0 always takes; else d100 >= character byte [i] takes (a high resistance byte protects). */
function effectSave(m: Mem, i: number): void {
  if (i === 0) {
    m.w16(g(R_RES), m.r16(g(R_RES)) + 1);
    return;
  }
  const d = randRange(m, 1, 100) & 0xff;
  m.w16(g(R_RES), d >= m.r8(m.r32(g(R_PTR)) + i) ? 1 : 0);
}
/** CODE+0x1EC7E: *p -= n; when it would go below zero it becomes 0 and a living target dies (0x81). Always reports success. */
function effectSub(m: Mem, p: number, n: number): void {
  m.w16(g(R_RES), 1);
  if (m.r8(p) >= (n & 0xff)) m.w8(p, m.r8(p) - (n & 0xff));
  else {
    m.w8(p, 0);
    const t = m.r32(g(R_PTR));
    if (m.r8(t + 38) < 0x80) m.w8(t + 38, 0x81);
  }
}
/** CODE+0x1ED18: save(i), then set condition bits `mask` on a living target. */
function effectCond(m: Mem, mask: number, i: number): void {
  effectSave(m, i);
  if (m.r16(g(R_RES)) !== 0) {
    const t = m.r32(g(R_PTR));
    if (m.r8(t + 38) < 0x80) m.w8(t + 38, m.r8(t + 38) | mask);
  }
}

/**
 * CODE+0x1F27E set_condition(ch): applies sabil/spell effect A4-4537 (1..30, others do nothing) to a party member and
 * returns whether it took (A4-22066). Saves use the character resist bytes +0x16 / +0x1A / +0x1B / +0x1C / +0x1E:
 *   1 lost gold (only roster index < 24; steals 0x10000 / 0x100 / 1 of +0x66 by magnitude)   2 lost gems (+0x5C)
 *   3 poisoned (cond |= 0x08, save +0x1C)  4 diseased (0x04, +0x1C)  5 asleep (0x10, +0x1B)  6 cursed (0x01, +0x16)
 *   7 silenced (0x02, +0x16)  8 paralyzed (0x20, +0x1C)  9 collapses (0x40, +0x1C)  10 dies (0x81)  11 stone (0x82)  12 eradicated (0xFF), no save
 *   13 lost item (first backpack item, slots compact)  14 lost backpack  15 lost food (+0x25 halved)  16 all food  17 all gold  18 all gems
 *   19 valuables (food, gems, gold)  20/21 aged +1/+5 (+0x21, cap 200)  22 working stats -2  23 halved  24 one base stat -1 (+0x10..+0x15)
 *   25 working level -2  26 halved  27 experience -(20..100) (+0x62)  28 backpack items scrambled  29 SP (+0x58) = 0  30 HP = 0 and unconscious.
 * Save byte per effect: +0x1E (1, 2, 13-19, 28, 30; the thieving byte), +0x1C (3, 4, 8, 9), +0x1B (5), +0x16 (6, 7), +0x1A (29); none for 10-12 and 20-27.
 * A save succeeds (the effect takes) when d100 >= the byte, so a high resistance byte protects.
 */
export function setCondition(m: Mem, ch: number, o: { noSave?: boolean } = {}): number {
  m.w32(g(R_PTR), ch);
  m.w16(g(R_RES), 0);
  const eff = m.r8(g(-4537));
  const wr16 = (v: number) => m.w16(g(R_RES), v);
  const gold = (all: number) => {
    if (s16(m.r16(g(-31082) + 2 * m.r8(g(-1272)))) >= 0x18) return;
    effectSave(m, 0x1e);
    if (m.r16(g(R_RES)) === 0) return;
    if (all) m.w32(ch + 102, 0);
    else if (m.r32(ch + 102) >= 0x10000) m.w32(ch + 102, m.r32(ch + 102) - 0x10000);
    else if (m.r32(ch + 102) >= 0x100) m.w32(ch + 102, m.r32(ch + 102) - 0x100);
    else if (m.r32(ch + 102) > 0) m.w32(ch + 102, m.r32(ch + 102) - 1);
  };
  const gems = (all: number) => {
    effectSave(m, 0x1e);
    if (m.r16(g(R_RES)) === 0) return;
    if (all) m.w16(ch + 92, 0);
    else if (m.r16(ch + 92) >= 0x100) m.w16(ch + 92, m.r16(ch + 92) - 0x100);
    else if (m.r16(ch + 92) > 0) m.w16(ch + 92, m.r16(ch + 92) - 1);
  };
  const food = (all: number) => {
    effectSave(m, 0x1e);
    if (m.r16(g(R_RES)) === 0) return;
    if (all) m.w8(ch + 37, 0);
    else m.w8(ch + 37, m.r8(ch + 37) >> 1);
  };
  const age = (n: number) => {
    m.w8(ch + 33, m.r8(ch + 33) + n);
    if (m.r8(ch + 33) > 0xc8) m.w8(ch + 33, 0xc8);
    m.w16(g(R_RES), m.r16(g(R_RES)) + 1);
  };
  const stats = (k: number) => {
    if (k === 2) {
      const r = randRange(m, 1, 6);
      effectSub(m, ch + 15 + (r & 0xffff), 1);
      return;
    }
    for (let i = 0; i < 7; i++) {
      const p = ch + 0x6b + s16(m.r16(g(-26232) + 2 * i));
      let amt = 2;
      if (k === 1) {
        amt = m.r8(p);
        if (amt >= 2) amt >>= 1;
      }
      effectSub(m, p, amt);
    }
  };
  const level = (k: number) => {
    let amt = 2;
    if (k) {
      amt = m.r8(ch + 113) >> 1;
      if (amt === 0) amt++;
    }
    effectSub(m, ch + 113, amt);
  };
  switch (o.noSave ? 0 : eff) {
    case 1: gold(0); break;
    case 2: gems(0); break;
    case 3: effectCond(m, 8, 0x1c); break;
    case 4: effectCond(m, 4, 0x1c); break;
    case 5: effectCond(m, 0x10, 0x1b); break;
    case 6: effectCond(m, 1, 0x16); break;
    case 7: effectCond(m, 2, 0x16); break;
    case 8: effectCond(m, 0x20, 0x1c); break;
    case 9: effectCond(m, 0x40, 0x1c); break;
    case 10: m.w8(ch + 38, 0x81); break;
    case 11: m.w8(ch + 38, 0x82); break;
    case 12: m.w8(ch + 38, 0xff); break;
    case 13:
      effectSave(m, 0x1e);
      if (m.r16(g(R_RES)) !== 0) {
        let i = 0;
        while (i < 6 && m.r8(ch + 58 + i) === 0) i++;
        if (i === 6) break;
        m.w8(ch + 58 + i, 0);
        m.w8(ch + 70 + i, 0);
        m.w8(ch + 64 + i, 0);
        for (let k = i; k < 5; k++) {
          m.w8(ch + 58 + k, m.r8(ch + 58 + k + 1));
          m.w8(ch + 64 + k, m.r8(ch + 64 + k + 1));
          m.w8(ch + 70 + k, m.r8(ch + 70 + k + 1));
        }
        m.w8(ch + 63, 0);
        m.w8(ch + 69, 0);
        m.w8(ch + 75, 0);
      }
      break;
    case 14:
      effectSave(m, 0x1e);
      if (m.r16(g(R_RES)) !== 0) for (let i = 0; i < 6; i++) for (const o2 of [58, 70, 64]) m.w8(ch + o2 + i, 0);
      break;
    case 15: food(0); break;
    case 16: food(1); break;
    case 17: gold(1); break;
    case 18: gems(1); break;
    case 19: {
      food(1);
      const a = m.r16(g(R_RES));
      gems(1);
      const b = m.r16(g(R_RES));
      gold(1);
      wr16(m.r16(g(R_RES)) | a | b);
      break;
    }
    case 20: age(1); break;
    case 21: age(5); break;
    case 22: stats(0); break;
    case 23: stats(1); break;
    case 24: stats(2); break;
    case 25: level(0); break;
    case 26: level(1); break;
    case 27: {
      const a = (randRange(m, 1, 80) + 20) & 0xffff;
      if (m.r32(ch + 98) > a) {
        m.w32(ch + 98, m.r32(ch + 98) - a);
        wr16(m.r16(g(R_RES)) + 1);
      } else m.w32(ch + 98, 0);
      break;
    }
    case 28:
      effectSave(m, 0x1e);
      if (m.r16(g(R_RES)) !== 0)
        for (let i = 0; i < 6; i++) {
          const v = m.r8(ch + 58 + i);
          if (v !== 0 && v < 0xd0) m.w8(ch + 58 + i, randRange(m, 1, 0xcf));
        }
      break;
    case 29:
      effectSave(m, 0x1a);
      if (m.r16(g(R_RES)) !== 0) m.w16(ch + 88, 0);
      break;
    case 30:
      effectSave(m, 0x1e);
      if (m.r16(g(R_RES)) !== 0) {
        m.w16(ch + 94, 0);
        if (m.r8(ch + 38) < 0x80) m.w8(ch + 38, m.r8(ch + 38) | 0x40);
      }
      break;
    default:
  }
  return m.r16(g(R_RES));
}

/**
 * CODE+0x0FD8C monster_special(): the monster's special attack (record sabil, 3.1) after a hit on the party member A4-1272.
 *   - a target already unconscious/dead (cond >= 0x40) is only reported and widens the front rank A4-24141 (< party size)
 *   - no effect when A4-1270 is set, the monster has no effect (A4-4537 == 0), the attack was ranged (A4-24114) or the target is dead (>= 0x80)
 *   - chance: tier = recordIndex >> 4; hit iff `tier + u8[16]@A4-28422[tier] >= d100` (byte add)
 *   - sabil bit 5 (A4-4536): the target's luck save (4.4) cancels the effect
 *   - effect id A4-4537 >= 0x20 does nothing; 0x1F is replaced by rand(1,30); then set_condition (setCondition)
 */
export function monsterSpecial(m: Mem, o: { noChance?: boolean; noLuck?: boolean } = {}): number {
  const ch = charPtr(m, m.r8(g(-1272)));
  if (m.r8(ch + 38) >= 0x40) {
    if (m.r8(g(-24141)) < m.r16(g(-31066))) m.w8(g(-24141), m.r8(g(-24141)) + 1);
  }
  if (m.r8(g(-1270)) !== 0 || m.r8(g(-4537)) === 0 || m.r8(g(-24114)) !== 0) return 0;
  if (m.r8(ch + 38) >= 0x80) return 0;
  let t = m.r8(g(-4574) + m.r8(g(-1271))) >> 4;
  t = (t + m.r8(g(-28422) + t)) & 0xff;
  const d = randRange(m, 1, 100) & 0xff;
  if (!o.noChance && t < d) return 0;
  if (m.r8(g(-4536)) !== 0 && !o.noLuck && luckSave(m, ch) !== 0) return 0;
  if (m.r8(g(-4537)) >= 0x20) return 0;
  let e = m.r8(g(-4537));
  if (e === 0x1f) e = randRange(m, 1, 30) & 0xff;
  m.w8(g(-4537), e);
  return setCondition(m, ch);
}

/* ----------------------------------------------------------- spell gates */

/**
 * CODE+0x78A8 spell combat gate: byte0 bits 6-7 of the spells.dat record: 0 = anywhere; 1 = combat only (A4-31154 == 2, else
 * message 3); 2 = outside combat only (else message 2); 3 = never. Returns 1 to allow.
 */
export function spellCombatGate(m: Mem, rec: number, o: { swap?: boolean } = {}): { ok: number; calls: Calls } {
  const k = (m.r8(rec) >> 6) & 3;
  if (k === 0) return { ok: 1, calls: [] };
  if (k === 3) return { ok: 0, calls: [] };
  const inCombat = m.r8(g(-31154)) === 2;
  if (k === 1) {
    if (o.swap ? !inCombat : inCombat) return { ok: 1, calls: [] };
    return { ok: 0, calls: [['msg', [3]]] };
  }
  if (k === 2) {
    if (o.swap ? inCombat : !inCombat) return { ok: 1, calls: [] };
    return { ok: 0, calls: [['msg', [2]]] };
  }
  return { ok: 0, calls: [] };
}

/** CODE+0x2BCC: the map's 16x16 bit map (u8[32] at A4-22010, row = y, bit by x & 7) at the party position (A4-31217 = x, A4-31216 = y). */
export function mapFlagAt(m: Mem): number {
  const row = m.r8(g(-22010) + m.r8(g(-31216)) * 2 + (m.r8(g(-31217)) > 7 ? 1 : 0));
  return row & m.r8(g(-30142) + (m.r8(g(-31217)) & 7)) ? 1 : 0;
}

/**
 * CODE+0x790E spell location gate: records with byte1 >= 0x80 are allowed when A4-31202 == 1 (hyp: overland), else only when the
 * map flag bit at the party's square (mapFlagAt) is clear (message 4 otherwise).
 */
export function spellLocationGate(m: Mem, rec: number, o: { ignoreMap?: boolean } = {}): { ok: number; calls: Calls } {
  if (m.r8(rec + 1) < 0x80) return { ok: 1, calls: [] };
  if (m.r8(g(-31202)) === 1) return { ok: 1, calls: [] };
  if (o.ignoreMap || !mapFlagAt(m)) return { ok: 1, calls: [] };
  return { ok: 0, calls: [['msg', [4]]] };
}

/* ------------------------------------------------------------ equipment */

export const ITEM_TABLE = -16126; // 256 x 20-byte items.dat records (A4-16126), loaded by the overlay
const itemByte = (m: Mem, id: number, off: number) => m.r8(g(ITEM_TABLE) + id * 20 + off);
/** CODE+0x4552 saturating byte add / CODE+0x452C floor-at-zero byte subtract */
const satAdd = (m: Mem, p: number, n: number) => m.w8(p, m.r8(p) > 255 - (n & 0xff) ? 0xff : m.r8(p) + (n & 0xff));
const floorSub = (m: Mem, p: number, n: number) => m.w8(p, m.r8(p) >= (n & 0xff) ? m.r8(p) - (n & 0xff) : 0);

/** item id classes (CODE+0xF5F4..0xF6B4): melee weapons 1..0x5B, ranged weapons 0x5C..0x72, armour 0x73..0x9F */
export const isMelee = (id: number) => id >= 1 && id <= 0x5b;
export const isRanged = (id: number) => id >= 0x5c && id <= 0x72;
export const isArmour = (id: number) => id >= 0x73 && id <= 0x9f;

/**
 * CODE+0x067E6 recalc_ac(): for every party member, AC (+0x24) = clamp(stat_bonus(+0x13) [negative counted as 0] + armour
 * accumulator +0x1F, 0..255). `+0x13` is the working-stat source the stat table calls speed.
 */
export function recalcAc(m: Mem, o: { noClamp?: boolean } = {}): void {
  for (let i = 0; i < s16(m.r16(g(-31066))); i++) {
    const ch = charPtr(m, i);
    let b = statBonus(m, m.r8(ch + 19));
    if (b >= 0xf0) b = 0;
    const sum = b + m.r8(ch + 31);
    if (sum > 255) m.w8(ch + 36, o.noClamp ? sum : 255);
    else if (sum <= 0) m.w8(ch + 36, 0);
    else m.w8(ch + 36, sum);
  }
}

/** CODE+0xF110 / 0xF1C0: remove / apply the equipped item's stat bonus (item byte +0x0E: hi nibble stat index, lo nibble amount; enchant = ch[0x34+slot] & 0x3F is added to it). */
function itemStatBonus(m: Mem, ch: number, slot: number, apply: boolean): void {
  const id = m.r8(ch + 40 + slot);
  let b = itemByte(m, id, 14);
  let ench = m.r8(ch + 52 + slot) & 0x3f;
  const type = b >> 4;
  b &= 0x0f;
  if (b !== 0) {
    ench = (ench + b) & 0xff;
    const p = ch + 0x10 + type;
    const w = type <= 5 ? ch + 0x6b + type : 0;
    (apply ? satAdd : floorSub)(m, p, ench);
    if (w) (apply ? satAdd : floorSub)(m, w, ench);
  }
  recalcAc(m);
}

/**
 * CODE+0xF36C equip_item(ch, slot): the item id is ch[0x28+slot], its enchant ch[0x34+slot] & 0x3F. A melee weapon (id 1..0x5B) sets
 * the melee die +0x4C = items.dat damage byte (+0x10) and +0x4D = enchant; a ranged weapon (0x5C..0x72) sets +0x4E / +0x4F; armour
 * (0x73..0x9F) adds enchant and the record's +0x10 byte to the AC accumulator +0x1F (cap 255). Then the stat bonus is applied and AC recalculated.
 * CODE+0xF270 unequip_item reverses it (weapon bytes cleared, accumulator floors at 0).
 */
export function equipItem(m: Mem, ch: number, slot: number, o: { noArmour?: boolean } = {}): void {
  const id = m.r8(ch + 40 + slot);
  const ench = m.r8(ch + 52 + slot) & 0x3f;
  const base = itemByte(m, id, 16);
  if (isMelee(id)) {
    m.w8(ch + 76, base);
    m.w8(ch + 77, ench);
  }
  if (isRanged(id)) {
    m.w8(ch + 78, base);
    m.w8(ch + 79, ench);
  }
  if (isArmour(id) && !o.noArmour) {
    satAdd(m, ch + 31, ench);
    satAdd(m, ch + 31, base);
  }
  itemStatBonus(m, ch, slot, true);
}
export function unequipItem(m: Mem, ch: number, slot: number, o: { keepBase?: boolean } = {}): void {
  const id = m.r8(ch + 40 + slot);
  const ench = m.r8(ch + 52 + slot) & 0x3f;
  const base = itemByte(m, id, 16);
  if (isMelee(id)) {
    m.w8(ch + 76, 0);
    m.w8(ch + 77, 0);
  }
  if (isRanged(id)) {
    m.w8(ch + 78, 0);
    m.w8(ch + 79, 0);
  }
  if (isArmour(id)) {
    floorSub(m, ch + 31, ench);
    if (!o.keepBase) floorSub(m, ch + 31, base);
  }
  itemStatBonus(m, ch, slot, false);
}

/* ------------------------------------------------------------- treasure */

/**
 * CODE+0x12206 loot_item(idx): rolls one treasure item. The loot tier A4-24105 is first capped at 2; d100 picks the first
 * row k of the u8[7] threshold table A4-28118 with d <= thr[k]; the item id = row base (u8@A4-28108[k*4]) + rand(1, u8@A4-28108[k*4 + tier + 1]).
 * Stored at A4-16156[idx]. Slot flags A4-16153[idx] hold the charges byte (items with bonus byte != 0xF0 and a tier index
 * A4-24104 >= 2: rand(1,7), replaced by rand(1,tierIndex) for 2..12 or rand(1,21)+11 for 13; values < 5 give none; otherwise
 * d100 < 41 sets 0x80, < 71 sets 0x40, else 0xC0), and A4-16150[idx] the item's use power (u8@A4-28111[tier]) when its record byte +0x0F is non-zero.
 */
export function lootItem(m: Mem, idx: number, o: { noCap?: boolean } = {}): void {
  let ch = 0;
  let uses = 0;
  if (m.r8(g(-24105)) > 2 && !o.noCap) m.w8(g(-24105), 2);
  let d = randRange(m, 1, 100) & 0xff;
  let k = 0;
  do {
    if (d <= m.r8(g(-28118) + k)) break;
    k++;
  } while (k < 7);
  let item = m.r8(g(-28108) + k * 4);
  item = (item + (randRange(m, 1, m.r8(g(-28108) + k * 4 + m.r8(g(-24105)) + 1)) & 0xff)) & 0xff;
  const rec = g(ITEM_TABLE) + item * 20;
  m.w8(g(-16156) + idx, item);
  if (m.r8(rec + 15) !== 0) uses = m.r8(g(-28111) + m.r8(g(-24105)));
  if (m.r8(rec + 14) !== 0xf0 && m.r8(g(-24104)) >= 2) {
    ch = randRange(m, 1, 7) & 0xff;
    const ti = m.r8(g(-24104));
    if (ti >= 2 && ti <= 12) ch = randRange(m, 1, ti) & 0xff;
    if (ti === 13) ch = (randRange(m, 1, 21) + 11) & 0xff;
    if (ch >= 5) {
      d = randRange(m, 1, 100) & 0xff;
      if (d < 0x29) ch |= 0x80;
      else if (d < 0x47) ch |= 0x40;
      else ch |= 0xc0;
    }
  }
  m.w8(g(-16153) + idx, ch);
  m.w8(g(-16150) + idx, uses);
}

/** CODE+0x123B0 treasure(): d100 < 11 -> 3 items, < 46 -> 2, < 91 -> 1, else none; each lowers the loot tier (A4-24105) by one while it is above 0 (the item is rolled at tier 0 once it runs out). */
export function treasure(m: Mem, o: { noTierCost?: boolean } = {}): void {
  const r = randRange(m, 1, 100) & 0xff;
  const n = r < 0x0b ? 3 : r < 0x2e ? 2 : r < 0x5b ? 1 : 0;
  if (!n) return;
  let i = 0;
  do {
    if (m.r8(g(-24105)) !== 0 && !o.noTierCost) m.w8(g(-24105), m.r8(g(-24105)) - 1);
    lootItem(m, i);
    i++;
  } while (i < n);
}

/* ------------------------------------------------------- Hall of Training */

const mulu32 = (a: number, b: number) => Math.imul(a, b) >>> 0;

/**
 * CODE+0x20796 xp_needed(ch): experience needed to reach level L = +0x20 + 1 (cap 255). Paladin, Archer, Sorcerer and Ninja
 * (class 1, 2, 4, 6) use the second row of the table `u32[2][9]` at A4-25998 (levels 2..10); beyond level 10 the cost grows by
 * 0x2EE00 per level for 11..13, 0x5DC00 for 14..15, then 0xBB800 per level (16..20, capped at 5 steps), 0x177000 (21..30, 10 steps),
 * 0x2EE000 (31..50, 20 steps), 0x190000 (51..75, 25 steps) and 0x5DC000 per level above 75.
 */
export function xpNeeded(m: Mem, ch: number, o: { noL15?: boolean } = {}): number {
  let L = m.r8(ch + 32);
  if (L !== 0xff) L++;
  const cls = m.r8(ch + 15);
  const w = cls === 1 || cls === 2 || cls === 4 || cls === 6 ? 1 : 0;
  const idx = Math.min(L, 10);
  let x = m.r32(g(-25998) + w * 0x24 + ((idx - 2) & 0xffff) * 4);
  if (L >= 0x0b) x = (x + 0x2ee00) >>> 0;
  if (L >= 0x0c) x = (x + 0x2ee00) >>> 0;
  if (L >= 0x0d) x = (x + 0x2ee00) >>> 0;
  if (L >= 0x0e) x = (x + 0x5dc00) >>> 0;
  if (L >= 0x0f && !o.noL15) x = (x + 0x5dc00) >>> 0;
  if (L >= 0x10) x = (x + mulu32(Math.min(L - 15, 5), 0xbb800)) >>> 0;
  if (L >= 0x15) x = (x + mulu32(Math.min(L - 20, 10), 0x177000)) >>> 0;
  if (L >= 0x1f) x = (x + mulu32(Math.min(L - 30, 20), 0x2ee000)) >>> 0;
  if (L >= 0x33) x = (x + mulu32(Math.min(L - 50, 25), 0x190000)) >>> 0;
  if (L >= 0x4c) x = (x + mulu32(L - 75, 0x5dc000)) >>> 0;
  return x;
}

/** CODE+0x2073A training_cost(ch, slot): 0 for a roster index >= 24 (hirelings), else `hallMul[hall A4-31218] * (level+1) * 50` gold (16-bit; the retail hall table never wraps) (hallMul = u16[10] at A4-25838). */
export function trainingCost(m: Mem, ch: number, slot: number, o: { noPlusOne?: boolean } = {}): number {
  if (s16(m.r16(g(-31082) + 2 * slot)) >= 0x18) return 0;
  let L = m.r8(ch + 32);
  if (L !== 0xff && !o.noPlusOne) L++;
  const a = mulu32(m.r16(g(-25838) + 2 * m.r8(g(-31218))), L);
  return mulu32(a & 0xffff, 50) & 0xffff;
}
