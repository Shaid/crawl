/**
 * Westwood "Format 80" (LCW) decompression, used by Eye of the Beholder's
 * `.CPS` container (compression type 4) on both DOS and Amiga.
 *
 * Ported directly from the command pseudocode in
 * `docs/eotb/amiga/data-structure.md` § "LCW Decompression" (itself
 * transcribed from ScummVM's real decoder).
 */
export function decompressLCW(src: Uint8Array, expectedSize?: number): Uint8Array {
  const out: number[] = [];
  let sp = 0;

  while (sp < src.length) {
    const cmd = src[sp++]!;
    if (cmd === 0x80) break; // EOF marker (command 1 with count 0)

    if ((cmd & 0x80) === 0) {
      // Command 2: 0xxxyyyy yyyyyyyy -- copy (xxx+3) bytes from out[out.length - pos]
      const count = ((cmd >> 4) & 7) + 3;
      const pos = ((cmd & 0x0f) << 8) | src[sp++]!;
      let from = out.length - pos;
      for (let i = 0; i < count; i++) out.push(out[from++]!);
    } else if ((cmd & 0x40) === 0) {
      // Command 1: 10xxxxxx -- copy xxxxxx literal bytes
      const count = cmd & 0x3f;
      for (let i = 0; i < count; i++) out.push(src[sp++]!);
    } else {
      const sub = cmd & 0x3f;
      if (sub === 0x3e) {
        // Command 4: fill
        const count = src[sp]! | (src[sp + 1]! << 8);
        sp += 2;
        const val = src[sp++]!;
        for (let i = 0; i < count; i++) out.push(val);
      } else if (sub === 0x3f) {
        // Command 5: long copy, absolute position
        const count = src[sp]! | (src[sp + 1]! << 8);
        sp += 2;
        const pos = src[sp]! | (src[sp + 1]! << 8);
        sp += 2;
        for (let i = 0; i < count; i++) out.push(out[pos + i]!);
      } else {
        // Command 3: medium copy, absolute position
        const count = sub + 3;
        const pos = src[sp]! | (src[sp + 1]! << 8);
        sp += 2;
        for (let i = 0; i < count; i++) out.push(out[pos + i]!);
      }
    }
    if (expectedSize !== undefined && out.length >= expectedSize) break;
  }

  return Uint8Array.from(out);
}
