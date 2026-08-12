/**
 * MM2 spell tables + `spells.dat` record codec + the `items.dat` effect-byte
 * decoder.
 *
 * Documentation ported from Vairn/MM2 (`EXTRACTED/docs/19-spells-and-item-use.md`,
 * `tools/mm2_spells.py`). The per-level counts (7/7/6/6/5/5/4/4/4, both
 * schools) and the item "use power" = flat spell index encoding were verified
 * byte-exact against the RPGClassics "Use Ability" column for 49 items
 * (0 mismatches).
 *
 * `spells.dat` is 256 bytes = 96 records × 2 bytes (Sorcerer 0..47, Cleric
 * 48..95, in the same flat order as the item effect index) + 64 trailing
 * bytes of leftover data preserved verbatim on round-trip. Each 2-byte record:
 *
 *   byte0: bit 0x40 combat-only, bit 0x80 non-combat-only, bit 0x10 special
 *          cost (gem count hard-coded in game code), low nibble = gem cost
 *          (0..15) when not special
 *   byte1: bit 0x80 outdoor-only, bits 6-4 = per-level SP multiplier, low
 *          nibble = flat SP cost (0 ⇒ cost is per caster level)
 */

export const SPELLS_PER_LEVEL = [7, 7, 6, 6, 5, 5, 4, 4, 4]; // L1..L9, both schools

export const SORCERER_SPELLS: Record<number, string[]> = {
  1: ['Awaken', 'Detect Magic', 'Energy Blast', 'Flame Arrow', 'Light', 'Location', 'Sleep'],
  2: ['Eagle Eye', 'Electric Arrow', 'Identify Monster', 'Jump', 'Levitate', "Lloyd's Beacon", 'Protection from Magic'],
  3: ['Acid Stream', 'Fly', 'Invisibility', 'Lightning Bolt', 'Web', 'Wizard Eye'],
  4: ['Cold Beam', 'Feeble Mind', 'Fire Ball', 'Guard Dog', 'Shield', 'Time Distortion'],
  5: ['Disrupt', 'Fingers of Death', 'Sand Storm', 'Shelter', 'Teleport'],
  6: ['Disintegration', 'Entrapment', 'Fantastic Freeze', 'Recharge Item', 'Super Shock'],
  7: ['Dancing Sword', 'Duplication', 'Etherealize', 'Prismatic Light'],
  8: ['Incinerate', 'Mega Volts', 'Meteor Shower', 'Power Shield'],
  9: ['Implosion', 'Inferno', 'Star Burst', 'Enchant Item'],
};

export const CLERIC_SPELLS: Record<number, string[]> = {
  1: ['Apparition', 'Awaken', 'Bless', 'First Aid', 'Light', 'Power Cure', 'Turn Undead'],
  2: ['Cure Wounds', 'Heroism', "Nature's Gate", 'Pain', 'Protection From Elements', 'Silence', 'Weaken'],
  3: ['Cold Ray', 'Create Food', 'Cure Poison', 'Immobilize', 'Lasting Light', 'Walk on Water'],
  4: ['Acid Spray', 'Air Transmutation', 'Cure Disease', 'Restore Alignment', 'Surface', 'Holy Bonus'],
  5: ['Air Encasement', 'Deadly Swarm', 'Frenzy', 'Paralyze', 'Remove Condition'],
  6: ['Earth Transmutation', 'Rejuvenate', 'Stone to Flesh', 'Water Encasement', 'Water Transmutation'],
  7: ['Earth Encasement', 'Fiery Flail', 'Moon Ray', 'Raise Dead'],
  8: ['Fire Encasement', 'Fire Transmutation', 'Mass Distortion', 'Town Portal'],
  9: ['Divine Intervention', 'Holy Word', 'Resurrection', 'Uncurse Item'],
};

export interface SpellRef {
  school: 'S' | 'C';
  level: number;
  number: number;
  name: string;
}

const flatIndex = (tbl: Record<number, string[]>): Map<number, SpellRef> => {
  const out = new Map<number, SpellRef>();
  let f = 0;
  for (let lv = 1; lv <= 9; lv++) {
    for (let n = 0; n < tbl[lv].length; n++) {
      f++;
      out.set(f, { school: 'S', level: lv, number: n + 1, name: tbl[lv][n] });
    }
  }
  return out;
};

const SORCERER_FLAT = flatIndex(SORCERER_SPELLS);
const CLERIC_FLAT = flatIndex(CLERIC_SPELLS);

/** Flat 1-based index (both schools have identical 48-spell structure). */
export function spellAt(school: 'S' | 'C', flat: number): SpellRef | undefined {
  const tbl = school === 'S' ? SORCERER_FLAT : CLERIC_FLAT;
  const ref = tbl.get(flat);
  if (!ref) return undefined;
  return { ...ref, school };
}

export interface ItemEffect {
  kind: 'none' | 'boost' | 'spell';
  /** For boosts. */
  boost?: string;
  amount?: number;
  /** For spells. */
  spell?: SpellRef;
  text: string;
}

const USE_BOOST_KINDS: Record<number, string> = {
  0: 'Max HP', 1: 'Might', 2: 'Speed', 3: 'Accuracy', 5: 'Level', 6: 'Spell Level',
};

/** Decode an `items.dat` effect byte (0x0F). */
export function decodeItemEffect(byte: number): ItemEffect {
  if (byte === 0) return { kind: 'none', text: 'none' };
  if (byte < 0x80) {
    const name = USE_BOOST_KINDS[byte >> 4] ?? `unknown${byte >> 4}`;
    return { kind: 'boost', boost: name, amount: byte & 0x0f, text: `${name} +${byte & 0x0f}` };
  }
  const school = byte <= 0xb0 ? 'S' : 'C';
  const flat = school === 'S' ? byte - 0x80 : byte - 0xb0;
  const spell = spellAt(school, flat);
  return {
    kind: 'spell',
    spell: spell ?? { school, level: 0, number: flat, name: '?' },
    text: spell ? `${school}${spell.level}/${spell.number} ${spell.name}` : `${school}#${flat} (?)`,
  };
}

export interface SpellDatRecord {
  index: number;
  byte0: number;
  byte1: number;
  /** 0x40 combat-only, 0x80 non-combat-only, 0x10 special/computed cost. */
  combatOnly: boolean;
  nonCombatOnly: boolean;
  specialCost: boolean;
  gemCost: number;
  outdoorOnly: boolean;
  /** Per-level SP multiplier (X in "X/L"), used when spCost is 0. */
  spPerLevel: number;
  /** Flat SP cost; 0 means per-caster-level. */
  spCost: number;
  spell: SpellRef | null;
}

export function decodeSpellRecord(byte0: number, byte1: number, index: number): SpellDatRecord {
  const school = index < 48 ? 'S' : 'C';
  const flat = (index % 48) + 1;
  const spell = spellAt(school, flat) ?? null;
  return {
    index,
    byte0,
    byte1,
    combatOnly: (byte0 & 0x40) !== 0,
    nonCombatOnly: (byte0 & 0x80) !== 0,
    specialCost: (byte0 & 0x10) !== 0,
    gemCost: byte0 & 0x0f,
    outdoorOnly: (byte1 & 0x80) !== 0,
    spPerLevel: (byte1 >> 4) & 0x07,
    spCost: byte1 & 0x0f,
    spell,
  };
}

export interface SpellsFile {
  records: SpellDatRecord[];
  /** 64 trailing bytes of leftover data (preserved verbatim). */
  trailing: Uint8Array;
}

export const SPELLS_DAT_SIZE = 256;
export const SPELLS_COUNT = 96;
export const SPELLS_RECORD_SIZE = 2;

export function decodeSpellsDat(data: Uint8Array): SpellsFile {
  if (data.length < SPELLS_DAT_SIZE) throw new Error(`spells.dat: expected ${SPELLS_DAT_SIZE} bytes, got ${data.length}`);
  const records: SpellDatRecord[] = [];
  for (let i = 0; i < SPELLS_COUNT; i++) {
    records.push(decodeSpellRecord(data[i * 2], data[i * 2 + 1], i));
  }
  return { records, trailing: Uint8Array.from(data.subarray(SPELLS_DAT_SIZE - 64)) };
}

export function encodeSpellsDat(spells: SpellsFile): Uint8Array {
  const out = new Uint8Array(SPELLS_DAT_SIZE);
  for (const r of spells.records) {
    out[r.index * 2] = r.byte0;
    out[r.index * 2 + 1] = r.byte1;
  }
  out.set(spells.trailing, SPELLS_DAT_SIZE - 64);
  return out;
}
