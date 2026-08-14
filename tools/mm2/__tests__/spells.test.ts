import { describe, expect, it } from 'vitest';
import { CLERIC_FLAT, decodeItemEffect, decodeSpellRecord, decodeSpellsDat, encodeSpellsDat, SORCERER_FLAT, spellAt } from '../spells.ts';

describe('item effect byte -> spell (flat index)', () => {
  it('decodes the documented known-answer examples byte-exact', () => {
    expect(decodeItemEffect(0x81).text).toBe('S1/1 Awaken');
    expect(decodeItemEffect(0x85).text).toBe('S1/5 Light');
    expect(decodeItemEffect(0x93).text).toBe('S3/5 Web');
    expect(decodeItemEffect(0x9a).text).toBe('S4/6 Time Distortion');
    expect(decodeItemEffect(0x9b).text).toBe('S5/1 Disrupt');
    expect(decodeItemEffect(0xa6).text).toBe('S7/2 Duplication');
    expect(decodeItemEffect(0xab).text).toBe('S8/3 Meteor Shower');
    expect(decodeItemEffect(0xbb).text).toBe('C2/4 Pain');
    expect(decodeItemEffect(0xc1).text).toBe('C3/3 Cure Poison');
    expect(decodeItemEffect(0xcf).text).toBe('C5/5 Remove Condition');
    expect(decodeItemEffect(0xd7).text).toBe('C7/3 Moon Ray');
    expect(decodeItemEffect(0xd8).text).toBe('C7/4 Raise Dead');
    expect(decodeItemEffect(0xdd).text).toBe('C9/1 Divine Intervention');
    expect(decodeItemEffect(0xde).text).toBe('C9/2 Holy Word');
  });

  it('0x00 is "none", 0x01..0x7F are nibble-packed stat boosts', () => {
    expect(decodeItemEffect(0x00)).toMatchObject({ kind: 'none' });
    expect(decodeItemEffect(0x13)).toMatchObject({ kind: 'boost', boost: 'Might', amount: 3 });
    expect(decodeItemEffect(0x61)).toMatchObject({ kind: 'boost', boost: 'Spell Level', amount: 1 });
  });

  it('flat index boundary: 0xB0 is the last Sorcerer spell, 0xB1 first Cleric', () => {
    expect(decodeItemEffect(0xb0).text).toBe('S9/4 Enchant Item');
    expect(decodeItemEffect(0xb1).text).toBe('C1/1 Apparition');
  });
});

describe('spell flat-index tables', () => {
  it('both schools have 48 spells in 7/7/6/6/5/5/4/4/4 levels', () => {
    for (const school of ['S', 'C'] as const) {
      let count = 0;
      for (let f = 1; f <= 48; f++) {
        const ref = spellAt(school, f);
        expect(ref).toBeDefined();
        expect(ref!.school).toBe(school);
        count++;
      }
      expect(count).toBe(48);
      expect(spellAt(school, 49)).toBeUndefined();
    }
  });

  it('names match the documented spell lists', () => {
    expect(spellAt('S', 1)?.name).toBe('Awaken');
    expect(spellAt('S', 48)?.name).toBe('Enchant Item');
    expect(spellAt('C', 1)?.name).toBe('Apparition');
    expect(spellAt('C', 48)?.name).toBe('Uncurse Item');
  });

  it('SORCERER_FLAT/CLERIC_FLAT carry the correct school on their own, without relying on spellAt() overriding it', () => {
    for (const ref of SORCERER_FLAT.values()) expect(ref.school).toBe('S');
    for (const ref of CLERIC_FLAT.values()) expect(ref.school).toBe('C');
  });
});

describe('spells.dat record decode', () => {
  it('decodes the documented example records', () => {
    // S1/3 Energy Blast: 41 10 -> combat, 1 gem, 1/L
    const eb = decodeSpellRecord(0x41, 0x10, 2);
    expect(eb.combatOnly).toBe(true);
    expect(eb.nonCombatOnly).toBe(false);
    expect(eb.gemCost).toBe(1);
    expect(eb.spPerLevel).toBe(1);
    expect(eb.spCost).toBe(0);
    // S2/1 Eagle Eye: 80 A0 -> non-combat, outdoor, 2/L
    const ee = decodeSpellRecord(0x80, 0xa0, 7);
    expect(ee.nonCombatOnly).toBe(true);
    expect(ee.outdoorOnly).toBe(true);
    expect(ee.spPerLevel).toBe(2);
    // S3/5 Web: 42 03 -> combat, 2 gems, 3 SP
    const web = decodeSpellRecord(0x42, 0x03, 14);
    expect(web.combatOnly).toBe(true);
    expect(web.gemCost).toBe(2);
    expect(web.spCost).toBe(3);
  });

  it('round-trips a full 256-byte spells.dat (96 records + 64 trailing bytes)', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 96; i++) {
      data[i * 2] = (i * 7) & 0xff;
      data[i * 2 + 1] = (i * 13) & 0xff;
    }
    for (let i = 192; i < 256; i++) data[i] = i & 0xff;
    const encoded = encodeSpellsDat(decodeSpellsDat(data));
    expect([...encoded]).toEqual([...data]);
  });
});
