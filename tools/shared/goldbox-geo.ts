/**
 * "GEO" — the SSI Gold Box engine's per-level 16x16 dungeon/city square grid.
 *
 * Present in all four sibling titles staged in this repo: Pool of Radiance's
 * `geo.dax` (Amiga `.dax` container, `tools/poolofradiance/amiga/dax.ts`) and
 * the three GLIB-based titles' `GEO.GLB` (a top-level, uncompressed "DATA"-
 * tagged container — see `docs/goldbox-glib-format.md` §0/§5: top-level GLIB
 * containers are always stored, never compressed, so `readBlock` gives the
 * real bytes directly with no decompression step).
 *
 * CONFIRMED structure (`docs/goldbox-glib-format.md` §7 / each title's
 * `data-structure.md` has the exact per-file counts):
 *
 * Every GEO entry/block is a **fixed 1024-byte record**, one per playable
 * map/level (PoR: 29 entries, all exactly `2 + 1024` bytes decompressed —
 * the leading 2 bytes are a CONSTANT `0x0004` tag on every single entry, not
 * per-level data, and are skipped by `decodeGeoRecord` below; the three GLIB
 * titles' `GEO.GLB` blocks are exactly 1024 bytes with no such prefix at
 * all). 1024 = 4 * 256 = four consecutive 256-byte PLANES over a 16x16 grid
 * (256 cells), NOT four interleaved bytes per cell — the planar reading was
 * confirmed empirically: interleaving produces spatially incoherent byte
 * grids, while the four-plane reading produces four clearly distinct,
 * spatially coherent data classes (see below). Cell index = `y*16 + x`,
 * row-major.
 *
 * ## Format, SOLVED end-to-end (2026-08-31, `re-oracle` escalation)
 *
 * The escalation found the actual DOS *Curse of the Azure Bonds* executable
 * decompiled by `simeonpilgrim/coab` (same author/technique as the
 * already-trusted `pooldata.py`) and confirmed the Amiga ports run the same
 * engine by locating 4 of its constant tables BYTE-EXACT inside
 * `data/poolofradiance/amiga/program` (file-relative offsets):
 * `symbol_set_fix` at `+0x6D53E`, `MapDirectionXDelta`/`MapDirectionYDelta`
 * at `+0x6D552`/`+0x6D55B`, and the renderer's 10-view `idxOffset` table at
 * `+0x40E8B`. Sources cited below: `Classes/GeoBlock.cs` (`MapInfo`),
 * `engine/ovr031.cs` (`draw_3D_8x8_titles`, `WallDoorFlagsGet`,
 * `getMap_wall_type`, `LoadWalldef`, `Load3DMap`), `engine/ovr015.cs`
 * (`MapSetDoorUnlocked`, move/bash handlers), `engine/ovr008.cs:655-684`
 * (ECL wallset-slot globals), `engine/ovr038.cs` (`Put8x8Symbol`/`Load8x8D`).
 *
 * - **Planes 0/1 — CONFIRMED wall-art TYPE per direction** (bytes 0-255 =
 *   plane 0, 256-511 = plane 1). Each byte packs two 4-bit fields: plane 0's
 *   high nibble = North wall type, low nibble = East; plane 1's high nibble
 *   = South, low nibble = West (same N/E/S/W direction convention as plane
 *   3 below — dir 0=N, 2=E, 4=S, 6=W per the byte-exact `MapDirection*Delta`
 *   tables). Value **0 = no wall drawn on that side** (always passable,
 *   regardless of plane 3). Value **1-15** indexes a **level-scoped**
 *   3-slot x 5-slice wallset table: `wallsetSlot = floor((n-1)/5)` (0-2),
 *   `slice = (n-1)%5` selects the slice-th 156-byte WALLDEF wall-slice
 *   record of whichever wallset is currently loaded into that slot
 *   (`ovr031.cs:152-153`). **Which WALLDEF resource occupies each of the 3
 *   slots is per-level runtime/area-setup state, written by ECL bytecode**
 *   (VM globals `0x322/0x324/0x326`, `value & 0x7F` = WALLDEF block id ->
 *   `LoadWalldef(slot, id)`, `ovr008.cs:655-684`) — it is NOT present
 *   anywhere in the GEO record itself. This is the missing indirection layer
 *   that defeated all three static hypotheses tried before the escalation
 *   (see "Paths tried" below): the per-cell nibble names a SLICE, not a
 *   resource id, so no static mapping from nibble value straight to a
 *   WALLDEF texture is possible without also decoding each level's ECL
 *   script. `wallSlotSlice()` below exposes the (slot, slice) decomposition;
 *   `wallTypeFor`/`GeoCell.wallN` etc. expose the raw 0-15 type.
 *
 *   Each cell stores only its OWN four visible faces — the two sides of a
 *   shared wall are independent per-cell values (`Draw3dWorldFar/Mid/Near`
 *   read `getMap_wall_type(dir, viewedCell)` for the front face and the
 *   flanking cells' own values for the sides), so wall-art-type agreement
 *   across a shared edge is not guaranteed or expected (unlike plane 3's
 *   presence/passability signal, which the engine does treat as gated by
 *   presence — see the plane-3 correction below).
 *
 * - **Plane 3 (bytes 768-1023) — CONFIRMED door/passability code, CORRECTED
 *   value semantics.** Same N/E/S/W 2-bit packing as originally found
 *   (bits[0:2]=N, bits[2:4]=E, bits[4:6]=S, bits[6:8]=W), but the VALUE
 *   labels from the first pass were backwards, per `WallDoorFlagsGet`
 *   (`ovr031.cs:181`), `MapSetDoorUnlocked` (`ovr015.cs:7` — UNLOCKING
 *   WRITES 1), the move handler (`ovr015.cs:~481`), and bash logic:
 *
 *   | Code | Meaning |
 *   |---|---|
 *   | 0 | **solid/blocked** (an ordinary impassable wall) |
 *   | 1 | **passable** (open arch, false wall, or an unlocked/opened door) |
 *   | 2 | locked door (Bash/Pick/Knock) |
 *   | 3 | locked door, unpickable (Bash/Knock only) |
 *
 *   Critically, **this code is only consulted where the SAME direction's
 *   plane 0/1 wall type is non-zero.** If wall type == 0 for a direction,
 *   that edge is unconditionally passable no matter what plane 3 says (an
 *   engine-level coupling confirmed corpus-wide: plane-3 door codes != 0
 *   with no matching wall art are near-nonexistent — 88/16,896 in PoR,
 *   3/5,168 in Secret's field count, 13 in Pools, 59 in Curse). The original
 *   self-consistency oracle (shared-wall PRESENCE agreement, value-symmetric
 *   so blind to which value means what) still stands as the evidence for
 *   the N/E/S/W bit assignment: 90-97% agreement across all four titles —
 *   only the 0/1/2/3 meaning was inverted, not the bit layout. See
 *   `game-re-lessons/format-doc-semantic-labels-swapped.md`.
 *
 *   `isBlocked()`/`isDoor()` below implement the corrected rule; the old
 *   `isPassable(code)` (which assumed 0=open, 2=door, ignoring wall type
 *   entirely) is REMOVED — any caller using plane 3 alone silently walked
 *   through most real walls (59-66% of wall-art edges have door-code 0).
 *
 * - **Plane 2 (bytes 512-767) — CONFIRMED (source-backed) `mapWallRoof`
 *   byte**, exposed verbatim to ECL bytecode (VM read location 4). Bit 7 =
 *   roofed/indoor (selects indoor vs outdoor sky colour, `ovr029.cs:21-32`;
 *   set on 47-86% of cells depending on title), bit 6 = city special-tile
 *   flag (`ovr011.cs:518`), low bits = zone/special-square id consumed by
 *   ECL scripts. NOT used by the walker (no lighting/sky-colour distinction
 *   implemented). Exposed as `GeoCell.special`.
 *
 * - **`caob-tile-bank-index-unit` (`docs/goldbox-glib-format.md` §5.6)
 *   resolved as a byproduct**: `Put8x8Symbol` (`ovr038.cs`) defines a global
 *   8x8-glyph symbol-id space — 0 invalid, 1-0x2D universal (45 ids), then
 *   70 ids per wallset slot (`0x2E-0x73`, `0x74-0xB9`, `0xBA-0xFF`) — matching
 *   §5.6's `1+45+70k` block arithmetic exactly. A WALLDEF tile byte indexes
 *   one whole bank BLOCK (= one glyph), not a single raw tile-plane byte.
 *
 * ## Wallset-slot resolution (2026-09-01, `tools/shared/goldbox-ecl.ts`)
 *
 * The "which WALLDEF resource occupies each of the 3 slots" gap above is
 * now resolved for MOST of Curse of the Azure Bonds and Secret of the
 * Silver Blades' levels by decoding each level's own ECL "LOAD PIECES"
 * script (`goldbox-ecl.ts`'s module doc has the full VM writeup and
 * verification evidence). `WallsetBinding` + `resolveWallFlatId` below
 * expose this: a level's `wallsetBinding` (attached by
 * `goldbox-glib-export.ts`'s GEO step) gives each slot's **flat** WALLDEF
 * piece id (`undefined` = not statically resolved for this level — a
 * dynamic/computed operand, or no ECL hit found at all); turning a flat id
 * into a real WALLDEF entry id + wallset-within-entry is
 * `resolveFlatWalldefId` in `goldbox-walltiles.ts` (needs that title's own
 * WALLDEF directory, not just the GEO/ECL data this module has). Pool of
 * Radiance and Pools of Darkness are NOT resolved this way (see
 * `goldbox-ecl.ts`'s doc and each title's own `data-structure.md`/
 * `TODO.md` for why) — their `wallsetBinding` fields are absent/all-
 * `undefined`, and `resolveWallFlatId` correctly returns `undefined` for
 * every cell in that case (the walker's existing one-texture-per-level
 * placeholder is the fallback).
 */

export const GEO_GRID_SIZE = 16;
export const GEO_PLANE_SIZE = GEO_GRID_SIZE * GEO_GRID_SIZE; // 256
export const GEO_RECORD_SIZE = GEO_PLANE_SIZE * 4; // 1024
/** Constant 2-byte tag PoR's `geo.dax` prepends to every entry (not per-level data) — see module doc. */
export const POR_GEO_PREFIX_LENGTH = 2;

/**
 * Plane-3 door/passability code, CONFIRMED semantics (see module doc):
 * 0=solid/blocked, 1=passable (open arch / unlocked door), 2=locked door,
 * 3=locked door (unpickable). Only meaningful where the matching direction's
 * wall TYPE (planes 0/1, 0-15) is non-zero — see `isBlocked`/`isDoor`.
 */
export type DoorCode = 0 | 1 | 2 | 3;

export interface GeoCell {
  /** Wall-art type per direction (planes 0/1, 0-15): 0 = no wall drawn (always passable); 1-15 = slice index into a level-scoped, ECL-loaded 3-slot x 5-slice wallset table — see `wallSlotSlice()` and the module doc. Not a static WALLDEF id by itself. */
  wallN: number;
  wallE: number;
  wallS: number;
  wallW: number;
  /** Door/passability code per direction (plane 3, CONFIRMED-corrected semantics — see module doc). Only consulted where the matching wall type above is non-zero. */
  doorN: DoorCode;
  doorE: DoorCode;
  doorS: DoorCode;
  doorW: DoorCode;
  /** Plane 2 raw byte — CONFIRMED `mapWallRoof`: bit7=roofed/indoor, bit6=city special-tile, low bits=zone/special-square id (ECL-consumed). Not used by the walker. */
  special: number;
}

/**
 * A level's resolved wallset-slot bindings — each slot's flat WALLDEF piece
 * id (see `goldbox-ecl.ts`'s `findWallsetBindings` and this module's
 * "Wallset-slot resolution" doc section above). `undefined` = not
 * statically resolved for this level.
 */
export interface WallsetBinding {
  slot1?: number;
  slot2?: number;
  slot3?: number;
}

export interface GeoLevel {
  id: number;
  width: number;
  height: number;
  /** Row-major, index = y*width+x. */
  cells: GeoCell[];
  /** This level's own ECL-resolved wallset bindings, when statically resolvable — see `WallsetBinding`. Absent for titles/levels where resolution isn't done (Pool of Radiance, Pools of Darkness) or didn't statically resolve. */
  wallsetBinding?: WallsetBinding;
}

/** Decode one already-isolated 1024-byte GEO payload (GLIB titles: the raw block bytes; PoR: `decompressed.subarray(2)`). */
export function decodeGeoRecord(payload: Uint8Array, id: number): GeoLevel {
  if (payload.length !== GEO_RECORD_SIZE) {
    throw new Error(`geo record: expected ${GEO_RECORD_SIZE} bytes, got ${payload.length}`);
  }
  const p0 = payload.subarray(0, GEO_PLANE_SIZE);
  const p1 = payload.subarray(GEO_PLANE_SIZE, GEO_PLANE_SIZE * 2);
  const p2 = payload.subarray(GEO_PLANE_SIZE * 2, GEO_PLANE_SIZE * 3);
  const p3 = payload.subarray(GEO_PLANE_SIZE * 3, GEO_PLANE_SIZE * 4);
  const cells: GeoCell[] = [];
  for (let i = 0; i < GEO_PLANE_SIZE; i++) {
    const b3 = p3[i];
    const b0 = p0[i];
    const b1 = p1[i];
    cells.push({
      wallN: (b0 >> 4) & 0xf,
      wallE: b0 & 0xf,
      wallS: (b1 >> 4) & 0xf,
      wallW: b1 & 0xf,
      doorN: (b3 & 3) as DoorCode,
      doorE: ((b3 >> 2) & 3) as DoorCode,
      doorS: ((b3 >> 4) & 3) as DoorCode,
      doorW: ((b3 >> 6) & 3) as DoorCode,
      special: p2[i],
    });
  }
  return { id, width: GEO_GRID_SIZE, height: GEO_GRID_SIZE, cells };
}

/** Decode a PoR `geo.dax` entry's decompressed bytes (2-byte constant prefix + 1024-byte record). */
export function decodePorGeoEntry(decompressed: Uint8Array, id: number): GeoLevel {
  return decodeGeoRecord(decompressed.subarray(POR_GEO_PREFIX_LENGTH), id);
}

export function cellAt(level: GeoLevel, x: number, y: number): GeoCell | undefined {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return undefined;
  return level.cells[y * level.width + x];
}

/** 0=N, 1=E, 2=S, 3=W — matches the confirmed `MapDirectionXDelta`/`MapDirectionYDelta` order. */
export type Direction = 0 | 1 | 2 | 3;

export function wallTypeFor(cell: GeoCell, dir: Direction): number {
  return dir === 0 ? cell.wallN : dir === 1 ? cell.wallE : dir === 2 ? cell.wallS : cell.wallW;
}

export function doorCodeFor(cell: GeoCell, dir: Direction): DoorCode {
  return dir === 0 ? cell.doorN : dir === 1 ? cell.doorE : dir === 2 ? cell.doorS : cell.doorW;
}

/**
 * CONFIRMED collision rule (see module doc's plane-3 correction): a
 * direction is blocked only if it has a wall drawn (type != 0) AND that
 * wall's door code is 0 (solid). A locked door (2/3) is a real obstacle
 * for gameplay (needs a key/bash/pick) but the walker treats any non-solid
 * code as passable — see `isDoor` to distinguish for rendering.
 */
export function isBlocked(cell: GeoCell, dir: Direction): boolean {
  return wallTypeFor(cell, dir) !== 0 && doorCodeFor(cell, dir) === 0;
}

/** True if this direction has a wall present (type != 0) with a non-solid door code (1/2/3) — an arch or a door, not a plain wall. */
export function isDoor(cell: GeoCell, dir: Direction): boolean {
  return wallTypeFor(cell, dir) !== 0 && doorCodeFor(cell, dir) !== 0;
}

/** True if this direction has a wall drawn at all (regardless of passability). */
export function hasWall(cell: GeoCell, dir: Direction): boolean {
  return wallTypeFor(cell, dir) !== 0;
}

/** True if the square at (x,y) has at least one side with a wall drawn (any direction, type != 0). */
export function hasAnyWall(cell: GeoCell): boolean {
  return cell.wallN !== 0 || cell.wallE !== 0 || cell.wallS !== 0 || cell.wallW !== 0;
}

/**
 * Decompose a 1-15 wall-art type into its level-scoped (slot, slice)
 * coordinates: `wallsetSlot = floor((n-1)/5)` (0-2, which of up to 3
 * ECL-loaded WALLDEF resources), `slice = (n-1)%5` (which of that
 * wallset's 5 slices, i.e. WALLDEF entries per wallset — see module doc).
 * Returns `undefined` for type 0 (no wall). Resolving `slot` to an actual
 * WALLDEF resource id requires each level's ECL script (not decoded by
 * this project) — this only narrows the search space.
 */
export function wallSlotSlice(wallType: number): { slot: 0 | 1 | 2; slice: 0 | 1 | 2 | 3 | 4 } | undefined {
  if (wallType <= 0) return undefined;
  const n = wallType - 1;
  return { slot: Math.floor(n / 5) as 0 | 1 | 2, slice: (n % 5) as 0 | 1 | 2 | 3 | 4 };
}

/**
 * Resolve a cell's wall in direction `dir` to `{flatId, slice}` — the flat
 * WALLDEF piece id (still needs `resolveFlatWalldefId` in
 * `goldbox-walltiles.ts` to become a real WALLDEF entry id + wallset
 * index) and which of that wallset's 5 slices to use. Returns `undefined`
 * if there's no wall in that direction, or if this level's own
 * `wallsetBinding` doesn't statically name the relevant slot (see
 * `WallsetBinding`'s doc) — callers should fall back to a placeholder
 * texture in that case, exactly as the walker already did before any
 * binding was known.
 */
export function resolveWallFlatId(
  cell: GeoCell,
  dir: Direction,
  binding: WallsetBinding | undefined,
): { flatId: number; slice: 0 | 1 | 2 | 3 | 4 } | undefined {
  const wallType = wallTypeFor(cell, dir);
  const ss = wallSlotSlice(wallType);
  if (!ss || !binding) return undefined;
  const flatId = ss.slot === 0 ? binding.slot1 : ss.slot === 1 ? binding.slot2 : binding.slot3;
  if (flatId === undefined) return undefined;
  return { flatId, slice: ss.slice };
}
