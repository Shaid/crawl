/**
 * MM2 `items.dat` codec — 256 records × 20 bytes = 5120 bytes.
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/18-items-dat-format.md`
 * and `07-dat-files-and-formats.md`). Multibyte fields are **little-endian**
 * on disk (the Amiga 68000 port byte-swaps the gold word on load at asm
 * 0x26030). Round-trip verified synthetically (no retail items.dat in this
 * repo).
 *
 *   +0x00  12B  name       ASCII, space-padded
 *   +0x0C   1B  separator  (editor writes 0)
 *   +0x0D   1B  forbidden  class-restriction mask — a SET bit means that class
 *                         CANNOT use the item (K P A C S R N B = 0x80..0x01)
 *   +0x0E   1B  bonus      hi nibble = bonus type, lo nibble = amount (0 = none)
 *   +0x0F   1B  effect     flat spell index / stat boost (see spells.ts
 *                         `decodeItemEffect`); NOT a type/amount pair
 *   +0x10   1B  damage     weapon damage component
 *   +0x11   1B  pad        (editor writes 0)
 *   +0x12   u16le  gold    shop price in gp
 */

export const ITEM_RECORD_SIZE = 20;
export const ITEM_NAME_SIZE = 12;
export const ITEMS_COUNT = 256;

export interface ItemRecord {
  index: number;
  /** ASCII, right-trimmed of trailing spaces / NULs. */
  name: string;
  separator: number;
  forbiddenClasses: number;
  bonusType: number;
  bonusAmount: number;
  effect: number;
  damage: number;
  pad: number;
  gold: number;
}

export const ITEM_CLASS_BITS: Record<string, number> = {
  Knight: 0x80,
  Paladin: 0x40,
  Archer: 0x20,
  Cleric: 0x10,
  Sorcerer: 0x08,
  Robber: 0x04,
  Ninja: 0x02,
  Barbarian: 0x01,
};

/** `set` bit = forbidden; clear bit = usable. */
export function itemClassCanUse(item: ItemRecord, className: keyof typeof ITEM_CLASS_BITS): boolean {
  return (item.forbiddenClasses & ITEM_CLASS_BITS[className]) === 0;
}

export function decodeItems(data: Uint8Array): ItemRecord[] {
  if (data.length % ITEM_RECORD_SIZE !== 0) {
    throw new Error(`items.dat: size ${data.length} is not a multiple of ${ITEM_RECORD_SIZE}`);
  }
  const count = data.length / ITEM_RECORD_SIZE;
  const items: ItemRecord[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * ITEM_RECORD_SIZE;
    const rawName = new TextDecoder('latin1').decode(data.subarray(off, off + ITEM_NAME_SIZE));
    items.push({
      index: i,
      // eslint-disable-next-line no-control-regex
      name: rawName.replace(/[\u0000 ]+$/, ''),
      separator: data[off + 0x0c],
      forbiddenClasses: data[off + 0x0d],
      bonusType: data[off + 0x0e] >> 4,
      bonusAmount: data[off + 0x0e] & 0x0f,
      effect: data[off + 0x0f],
      damage: data[off + 0x10],
      pad: data[off + 0x11],
      gold: data[off + 0x12] | (data[off + 0x13] << 8),
    });
  }
  return items;
}

export function encodeItems(items: ItemRecord[]): Uint8Array {
  const out = new Uint8Array(items.length * ITEM_RECORD_SIZE);
  for (const it of items) {
    const off = it.index * ITEM_RECORD_SIZE;
    const nameBytes = new TextEncoder().encode(it.name);
    if (nameBytes.length > ITEM_NAME_SIZE) throw new Error(`item name too long: "${it.name}"`);
    out.fill(0x20, off, off + ITEM_NAME_SIZE);
    out.set(nameBytes, off);
    out[off + 0x0c] = it.separator;
    out[off + 0x0d] = it.forbiddenClasses;
    out[off + 0x0e] = (it.bonusType << 4) | (it.bonusAmount & 0x0f);
    out[off + 0x0f] = it.effect;
    out[off + 0x10] = it.damage;
    out[off + 0x11] = it.pad;
    out[off + 0x12] = it.gold & 0xff;
    out[off + 0x13] = (it.gold >> 8) & 0xff;
  }
  return out;
}
