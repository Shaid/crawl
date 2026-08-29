/**
 * Eye of the Beholder decoration-definition file decoder -- the format
 * `EoBCoreEngine::loadDecorations`/`getDecDefinitions` reads (`engines/
 * kyra/engine/scene_eob.cpp:421-464`, fetched from `github.com/scummvm/
 * scummvm`). `docs/eotb/amiga/data-structure.md` already documents this
 * exact 52-byte-record + 8-byte-rect layout for **EOB2's `.DEC` files**
 * (`getDecDefinitions` reads via `createEndianAwareReadStream(file,
 * Resource::kForceLE)` -- forced little-endian regardless of platform).
 *
 * **This module is the same decoder pointed at EOB1's `.DAT` files.**
 * `docs/eotb/TODO.md`'s `eotb1-amiga-dec-verify` item closed EOB1's own
 * `.DEC` format as "confirmed from source, unverifiable -- no `.DEC` file
 * exists anywhere in this game's corpus" -- true for the literal `.DEC`
 * extension, but that closure missed that EOB1's real per-level decoration
 * data ships under a **different extension**: `initLevelData`'s decoded
 * `.INF` wall-mapping/decoration-load record stream (`decode-inf.ts`)
 * calls `loadDecorations(cpsFile, decFile)` with real, on-disk `decFile`
 * values of `brick.dat`/`blue.dat`/`drow.dat`/`green.dat`/`xanatha.dat` --
 * i.e. this project's already-catalogued (but previously undecoded)
 * "Wall Set DAT Files" (`docs/eotb/amiga/data-structure.md` § "DAT --
 * Data Files" -> "Wall Set DAT Files (EOB1)"). Verified byte-exact: this
 * decoder consumes **every** byte of all 5 real files with zero residue
 * (`BRICK.DAT` 4540, `BLUE.DAT` 3228, `DROW.DAT` 2744, `GREEN.DAT` 2820,
 * `XANATHA.DAT` 2096 -- `dataSize`/`rectCount`-derived end position lands
 * exactly on EOF in every case).
 */

function s16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** One `LevelDecorationProperty` record (`scene_eob.cpp:437-450`). */
export interface DecorationProperty {
  /** Index into `rects`/the decoration CPS's shape sheet, per screen-depth slot (0-9); `0xFFFF` = "no shape at this slot". */
  shapeIndex: number[]; // length 10
  /** 0 = end of chain; nonzero = index of the next `DecorationProperty` in this same array to draw alongside this one (`assignWallsAndDecorations`'s do-while). */
  next: number;
  flags: number;
  /** Per screen-depth-slot on-screen X offset (added to the resolved cell's `_dscShapeX` translation -- see `resolveWallDecorations` in `decode-inf.ts`). */
  shapeX: number[]; // length 10, signed
  /** Per screen-depth-slot on-screen Y (viewport-absolute, no per-cell translation applied). */
  shapeY: number[]; // length 10, signed
}

/** One `EoBRect8` shape-sheet crop rectangle (`scene_eob.cpp:452-461`) -- pixel coordinates into the paired decoration CPS's 320x200 canvas. */
export interface DecorationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DecorationData {
  properties: DecorationProperty[];
  rects: DecorationRect[];
}

/** Parse a `.DAT` (EOB1) / `.DEC` (EOB2) decoration-definition file. Forced little-endian regardless of platform, per `getDecDefinitions`. */
export function decodeDecorations(data: Uint8Array): DecorationData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  const dataSize = view.getUint16(pos, true);
  pos += 2;
  const properties: DecorationProperty[] = [];
  for (let i = 0; i < dataSize; i++) {
    const shapeIndex: number[] = [];
    for (let j = 0; j < 10; j++) {
      const b = data[pos]!;
      pos += 1;
      shapeIndex.push(b === 0xff ? 0xffff : b);
    }
    const next = data[pos]!;
    pos += 1;
    const flags = data[pos]!;
    pos += 1;
    const shapeX: number[] = [];
    for (let j = 0; j < 10; j++) {
      shapeX.push(s16(view.getUint16(pos, true)));
      pos += 2;
    }
    const shapeY: number[] = [];
    for (let j = 0; j < 10; j++) {
      shapeY.push(s16(view.getUint16(pos, true)));
      pos += 2;
    }
    properties.push({ shapeIndex, next, flags, shapeX, shapeY });
  }

  const rectCount = view.getUint16(pos, true);
  pos += 2;
  const rects: DecorationRect[] = [];
  for (let i = 0; i < rectCount; i++) {
    const x = view.getUint16(pos, true);
    pos += 2;
    const y = view.getUint16(pos, true);
    pos += 2;
    const w = view.getUint16(pos, true);
    pos += 2;
    const h = view.getUint16(pos, true);
    pos += 2;
    rects.push({ x, y, w, h });
  }

  if (pos !== data.length) {
    throw new Error(`decodeDecorations: oracle check failed -- parsed ${pos} bytes, expected exactly ${data.length} (0 residue)`);
  }

  return { properties, rects };
}

/**
 * Follow `assignWallsAndDecorations`'s do-while chain (`scene_eob.cpp:
 * 488-519`) from a starting `decIndex` (as stored in an `.INF`
 * wall-mapping override record) to the full ordered list of
 * `DecorationProperty` records drawn together for that wall. `next == 0`
 * always terminates the chain (even though 0 is itself a valid absolute
 * `decIndex` for the *first* element) -- this matches the source exactly,
 * not a bug in this port.
 */
export function decorationChain(dec: DecorationData, startDecIndex: number): DecorationProperty[] {
  if (startDecIndex < 0) return [];
  const chain: DecorationProperty[] = [];
  let decIndex = startDecIndex;
  const seen = new Set<number>(); // guard against a malformed cyclic chain; never observed in the real corpus.
  while (decIndex >= 0 && decIndex < dec.properties.length && !seen.has(decIndex)) {
    seen.add(decIndex);
    const rec = dec.properties[decIndex]!;
    chain.push(rec);
    if (rec.next === 0) break;
    decIndex = rec.next;
  }
  return chain;
}
