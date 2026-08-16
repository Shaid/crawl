/**
 * Decodes the monster catalog from `scenario.dbs`.
 *
 * See docs/wizardry6/amiga/investigations/scenario-messages-monsters.md
 * ("Target 2: scenario.dbs monster/item/spell data") for the full
 * derivation. Summary:
 *
 * - `scenario.dbs` has a **fixed-stride monster table**: 250 records of
 *   222 bytes each, starting at file offset 0x154e8 (87272) and running to
 *   0x22db4 (142804). Both boundaries are byte-exact matches to two of
 *   `disk.hdr`'s own directory offsets (previously undecoded in the main
 *   doc's section 6.5) -- `disk.hdr`'s directory turns out to be a section
 *   table for `scenario.dbs` (it also brackets the item table below at
 *   896-37896, another exact match). This cross-file agreement is the
 *   primary structural confirmation for the record boundaries/stride.
 *
 * - Each record's first 64 bytes are four 16-byte null-padded name slots:
 *     +0  singular display name   (e.g. "GIANT RAT")
 *     +16 plural display name     (e.g. "GIANT RATS")
 *     +32 singular "category" name -- often equal to the display name,
 *         but for reskinned/variant monsters names a shared base monster
 *         (e.g. "BUSHWACKER"'s category is "ROGUE", "ZOMBIE"'s category
 *         is "STINKING CORPSE") -- almost certainly the field that
 *         selects which shared sprite/graphic set (and thus, ultimately,
 *         which `mon##.pic` file / cel group) the variant renders with.
 *         This is a strong lead for Target 3 (.PIC cel-list -> monster
 *         mapping) but was NOT traced further this pass -- no field
 *         pointing at a specific `mon##.pic` file index or cel-index-list
 *         byte range was identified in the remaining 158-byte stat block.
 *     +48 plural "category" name
 *   Confirmed by legibility across the whole 250-record table: monster
 *   names read as real Wizardry 6 bestiary entries (RAT, GIANT RAT, BAT,
 *   HUGE BAT, VAMPIRE BAT, CREEPING VINE, ROGUE, ROGUE LEADER, ZOMBIE,
 *   BRIGAND, KILLER RAT, POISON SLIME, DUNGEON LEECH, named bosses like
 *   XORPHITUS, QUEEQUEG, CAPTAIN MATEY, ...).
 *
 * - Record-relative offset 64 (4 bytes, BE u32) is **CONFIRMED** XP award:
 *   `move.l 0x40(a1),d0` at CODE+0x22e9a, added to the global XP
 *   accumulator (-0x3bc4(a4)) at CODE+0x22e9e inside the "remove combat
 *   participant" cleanup function. Recorded as `xp`.
 *
 * - Offset +0xbe (190, signed byte) is **CONFIRMED** AC (armor class):
 *   read at CODE+0x1fce2/0x1fe88; range -14..+12, Pearson r=-0.566 vs
 *   log(XP). Recorded as `ac`.
 *
 * - Offset +0xd4 (212) is **CONFIRMED structure** as monster level (coarse
 *   4-tier class, not a literal level number): written at CODE+0x29114
 *   from pcfile.dbs character offset +425 via the character->monster-slot
 *   conversion routine (CODE+0x28fee-0x29342). Recorded as `levelTier`
 *   (values 1-4).
 *
 * - HP and alignment are still NOT located despite a full ~87KB
 *   combat-subsystem sweep across 2 sessions; several candidates were
 *   tested and refuted (+0xd3, +0xd9, +0xd6, +0x86/+0x87). See
 *   docs/wizardry6/amiga/data-structure.md §7.1 for the full paths-tried
 *   detail. The rest of each record (~140 bytes) almost certainly holds
 *   further combat stats (attacks, resistances, spell lists), but no
 *   further fields were decoded this pass -- exposed here as raw bytes
 *   (`statBytesHex`) for a future session to pick up.
 *
 * - **Record offset +209 (stat-block offset 141) -- `mon##.pic` file index,
 *   CONFIRMED.** This closes the `.PIC` cel-list -> monster mapping's first
 *   half (which file). Found two independent ways that converge on the
 *   same byte:
 *     1. Statistical: grouping the 250 records by `categorySingular` and
 *        scanning every stat-block byte offset for one that's (a) constant
 *        within every multi-member category group and (b) ranges exactly
 *        0-58 (the valid `mon00.pic`-`mon58.pic` index range) turned up
 *        offset 141 as the top candidate: 32/32 multi-member category
 *        groups perfectly consistent, 46 distinct values across 114
 *        categories, max value exactly 58.
 *     2. Disassembly: `CODE+0x16042` (`move.b 0xd1(a1),d0` -- 0xd1 = 209)
 *        reads this exact record byte and pushes it into
 *        `CODE+0x15ebc` (a resource-slot cache lookup), which on a cache
 *        miss calls `CODE+0x15cf2`: that function converts the value to
 *        two ASCII digits (`divs.w 0xa,d0` then `+0x30` twice, the
 *        classic decimal-digit-pair idiom), builds `"MON<NN>.PIC"` in a
 *        scratch buffer immediately followed by the literal string
 *        `"MON00.PIC\0"` at `CODE+0x15e08`, then calls
 *        `BuildResourcePath`/`Open`/entry-55-"read into load slot"/`Close`
 *        (the same A4 jump-table entries documented in the main doc's
 *        §1.4) -- i.e. this is genuinely the file loader, not a coincidence.
 *   **Visual cross-check (5 spot-renders from the existing
 *   `sprites/monsters.png` atlas, independent of both methods above)**:
 *   category `RAT`(21) -> unmistakable rat art; `BAT`(18) -> a bat;
 *   `GIANT SERPENT`(19) -> a serpent; `HUGE SPIDER`(58) -> a spider;
 *   `STINKING CORPSE`/`ZOMBIE`(25) -> a rotting corpse. 5/5 species-correct.
 *   Exported below as `picFileIndex`/`picFile`.
 *
 * - **Record offset +210 (stat-block offset 142) -- secondary/alternate
 *   selector, hypothesis only.** Read by the same caller
 *   (`CODE+0x16092`, `move.b 0xd2(a1),d0`) but only when a *different*
 *   variable (`0xa(a5)`, likely a combat-slot/rank index passed into the
 *   enclosing function, not part of the monster record) equals 1, and
 *   only if the byte is non-zero (`tst.b 0xd2(a1); bls`) -- i.e. it's
 *   conditionally consumed per-*slot*, not unconditionally per-monster,
 *   so its role (alternate art for a specific formation position? a
 *   companion/mount graphic?) wasn't pinned down this pass. Exported as
 *   `picFileIndexSecondary` for a future session; range is 0-50, close
 *   to but not identical to the valid file range (182/183 records < 59).
 *
 * - Tracing forward from `+209` to the *cel-index-list* (i.e. which
 *   specific cel(s) within that `mon##.pic` file get composited -- the
 *   drawer at `CODE+0x35e6` takes a NUL-terminated list, not a bare file
 *   index) dead-ended this pass: the list is built at runtime into a
 *   per-combat-slot struct (`-0x3b86(a4)[slot]+8` onward, byte-copied
 *   into a stack scratch buffer at `CODE+0x18838`/`0x18816`) rather than
 *   read as a fixed field out of the monster record directly, and a few
 *   monster-identity constants (`0x14`, `0x23`, `0x36`, `0x39` -- all
 *   valid `picFileIndex` values, e.g. 0x36=54 is category `* B E L A *`)
 *   trigger a multi-cel-copy special case (`CODE+0x1885e`-`0x18886`)
 *   instead of the default single-cel path. Where that per-slot struct's
 *   `+8` byte(s) get their *value* from wasn't traced to a source this
 *   pass -- left open, see the main doc's §2.7 paths-tried table (§2.6 is
 *   this confirmed file-index finding; §2.7 is the older, superseded
 *   per-band-layout hypotheses table).
 *
 * - 67 of the 250 record slots are entirely zero (no printable name in
 *   any of the 4 slots) -- almost certainly unused/reserved roster
 *   capacity, matching the same "trailing all-zero slots" convention
 *   already confirmed for `msg.hdr` and the `.PIC` directory elsewhere in
 *   this corpus.
 *
 * Usage: npx tsx tools/wizardry6/decode-scenario-monsters.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r32 } from '@seer-project/core';

const TABLE_START = 0x154e8;
const TABLE_END = 0x22db4;
const STRIDE = 222;
const NAME_SLOT_SIZE = 16;
const NAME_SLOT_COUNT = 4;
const STAT_BLOCK_OFFSET = NAME_SLOT_SIZE * NAME_SLOT_COUNT; // 64
const PIC_FILE_INDEX_OFFSET = 209; // confirmed: mon##.pic file index (0-58)
const PIC_FILE_INDEX_SECONDARY_OFFSET = 210; // hypothesis: secondary/alternate selector
const AC_OFFSET = 0xbe; // confirmed: signed byte, armor class
const LEVEL_TIER_OFFSET = 0xd4; // confirmed structure: coarse 4-tier level class

interface MonsterRecord {
  index: number;
  offset: number;
  nameSingular: string;
  namePlural: string;
  categorySingular: string;
  categoryPlural: string;
  xp: number;
  ac: number;
  levelTier: number;
  picFileIndex: number;
  picFile: string;
  picFileIndexSecondary: number;
  /** Per-attack sub-records at +68/+84/+100 -- fully decoded 2026-08-16 (oracle: the published Zimlab bestiary, field-for-field on 9 monsters x up to 3 attacks). */
  attacks: MonsterAttack[];
  empty: boolean;
  statBytesHex: string;
}

/**
 * One 16-byte per-attack sub-record (record offsets +68/+84/+100; a
 * monster has 1-3 attacks, all-zero sub-records are unused slots).
 * Field map confirmed against the published bestiary
 * (docs/wizardry6/amiga/data-structure.md section 7.1):
 * +0-1 u16 BE damage bonus, +2 dice count, +3 dice sides (same encoding
 * as the confirmed HP/stamina specs), +4 sleep%, +5 paralyze%,
 * +6 poison%, +7 stone%, +9 drain%, +10 crit%, +11 KO%, +12 poison
 * level (Pois-N), +13 range (0=[S]hort 1=[E]xtended 2=[T]hrown 3=[L]ong),
 * +14 = 100 - toHit% (vs AC 0), +15 attack verb/type id. +8 is 0 in all
 * 301 real attacks corpus-wide.
 */
interface MonsterAttack {
  damageBonus: number;
  diceCount: number;
  diceSides: number;
  damage: string;
  sleepPct: number;
  paralyzePct: number;
  poisonPct: number;
  stonePct: number;
  drainPct: number;
  critPct: number;
  koPct: number;
  poisonLevel: number;
  range: 'short' | 'extended' | 'thrown' | 'long' | 'unknown';
  hitPct: number;
  verbId: number;
}

const ATTACK_OFFSETS = [68, 84, 100] as const;
const ATTACK_RANGES = ['short', 'extended', 'thrown', 'long'] as const;

function readAttack(rec: Uint8Array, off: number): MonsterAttack | null {
  const sub = rec.subarray(off, off + 16);
  if (sub.every((b) => b === 0)) return null;
  const damageBonus = (sub[0]! << 8) | sub[1]!;
  const diceCount = sub[2]!;
  const diceSides = sub[3]!;
  return {
    damageBonus,
    diceCount,
    diceSides,
    damage: `${diceCount}d${diceSides}${damageBonus ? `+${damageBonus}` : ''}`,
    sleepPct: sub[4]!,
    paralyzePct: sub[5]!,
    poisonPct: sub[6]!,
    stonePct: sub[7]!,
    drainPct: sub[9]!,
    critPct: sub[10]!,
    koPct: sub[11]!,
    poisonLevel: sub[12]!,
    range: ATTACK_RANGES[sub[13]!] ?? 'unknown',
    hitPct: 100 - sub[14]!,
    verbId: sub[15]!,
  };
}

function readNameSlot(rec: Uint8Array, slot: number): string {
  const base = slot * NAME_SLOT_SIZE;
  const field = rec.subarray(base, base + NAME_SLOT_SIZE);
  const nulIdx = field.indexOf(0);
  const bytes = nulIdx === -1 ? field : field.subarray(0, nulIdx);
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  let text = '';
  for (let i = start; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-scenario-monsters.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  if (TABLE_END > data.length) {
    console.error(
      `scenario.dbs too small: ${data.length} bytes, need at least ${TABLE_END} for the monster table`,
    );
    process.exit(1);
  }

  const recordCount = Math.floor((TABLE_END - TABLE_START) / STRIDE);
  const records: MonsterRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const offset = TABLE_START + i * STRIDE;
    const rec = data.subarray(offset, offset + STRIDE);

    const nameSingular = readNameSlot(rec, 0);
    const namePlural = readNameSlot(rec, 1);
    const categorySingular = readNameSlot(rec, 2);
    const categoryPlural = readNameSlot(rec, 3);
    const empty = !nameSingular && !namePlural && !categorySingular && !categoryPlural;

    // STAT_BLOCK_OFFSET (64 / 0x40) is the confirmed XP-award field itself
    // (CODE+0x22e9a), not just the start of an undecoded stat block.
    const xp = r32(rec, STAT_BLOCK_OFFSET, 'be');
    const statBytes = rec.subarray(STAT_BLOCK_OFFSET);
    const statBytesHex = Array.from(statBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Signed byte (confirmed): -14..+12 observed range.
    const acRaw = rec[AC_OFFSET];
    const ac = acRaw >= 0x80 ? acRaw - 0x100 : acRaw;
    const levelTier = rec[LEVEL_TIER_OFFSET];

    const picFileIndex = rec[PIC_FILE_INDEX_OFFSET];
    const picFile = `mon${picFileIndex.toString().padStart(2, '0')}.pic`;
    const picFileIndexSecondary = rec[PIC_FILE_INDEX_SECONDARY_OFFSET];
    const attacks = ATTACK_OFFSETS.map((o) => readAttack(rec, o)).filter((a): a is MonsterAttack => a !== null);

    records.push({
      index: i,
      offset,
      nameSingular,
      namePlural,
      categorySingular,
      categoryPlural,
      xp,
      ac,
      levelTier,
      picFileIndex,
      picFile,
      picFileIndexSecondary,
      attacks,
      empty,
      statBytesHex,
    });
  }

  const named = records.filter((r) => !r.empty);
  console.log(
    `Decoded ${recordCount} monster-table slots (${TABLE_START.toString(16)}-${TABLE_END.toString(16)}, stride ${STRIDE}): ` +
      `${named.length} named, ${recordCount - named.length} empty/reserved`,
  );

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'monster-mapping.json'), {
    note:
      'Monster catalog from scenario.dbs (confirmed: fixed 222-byte-stride, 250-record table at file ' +
      "offset 0x154e8-0x22db4, boundaries cross-verified against disk.hdr's own directory table). Name " +
      'fields (nameSingular/namePlural/categorySingular/categoryPlural) are confirmed legible. ' +
      'picFileIndex/picFile (record offset +209) is CONFIRMED: which mon##.pic file this monster renders ' +
      'with, found via a category-grouping statistical scan and independently via disassembly ' +
      '(CODE+0x16042 reads this exact byte and feeds it to the MON%02d.PIC loader at CODE+0x15cf2), plus ' +
      '5/5 species-correct visual spot-renders (RAT/BAT/GIANT SERPENT/HUGE SPIDER/ZOMBIE all matched their ' +
      'picFileIndex). picFileIndexSecondary (record offset +210) is an unconfirmed hypothesis -- read by ' +
      'the same caller but only for a specific combat-slot condition, role not pinned down. Which cel(s) ' +
      "within a monster's mon##.pic file get composited (vs. just which file) is still open -- the " +
      'runtime cel-index list is built into a per-combat-slot struct, not read as a fixed record field; ' +
      'see docs/wizardry6/amiga/data-structure.md §2 for the paths-tried detail. xp (+64, BE u32) is ' +
      'CONFIRMED via disassembly (CODE+0x22e9a, added to the global XP accumulator on kill). ac (+0xbe, ' +
      'signed byte) is CONFIRMED (CODE+0x1fce2/0x1fe88; range -14..+12, r=-0.566 vs log(XP)). levelTier ' +
      '(+0xd4) is CONFIRMED structure (coarse 4-tier class, not a literal level; written at CODE+0x29114 ' +
      'from a pcfile.dbs character field via the character->monster-slot conversion routine). HP and ' +
      'alignment were NOT located despite a full ~87KB combat-subsystem sweep across 2 sessions; several ' +
      'candidates were tested and refuted -- see data-structure.md §7.1 for the full paths-tried table. ' +
      'statBytesHex is the remaining undecoded stat block (now excludes only xp/ac/levelTier as separately ' +
      'confirmed fields, not yet trimmed of those bytes). empty=true records are unused/reserved roster ' +
      'capacity (all 4 name slots blank), matching the same trailing-blank-slot convention already ' +
      'confirmed for msg.hdr and the .PIC directory. See ' +
      'docs/wizardry6/amiga/investigations/scenario-messages-monsters.md for full derivation.',
    tableStart: TABLE_START,
    tableEnd: TABLE_END,
    stride: STRIDE,
    recordCount,
    namedCount: named.length,
    records,
  });

  console.log(`Wrote monster-mapping.json (${recordCount} slots, ${named.length} named)`);
}

main();
