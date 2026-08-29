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
 * **`DSC_SHAPE_INDEX` / `DSC_SHAPE_X` / `DSC_SHAPE_COORDS` -- feed
 * `renderer.ts`'s `drawWallDecorations` (both roles, 2026-08-29).** Real
 * source, fetched fresh and re-verified line-by-line against
 * `github.com/scummvm/scummvm`'s raw `scene_eob.cpp` (not trusted from a
 * prior session's paraphrase):
 *
 * ```cpp
 * void EoBCoreEngine::drawDecorations(int index) {
 *   for (int i = 1; i >= 0; i--) {
 *     int s = index * 2 + i;
 *     if (_dscWallMapping[s]) {
 *       int16 d = *_dscWallMapping[s];
 *       int8 l = _wllShapeMap[_visibleBlocks[index]->walls[d]];
 *       ...
 *       while (l > 0) {
 *         l--;
 *         int8 ix = _dscShapeIndex[s];
 *         uint8 shpIx = ABS(ix) - 1;
 *         uint8 flg = _levelDecorationProperties[l].flags;
 *         if ((i == 0) && (flg & 1 || ((flg & 2) && _wllProcessFlag)))
 *           ix = -ix;
 *         if (_levelDecorationProperties[l].shapeIndex[shpIx] == 0xFFFF) { l = ...next; continue; }
 *         shapeData = _levelDecorationShapes[_levelDecorationProperties[l].shapeIndex[shpIx]];
 *         if (shapeData) {
 *           x = 0;
 *           if (i == 0) {
 *             if (flg & 4) x += _dscShapeCoords[(index * 5 + 4) << 1];
 *             else x += _dscShapeX[index];
 *           }
 *           if (ix < 0) {
 *             x += (176 - _levelDecorationProperties[l].shapeX[shpIx] - (shapeData[2] << 3));
 *             drawBlockObject(1, 2, shapeData, x, _levelDecorationProperties[l].shapeY[shpIx], _sceneShpDim);
 *           } else {
 *             x += _levelDecorationProperties[l].shapeX[shpIx];
 *             drawBlockObject(0, 2, shapeData, x, _levelDecorationProperties[l].shapeY[shpIx], _sceneShpDim);
 *           }
 *         }
 *         l = _levelDecorationProperties[l].next;
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * **Key finding, corrects this session's task brief's assumption:** the
 * `ix = -ix` flag-driven flip is gated `(i == 0) &&` -- i.e. it applies to
 * the FRONT role only, never to the side roles. Side-role mirroring comes
 * for free from `DSC_SHAPE_INDEX`'s own static sign at odd (`i=1`)
 * entries instead (negative for every `-west`-suffixed cell, positive for
 * every `-east`-suffixed cell -- see the table below); the `ix < 0`
 * mirrored-draw branch is itself unconditional on `i`, only the extra
 * flag-driven negation is front-role-only. `l = _wllShapeMap[...]`/
 * `_levelDecorationProperties`'s "+1"-offset runtime re-indexing
 * (`assignWallsAndDecorations`, `scene_eob.cpp:466-511`) is a pure
 * engine-internal detail (flattening every wall's chain into one
 * per-level running array to reuse memory) -- it does NOT change the
 * on-disk chain semantics `decode-decorations.ts`'s `decorationChain`
 * already implements (`next` is a plain 0-based index into the same
 * static array, `next==0` terminates); traced end-to-end in
 * `assignWallsAndDecorations` to confirm this, not assumed.
 *
 * `_wllProcessFlag` (the runtime toggle gating `flg & 2`) has **no static
 * source and is never confirmed set in this corpus's `flg` values** --
 * moot, not modelled: a whole-corpus census of all 5 real `.DAT` files'
 * `DecorationProperty.flags` (198 properties total) found bit `0x02` set
 * on **zero** records (bit `0x01`: 18/198; bit `0x04`: 21/198) -- see
 * `renderer.ts`'s module doc for the probe. `flg & 2` is therefore dead
 * code for every real EOB1 Amiga decoration and is omitted from this
 * port entirely (not defaulted to false and left in as inert code -- it
 * cannot fire on any real data).
 *
 * `s = cellIndex*2 + i` (`i=0` front/"Down", `i=1` side/"Right"-or-"Left",
 * resolved the same way `view-model.ts`'s `resolveWallTypes` already
 * resolves a slot's `role`/`side` from its `-south`/`-east`/`-west`
 * suffix -- this project's already-CONFIRMED `DSC_BLOCK_MAP` cross-check
 * is the byte-exact equivalent of dereferencing `_dscWallMapping[s]`, so
 * no separate `_dscWallMapping` table needs decoding for either role):
 * `int8 ix = _dscShapeIndex[s]`; `uint8 shpIx = ABS(ix) - 1` selects
 * which of a `LevelDecorationProperty`'s 10 screen-depth-slot
 * `shapeIndex`/`shapeX`/`shapeY` entries applies. For `i=0`, `x +=
 * _dscShapeX[index]` (or, if `flg & 4`, `x +=
 * _dscShapeCoords[(index*5+4)<<1]` instead -- real, confirmed occurrences
 * in the corpus, see `DSC_SHAPE_COORDS` below); for `i=1`, `x` stays `0`
 * at this step (no per-cell translation at all -- side-role placement is
 * carried entirely by the property's own `shapeX[shpIx]`, pre-authored
 * per depth slot). Then universally (both roles): `ix < 0` mirrors (`x +=
 * 176 - shapeX[shpIx] - shapeWidthPx`, drawn flipped) else `x +=
 * shapeX[shpIx]` (drawn normally); `y = shapeY[shpIx]` always, no offset,
 * either role.
 */

/** `s->_currentDirection` (0=N,1=E,2=S,3=W) -> `[Down, Right, Left]` wall-side array index (0=N,1=E,2=S,3=W in this project's own `SIDES` convention). 12 bytes: `kEoB1DscBlockMapAmiga` (`eob1_amiga.h:1420`). */
export const DSC_BLOCK_MAP: readonly number[] = [2, 3, 0, 1, 1, 2, 3, 0, 3, 0, 1, 2];

/**
 * `s = cellIndex*2 + i` (`cellIndex` 0-17 per `CELL_LETTERS`; `i`=0 is the
 * front/"Down" role, `i`=1 is the side/"Right"-or-"Left" role, both now
 * consumed by `renderer.ts`'s `drawWallDecorations`) -> signed shape-depth
 * selector. `kEoB1DscShapeIndexAmiga` (`eob1_amiga.h:1262`, 36 `int8`
 * entries). Odd (`i=1`) entries' sign is the side-role mirror encoding:
 * negative for every `-west`-suffixed `WALL_RENDER_SLOTS` cell (E,F,K,L,
 * O,Q), positive for every `-east`-suffixed one (A,B,C,H,I,M,P) --
 * confirmed by cross-checking each cell's sign against its real slot
 * suffix, zero mismatches. Cells with neither an `-east`/`-west` slot
 * (D,J,N) nor (for `i=0`) a `-south` slot (G at `i=0`; matches the value
 * `0` there, an otherwise-invalid `shpIx` that's never reached since
 * `_dscWallMapping[s]` is null for those `(cellIndex,i)` pairs) carry
 * unused placeholder values -- this port's renderer guards `shpIx` to
 * `0-9` defensively rather than hardcoding which cells to skip.
 */
export const DSC_SHAPE_INDEX: readonly number[] = [
  1, 1, 4, 10, 4, 8, 4, 1, 4, -8, 4, -10, 0, 0, 3, 9, 3, 7, 3, 1, 3, -7, 3, -9, 2, 6, 2, 1, 2, -6, 1, 5, 1, 1, 1, -5,
];

/** `cellIndex` (0-17) -> signed on-screen X translation added to a decoration's own `shapeX` for the front/"Down" role, general (`flags & 4` unset) case. `kEoB1DscXAmiga` (`eob1_amiga.h:1272`, 18 `uint16`/signed entries). */
export const DSC_SHAPE_X: readonly number[] = [
  -144, -96, -48, 0, 48, 96, 144, -160, -80, 0, 80, 160, -128, 0, 128, 0, 0, 0,
];

/**
 * `_dscShapeCoords` -- the front/"Down"-role alternate on-screen X
 * translation used instead of `DSC_SHAPE_X[cellIndex]` when a chained
 * `DecorationProperty.flags & 4` is set (`x += _dscShapeCoords[(index * 5
 * + 4) << 1]`, `scene_eob.cpp:697`). `kEoB1DscShapeCoordsAmiga`
 * (`eob1_amiga.h:906-931`, 180 `uint16`/signed entries) -- structurally
 * 18 cellIndex groups of 5 signed `(x,y)` pairs (10 words each); only
 * each group's **5th pair's X word** (`group*10 + 8`, matching `(cellIndex
 * * 5 + 4) << 1` byte-for-byte) is read by `drawDecorations` -- the other
 * 4 pairs per group are for a different, unrelated consumer (not this
 * decoration path) and aren't needed here, but the full literal table is
 * kept for provenance/fidelity rather than pre-slicing it by hand.
 * Real occurrences confirmed in this corpus: 21/198 `DecorationProperty`
 * records across the 5 real `.DAT` files carry `flags & 4`
 * (`renderer.ts`'s module doc cites the per-file breakdown).
 */
export const DSC_SHAPE_COORDS: readonly number[] = [
  -111, -63, -95, -63, -139, -59, -117, -59, -120, -61,
  -76, -63, -60, -63, -95, -59, -74, -59, -80, -61,
  -43, -63, -27, -63, -53, -59, -31, -59, -40, -61,
  -8, -63, 8, -63, -10, -59, 10, -59, 0, -61,
  27, -63, 43, -63, 31, -59, 53, -59, 40, -61,
  60, -63, 76, -63, 74, -59, 95, -59, 80, -61,
  95, -63, 111, -63, 117, -59, 139, -59, 120, -61,
  -118, -53, -92, -53, -152, -45, -120, -45, -118, -50,
  -66, -53, -40, -53, -84, -45, -51, -45, -59, -50,
  -13, -53, 13, -53, -16, -45, 16, -45, 0, -50,
  40, -53, 66, -53, 51, -45, 84, -45, 59, -50,
  92, -53, 118, -53, 120, -45, 152, -45, 118, -50,
  -110, -35, -67, -35, -140, -22, -83, -22, -98, -30,
  -22, -35, 22, -35, -27, -22, 27, -22, 0, -30,
  67, -35, 110, -35, 83, -22, 140, -22, 98, -30,
  -128, -4, 128, -4, -128, -66, 128, -66, 128, 0,
  -38, -4, 38, -4, -38, -66, 38, -66, 0, 0,
  -128, -4, 128, -4, -128, -66, 128, -66, 128, 0,
];

/** `CELL_OFFSETS`' 17 named cells, in `_visibleBlocks` index order (0-17); index 16 (the player's own cell) has no wall-render slot and is `null`. */
export const CELL_LETTERS: readonly (string | null)[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', null, 'Q',
];
