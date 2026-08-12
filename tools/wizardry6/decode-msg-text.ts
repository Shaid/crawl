/**
 * Decodes Wizardry 6 (Amiga) `msg.dbs`, the Huffman-compressed message/
 * text-fragment blob indexed by `msg.hdr`.
 *
 * See docs/wizardry6/amiga/investigations/scenario-messages-monsters.md
 * ("Target 1: msg.dbs text extraction") for the full derivation. Summary:
 *
 * - `misc.hdr` (1024 bytes) is a 256-node Huffman bit-tree: 2x BE i16 per
 *   node (left child, right child). A negative value is an internal-node
 *   back-reference (`nextNode = -value`, i.e. the node-index table, NOT a
 *   byte offset -- misc.hdr's on-disk stride is 4 bytes/node but the
 *   decoder computes byte offsets as `-value*4`, which is exactly
 *   `nodeIndex*4`). A non-negative value (bit 7 clear, 0x00-0x7F) is a
 *   leaf: the literal output byte. Traced from `Bane` CODE+0x2a8a-0x2ad0.
 *
 * - `msg.hdr` (5102 bytes = 2-byte count + 850 x 6-byte records) stores,
 *   per record, three BE u16 fields (A, B, C):
 *     - A: a monotonically increasing "trigger ID" or ID-range start (not
 *       used by this extractor -- it's the key `Bane`'s binary-search
 *       lookup (CODE+0x730) uses to map an arbitrary in-game message ID to
 *       a record; confirmed via disassembly, not decoded further here).
 *     - B: byte offset of this message's compressed data, RELATIVE TO THE
 *       START OF A 1024-BYTE PAGE within msg.dbs (msg.dbs is exactly
 *       81920 = 80 x 1024 bytes).
 *     - C: high byte = unused by this extractor; LOW byte = the page
 *       number (0-79). Confirmed: grouping all 724 real records by C's low
 *       byte yields exactly the page range 0-79 with every B < 1024 in its
 *       page -- i.e. `offset = (C & 0xFF) * 1024 + B` is a byte-exact,
 *       collision-free map onto msg.dbs (724 unique offsets for 724
 *       records, zero collisions).
 *
 * - At that offset, each message is stored as:
 *     +0  u8  decoded character count (L) -- the Huffman driver's own
 *             loop counter (`Bane` CODE+0x2a72, `clr.l d2; move.b (a1)+,d2`)
 *     +1  u8  compressed byte count (informational; NOT needed to decode,
 *             since the driver's tree walk is self-terminating on L
 *             output symbols -- but its presence here is what makes
 *             `offset+2` rather than `offset+1` the real bitstream start)
 *     +2  ..  Huffman bitstream, MSB-first per byte, tree walked once per
 *             output byte until L bytes have been produced
 *
 *   The "+1 mystery byte" was found empirically: decoding straight from
 *   `offset+1` (i.e. treating the driver's own length-byte read as
 *   immediately followed by the bitstream, with no second header byte)
 *   produces mostly-legible text with a short garbled prefix on almost
 *   every message (Huffman bitstreams partially resynchronize after a
 *   misaligned start, which is what made the bug non-obvious). Skipping
 *   one extra byte before the bitstream removes the corruption on every
 *   sampled message and produces clean, recognisable English throughout
 *   ("INVOKE THE POWE[R]", "WARNING! THIS CHARACTER", "YOU ARE NOT
 *   ELIGIBLE", "APPROACHING THE GATE WI[TH]", dungeon flavour text, etc.).
 *   That extra byte's own value tracks roughly with L (proportionally
 *   larger for longer messages), consistent with it being the compressed
 *   byte count -- plausibly the same field the `Bane` position-computing
 *   loop at CODE+0x8c4-0x90c walks message-to-message within a page
 *   (`pos += table[pos] + 1`), though that loop was not traced to full
 *   confirmation (see the investigation doc's "still open" notes).
 *
 * Many decoded records are lowercase internal script tokens rather than
 * player-facing text (e.g. `^_ouch_^`, `who_drinks`, `disk_options`) --
 * expected, since `misc.hdr`'s single shared alphabet covers both. Some
 * messages end mid-word: they are short flavour-text FRAGMENTS (the
 * decoded length is exactly what msg.hdr says), not truncation bugs --
 * Wizardry's dialogue engine builds full sentences by concatenating
 * fragments with runtime-substituted names/items.
 *
 * Usage: npx tsx tools/wizardry6/decode-msg-text.ts <dataDir>
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

function readHuffmanTree(misc: Uint8Array): HuffmanNode[] {
  const nodes: HuffmanNode[] = [];
  for (let i = 0; i < 256; i++) {
    const left = toSigned16(r16(misc, i * 4, 'be'));
    const right = toSigned16(r16(misc, i * 4 + 2, 'be'));
    nodes.push({ left, right });
  }
  return nodes;
}

function toSigned16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Decode one message starting at `offset` in msg.dbs:
 *   +0 u8 decoded length L
 *   +1 u8 compressed byte length (skipped, not needed for decode)
 *   +2.. Huffman bitstream, MSB-first, tree-walked once per output byte
 */
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

  // Decode raw byte values as Latin-1 so any control-code bytes round-trip
  // losslessly through JSON rather than being silently dropped/mangled.
  const text = out.map((b) => String.fromCharCode(b)).join('');
  return { text, decodedLength, compressedLength };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-msg-text.ts <dataDir>');
    process.exit(1);
  }

  const misc = readBinary(resolve(dataDir, 'misc.hdr'));
  if (misc.length !== 1024) {
    console.warn(`misc.hdr: expected 1024 bytes, got ${misc.length}`);
  }
  const tree = readHuffmanTree(misc);

  const hdr = readBinary(resolve(dataDir, 'msg.hdr'));
  const dbs = readBinary(resolve(dataDir, 'msg.dbs'));

  const count = r16(hdr, 0, 'be');
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
    const a = r16(hdr, base, 'be');
    const b = r16(hdr, base + 2, 'be');
    const c = r16(hdr, base + 4, 'be');
    const page = c & 0xff;
    const offset = page * PAGE_SIZE + b;

    if (offset + 2 > dbs.length) {
      console.warn(`record ${i}: computed offset ${offset} out of bounds, skipping`);
      continue;
    }

    const { text, decodedLength, compressedLength } = decodeMessage(dbs, offset, tree);
    records.push({ index: i, a, b, c, page, offset, text, decodedLength, compressedLength });
  }

  // Structural verification: every record's (page, b) -> offset mapping
  // must be unique (no two messages sharing a start position by accident).
  const uniqueOffsets = new Set(records.map((r) => r.offset));
  if (uniqueOffsets.size !== records.length) {
    console.warn(
      `WARNING: ${records.length} records but only ${uniqueOffsets.size} unique msg.dbs offsets`,
    );
  }

  const printableChars = records.reduce(
    (sum, r) => sum + [...r.text].filter((ch) => ch >= ' ' && ch < '\x7f').length,
    0,
  );
  const totalChars = records.reduce((sum, r) => sum + r.text.length, 0);
  console.log(
    `Decoded ${records.length}/${count} messages, ${uniqueOffsets.size} unique offsets, ` +
      `${((printableChars / totalChars) * 100).toFixed(1)}% printable-ASCII chars`,
  );

  const outDir = resolve('public/assets/wizardry6/amiga/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'messages.json'), {
    note:
      'msg.dbs decoded via misc.hdr Huffman tree. offset = (msg.hdr field C low byte) * 1024 + (msg.hdr field B). ' +
      'Field A (not stored here) is a separate lookup ID, not a msg.dbs offset -- see ' +
      'docs/wizardry6/amiga/investigations/scenario-messages-monsters.md. Many entries are internal ' +
      'lowercase script tokens (e.g. "who_drinks") rather than player-facing text; some end mid-word ' +
      '(short flavour-text fragments, not truncation).',
    count: records.length,
    messages: records,
  });

  console.log(`Wrote messages.json (${records.length} messages)`);
}

main();
