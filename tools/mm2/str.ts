/**
 * MM2 `str.dat` text-string codec.
 *
 * Encoding ported from Vairn/MM2 (`EXTRACTED/docs/07-dat-files-and-formats.md`,
 * `tools/mm2_codec.py`): every byte is transformed with a fixed XOR-0x1C
 * obfuscation — decoded char = `(encoded + 0x1C) & 0xFF` — and byte 0x01 is a
 * newline/line break. The Amiga `str.dat` is 7808 bytes; the GOG PC port's
 * `STR.DAT` decodes to 7707 bytes (a different platform string table, not a
 * decode error).
 *
 * No retail `str.dat` is in this repo — the codec is verified with known
 * answers (e.g. encoded 0x25 decodes to 'A') and synthetic round-trips. Note
 * the transform is not invertible for every byte: encoded 0xE4/0xE5 decode to
 * 0x00/0x01, and 0x01 re-encodes as newline, so byte-exact round-trip is only
 * asserted for the documented text content.
 */

/** Decode a `str.dat` blob to text. 0x01 becomes `\n`. */
export function decodeStr(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0x01) out += '\n';
    else out += String.fromCharCode((b + 0x1c) & 0xff);
  }
  return out;
}

/**
 * Encode text back to the `str.dat` transform. `\n` becomes 0x01; CR from
 * CRLF input is dropped (mirrors the ground-truth encoder). Other characters
 * map to `(code - 0x1C) & 0xFF`.
 */
export function encodeStr(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      out.push(0x01);
    } else if (c === 0x0d) {
      continue;
    } else {
      out.push((c - 0x1c) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
