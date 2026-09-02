/**
 * Eye of the Beholder II (Amiga) `ITEM.DAT` / `ITEMTYPE.DAT` decoder.
 *
 * **Confirmed (2026-09-02): same `EoBItem`/`EoBItemType` record layout,
 * counts, and total size as EOB2 DOS/VGA's own files -- but every
 * multi-byte field is big-endian (Amiga-native), not DOS's little-endian.**
 * The two files are NOT byte-identical (`md5sum` differs, unlike `.DEC`/
 * `.DCR`) despite being byte-for-byte the *same size* (10,385 and 1,026
 * bytes respectively) -- this module resolves that: a whole-file
 * little-endian parse (the DOS reader, `scripts/kyralib/items.py`) fails
 * to land on EOF, while the identical field layout read big-endian lands
 * exactly on EOF with zero residue for both files, and the resulting
 * `numItems`/`numNames`/`numTypes` counts match DOS's own values exactly:
 *
 * - `ITEM.DAT` (10,385 bytes): `numItems=434` (BE) -> item table ends at
 *   `2+434*14=6078`; `numNames=123` (BE) at that offset -> name table
 *   `6078+2+123*35=10385` = file size exactly. First name decodes to
 *   `"Mouse Pointer"`, matching both EOB1 and EOB2 DOS's own convention.
 * - `ITEMTYPE.DAT` (1,026 bytes): `numTypes=64` (BE) -> `2+64*16=1026` =
 *   file size exactly.
 *
 * Record layout is a direct port of `EoBCoreEngine::loadItemDefs`
 * (`engine/items_eob.cpp:35-143`, shared code, already confirmed for both
 * EOB1 and EOB2 DOS -- `docs/eotb2/dosvga/data-structure.md` § "ITEM.DAT
 * / ITEMTYPE.DAT / TEXT.DAT"), field-for-field identical to
 * `scripts/kyralib/items.py`'s `parse_item_dat`/`parse_itemtype_dat`
 * except every multi-byte read uses big-endian instead of little-endian.
 */

export interface EobItem {
  nameUnid: number;
  nameId: number;
  flags: number;
  icon: number;
  type: number;
  pos: number;
  block: number;
  next: number;
  prev: number;
  level: number;
  value: number;
}

export interface EobItemType {
  invFlags: number;
  handFlags: number;
  armorClass: number;
  allowedClasses: number;
  requiredHands: number;
  dmgNumDiceS: number;
  dmgNumPipsS: number;
  dmgIncS: number;
  dmgNumDiceL: number;
  dmgNumPipsL: number;
  dmgIncL: number;
  unk1: number;
  extraProperties: number;
}

function s8(v: number): number {
  return v < 0x80 ? v : v - 0x100;
}
function s16be(data: Uint8Array, off: number): number {
  const v = (data[off]! << 8) | data[off + 1]!;
  return v < 0x8000 ? v : v - 0x10000;
}

const ITEM_RECORD_SIZE = 14;
const NAME_SIZE = 35;
const ITEMTYPE_RECORD_SIZE = 16;

export function decodeItemDat(data: Uint8Array): { items: EobItem[]; names: string[] } {
  const numItems = (data[0]! << 8) | data[1]!;
  let off = 2;
  const items: EobItem[] = [];
  for (let i = 0; i < numItems; i++) {
    items.push({
      nameUnid: data[off]!,
      nameId: data[off + 1]!,
      flags: data[off + 2]!,
      icon: s8(data[off + 3]!),
      type: s8(data[off + 4]!),
      pos: s8(data[off + 5]!),
      block: s16be(data, off + 6),
      next: s16be(data, off + 8),
      prev: s16be(data, off + 10),
      level: data[off + 12]!,
      value: s8(data[off + 13]!),
    });
    off += ITEM_RECORD_SIZE;
  }
  const numNames = (data[off]! << 8) | data[off + 1]!;
  off += 2;
  const names: string[] = [];
  for (let i = 0; i < numNames; i++) {
    const raw = data.subarray(off, off + NAME_SIZE);
    const nul = raw.indexOf(0);
    names.push(Buffer.from(raw.subarray(0, nul === -1 ? NAME_SIZE : nul)).toString('latin1'));
    off += NAME_SIZE;
  }
  if (off !== data.length) {
    throw new Error(`decodeItemDat: oracle check failed -- expected to land exactly on EOF (${data.length}), stopped at ${off}`);
  }
  return { items, names };
}

export function decodeItemTypeDat(data: Uint8Array): EobItemType[] {
  const numTypes = (data[0]! << 8) | data[1]!;
  let off = 2;
  const types: EobItemType[] = [];
  for (let i = 0; i < numTypes; i++) {
    types.push({
      invFlags: (data[off]! << 8) | data[off + 1]!,
      handFlags: (data[off + 2]! << 8) | data[off + 3]!,
      armorClass: s8(data[off + 4]!),
      allowedClasses: s8(data[off + 5]!),
      requiredHands: s8(data[off + 6]!),
      dmgNumDiceS: s8(data[off + 7]!),
      dmgNumPipsS: s8(data[off + 8]!),
      dmgIncS: s8(data[off + 9]!),
      dmgNumDiceL: s8(data[off + 10]!),
      dmgNumPipsL: s8(data[off + 11]!),
      dmgIncL: s8(data[off + 12]!),
      unk1: data[off + 13]!,
      extraProperties: (data[off + 14]! << 8) | data[off + 15]!,
    });
    off += ITEMTYPE_RECORD_SIZE;
  }
  if (off !== data.length) {
    throw new Error(`decodeItemTypeDat: oracle check failed -- expected to land exactly on EOF (${data.length}), stopped at ${off}`);
  }
  return types;
}
