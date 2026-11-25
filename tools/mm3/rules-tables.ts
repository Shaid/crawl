/**
 * Exports the DATA-hunk tables the MM3 (Amiga) rules read into one JSON for the browser remake:
 *   npx tsx tools/mm3/rules-tables.ts [data/mm3/amiga/Might\&MagicIII] [public/assets/mm3/amiga/data/rules-tables.json]
 * Reads only the retail executable (hunk walk, RELOC32 applied to find the spell-name strings in the CODE hunk).
 * Every table's extent is the distance to the next table in the DATA hunk (or the index range the code uses);
 * tools/mm3/__tests__/rules-tables.test.ts checks the export byte-for-byte against the bytes the harness vectors read.
 * `a4` is the SAS/C small-data displacement (A4 = DATA + 0x7FFE).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type Width = 'u8' | 's8' | 'u16' | 's16' | 'u32';
export interface TableDef { name: string; a4: number; count: number; width: Width; role: string }
const T = (name: string, a4: number, count: number, width: Width, role: string): TableDef => ({ name, a4, count, width, role });

/** (A4 displacement, element count) of every table the verified rules read. */
export const TABLES: TableDef[] = [
  T('bracketThreshold', -0x42f0, 24, 'u16', 'R+0xCE5C: first i with threshold[i] > value'),
  T('bracketBonus', -0x567b, 24, 's8', 'R+0xCE5C: bonus for that bracket'),
  T('ageBonus', -0x5432, 20, 's16', 'R+0xD064: [row 0 = Might/End/Spd/Acc, row 1 = Int/Pers][10 age brackets]'),
  T('ageThreshold', -0x540a, 10, 'u16', 'R+0xD064: bracket = first i with age < threshold[i]'),
  T('classHp', -0x25ee, 10, 'u8', 'R+0xAD56: base HP per level by class'),
  T('raceHp', -0x53a1, 5, 's8', 'R+0xAD56: HP per level by race'),
  T('raceSp', -0x53ab, 10, 's8', 'R+0xAC46: [race*2 + stat-1]'),
  T('classXp', -0x3fca, 10, 'u16', 'R+0x88FC / OV4+0xB7EC: base XP per class'),
  T('statKindA', -0x53ec, 10, 'u8', 'R+0xC7D2: thresholds mapping an item selector to a stat kind'),
  T('statKindB', -0x53dc, 6, 'u8', 'R+0xC7AC: thresholds mapping an item selector to a save/element kind'),
  T('itemStatBonus', -0x2984, 73, 's8', 'R+0xCEF0: +0xC9 selector -> stat bonus'),
  T('itemSaveBonus', -0x2a2a, 37, 'u8', 'R+0xCEF0: +0xA3 selector -> save bonus'),
  T('elementBase', -0x2a05, 37, 'u8', 'OV4+0x12D56: element selector -> base damage'),
  T('weaponHit', -0x29e0, 23, 's8', 'R+0x11DA6: +0xB6 selector -> to-hit bonus'),
  T('weaponDamage', -0x29c9, 23, 's8', 'R+0x11DA6: +0xB6 selector -> damage bonus'),
  T('itemAcMod', -0x29b2, 23, 's8', 'R+0xCEF0: +0xB6 selector -> AC modifier'),
  T('itemDiceCount', -0x2780, 73, 'u8', 'R+0x11DA6: weapon dice count by item id'),
  T('itemDiceSides', -0x2737, 73, 'u8', 'R+0x11DA6: weapon die sides by item id'),
  T('itemAc', -0x27c9, 73, 'u8', 'R+0xCEF0: AC by item id'),
  T('lootChance', -0x3518, 12, 'u8', 'OV4+0x136E2: percent chance of a loot item by treasure id (1-based)'),
  T('itemGenEnchantA', -0x539c, 72, 'u8', 'R+0xB83A kind 1: [6 bands][6 grades][lo,hi]'),
  T('itemGenEnchantABonus', -0x5354, 6, 'u8', 'R+0xB83A kind 1: added per band'),
  T('itemGenEnchantC', -0x534e, 120, 'u8', 'R+0xB83A kind 2: [10 bands][6 grades][lo,hi]'),
  T('itemGenEnchantCBonus', -0x52d6, 10, 'u8', 'R+0xB83A kind 2: added per band'),
  T('itemGenEnchantB', -0x52cc, 24, 'u8', 'R+0xB83A kind 3: [2 bands][6 grades][lo,hi]'),
  T('itemGenEnchantBBonus', -0x52b4, 2, 'u8', 'R+0xB83A kind 3: added per band'),
  T('itemGenChargesLo', -0x53d6, 7, 'u8', 'R+0xB83A kind 4: +0xEF low by grade'),
  T('itemGenChargesHi', -0x53cf, 7, 'u8', 'R+0xB83A kind 4: +0xEF high by grade'),
  T('spellAnim', -0x3c61, 7, 'u8', 'OV4+0x136E2: spell kind (A4+0x332E, capped at 6) -> animation id + 1'),
  T('monsterListA', -0x3c6a, 9, 'u8', 'OV4+0x13282 combat spell kind: monster ids affected (code-read, spell mode 7)'),
  T('monsterListB', -0x3c5a, 5, 'u8', 'combat spell: monster ids (code-read)'), T('monsterListC', -0x3c55, 13, 'u8', 'combat spell: monster ids (code-read)'),
  T('monsterListD', -0x3c48, 13, 'u8', 'combat spell: monster ids (code-read)'), T('monsterListE', -0x3c3b, 13, 'u8', 'combat spell: monster ids (code-read)'),
  T('monsterListF', -0x3c23, 22, 'u8', 'combat spell: monster ids (code-read)'), T('monsterListG', -0x3c0d, 5, 'u8', 'combat spell: monster ids (code-read)'),
  T('spellSp', -0x4102, 77, 's16', 'OV8+0x534 / OV4+0xF10C: SP cost per spell; <= 0 means -value * caster level'),
  T('spellGems', -0x4066, 77, 'u16', 'OV8+0x534: gem cost per spell'),
  T('monsterHp', -0x6120, 90, 'u16', 'Mon table'), T('monsterAc', -0x606c, 90, 'u8', 'Mon table'),
  T('monsterSpd', -0x6012, 90, 'u8', 'OV4+0x1307C initiative speed'), T('monsterDmgN', -0x5fb8, 90, 'u8', 'dice count'),
  T('monsterDmgS', -0x5f5e, 90, 'u8', 'die sides'), T('monsterNumA', -0x5f04, 90, 'u8', 'attacks per turn'),
  T('monsterExp', -0x5eaa, 90, 'u32', 'XP award'), T('monsterDmgT', -0x5d42, 90, 'u8', 'damage type (non-zero = never misses)'),
  T('monsterAttP', -0x5ce8, 90, 'u8', 'target preference: 0 all, 1 random, 2..6 class/race (R+0xA1DC)'),
  T('monsterSpec', -0x5c8e, 90, 'u8', 'special attack 0..16'), T('monsterRang', -0x5c34, 90, 'u8', 'ranged flag (read by R+0x9754)'),
  T('monsterHitB', -0x5bda, 90, 'u8', 'hit bonus die (R+0xA1DC)'), T('monsterTrea', -0x5b80, 90, 'u8', 'treasure id'),
  T('monsterGold', -0x5b26, 90, 'u32', 'gold'), T('monsterGems', -0x59be, 90, 'u16', 'gems'),
  T('monsterMagi', -0x590a, 90, 'u8', 'magic resistance %'), T('monsterFire', -0x58b0, 90, 'u8', 'fire resistance %'),
  T('monsterElec', -0x5856, 90, 'u8', 'electric %'), T('monsterCold', -0x57fc, 90, 'u8', 'cold %'),
  T('monsterAcid', -0x57a2, 90, 'u8', 'acid %'), T('monsterEner', -0x5748, 90, 'u8', 'energy %'), T('monsterPhys', -0x56ee, 90, 'u8', 'physical %'),
];
const SIZE: Record<Width, number> = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4 };

/** DATA hunk image (stored bytes, 25,156 B) + CODE hunk + RELOC32 offsets of the DATA hunk targeting hunk 0. */
export function loadHunks(exe: Buffer) {
  const u32 = (p: number) => exe.readUInt32BE(p);
  let p = 4;
  if (u32(0) !== 0x3f3) throw new Error('not a hunk executable');
  while (u32(p)) p += 4 + u32(p) * 4;
  p += 4;
  const first = u32(p + 4), last = u32(p + 8);
  p += 12 + 4 * (last - first + 1);
  const hunks: { data: Buffer; relocs: Map<number, number[]> }[] = [];
  let cur: { data: Buffer; relocs: Map<number, number[]> } | null = null;
  for (;;) {
    const t = u32(p) & 0x3fffffff;
    if (t === 0x3e9 || t === 0x3ea) { const n = u32(p + 4) * 4; cur = { data: exe.subarray(p + 8, p + 8 + n), relocs: new Map() }; hunks.push(cur); p += 8 + n; }
    else if (t === 0x3eb) { cur = { data: Buffer.alloc(0), relocs: new Map() }; hunks.push(cur); p += 8; }
    else if (t === 0x3ec) { p += 4; while (u32(p)) { const n = u32(p), h = u32(p + 4); const arr = cur!.relocs.get(h) ?? []; for (let i = 0; i < n; i++) arr.push(u32(p + 8 + 4 * i)); cur!.relocs.set(h, arr); p += 8 + 4 * n; } p += 4; }
    else if (t === 0x3f2) p += 4;
    else if (t === 0x3f5 || t === 0x3f4) break;
    else throw new Error('hunk ' + t.toString(16));
  }
  return hunks;
}

export function buildRulesTables(exe: Buffer) {
  const hunks = loadHunks(exe);
  const code = hunks[0].data, data = hunks[1].data;
  const rd = (a4: number, i: number, w: Width) => {
    const o = 0x7ffe + a4 + i * SIZE[w];
    switch (w) {
      case 'u8': return data[o]; case 's8': return data.readInt8(o);
      case 'u16': return data.readUInt16BE(o); case 's16': return data.readInt16BE(o); default: return data.readUInt32BE(o);
    }
  };
  const tables: Record<string, { a4: number; width: Width; role: string; values: number[] }> = {};
  for (const t of TABLES) tables[t.name] = { a4: t.a4, width: t.width, role: t.role, values: Array.from({ length: t.count }, (_, i) => rd(t.a4, i, t.width)) };
  // spell names: 80 u32 pointers at A4-0x4A82 into the CODE hunk (RELOC32 already folded in: the stored value is the CODE offset)
  const names: string[] = [];
  for (let i = 0; i < 80; i++) {
    const off = data.readUInt32BE(0x7ffe - 0x4a82 + 4 * i);
    let e = off; while (code[e]) e++;
    names.push(code.toString('latin1', off, e));
  }
  return {
    source: 'Might&MagicIII DATA hunk, A4 = DATA+0x7FFE; see docs/mm3/amiga/game-rules.md',
    tables,
    spells: names.slice(0, 77).map((name, id) => ({ id, name, sp: tables.spellSp.values[id], gems: tables.spellGems.values[id] })),
    spellNone: names.slice(77),
    classesHyp: ['Knight', 'Paladin', 'Archer', 'Cleric', 'Sorcerer', 'Robber', 'Ninja', 'Barbarian', 'Druid', 'Ranger'],
    constants: {
      swingDivisor: [5, 6, 6, 7, 8, 6, 5, 4, 7, 6], toHitLevelDivisor: [1, 2, 2, 3, 4, 2, 2, 1, 3, 2],
      trainingCostGold: '10 * level^2', unconsciousAt: 0, deadAt: '-maxHP', monsterGroupsMax: 3, partyMax: 8,
    },
  };
}

if (process.argv[1] && /rules-tables\.ts$/.test(process.argv[1])) {
  const exePath = process.argv[2] ?? 'data/mm3/amiga/Might&MagicIII';
  const out = process.argv[3] ?? 'public/assets/mm3/amiga/data/rules-tables.json';
  if (!existsSync(exePath)) { console.error('missing', exePath); process.exit(1); }
  const j = buildRulesTables(readFileSync(exePath));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(j));
  console.log(Object.keys(j.tables).length, 'tables,', j.spells.length, 'spells ->', out);
}
