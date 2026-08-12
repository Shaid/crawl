/**
 * Extracts scenario.dbs's class XP tables, item catalog, and monster
 * catalog on the DOS/EGA release.
 *
 * scenario.dbs's 10-section layout is byte-exact identical to the Amiga
 * release (confirmed via master.hdr/disk.hdr's LE-reinterpreted values,
 * see docs/wizardry6/dosega/data-structure.md section 1.6) -- only the
 * multi-byte numeric fields' endianness differs (LE here vs. BE on
 * Amiga); ASCII name fields are untouched.
 *
 * Section 0 (0x000-0x37F): 14 x 16 x u32 LE class XP tables, values
 * identical to the Amiga release's round-decimal sequences.
 * Section 1 (0x380-0x9408): 500 x 74-byte item catalog (name at +0,
 * price u32 LE at +16) -- names/prices identical to Amiga's catalog.
 * Section 4 (0x154e8-0x22db4): 250 x 222-byte monster catalog (singular/
 * plural/category names at +0/+16/+32/+48, picFileIndex u8 at +209,
 * secondary selector u8 at +210) -- names/picFileIndex identical to
 * Amiga's catalog (single-byte fields, endianness-agnostic).
 *
 * See docs/wizardry6/amiga/data-structure.md section 7.1 for the full
 * field-layout derivation (shared, not re-derived here) and
 * docs/wizardry6/dosega/data-structure.md section 1.6 for this platform's
 * cross-verification.
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-scenario.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r32 } from '@seer-project/core';

const XP_TABLE_COUNT = 14;
const XP_LEVELS_PER_TABLE = 16;
const XP_TABLE_BYTES = XP_TABLE_COUNT * XP_LEVELS_PER_TABLE * 4;

const ITEM_BASE = 0x380;
const ITEM_STRIDE = 74;
const ITEM_COUNT = 500;

const MONSTER_BASE = 0x154e8;
const MONSTER_STRIDE = 222;
const MONSTER_COUNT = 250;

function readCString(data: Uint8Array, offset: number, maxLen: number): string {
  const slice = data.subarray(offset, offset + maxLen);
  let end = slice.indexOf(0);
  if (end < 0) end = slice.length;
  return Buffer.from(slice.subarray(0, end)).toString('latin1');
}

function decodeXpTables(data: Uint8Array): number[][] {
  const tables: number[][] = [];
  for (let t = 0; t < XP_TABLE_COUNT; t++) {
    const levels: number[] = [];
    for (let lvl = 0; lvl < XP_LEVELS_PER_TABLE; lvl++) {
      const offset = (t * XP_LEVELS_PER_TABLE + lvl) * 4;
      levels.push(r32(data, offset, 'le'));
    }
    tables.push(levels);
  }
  return tables;
}

interface ItemRecord {
  index: number;
  name: string;
  priceGold: number;
}

function decodeItems(data: Uint8Array): ItemRecord[] {
  const items: ItemRecord[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    const base = ITEM_BASE + i * ITEM_STRIDE;
    const name = readCString(data, base, 20);
    if (!name) continue;
    items.push({ index: i, name, priceGold: r32(data, base + 16, 'le') });
  }
  return items;
}

interface MonsterRecord {
  index: number;
  name: string;
  namePlural: string;
  category: string;
  categoryPlural: string;
  picFileIndex: number;
  picFile: string;
  picFileIndexSecondary: number;
}

function decodeMonsters(data: Uint8Array): MonsterRecord[] {
  const monsters: MonsterRecord[] = [];
  for (let i = 0; i < MONSTER_COUNT; i++) {
    const base = MONSTER_BASE + i * MONSTER_STRIDE;
    const name = readCString(data, base, 16);
    if (!name) continue;
    const picFileIndex = data[base + 209];
    monsters.push({
      index: i,
      name,
      namePlural: readCString(data, base + 16, 16),
      category: readCString(data, base + 32, 16),
      categoryPlural: readCString(data, base + 48, 16),
      picFileIndex,
      picFile: `mon${String(picFileIndex).padStart(2, '0')}.pic`,
      picFileIndexSecondary: data[base + 210],
    });
  }
  return monsters;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-scenario.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  if (data.length < XP_TABLE_BYTES) {
    console.error(`scenario.dbs too small: ${data.length} bytes`);
    process.exit(1);
  }

  const xpTables = decodeXpTables(data);
  const items = decodeItems(data);
  const monsters = decodeMonsters(data);

  const outDir = resolve('public/assets/wizardry6/dosega/data');
  mkdirSync(outDir, { recursive: true });

  writeJson(resolve(outDir, 'xp-tables.json'), {
    note:
      'Class-index -> table mapping unconfirmed (same open item as Amiga). 14 tables at scenario.dbs offset 0x000-0x37F, 16 levels each, little-endian u32 XP thresholds, values identical to the Amiga release.',
    tables: xpTables,
  });

  writeJson(resolve(outDir, 'items.json'), {
    note:
      'scenario.dbs section 1 (0x380-0x9408), 500x74-byte records. Only name (+0) and price (+16, u32 LE) are decoded; remaining fields open -- see docs/wizardry6/amiga/data-structure.md section 7.1.',
    count: items.length,
    items,
  });

  writeJson(resolve(outDir, 'monster-mapping.json'), {
    note:
      'scenario.dbs section 4 (0x154e8-0x22db4), 250x222-byte records. picFileIndex (+209) selects mon##.pic (0-58); picFileIndexSecondary (+210) is a hypothesis-only alternate/companion selector, conditionally consumed. Combat stat block (~154 bytes/record) undecoded -- see docs/wizardry6/amiga/data-structure.md sections 2.6a and 7.1.',
    count: monsters.length,
    monsters,
  });

  console.log(
    `Wrote xp-tables.json (${xpTables.length} tables), items.json (${items.length}/${ITEM_COUNT} named), monster-mapping.json (${monsters.length}/${MONSTER_COUNT} named)`,
  );
}

main();
