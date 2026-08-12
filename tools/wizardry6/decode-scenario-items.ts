/**
 * Decodes the item catalog from `scenario.dbs` (section 1).
 *
 * See docs/wizardry6/amiga/data-structure.md §7.1 ("Section 1") for the
 * full derivation and disassembly citations. Summary:
 *
 * - `scenario.dbs` section 1 is a fixed-stride table: 500 records of
 *   74 bytes each, starting at file offset 0x380 (896) and running to
 *   0x9408 (37896). Both boundaries are byte-exact matches to two of
 *   `disk.hdr`'s own section-boundary offsets (§6.5/§6.4).
 *
 * - `+0` (name, NUL-padded ~20 bytes) is confirmed legible across all
 *   452 named records (of 500 total slots -- the other 48 are unused
 *   roster capacity, all-zero, matching the same trailing-blank-slot
 *   convention already confirmed elsewhere in this corpus).
 *
 * - `+16` (BE u32 price in gold) is confirmed via disassembly: seeded
 *   into the shop BCD money-accumulator primitives (CODE+0x46648-0x4665c,
 *   CODE+0x46b38).
 *
 * - `+20/+22/+23` (BE u16 bonus, u8 dice count, u8 dice sides) is a
 *   confirmed damage-dice spec: `mulu.w` of count*sides plus the bonus,
 *   at 3 call sites, and the whole 4-byte span is copied as one unit by
 *   4 separate equip-application functions.
 *
 * - `+28` (BE u16, NOT 4 bytes) is a confirmed "special power" ID: split
 *   into hi/lo bytes via `divs.w #0x100`, the lo byte indexes a small
 *   lookup table that selects which of two per-character result fields
 *   receives the hi byte. This refutes the original "+28 = 4-byte weight"
 *   hypothesis -- no 4-byte read at this offset exists in any of the 23
 *   traced ReadSection(category=1) consumers. The real weight field (if
 *   any) is not yet located.
 *
 * - `+54-55` (BE u16, LSB-first, 14 bits) is a confirmed CLASS-restriction
 *   bitmask, with a live enforcement site: CODE+0x366b4-0x366d2 reads the
 *   wearer's class-ID byte and TestBit()s it against this field, aborting
 *   the equip (message 0x2da) on failure. Semantic cross-check across 500
 *   records matches classic Wizardry conventions (e.g. priest hats allow
 *   only PRI/BIS; blunt weapons allow PRI where edged weapons don't).
 *
 * - `+56` (+ low 3 bits of `+57`) is a confirmed RACE-restriction bitmask
 *   (11 bits). Independently re-derived twice: via disassembly (a
 *   TestBit-loop bound of 11 at CODE+0x39916) AND via a from-scratch
 *   statistical pass over the raw bytes (before the disassembly trace
 *   returned) that found only 6 distinct bitmask patterns across all 452
 *   named records and matched them to item names: bit 5 set alone on
 *   exactly the 5 tiny Faerie-sized items (FAERIE CAP, PIXIE STICK,
 *   FAERIE STICK, NIGHT STICK, ROD=SPRITES); bit 1 set alone only on
 *   ELVEN BOW; GIANT SLEDGE (big/strong races only) sets bits 0,2,6,7;
 *   0xDF (0xFF minus bit 5, "everyone except Faerie") on 127 mostly-heavy
 *   weapon/armor records; 0xFF (unrestricted) on 317 records. Both
 *   independent methods converged on the same bit-5=Faerie, bit-1=Elf
 *   reading.
 *
 * - `+58` (2 bits) is a confirmed gender/2-state restriction: `0x03`
 *   (unrestricted) in 445/452 records, with exceptions matching thematic
 *   gender associations (women's garments = 0x02, etc.).
 *
 * - `+59` bit 2 is confirmed as a two-handed-weapon flag: set on exactly
 *   the classic Wizardry two-handed weapons (CLAYMORE, SPEAR, AWL PIKE,
 *   QUARTERSTAFF, BO, HALBERD, ...), 29/452 records.
 *
 * - `+60` is a confirmed item-category/equip-slot enum (17 values,
 *   0-16), decoded by direct semantic inspection of all 452 named
 *   records: 0=melee, 1=polearm, 2=light/thrown, 3=bow, 4=ammo, 5=cloak,
 *   6=headgear, 7=body-upper, 8=body-lower, 9=gauntlets, 10=boots,
 *   11=shield, 12=heal potion, 13=spell scroll, 14=misc/instrument,
 *   15=key, 16=powder/dust. Also directly compared against literals in
 *   code and used as an index into a 256-entry classification table.
 *
 * Session update (see docs/wizardry6/amiga/data-structure.md §7.1 "Final
 * update" block for full derivation): a new consumer function
 * (CODE+0x3bf3c-0x3c220, outside the previously-known 23 ReadSection
 * call sites) resolved 29 of the 32 previously-undecoded gap bytes:
 * +33-45 (13 bytes) is a per-class equip-bonus array consumed by a
 * dedicated per-class accumulator helper; +46-53 (8 bytes) is an 8-slot
 * resistance/quality-shaped array; +64/+65/+68/+72 are per-slot cache
 * bytes; +66/+67 feed per-character "running max" trackers; +70 is
 * subtracted from a per-character byte pool (weight/encumbrance-shaped);
 * +71 is category-gated (ammo-specific hypothesis); +24-27 (a previously
 * unlisted 4-byte span right after the confirmed dice spec) is also
 * copied whole into a per-slot cache. All of these are access-confirmed,
 * hypothesis-semantics (matching this doc's convention) -- exposed below
 * as named raw fields. Genuinely open, no consumer found anywhere: +31,
 * +32, +73 (3 bytes -- down from the original 32-byte/3-gap span).
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-items.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r16, r32 } from '@seer-project/core';

const TABLE_START = 0x380;
const TABLE_END = 0x9408;
const STRIDE = 74;
const NAME_FIELD_SIZE = 20;

const CATEGORY_NAMES: Record<number, string> = {
  0: 'melee',
  1: 'polearm',
  2: 'light/thrown',
  3: 'bow',
  4: 'ammo',
  5: 'cloak',
  6: 'headgear',
  7: 'body-upper',
  8: 'body-lower',
  9: 'gauntlets',
  10: 'boots',
  11: 'shield',
  12: 'heal-potion',
  13: 'spell-scroll',
  14: 'misc/instrument',
  15: 'key',
  16: 'powder/dust',
};

interface ItemRecord {
  index: number;
  offset: number;
  name: string;
  empty: boolean;
  price: number;
  damageBonus: number;
  diceCount: number;
  diceSides: number;
  specialPowerRaw: number;
  classMask: number;
  classMaskBinary: string;
  raceMask: number;
  raceMaskBinary: string;
  genderMask: number;
  twoHanded: boolean;
  specialFlagsRaw: number;
  category: number;
  categoryName: string;
  categoryCompanionByte: number;
  bonusBlock24to27Hex: string;
  classBonusArray33to45Hex: string;
  slotArray46to53Hex: string;
  equipCacheByte64: number;
  equipCacheByte65: number;
  runningMaxInput66: number;
  runningMaxInput67: number;
  slotLocalByte68: number;
  weightDeduction70: number;
  ammoStat71: number;
  equipCacheByte72: number;
  undecodedHex: string;
}

function readName(rec: Uint8Array): string {
  const field = rec.subarray(0, NAME_FIELD_SIZE);
  const nulIdx = field.indexOf(0);
  const bytes = nulIdx === -1 ? field : field.subarray(0, nulIdx);
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-items.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  if (TABLE_END > data.length) {
    console.error(
      `scenario.dbs too small: ${data.length} bytes, need at least ${TABLE_END} for the item table`,
    );
    process.exit(1);
  }

  const recordCount = Math.floor((TABLE_END - TABLE_START) / STRIDE);
  const records: ItemRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const offset = TABLE_START + i * STRIDE;
    const rec = data.subarray(offset, offset + STRIDE);

    const name = readName(rec);
    const empty = !name;

    const price = r32(rec, 16, 'be');
    const damageBonus = r16(rec, 20, 'be');
    const diceCount = rec[22];
    const diceSides = rec[23];
    const specialPowerRaw = r16(rec, 28, 'be');
    // Class mask is consumed via the game's own byte-array-based TestBit(base, i)
    // primitive (base[i>>3] & (1<<(i&7))), i.e. LSB-first BYTE order: +54 holds
    // bits 0-7, +55 holds bits 8-13. This is the opposite of a big-endian u16
    // read despite the CPU being big-endian -- confirmed by cross-checking
    // against the disassembly-reported semantics (DAGGER excludes exactly
    // PRI/BIS/MON; MITRE allows only PRI/BIS) which only matches this byte
    // order, not a naive BE r16 read.
    const classMask = rec[54] | (rec[55] << 8);
    const raceMask = rec[56] | ((rec[57] & 0x07) << 8);
    const genderMask = rec[58] & 0x03;
    const specialFlagsRaw = rec[59];
    const twoHanded = (specialFlagsRaw & 0x04) !== 0;
    const category = rec[60];
    const categoryCompanionByte = rec[61];

    const hex = (from: number, to: number) =>
      Array.from(rec.subarray(from, to))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const bonusBlock24to27Hex = hex(24, 28);
    const classBonusArray33to45Hex = hex(33, 46);
    const slotArray46to53Hex = hex(46, 54);
    const equipCacheByte64 = rec[64];
    const equipCacheByte65 = rec[65];
    const runningMaxInput66 = rec[66];
    const runningMaxInput67 = rec[67];
    const slotLocalByte68 = rec[68];
    const weightDeduction70 = rec[70];
    const ammoStat71 = rec[71];
    const equipCacheByte72 = rec[72];

    // Genuinely open, no consumer found anywhere (down from the original
    // 32-byte/3-gap span -- see the session-update comment at the top of
    // this file): +31, +32, +73.
    const undecodedRanges: [number, number][] = [
      [31, 33],
      [73, 74],
    ];
    const undecodedHex = undecodedRanges
      .map(([start, end]) =>
        Array.from(rec.subarray(start, end))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      )
      .join('|');

    records.push({
      index: i,
      offset,
      name,
      empty,
      price,
      damageBonus,
      diceCount,
      diceSides,
      specialPowerRaw,
      classMask,
      classMaskBinary: classMask.toString(2).padStart(14, '0'),
      raceMask,
      raceMaskBinary: raceMask.toString(2).padStart(11, '0'),
      genderMask,
      twoHanded,
      specialFlagsRaw,
      category,
      categoryName: CATEGORY_NAMES[category] ?? `unknown(${category})`,
      categoryCompanionByte,
      bonusBlock24to27Hex,
      classBonusArray33to45Hex,
      slotArray46to53Hex,
      equipCacheByte64,
      equipCacheByte65,
      runningMaxInput66,
      runningMaxInput67,
      slotLocalByte68,
      weightDeduction70,
      ammoStat71,
      equipCacheByte72,
      undecodedHex,
    });
  }

  const named = records.filter((r) => !r.empty);
  console.log(
    `Decoded ${recordCount} item-table slots (${TABLE_START.toString(16)}-${TABLE_END.toString(16)}, stride ${STRIDE}): ` +
      `${named.length} named, ${recordCount - named.length} empty/reserved`,
  );

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'item-catalog.json'), {
    note:
      'Item catalog from scenario.dbs section 1 (confirmed: fixed 74-byte-stride, 500-record table at file ' +
      "offset 0x380-0x9408, boundaries cross-verified against disk.hdr's own section table). See " +
      'docs/wizardry6/amiga/data-structure.md §7.1 for full derivation. name/price/damage-dice ' +
      '(damageBonus/diceCount/diceSides)/classMask (+54-55, with a live equip-time enforcement site)/' +
      'raceMask (+56-57, cross-checked both via disassembly and an independent statistical bit/name ' +
      'analysis)/genderMask (+58)/twoHanded flag (+59 bit 2)/category+categoryName (+60, 17-value enum ' +
      'decoded by direct semantic inspection) are all CONFIRMED. specialPowerRaw (+28, packed byte pair, ' +
      'not the "4-byte weight" originally hypothesized) is confirmed structure, hypothesis semantics. ' +
      'categoryCompanionByte (+61) is structurally confirmed (always copied alongside +60 into a runtime ' +
      'equip-cache) but not semantically decoded. bonusBlock24to27Hex/classBonusArray33to45Hex/' +
      'slotArray46to53Hex/equipCacheByte64/65/72/runningMaxInput66/67/slotLocalByte68/weightDeduction70/' +
      'ammoStat71 are all access-confirmed (a new consumer function, CODE+0x3bf3c-0x3c220, found this ' +
      'session outside the previously-known 23 category-1 ReadSection call sites) but hypothesis-semantics ' +
      'only -- see data-structure.md §7.1 "Final update" for the full per-field disassembly citations. ' +
      'undecodedHex concatenates the remaining genuinely-undecoded byte ranges (+31-32, +73 -- narrowed ' +
      'from 32 bytes/3 gaps to 3 bytes this session) in that order, pipe-separated, for a future session. ' +
      'empty=true records are unused/reserved catalog capacity (blank name), matching the same ' +
      'trailing-blank-slot convention already confirmed for msg.hdr, the monster catalog, and the .PIC ' +
      'directory elsewhere in this corpus.',
    tableStart: TABLE_START,
    tableEnd: TABLE_END,
    stride: STRIDE,
    recordCount,
    namedCount: named.length,
    categoryNames: CATEGORY_NAMES,
    records,
  });

  console.log(`Wrote item-catalog.json (${recordCount} slots, ${named.length} named)`);
}

main();
