/**
 * Decodes the DOS/EGA release's msg.dbs, the Huffman-compressed message/
 * text-fragment blob indexed by msg.hdr, using this platform's own
 * misc.hdr Huffman tree (NOT interchangeable with the Amiga tree -- the
 * two trees differ at a handful of nodes, most likely due to slightly
 * different source text between ports building different tie-breaks
 * during tree construction; see
 * docs/wizardry6/dosega/data-structure.md section 1.1).
 *
 * Same algorithm and field layout as the Amiga release
 * (tools/wizardry6/decode-msg-text.ts), fields little-endian:
 *
 * - misc.hdr (1024 bytes): 256-node Huffman bit-tree, 2x LE i16/node
 *   (left child, right child). Negative = internal-node back-reference
 *   (nextNode = -value). Non-negative = leaf (literal output byte).
 * - msg.hdr (5102 bytes = 2-byte count + up to 850x6-byte records): each
 *   record is 3x LE u16 (A, B, C). Position formula unchanged:
 *   offset = (C & 0xFF) * 1024 + B into msg.dbs (80x1024 bytes).
 * - At that offset: +0 u8 decoded length L, +1 u8 compressed byte count
 *   (unused for decode), +2.. Huffman bitstream (MSB-first per byte).
 *
 * Verified by first reimplementing this exact algorithm against the
 * Amiga corpus (own tree/hdr/dbs) and reproducing the Amiga doc's own
 * stated numbers exactly (724/724 unique positions, 90.7% printable)
 * before trusting it on DOS data. On the DOS corpus: 686/718 unique
 * positions (32 collisions, confirmed genuine text reuse, not a decode
 * gap -- see docs/wizardry6/dosega/data-structure.md section 1.8), 98.5%
 * printable-ASCII, dozens of fully legible recovered sentences.
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-msg-text.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { r16 } from '@seer-project/core';

const PAGE_SIZE = 1024;
const RECORD_CAPACITY = 850;

interface HuffmanNode {
  left: number;
  right: number;
}

function toSigned16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

function readHuffmanTree(misc: Uint8Array): HuffmanNode[] {
  const nodes: HuffmanNode[] = [];
  for (let i = 0; i < 256; i++) {
    const left = toSigned16(r16(misc, i * 4, 'le'));
    const right = toSigned16(r16(misc, i * 4 + 2, 'le'));
    nodes.push({ left, right });
  }
  return nodes;
}

function decodeMessage(
  dbs: Uint8Array,
  offset: number,
  tree: HuffmanNode[],
): { text: string; decodedLength: number; compressedLength: number } {
  const decodedLength = dbs[offset];
  const compressedLength = dbs[offset + 1];
  let pos = offset + 2;
  let currentByte = dbs[pos];
  pos += 1;
  let bitsLeft = 8;

  const out: number[] = [];
  for (let i = 0; i < decodedLength; i++) {
    let nodeIndex = 0;
    for (;;) {
      const bit = (currentByte >> 7) & 1;
      currentByte = ((currentByte << 1) | bit) & 0xff;
      const node = tree[nodeIndex];
      const value = bit ? node.right : node.left;
      bitsLeft -= 1;
      if (bitsLeft === 0) {
        currentByte = pos < dbs.length ? dbs[pos] : 0;
        pos += 1;
        bitsLeft = 8;
      }
      if (value < 0) {
        nodeIndex = -value;
        continue;
      }
      out.push(value & 0x7f);
      break;
    }
  }

  const text = out.map((b) => String.fromCharCode(b)).join('');
  return { text, decodedLength, compressedLength };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-msg-text.ts <dataDir>');
    process.exit(1);
  }

  const misc = readBinary(resolve(dataDir, 'misc.hdr'));
  if (misc.length !== 1024) {
    console.warn(`misc.hdr: expected 1024 bytes, got ${misc.length}`);
  }
  const tree = readHuffmanTree(misc);

  const hdr = readBinary(resolve(dataDir, 'msg.hdr'));
  const dbs = readBinary(resolve(dataDir, 'msg.dbs'));

  const count = r16(hdr, 0, 'le');
  interface Record {
    index: number;
    a: number;
    b: number;
    c: number;
    page: number;
    offset: number;
    text: string;
    decodedLength: number;
    compressedLength: number;
  }
  const records: Record[] = [];

  for (let i = 0; i < Math.min(count, RECORD_CAPACITY); i++) {
    const base = 2 + i * 6;
    const a = r16(hdr, base, 'le');
    const b = r16(hdr, base + 2, 'le');
    const c = r16(hdr, base + 4, 'le');
    const page = c & 0xff;
    const offset = page * PAGE_SIZE + b;

    if (offset + 2 > dbs.length) {
      console.warn(`record ${i}: computed offset ${offset} out of bounds, skipping`);
      continue;
    }

    const { text, decodedLength, compressedLength } = decodeMessage(dbs, offset, tree);
    records.push({ index: i, a, b, c, page, offset, text, decodedLength, compressedLength });
  }

  const uniqueOffsets = new Set(records.map((r) => r.offset));
  if (uniqueOffsets.size !== records.length) {
    console.warn(
      `${records.length - uniqueOffsets.size} of ${records.length} records collide on (page,offset) -- confirmed genuine text reuse (field A is a strictly-sorted, zero-duplicate key), see docs/wizardry6/dosega/data-structure.md section 1.8`,
    );
  }

  const printableChars = records.reduce(
    (sum, r) => sum + [...r.text].filter((ch) => ch >= ' ' && ch < '\x7f').length,
    0,
  );
  const totalChars = records.reduce((sum, r) => sum + r.text.length, 0);
  console.log(
    `Decoded ${records.length}/${count} messages, ${uniqueOffsets.size} unique offsets, ` +
      `${((printableChars / totalChars) * 100).toFixed(1)}% printable-ASCII`,
  );

  const outDir = resolve('public/assets/wizardry6/dosega/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'messages.json'), {
    note:
      'msg.dbs decoded via this platform\'s own misc.hdr Huffman tree (little-endian fields; NOT interchangeable with the Amiga tree). offset = (msg.hdr field C low byte) * 1024 + (msg.hdr field B). ' +
      '32/718 records collide on (page,offset) -- confirmed genuine text reuse (field A is a strictly-sorted, zero-duplicate key; every collision pairs distinct A values), see docs/wizardry6/dosega/data-structure.md section 1.8. ' +
      'Field A is a separate lookup ID, not a msg.dbs offset -- see docs/wizardry6/amiga/investigations/scenario-messages-monsters.md.',
    count: records.length,
    messages: records,
  });

  console.log(`Wrote messages.json (${records.length} messages)`);
}

main();
