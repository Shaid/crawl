import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeRoster,
  encodeRoster,
  ROSTER_FILE_SIZE,
  ROSTER_CHAR_RECORD_SIZE,
  ROSTER_CHAR_COUNT,
  ROSTER_GLOBAL_SIZE,
  conditionName,
} from '../roster.ts';

const FIXTURE = resolve(import.meta.dirname, '../fixtures/roster_create_test.dat');

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('roster.dat vs the real fixture', () => {
  const data = readFileSync(FIXTURE);

  it('fixture is a full 8320-byte Amiga roster file', () => {
    expect(data.length).toBe(ROSTER_FILE_SIZE);
  });

  it('decodes record 0 ("Sir Felgar") with every documented field', () => {
    const roster = decodeRoster(data);
    const c = roster.characters[0];

    expect(c.name).toBe('Sir Felgar');
    expect(c.town).toBe(1); // Middlegate
    expect(c.inParty).toBe(false);
    expect(c.sex).toBe(0); // male
    expect(c.alignment).toBe(1); // neutral
    expect(c.race).toBe(4); // Half-Orc
    expect(c.charClass).toBe(0); // Knight
    expect(c.stats).toEqual({ might: 21, intelligence: 10, personality: 9, speed: 15, accuracy: 17, luck: 12 });
    expect(c.thievery).toBe(0);
    expect(c.skills).toEqual([5, 5, 5]);
    expect(c.age).toBe(18);
    expect(c.armorClass).toBe(2);
    expect(c.food).toBe(10);
    expect(c.condition).toBe(0);
    expect(c.endurance).toBe(19);
    expect(c.spMax).toBe(0);
    expect(c.hpMax).toBe(16);
    expect(c.hpTemp).toBe(16);
    expect(c.hpCurrent).toBe(16);
    expect(c.experience).toBe(0);
    expect(c.gold).toBe(200);
    expect(c.baseAlignment).toBe(1);
    expect(c.baseStats).toEqual({ might: 21, intelligence: 10, personality: 9, speed: 15, accuracy: 17, luck: 12 });
    expect(c.level).toBe(1);
    expect(c.secondaryLevel).toBe(0);
    expect(c.baseEndurance).toBe(19);
    expect(c.scriptFlag).toBe(0);
    expect(c.classQuestMask).toBe(0);
  });

  it('round-trips the whole file byte-exact (encode(decode(file)) === file)', () => {
    const roster = decodeRoster(data);
    const reEncoded = encodeRoster(roster);
    expect(bytesEqual(reEncoded, data)).toBe(true);
  });

  it('preserves the global stream and per-record tail bytes', () => {
    const roster = decodeRoster(data);
    expect(roster.global.length).toBe(ROSTER_GLOBAL_SIZE);
    expect(roster.characters.length).toBe(ROSTER_CHAR_COUNT);
    for (const c of roster.characters) {
      expect(c.tail.length).toBe(ROSTER_CHAR_RECORD_SIZE - 0x7a);
    }
  });
});

describe('roster enums', () => {
  it('conditionName maps the documented codes', () => {
    expect(conditionName(0)).toBe('Good');
    expect(conditionName(1)).toBe('Cursed');
    expect(conditionName(4)).toBe('Poisoned');
    expect(conditionName(0x80)).toBe('Dead/Stone/Eradicated');
  });
});
