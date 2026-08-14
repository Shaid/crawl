/**
 * MM2 (Amiga) `globe.32` / `disk.32` codec — XOR-obfuscated string blobs, not
 * image chunks despite the shared `.32` extension.
 *
 * Format documented in Vairn/MM2 (`EXTRACTED/docs/20-copy-protection-table.md`,
 * `06-gfx-loading.md`) and the ASM-anchored reference tool
 * `tools/decode_globe_amiga.py` / `EXTRACTED/decomp/mm2_globe_blob.c`:
 *
 *   - XOR loop at asm `0x2613E` (duplicate `0x263A8`), anchored off `A4`
 *     ($7FFE fixed base): decode the first `xorLen` bytes in place with a
 *     rolling 5-byte key, `data[i] ^= key[i % 5]`.
 *   - The decoded bytes are 7 NUL-terminated string tables, counts
 *     `[14, 18, 7, 15, 17, 10, 23]` (104 strings total) — credits, version
 *     notes, character-screen prompts, disk/hard-drive/RAM help text, and
 *     (table index 6) the copy-protection "look at page N paragraph P line L"
 *     challenge prompt strings.
 *
 * **Key correction:** Vairn's own `decode_globe_amiga.py` ships a default key
 * `f1 29 ab 5a 07`, read as the 5 bytes starting at the literal `DC.L
 * $f129ab5a` in `EXTRACTED/mm2.asm` (~offset 0x26332). That key does **not**
 * decode this repo's retail `data/mm2/amiga/data/globe.32` (0 NUL bytes
 * anywhere in the output — pure noise). Frequency-analysis key recovery
 * (independent per-position brute force over the 5-byte rotation) against
 * the real file converges on `37 f1 29 ab 5a` instead, which is the same 4
 * bytes `f1 29 ab 5a` shifted one position later, preceded by `0x37` — the
 * last byte of the *previous* `DC.L` line in `mm2.asm`
 * (`...$0000ff37 ;26322`). This is consistent with Vairn's key window being
 * off by one byte (an easy mistake reading a literal window out of a raw
 * disassembly dump), not a different key. With `37 f1 29 ab 5a` the decode
 * of the real `globe.32` is clean: exactly 104 NUL terminators, the parse
 * consumes the file to the last byte with nothing left over, and the text is
 * legible ("Might and Magic Book Two", the Amiga port credits, disk-backup
 * and hard-drive-install help, and the "Please look at page ... paragraph
 * ... line ... and type in word" copy-protection prompt in table 6) — see
 * `tools/mm2/__tests__/copy-protection.test.ts`.
 *
 * `disk.32` is documented as "a similar XOR blob" but Vairn does not give its
 * table-count layout, and no retail `disk.32` ships with this repo to
 * recover it from — `decodeXorBlob`/`encodeXorBlob` below XOR-round-trip any
 * such blob, but only `decodeGlobeBlob`'s 7-table layout is confirmed.
 *
 * The separate copy-protection *answer key* (51 records of page/paragraph/
 * line/checksum, `w0`/`w1`/`w2` per `20-copy-protection-table.md`) lives in
 * the game executable's code segment, not in `globe.32` — out of scope here
 * (this repo has no `MM2.exe`/Amiga-executable data extractor).
 */

/** 5-byte rolling XOR key for `globe.32` (see module doc for the correction vs Vairn's script default). */
export const GLOBE_XOR_KEY = Uint8Array.of(0x37, 0xf1, 0x29, 0xab, 0x5a);

/** Max XOR'd prefix length per the ASM loop bound (`cmpi.w #$be1`); real `globe.32` (3034 B) is shorter, so the whole file is covered. */
export const GLOBE_XOR_LEN = 0x0be1;

/** String-table string counts within the decoded `globe.32` blob (14+18+7+15+17+10+23 = 104 strings). Table 6 is the copy-protection challenge prompt text. */
export const GLOBE_TABLE_COUNTS = [14, 18, 7, 15, 17, 10, 23] as const;

/** Reversible rolling-XOR of the first `min(data.length, xorLen)` bytes with `key` (cycled). */
export function xorPrefix(data: Uint8Array, key: Uint8Array, xorLen: number): Uint8Array {
  const out = new Uint8Array(data);
  const n = Math.min(out.length, xorLen);
  for (let i = 0; i < n; i++) {
    out[i] ^= key[i % key.length];
  }
  return out;
}

/** Decode a generic XOR-obfuscated `.32` blob (e.g. `disk.32`) to raw bytes. XOR is symmetric, so this is also the encoder. */
export function decodeXorBlob(data: Uint8Array, key: Uint8Array = GLOBE_XOR_KEY, xorLen: number = GLOBE_XOR_LEN): Uint8Array {
  return xorPrefix(data, key, xorLen);
}

/** Symmetric alias of {@link decodeXorBlob} for call-site clarity when re-obfuscating. */
export const encodeXorBlob = decodeXorBlob;

export interface GlobeBlob {
  /** 7 NUL-terminated string tables, decoded text. */
  tables: string[][];
  /** Byte offset in the decoded blob just past the last table's terminator. */
  parseEndOffset: number;
}

/**
 * Decode `globe.32` (or a compatible blob) to its 7 string tables. Throws if
 * a NUL terminator is missing before the decoded data ends (bad key/blob).
 */
export function decodeGlobeBlob(
  data: Uint8Array,
  key: Uint8Array = GLOBE_XOR_KEY,
  tableCounts: readonly number[] = GLOBE_TABLE_COUNTS,
): GlobeBlob {
  const decoded = xorPrefix(data, key, GLOBE_XOR_LEN);
  const tables: string[][] = [];
  let off = 0;
  for (const count of tableCounts) {
    const table: string[] = [];
    for (let i = 0; i < count; i++) {
      let end = off;
      while (end < decoded.length && decoded[end] !== 0) end++;
      if (end >= decoded.length) {
        throw new Error(`decodeGlobeBlob: unterminated string at offset ${off} (table ${tables.length}, entry ${i})`);
      }
      let s = '';
      for (let j = off; j < end; j++) s += String.fromCharCode(decoded[j]);
      table.push(s);
      off = end + 1;
    }
    tables.push(table);
  }
  return { tables, parseEndOffset: off };
}

/** Re-encode `decodeGlobeBlob`'s tables back to an obfuscated `.32` blob. Round-trips byte-exact when the tables were parsed from the full file (`parseEndOffset === originalLength`). */
export function encodeGlobeBlob(tables: string[][], key: Uint8Array = GLOBE_XOR_KEY): Uint8Array {
  const bytes: number[] = [];
  for (const table of tables) {
    for (const s of table) {
      for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
      bytes.push(0);
    }
  }
  return xorPrefix(Uint8Array.from(bytes), key, GLOBE_XOR_LEN);
}
