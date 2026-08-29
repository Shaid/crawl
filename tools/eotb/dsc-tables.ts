/**
 * Real, byte-exact, Amiga-specific static tables for Eye of the Beholder 1
 * (Amiga)'s screen-position dispatch and wall-decoration placement --
 * transcribed from ScummVM's own `devtools/create_kyradat/resources/
 * eob1_amiga.h` (fetched from `github.com/scummvm/scummvm`). These are
 * **not** ScummVM's engine C++ source -- the engine (`engines/kyra/
 * engine/kyra_rpg.cpp`'s `staticres_rpg.cpp` init) loads them at runtime
 * from `kyra.dat`, a compiled resource blob built by `create_kyradat`; the
 * `devtools/` tool is where the ScummVM team's own literal, per-platform
 * byte arrays (originally reverse-engineered from the real games) live in
 * readable source form. `kEoB1DscBlockIndexAmigaProvider` /
 * `kEoB1DscBlockMapAmigaProvider` / `kEoB1DscShapeIndexAmigaProvider` /
 * `kEoB1DscXAmigaProvider` in that header are registered specifically for
 * `{ kEoB1, kPlatformAmiga }` -- i.e. these are this exact game+platform's
 * real values, not a DOS/PC98/FMTowns/SegaCD sibling's.
 *
 * **`DSC_BLOCK_MAP` -- confirms `view-model.ts`'s `roleSide`.** Real
 * source: `KyraRpgEngine::generateBlockDrawingBuffer` (`engines/kyra/
 * engine/scene_rpg.cpp:128-131`): `_sceneDrawVarDown = _dscBlockMap[dir]`,
 * `_sceneDrawVarRight = _dscBlockMap[dir+4]`, `_sceneDrawVarLeft =
 * _dscBlockMap[dir+8]`. Verified (this session): for every one of the 4
 * facings x 3 roles (12 combinations), `roleSide(role, facing)`'s numeric
 * side-array index equals the real `_dscBlockMap`-derived
 * `_sceneDrawVar{Down,Right,Left}` value, once "front" is paired with
 * ScummVM's "Down" role and "left"/"right" are paired with its "Right"/
 * "Left" roles (`_visibleBlocks[0]`, the screen-far-left cell, always
 * reads `_sceneDrawVarRight`; `_visibleBlocks[6]`, the screen-far-right
 * cell, always reads `_sceneDrawVarLeft` -- `generateBlockDrawingBuffer`'s
 * own hardcoded call sites, unconditional on facing). This closes
 * `docs/eotb/TODO.md`'s "facing rotation for non-North, unverified"
 * item -- see `data-structure.md`'s "INF" section for the full derivation
 * and the verification script's output.
 *
 * **`DSC_BLOCK_INDEX` -- confirms `decode-vmp.ts`'s `CELL_OFFSETS` +
 * `view-model.ts`'s `rotateOffset`, for all 4 facings.** Real source:
 * `KyraRpgEngine::assignVisibleBlocks` (`scene_rpg.cpp:313-320`): `t =
 * (block + _dscBlockIndex[direction*18+i]) & 0x3FF`. Decoding each `int8`
 * offset as `(dy, dx) = (offset >> 5 [floor], offset - dy*32)` (32 = maze
 * row stride) and comparing against `rotateOffset(dxRel, dyRel, facing)`
 * for the matching `CELL_OFFSETS` letter gives **zero mismatches across
 * all 68 populated (facing, cell) pairs** (17 named cells x 4 facings;
 * `_visibleBlocks[16]`, the player's own cell, has no `CELL_OFFSETS`
 * entry and isn't checked). Not re-exported as a table here since nothing
 * in this codebase reads raw block-index arithmetic directly -- the
 * confirmation is recorded for provenance; `CELL_OFFSETS`/`rotateOffset`
 * remain the implementation.
 *
 * **`DSC_SHAPE_INDEX` / `DSC_SHAPE_X` -- feed `renderer.ts`'s
 * `drawWallDecorations`.** Real source: `EoBCoreEngine::drawDecorations`
 * (`engines/kyra/engine/scene_eob.cpp:667-716`): `int8 ix =
 * _dscShapeIndex[s]` (`s = cellIndex*2 + i`, `i=0` for the "Down"/front
 * role this port implements, `i=1` for the "Right"/"Left" side roles,
 * not implemented here -- see `renderer.ts`'s module doc); `uint8 shpIx =
 * ABS(ix) - 1` selects which of a `LevelDecorationProperty`'s 10
 * screen-depth-slot `shapeIndex`/`shapeX`/`shapeY` entries applies at
 * this specific cell. `x += _dscShapeX[index]` (the general, non-`flags
 * & 4` path) translates the property's own stored `shapeX` into this
 * cell's on-screen position.
 */

/** `s->_currentDirection` (0=N,1=E,2=S,3=W) -> `[Down, Right, Left]` wall-side array index (0=N,1=E,2=S,3=W in this project's own `SIDES` convention). 12 bytes: `kEoB1DscBlockMapAmiga` (`eob1_amiga.h:1420`). */
export const DSC_BLOCK_MAP: readonly number[] = [2, 3, 0, 1, 1, 2, 3, 0, 3, 0, 1, 2];

/**
 * `s = cellIndex*2 + i` (`cellIndex` 0-17 per `CELL_LETTERS`, `i`=0 is the
 * front/"Down" role) -> signed shape-depth selector. `kEoB1DscShapeIndexAmiga`
 * (`eob1_amiga.h:1262`, 36 `int8` entries).
 */
export const DSC_SHAPE_INDEX: readonly number[] = [
  1, 1, 4, 10, 4, 8, 4, 1, 4, -8, 4, -10, 0, 0, 3, 9, 3, 7, 3, 1, 3, -7, 3, -9, 2, 6, 2, 1, 2, -6, 1, 5, 1, 1, 1, -5,
];

/** `cellIndex` (0-17) -> signed on-screen X translation added to a decoration's own `shapeX` for the front/"Down" role. `kEoB1DscXAmiga` (`eob1_amiga.h:1272`, 18 `uint16`/signed entries). */
export const DSC_SHAPE_X: readonly number[] = [
  -144, -96, -48, 0, 48, 96, 144, -160, -80, 0, 80, 160, -128, 0, 128, 0, 0, 0,
];

/** `CELL_OFFSETS`' 17 named cells, in `_visibleBlocks` index order (0-17); index 16 (the player's own cell) has no wall-render slot and is `null`. */
export const CELL_LETTERS: readonly (string | null)[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', null, 'Q',
];
