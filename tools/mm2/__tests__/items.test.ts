import { describe, expect, it } from 'vitest';
import { decodeItems, encodeItems, itemClassCanUse, ITEM_RECORD_SIZE } from '../items.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('items.dat codec', () => {
  it('decodes a hand-built record byte-exact per the field map', () => {
    // "Small Club": no restriction (0x00), no bonus (0x00), no effect (0x00),
    // damage 2, gold 5 (LE).
    const bytes = new Uint8Array(ITEM_RECORD_SIZE);
    const name = 'Small Club';
    for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i);
    for (let i = name.length; i < 12; i++) bytes[i] = 0x20;
    bytes[0x0c] = 0;
    bytes[0x0d] = 0x00;
    bytes[0x0e] = 0x00;
    bytes[0x0f] = 0x00;
    bytes[0x10] = 2;
    bytes[0x11] = 0;
    bytes[0x12] = 5;
    bytes[0x13] = 0;

    const items = decodeItems(bytes);
    expect(items.length).toBe(1);
    const it = items[0];
    expect(it.name).toBe('Small Club');
    expect(it.forbiddenClasses).toBe(0x00);
    expect(it.damage).toBe(2);
    expect(it.gold).toBe(5);
    expect(itemClassCanUse(it, 'Knight')).toBe(true);
    expect(itemClassCanUse(it, 'Cleric')).toBe(true);
  });

  it('forbidden mask semantics: set bit = class CANNOT use', () => {
    const bytes = new Uint8Array(ITEM_RECORD_SIZE);
    bytes.set([...'Katana'].map((c) => c.charCodeAt(0)));
    bytes[0x0d] = 0x7d; // every class except Knight + Ninja forbidden
    const [katana] = decodeItems(bytes);
    expect(itemClassCanUse(katana, 'Knight')).toBe(true);
    expect(itemClassCanUse(katana, 'Ninja')).toBe(true);
    expect(itemClassCanUse(katana, 'Cleric')).toBe(false);
    expect(itemClassCanUse(katana, 'Sorcerer')).toBe(false);
  });

  it('bonus/effect nibble packing round-trips', () => {
    const items = decodeItems(encodeItems([
      { index: 0, name: 'Force Sword', separator: 0, forbiddenClasses: 0x10, bonusType: 0, bonusAmount: 15, effect: 0x93, damage: 9, pad: 0, gold: 5000 },
      { index: 1, name: 'Magic Shield', separator: 0, forbiddenClasses: 0x00, bonusType: 6, bonusAmount: 0, effect: 0, damage: 0, pad: 0, gold: 250 },
    ]));
    expect(items[0]).toMatchObject({ name: 'Force Sword', bonusType: 0, bonusAmount: 15, effect: 0x93, gold: 5000, forbiddenClasses: 0x10 });
    expect(items[1]).toMatchObject({ name: 'Magic Shield', bonusType: 6, bonusAmount: 0, gold: 250 });
  });

  it('encode(decode(x)) === x for a 256-record synthetic file', () => {
    const out = new Uint8Array(256 * ITEM_RECORD_SIZE);
    for (let i = 0; i < 256; i++) {
      const name = `Item ${i}`.padEnd(12, ' ');
      for (let c = 0; c < 12; c++) out[i * 20 + c] = name.charCodeAt(c);
      out[i * 20 + 0x0d] = i & 0xff;
      out[i * 20 + 0x0e] = (i >> 4) & 0x0f;
      out[i * 20 + 0x0f] = 0x80 + (i % 48);
      out[i * 20 + 0x10] = (i * 3) & 0xff;
      out[i * 20 + 0x12] = i & 0xff;
      out[i * 20 + 0x13] = (i >> 8) & 0xff;
    }
    expect(bytesEqual(encodeItems(decodeItems(out)), out)).toBe(true);
  });
});
