/**
 * AGOS engine (Adventure Soft / Horrorsoft) — Amiga/AtariST "old bundle"
 * resource container + VC10 planar image codec.
 *
 * Shared by Elvira: Mistress of the Dark, Elvira II: The Jaws of Cerberus,
 * and Waxworks (all `data/_unexplored_/{Elvira,Elvira2,Waxworks}` in this
 * repo — see `docs/agos-pkd-format.md` for the container-format writeup and
 * `docs/elvira/amiga/data-structure.md` / `docs/elvira2/amiga/data-structure.md`
 * / `docs/waxworks/amiga/data-structure.md` for the per-game specs).
 *
 * Ground truth: ScummVM's `engines/agos/` source (GPLv3, MIT-compatible
 * reference — read directly, not reimplemented from a fan doc):
 *  - `res_ami.cpp` (`convertAmigaImage`/`convertCompressedImage`/
 *    `uncompressPlane`/`bitplaneToChunky`) — the planar->chunky conversion.
 *  - `vga.cpp:drawImage_init` — anim-table entry layout + compressed/
 *    uncompressed dispatch.
 *  - `vga_e2.cpp:setPaletteSlot` (the *live*, in-game VC opcode 46/47/48
 *    handler — NOT the debug-only `dumpVgaBitmaps`/`palLoad` in `debug.cpp`,
 *    though both independently agree) — palette load + RGB scale.
 *  - `scummvm-tools/engines/agos/extract_agos.cpp` (`simon_decr`) — the
 *    backward-reading bit-oriented LZ77 decompressor for `.pkd`/`.out`
 *    "old bundle" resource files.
 *
 * `simonDecr` is verified byte-exact-clean-decode (no bounds errors, no
 * checksum needed — the format has none) against every `.pkd` file in all
 * three games' corpora: 130/130 Elvira 1, 200/200 Elvira 2, 298/298
 * Waxworks (see the per-game export scripts' console output). The SAME
 * decoder handles all three — the probe recon's "Elvira 2 has a different
 * .pkd header" turned out to be normal compressed-content variance, not a
 * different container format (see the `elvira2` data-structure doc's
 * "Container format" section).
 */

// ---------------------------------------------------------------------------
// Container: "simon_decr" backward-reading bit-oriented LZ77.
// ---------------------------------------------------------------------------

/**
 * Decompress one AGOS Amiga/AtariST "old bundle" `.pkd`/`.out` resource.
 * Ported 1:1 from `scummvm-tools/engines/agos/extract_agos.cpp`'s
 * `simon_decr` (bit-for-bit, including its backward read direction).
 *
 * The last 4 bytes of `src` are a big-endian u32 giving the exact
 * decompressed length. Decoding writes `dest` from the END backward; the
 * compressed bitstream is also consumed backward (bits packed MSB-first
 * into big-endian u32 words, read starting 8 bytes before EOF).
 */
export function simonDecr(src: Uint8Array): Uint8Array {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const srclen = src.length;
  let s = srclen - 4;
  const destlen = view.getUint32(s, false);
  const dest = new Uint8Array(destlen);
  let d = destlen;

  s -= 4;
  let bb = view.getUint32(s, false);
  let bits = 0;
  let xx = bb;
  while (xx) {
    xx = xx >>> 1;
    bits++;
  }
  bits--;

  function getbit(): number {
    if (bits === 0) {
      s -= 4;
      if (s < 0) throw new Error('simonDecr: buffer underrun (malformed stream)');
      bb = view.getUint32(s, false);
      bits = 31;
    } else {
      bits--;
    }
    const bit = bb & 1;
    bb = bb >>> 1;
    return bit;
  }
  function getbits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) val = (val << 1) | getbit();
    return val >>> 0;
  }

  while (d > 0) {
    const bit = getbit();
    let literal: boolean;
    let nbits: number;
    let y: number;
    if (bit) {
      const code = getbits(2);
      if (code === 0) { literal = false; nbits = 9; y = 2; }
      else if (code === 1) { literal = false; nbits = 10; y = 3; }
      else if (code === 2) { literal = false; nbits = 12; y = getbits(8); }
      else { literal = true; nbits = 8; y = 8; }
    } else {
      if (getbit()) { literal = false; nbits = 8; y = 1; }
      else { literal = true; nbits = 3; y = 0; }
    }

    if (literal) {
      y += getbits(nbits);
      if (y + 1 > d) throw new Error('simonDecr: literal run overflow');
      const count = y + 1;
      for (let i = 0; i < count; i++) {
        dest[--d] = getbits(8);
      }
    } else {
      if (y + 1 > d) throw new Error('simonDecr: match overflow (pre-offset)');
      const off = getbits(nbits);
      if (d + off > destlen) throw new Error('simonDecr: match offset overflow');
      const count = y + 1;
      for (let i = 0; i < count; i++) {
        d -= 1;
        dest[d] = dest[d + off];
      }
    }
  }
  return dest;
}

/** `%.2d%d.pkd` (Elvira 1/2) or `%.3d%d.pkd` (Waxworks) — see loadVGAVideoFile's GF_OLD_BUNDLE Amiga branch. */
export type AgosNamingScheme = 'elvira' | 'waxworks';

export function pkdFilename(scheme: AgosNamingScheme, zone: number, type: number): string {
  const zoneStr = scheme === 'elvira' ? String(zone).padStart(2, '0') : String(zone).padStart(3, '0');
  return `${zoneStr}${type}.pkd`;
}

// ---------------------------------------------------------------------------
// Palette — `setPaletteSlot` (vga_e2.cpp) / `palLoad` (debug.cpp), both
// GType_ELVIRA1 || GType_ELVIRA2 || GType_WW || GType_PN branch.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number; }

/**
 * Read `count` (default 32) consecutive Amiga 12-bit RGB colour words
 * from `vga1` (a decompressed "type 1" resource), starting at
 * `vga1 + BE16(vga1+6) + bank*32`.
 *
 * Scale is `nibble * 32`, truncated to a byte (matches the ScummVM source
 * literally — confirmed via TWO independent live code paths, not just the
 * debug dumper: `vga_e2.cpp`'s `setPaletteSlot` [the actual VC opcode
 * 46/47/48 handler used during real gameplay] and `debug.cpp`'s `palLoad`.
 * Visually verified: rendering with this exact scale (vs. the more
 * "obvious" `nibble*17` linear 4-to-8-bit expansion) produces a coherent,
 * recognizable jungle/swamp scene — see `docs/elvira/amiga/data-structure.md`
 * §Palette for the swatch comparison that ruled out `nibble*17`).
 */
export function loadPalette(vga1: Uint8Array, bank = 0, count = 32): RGB[] {
  const view = new DataView(vga1.buffer, vga1.byteOffset, vga1.byteLength);
  const pOff = view.getUint16(6, false);
  const colors: RGB[] = [];
  for (let i = 0; i < count; i++) {
    const off = pOff + bank * 32 + i * 2;
    const word = view.getUint16(off, false);
    colors.push({
      r: (((word & 0xf00) >> 8) * 32) & 0xff,
      g: (((word & 0x0f0) >> 4) * 32) & 0xff,
      b: (((word & 0x00f) >> 0) * 32) & 0xff,
    });
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Picture: anim table + VC10 planar->chunky image codec.
// ---------------------------------------------------------------------------

export interface AnimTableEntry {
  index: number;
  offset: number;
  width: number; // full pixel width
  height: number;
  flags: number;
  compressed: boolean;
}

/**
 * Walk a "type 2" resource's animation table. Entry 0 is always a reserved/
 * unused all-zero placeholder (see `dumpVgaBitmaps`, `debug.cpp:658-680` —
 * it starts iterating at index 1); entry 1's own `offset` field doubles as
 * the table's total byte span (the first real image's pixel data always
 * begins immediately after the last table entry, so no separate
 * "table size" field is stored). Walk stops at the first entry whose
 * `offset` is out of bounds or whose width/height is 0.
 */
export function readAnimTable(vga2: Uint8Array): AnimTableEntry[] {
  const view = new DataView(vga2.buffer, vga2.byteOffset, vga2.byteLength);
  const entries: AnimTableEntry[] = [];
  if (vga2.length < 16) return entries;
  const offsEnd = view.getUint32(8, false);
  for (let i = 1; i * 8 < offsEnd; i++) {
    const entryOff = i * 8;
    if (entryOff + 8 > vga2.length) break;
    const offset = view.getUint32(entryOff, false);
    const widthField = view.getUint16(entryOff + 6, false);
    const height = vga2[entryOff + 5];
    const flags = vga2[entryOff + 4];
    const width = Math.floor(widthField / 16) * 16;
    if (offset >= vga2.length || width === 0 || height === 0) break;
    entries.push({ index: i, offset, width, height, flags, compressed: (flags & 0x80) !== 0 });
  }
  return entries;
}

/** PackBits-style RLE over 16-bit big-endian words (`uncompressPlane`, res_ami.cpp). */
function uncompressPlane(plane: Uint8Array, offset: number, outLenWords: number): Uint16Array {
  const view = new DataView(plane.buffer, plane.byteOffset, plane.byteLength);
  const out = new Uint16Array(outLenWords);
  let oi = 0;
  let p = offset;
  let remaining = outLenWords;
  while (remaining !== 0) {
    const x = view.getInt8(p);
    p += 1;
    let wordlen: number;
    if (x >= 0) {
      wordlen = Math.min(x + 1, remaining);
      const w = view.getUint16(p, false);
      p += 2;
      for (let i = 0; i < wordlen; i++) out[oi++] = w;
    } else {
      wordlen = Math.min(-x, remaining);
      for (let i = 0; i < wordlen; i++) {
        out[oi++] = view.getUint16(p, false);
        p += 2;
      }
    }
    remaining -= wordlen;
  }
  return out;
}

/** `bitplaneToChunky` (res_ami.cpp) — colorDepth<=4: 8 pixels -> 8 packed 2px/byte output bytes. */
function bitplaneToChunky(words: Uint16Array, colorDepth: number, out: Uint8Array, outOff: number): void {
  let oi = outOff;
  for (let j = 0; j < 8; j++) {
    let color1 = 0, color2 = 0;
    for (let p = 0; p < colorDepth; p++) {
      if (words[p] & 0x8000) color1 |= 1 << p;
      if (words[p] & 0x4000) color2 |= 1 << p;
      words[p] = (words[p] << 2) & 0xffff;
    }
    if (colorDepth > 4) {
      out[oi++] = color1;
      out[oi++] = color2;
    } else {
      out[oi++] = (color1 << 4) | color2;
    }
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major, 2 pixels/byte (high nibble = left pixel). `rowStride` bytes/row. */
  packed: Uint8Array;
  rowStride: number;
}

/**
 * Decode one image's pixel data (`convertAmigaImage`, res_ami.cpp), given
 * `src` = the resource positioned at the anim-table entry's own `offset`
 * (i.e. `vga2.subarray(entry.offset)`).
 *
 * colorDepth is always 4 (16 colours) for Elvira/Elvira2/Waxworks — the
 * 5-plane branch in the real source is `GType_SIMON1`-only.
 *
 * Two distinct source layouts, exactly as ScummVM decodes them:
 *  - compressed (flags&0x80): a per-plane pointer table (4 x [u16,u16],
 *    summed to a byte offset) into 4 independently-RLE-compressed
 *    bitplanes, reassembled in COLUMN-MAJOR (vertical 16px-strip) order —
 *    NOT plain row-major (see `ported-fill-loop-moving-base-pointer.md`).
 *  - uncompressed: 4 planes' words INTERLEAVED per source position (not
 *    stored as 4 contiguous per-plane blocks), consumed and written in
 *    plain row-major order (drawImage_init's `else` branch has no
 *    reassembly pass at all).
 */
export function decodeImage(src: Uint8Array, width: number, height: number, compressed: boolean, colorDepth = 4): DecodedImage {
  const wordsPerRow = Math.ceil(width / 16);
  const length = wordsPerRow * height;
  const chunkSize = colorDepth > 4 ? 16 : 8;
  const rowStride = (width * chunkSize) / 16;
  const packed = new Uint8Array(rowStride * height);

  if (compressed) {
    const srcView = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const planeWords: Uint16Array[] = [];
    for (let i = 0; i < colorDepth; i++) {
      const o1 = srcView.getUint16(i * 4, false);
      const o2 = srcView.getUint16(i * 4 + 2, false);
      planeWords.push(uncompressPlane(src, o1 + o2, length));
    }
    const uncbfrout = new Uint8Array(length * chunkSize);
    const words = new Uint16Array(colorDepth);
    for (let i = 0; i < length; i++) {
      for (let j = 0; j < colorDepth; j++) words[j] = planeWords[j][i];
      bitplaneToChunky(words, colorDepth, uncbfrout, i * chunkSize);
    }
    // Reassembly, non-GType_PN order: outer = column (16px strip), inner = row.
    let srcPos = 0;
    const wBlocks = Math.floor(width / 16);
    for (let i = 0; i < wBlocks; i++) {
      for (let j = 0; j < height; j++) {
        packed.set(uncbfrout.subarray(srcPos, srcPos + chunkSize), rowStride * j + chunkSize * i);
        srcPos += chunkSize;
      }
    }
  } else {
    const srcView = new DataView(src.buffer, src.byteOffset, src.byteLength);
    let p = 0;
    const words = new Uint16Array(colorDepth);
    for (let i = 0; i < length; i++) {
      for (let j = 0; j < colorDepth; j++) {
        words[j] = srcView.getUint16(p, false);
        p += 2;
      }
      bitplaneToChunky(words, colorDepth, packed, i * chunkSize);
    }
  }

  return { width, height, packed, rowStride };
}

/** Unpack a 2px/byte row-major buffer into one palette-index byte per pixel (high nibble = left). */
export function unpackIndices(img: DecodedImage): Uint8Array {
  const { width, height, packed, rowStride } = img;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = packed[y * rowStride + (x >> 1)] ?? 0;
      out[y * width + x] = x % 2 === 0 ? b >> 4 : b & 15;
    }
  }
  return out;
}

/** Palette-index buffer -> RGBA8888. */
export function indicesToRGBA(indices: Uint8Array, palette: RGB[]): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = palette[indices[i]] ?? { r: 255, g: 0, b: 255 };
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Zone discovery — shared by Elvira 1/2 (2-digit zone) and Waxworks
// (3-digit zone). A "zone" is one `loadVGAVideoFile(id, type)` id: type 1 =
// vga1 (palette + object/script data), type 2 = vga2 (image anim table +
// pixel data), type 3 = a `.out`/`.OUT` sound-effect resource (undecoded —
// see the per-game TODO.md).
// ---------------------------------------------------------------------------

export interface AgosZoneFiles {
  zone: number;
  type1?: string;
  type2?: string;
  type3?: string;
}

/**
 * Scan `dataDir` for `.pkd`/`.out` "old bundle" resource files and group
 * them by zone id. `scheme` picks the digit width ScummVM's
 * `loadVGAVideoFile` uses for this game's filename convention (see
 * `pkdFilename`'s doc).
 */
export function discoverZones(files: string[], scheme: AgosNamingScheme): AgosZoneFiles[] {
  const zoneDigits = scheme === 'elvira' ? 2 : 3;
  const re = new RegExp(`^(\\d{${zoneDigits}})(\\d)\\.(pkd|out)$`, 'i');
  const byZone = new Map<number, AgosZoneFiles>();
  for (const f of files) {
    const m = re.exec(f);
    if (!m) continue;
    const zone = parseInt(m[1], 10);
    const type = parseInt(m[2], 10);
    let entry = byZone.get(zone);
    if (!entry) {
      entry = { zone };
      byZone.set(zone, entry);
    }
    if (type === 1) entry.type1 = f;
    else if (type === 2) entry.type2 = f;
    else if (type === 3) entry.type3 = f;
  }
  return [...byZone.values()].sort((a, b) => a.zone - b.zone);
}
