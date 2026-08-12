import { describe, expect, it } from 'vitest';
import { decodeMonsterHp, decodeMonsterXp, decodeMonsterStat, decodeMonsters, encodeMonsters, PABIL_VERBS, MONSTER_RECORD_SIZE } from '../monsters.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('monsters.dat HP/XP formulas (ASM-confirmed)', () => {
  it('decodes the documented formula cases', () => {
    // HP = ((c & 0x3F) + 1) * hpmul[(c >> 6) & 3], hpmul = {1,10,100,1000}
    expect(decodeMonsterHp(0x00)).toBe(1);
    expect(decodeMonsterHp(0x41)).toBe(20); // (1+1) * 10
    expect(decodeMonsterHp(0x84)).toBe(500); // (4+1) * 100
    expect(decodeMonsterHp(0xC7)).toBe(8000); // (7+1) * 1000
    // XP = ((c & 0x1F) + 1) * xpmul[(c & 0x60) >> 5], ×1000 if bit7
    expect(decodeMonsterXp(0x00)).toBe(1);
    expect(decodeMonsterXp(0x21)).toBe(20); // (1+1) * 10, xpmul[1]
    expect(decodeMonsterXp(0x43)).toBe(400); // (3+1) * 100
    expect(decodeMonsterXp(0xC1)).toBe(200000); // (1+1) * 100, ×1000
  });

  it('AC/damage/speed2 use low5+1 with a ×10 bit-5 multiplier, capped at 250', () => {
    expect(decodeMonsterStat(0x00)).toBe(1);
    expect(decodeMonsterStat(0x1e)).toBe(31); // (0x1e & 0x1f) + 1
    expect(decodeMonsterStat(0x20)).toBe(10); // bit5 set: (0+1)*10
    expect(decodeMonsterStat(0xff)).toBe(250); // capped
  });

  it('Cuisinart example: Pabil 0x3D -> verb index 29 -> "frenzies"', () => {
    expect(0x3d & 0x1f).toBe(29);
    expect(PABIL_VERBS[29]).toBe('frenzies');
  });
});

describe('monsters.dat record codec', () => {
  it('decodes a 26-byte record and re-encodes byte-exact', () => {
    const rec = new Uint8Array(MONSTER_RECORD_SIZE);
    const name = 'Cuisinart';
    for (let i = 0; i < name.length; i++) rec[i] = name.charCodeAt(i) | 0x80;
    for (let i = name.length; i < 14; i++) rec[i] = 0x80; // space-char + 0x80
    rec[0x0e] = 0xc7; // HP 8000 ((7+1) * 1000)
    rec[0x0f] = 0xf3; // XP 20,000,000 ((20) * 1000, ×1000)
    rec[0x10] = 0x00;
    rec[0x11] = 0x3d; // frenzies
    rec[0x12] = 0x80; // undead
    rec[0x13] = 0x01;
    rec[0x14] = 0x11;
    rec[0x15] = 0x2a; // picture 42, bit7 clear
    rec[0x16] = 0x3c; // AC 250
    rec[0x17] = 0x0f;
    rec[0x18] = 0x0a;
    rec[0x19] = 0x00;

    const all = new Uint8Array(256 * MONSTER_RECORD_SIZE);
    all.set(rec, 0);
    const [m] = decodeMonsters(all);
    expect(m.name).toBe('Cuisinart');
    expect(m.hp).toBe(8000);
    expect(m.xp).toBe(20000000);
    expect(m.pabil & 0x1f).toBe(29);
    expect(m.sabil & 0x80).toBe(0x80);
    expect(m.picture).toBe(42);
    expect(m.pictureFlag).toBe(false);
    expect(m.ac).toBe(250);
    expect(m.speed).toBe(2);
    expect(m.speedHigh).toBe(2);

    expect(bytesEqual(encodeMonsters(decodeMonsters(all)), all)).toBe(true);
  });
});
