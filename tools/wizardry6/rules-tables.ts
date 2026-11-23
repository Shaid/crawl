/**
 * Extracts Wizardry 6 (Amiga) rule tables from the retail files and the `Bane` executable.
 * Outputs (public/assets/wizardry6/amiga/data/):
 *   messages-full.json  every message id the game can look up, decoded with the game's own
 *                       record framing (supersedes messages.json, which only held each
 *                       record's first string and cut it short; see game-rules.md Correction)
 *   rules-tables.json   classes, races, attributes, skills, spells, ranks, level-up constants
 * Evidence and addresses: docs/wizardry6/amiga/game-rules.md. Original code, derived from the
 * game's disassembly only.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { parseHunkFile } from '@seer-project/amiga';
import { HP_DICE, SPELL_TIER_LEVELS } from './rules.ts';

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const s16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Huffman tree from misc.hdr (CODE+0x2a60 LAB_0193 decoder). */
function huff(misc: Uint8Array, buf: Uint8Array): string {
  const L = buf[0];
  if (buf.length < 2) return '';
  let cur = buf[1];
  let pos = 2;
  let bits = 8;
  let out = '';
  for (let i = 0; i < L; i++) {
    let node = 0;
    for (;;) {
      const bit = (cur >> 7) & 1;
      cur = ((cur << 1) | bit) & 0xff;
      const off = node + (bit ? 2 : 0);
      bits--;
      if (bits === 0) {
        cur = pos < buf.length ? buf[pos] : 0;
        pos++;
        bits = 8;
      }
      if (misc[off] & 0x80) {
        node = (-s16(misc, off) << 2) & 0xffff;
        continue;
      }
      out += String.fromCharCode(u16(misc, off) & 0xff);
      break;
    }
  }
  return out;
}

/**
 * GetMessage (CODE+0x872 LAB_004B): msg.hdr is count + 6-byte records (firstId, offsetInPage,
 * word: high byte = extra ids, low byte = page). A record names a run of consecutive ids whose
 * strings are packed in a 1024-byte page as [n][L][n-1 bytes of Huffman stream], so the next
 * string is `n+1` bytes on.
 */
export function decodeAllMessages(hdr: Uint8Array, dbs: Uint8Array, misc: Uint8Array): Record<number, string> {
  const out: Record<number, string> = {};
  const n = u16(hdr, 0);
  for (let i = 0; i < n; i++) {
    const id = u16(hdr, 2 + 6 * i);
    let off = u16(hdr, 4 + 6 * i);
    const w = u16(hdr, 6 + 6 * i);
    const page = (w & 0xff) * 1024;
    for (let k = 0; k <= w >> 8; k++) {
      const len = dbs[page + off];
      out[id + k] = huff(misc, dbs.subarray(page + off + 1, page + off + 1 + len));
      off += len + 1;
    }
  }
  return out;
}

/** Targets of `PEA d16(PC)` (0x487a) opcodes in [from,to): the inline 8-letter attribute strings. */
function peaTargets(code: Uint8Array, from: number, to: number): number[] {
  const t: number[] = [];
  for (let a = from; a < to; a += 2) if (code[a] === 0x48 && code[a + 1] === 0x7a) t.push(a + 2 + s16(code, a + 2));
  return t;
}
const letters = (code: Uint8Array, o: number) => Array.from(code.subarray(o, o + 8)).map((c) => c - 0x41);

export interface SpellRow {
  id: number;
  name: string;
  realm: number;
  realmName: string;
  level: number;
  /** SP deducted from the realm pool per power step (record +2); code-confirmed (CODE+0x275ba). */
  spPerPower: number;
  /** +3: bit0/bit1 gate the cast-outcome flags at CODE+0x2747a/0x274a0 (semantics hypothesis). */
  b3: number;
  /** +4: 0/1/2 (read by CODE+0x1e506 and others; semantics open). */
  b4: number;
  /** +5: who can learn it, a mask over the four caster groups (CODE+0x356c0): 1 alchemist, 2 psionic, 4 priest, 8 mage. */
  casterMask: number;
}

export function extractRulesTables(dataDir: string) {
  const bane = readBinary(resolve(dataDir, 'Bane'));
  const hunks = parseHunkFile(bane);
  const code = bane.subarray(hunks[0].fileOffset!, hunks[0].fileOffset! + hunks[0].size);
  const data = bane.subarray(hunks[1].fileOffset!, hunks[1].fileOffset! + hunks[1].size);
  const sc = readBinary(resolve(dataDir, 'scenario.dbs'));
  const msgs = decodeAllMessages(readBinary(resolve(dataDir, 'msg.hdr')), readBinary(resolve(dataDir, 'msg.dbs')), readBinary(resolve(dataDir, 'misc.hdr')));
  const m = (id: number) => msgs[id] ?? '';

  const attrNames = Array.from({ length: 8 }, (_, i) => m(5050 + i));
  const attrAbbr = Array.from({ length: 8 }, (_, i) => m(204 + i));

  // Class minimum attributes: CODE+0x2d238.. (case i = class i; class 8 VALKYRIE additionally needs
  // gender byte -10038(A4) == 1, CODE+0x2d2d8).
  const classMin = peaTargets(code, 0x2d238, 0x2d36a).map((t) => letters(code, t));
  // Race base attributes: CODE+0x2d614.. (case i = race i).
  const raceBase = peaTargets(code, 0x2d610, 0x2d6a0).map((t) => letters(code, t));

  const classes = Array.from({ length: 14 }, (_, c) => ({
    id: c,
    name: m(120 + c),
    xpTable: Array.from({ length: 16 }, (_, i) => u32(sc, c * 64 + i * 4)),
    hpDie: HP_DICE[c].die,
    hpBonus: HP_DICE[c].bonus,
    minAttrs: classMin[c],
    femaleOnly: c === 8,
    ranks: Array.from({ length: 10 }, (_, i) => m(800 + c * 10 + i)),
  }));
  const races = Array.from({ length: 11 }, (_, r) => ({ id: r, name: m(100 + r), baseAttrs: raceBase[r] }));
  const skills = Array.from({ length: 30 }, (_, k) => ({ id: k, name: m(5500 + k), recordOffset: 308 + k }));

  const realmNames = Array.from({ length: 6 }, (_, i) => m(3950 + i));
  const spells: SpellRow[] = [];
  const SP = 0x7ffe - 31698; // A4-31698 = DATA+0x42c
  for (let i = 0; i < 82; i++) {
    const o = SP + 6 * i;
    spells.push({
      id: i,
      name: m(4000 + i),
      realm: data[o],
      realmName: realmNames[data[o]] ?? '',
      level: data[o + 1],
      spPerPower: data[o + 2],
      b3: data[o + 3],
      b4: data[o + 4],
      casterMask: data[o + 5],
    });
  }

  const tables = {
    note:
      'Wizardry 6 (Amiga) rule tables. Sources: Bane CODE inline strings (class minimums CODE+0x2d3a4.., race bases CODE+0x2d6ce..), ' +
      'Bane DATA+0x42c spell table (A4-31698, 6 B/spell), scenario.dbs section 0 (XP), msg.dbs via the game framing. See docs/wizardry6/amiga/game-rules.md.',
    attributes: attrNames.map((name, i) => ({ id: i, name, abbr: attrAbbr[i], recordOffset: 300 + i, creationCap: 18 })),
    classes,
    races,
    skills,
    skillPointsLabel: m(5530),
    casterGroups: [
      { group: 0, label: m(704), mask: 8, skillId: 28 },
      { group: 1, label: m(705), mask: 4, skillId: 26 },
      { group: 2, label: m(706), mask: 1, skillId: 25 },
      { group: 3, label: m(707), mask: 2, skillId: 27 },
    ],
    realms: realmNames,
    spells,
    spellTierLevels: [...SPELL_TIER_LEVELS],
    creation: {
      bonusPool: { base: 5, randomDie: 6, extraEightChance: '2 independent rolls of Random(20)==0, +8 each', cheatValue: 21 },
      femalePenalty: { str: -2, per: +1, kar: +1, note: 'applied by CODE+0x2d732 when the gender arg == 1 (hypothesis: female)' },
      attributeCap: 18,
    },
  };
  return { tables, messages: msgs };
}

export function exportRulesTables(dataDir: string): void {
  const { tables, messages } = extractRulesTables(dataDir);
  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'rules-tables.json'), tables);
  writeJson(resolve(outDir, 'messages-full.json'), {
    note:
      'Every id GetMessage (Bane CODE+0x872) can resolve, decoded with the game framing [n][L][n-1 stream bytes] per string. ' +
      'Supersedes messages.json, which decoded only the first string of each msg.hdr record and mis-read the length bytes.',
    count: Object.keys(messages).length,
    messages,
  });
}

if (process.argv[1]?.endsWith('rules-tables.ts')) {
  exportRulesTables(process.argv[2] ?? 'data/wizardry6/amiga');
}
