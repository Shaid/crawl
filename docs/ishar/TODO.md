# Ishar-engine family — open work

Single status surface for **Crystals of Arborea, Ishar 1, Ishar 2, and
Ishar 3** (all share one container/codec family — see
`docs/ishar-container-format.md`). This is still an exploratory pass
(started 2026-08-30) — the container/compression layer is now fully
confirmed via real prior art (`github.com/maestun/silm-depack`/`alis`);
per-title content semantics (overworld/dungeon-view mechanism) remain a
from-scratch investigation.

See `docs/ishar-container-format.md` for the shared container spec,
`docs/ishar/amigaaga/data-structure.md` / `docs/ishar2/amigaaga/
data-structure.md` / `docs/ishar3/amigaaga/data-structure.md` /
`docs/crystalsofarborea/amiga/data-structure.md` for per-title findings.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ishar-main-manifest-structure | open | `MAIN.DO`'s content is now fully readable in all 3 Ishar titles (resource manifest + monster roster + level-editor strings — the earlier "Ishar 2/3 don't show readable strings" note was a false negative from checking pre-decompression bytes, corrected this session), but its *binary record structure* (per-scene resource lists as actual records with offsets/counts, not just repeated substrings found via `strings`) is still not decoded | `docs/ishar-container-format.md` §3, `docs/ishar/amigaaga/data-structure.md` §4, `docs/ishar2/amigaaga/data-structure.md` §3, `docs/ishar3/amigaaga/data-structure.md` §2 | 2026-08-30 |
| ishar-cell-value-semantics | open | The region-grid cell-value alphabet (§9.2: `0x00` void, low codes = terrain/feature, high-bit `0x9D`/`0xCC-0xCE`/`0xE1`/`0xE5-0xE6` = obstacle classes; cells read sign-extended so `< 0` is the natural blocked test — HYPOTHESIS) needs its value→walkability and value→scene-script dispatch decoded (very likely the `cswitch` streams around `MAIN.bin+0x18e8..0x1c74` where all the location `.AO` names sit) | `docs/ishar-container-format.md` §9.2 | 2026-09-01 re-oracle |
| ishar-fic-semantics | open | Remaining `.FIC` semantics now that the format layer is solved (§9): the role split between the two region-grid buffers (`basemain+0x80` vs `+0x234a` — adjacent-region staging vs pristine-copy both fit the paired reads); `EN1.FIC`'s 28/29 per-array record layouts (sizes byte-exact from bytecode, content undecoded); `TAB1.FIC`'s 19×19 {1..4} grid's role; Ishar 2/3's second grid layer's meaning | `docs/ishar-container-format.md` §9.1-9.3 | 2026-09-01 re-oracle |
| ishar-alis-bytecode-disassembler | open | Build a real ALIS bytecode disassembler as a committed tool (`tools/shared/alis-disasm.ts`): the full operand grammar is mechanically derivable from `maestun/alis`'s `opcodes.c`/`opernames.c`/`storenames.c`/`addnames.c` (one 256-entry opcode table, version differences inside handlers; expression streams self-delimiting via `oeval`/`ofin`). Hand-decoding small windows was enough for §9, but the cell-value dispatch, scene compositor logic, and sprite-palette selection all want proper stream walking | `docs/ishar-container-format.md` §9.1 (worked hand-decode examples) | 2026-09-01 re-oracle |
| ishar-sprite-palette | open | The real AGA colour palette for decoded sprites (§7/`docs/ishar-sprite-format.md`) is not yet recovered — `topalette()` resolves a palette resource via the same `adresdes()` directory mechanism as bitmaps, but the specific directory INDEX that is "the palette for this scene" is chosen by VM bytecode at runtime, not by any static marker. All shipped sprite renders are greyscale (RENDERED, not CONFIRMED colour) | `docs/ishar-sprite-format.md` §5 | 2026-08-31 |
| ishar-scene-header-subtype-byte | open | The shared 16-byte scene header (§6's evidence) has a varying byte at offset 21 (`0x0a` graphics/Ishar-1 caves, `0x47` Ishar-2 dungeon files, `0x1e` a third subgroup) that looks like a content-subtype discriminator — not traced to any consumer code. (Note: this header is the ALIS *script* header — `id@0`, `code_loc@+4`→bytecode entry, `dirOff@+0x0e` — per §9's `script.c` layout, so the "subtype byte" is a script-header field, likely `vram_alloc`-adjacent) | `docs/ishar-container-format.md` §6, §9 | 2026-09-01 re-oracle |
| ishar-walker-topdown-only | open | `tools/walker/games-ishar.ts` (built this session) renders the CONFIRMED top-down `CONT*.FIC` region grid for Ishar 1/2/3, NOT a first-person view — the actual first-person mechanism (generic VM sprite/scene compositing keyed by cell value, §9's premise-correction finding) is not decoded to the point of rendering a frame. Walkability is the HYPOTHESIS-level `isBlocked()` rule (see `ishar-cell-value-semantics`), independently re-verified this session only as "produces a coherent, non-random render" — not as a traced collision-check opcode | `docs/ishar-container-format.md` §9, `tools/walker/games-ishar.ts` module doc | 2026-09-01 |
| ishar-t3-crystals-executable-trace | deferred | Ishar 3's `START` and Crystals' `T.X` were not disassembled this pass (only Ishar 1's `T.X` was traced) — the `0xA1`/`0x81` codec port is now verified corpus-wide by output self-consistency + readable content instead, which is strong enough evidence to not require this, but a direct trace on a second title's executable would still strengthen the "one shared codec" claim further | `docs/ishar-container-format.md` §1, §2.5 | 2026-08-30 |

## Session log

- **2026-09-01 (seventh pass — walker built on the confirmed region grids,
  re-oracle's claims independently re-verified)**: Before trusting the
  escalation's report, independently re-verified its two most falsifiable
  claims with this project's own tools: (1) rendered `CONT1.FIC` (Ishar 1)
  as a 90×54 ASCII/pixel grid — unmistakably coherent (closed building/
  compound rectangles, road lines, a bordered coastline blob), and Ishar
  2's `CONT1.FIC` at 60×90 similarly shows a smooth closed coastline
  outline; (2) re-decoded `MAP.DO` with this project's own (already-correct,
  +2/+4 offset) sprite decoder — resolves to exactly the claimed single
  320×126 type-0x12 bitmap, and its shipped greyscale render legibly shows
  the title "RENDORIA" over map artwork. Both independent checks passed
  decisively, so the escalation's report is treated as CONFIRMED per this
  project's verification bar (not just accepted on narrative). Built
  `tools/shared/ishar-regions.ts` (decoder + the HYPOTHESIS-labeled
  `isBlocked()` walkability rule) and a batch export pipeline
  (`tools/shared/ishar-region-export.ts`, per-title CLI wrappers) writing
  `public/assets/<game>/amigaaga/data/regions.json` — all 19 region grids
  (6+7+6) decode cleanly. Built `tools/walker/games-ishar.ts` (`GameView`
  for Ishar 1/2/3): a TOP-DOWN region-grid explorer (party dot + facing
  arrow over a colour-classified cell render), not a first-person view —
  honestly scoped to what's actually confirmed (`ishar-walker-topdown-only`,
  new row, supersedes the now-closed `ishar-walker-view`). `npx tsc --noEmit`
  (whole project) and `npx eslint` (all new files) both clean; a Node smoke
  test (fetch stubbed to local files) confirmed region loading, level
  listing, and movement/blocking logic all behave correctly.

- **2026-09-01 (sixth pass — `re-oracle` escalation returned: premise refuted, world grids SOLVED)**:
  The escalation succeeded by dissolving the wall rather than crossing it.
  (1) **Premise correction**: `render3d.c`'s raycaster is version-gated
  (`opcodes.c:1409` `if (alis.platform.version >= 31)`) and per
  `script.c`'s own version table Ishar 1/2/3 are v20/21/30 — **no Ishar
  title ever executes the heightfield renderer**; it's Robinson's
  Requiem's (v31). The "oracle gap" (`cdefmap` unimplemented for Ishar)
  was no gap: Ishar never issues those opcodes. Ishar's first-person view
  is generic VM sprite compositing. (2) **The real world data found and
  solved**: `CONT<n>.FIC` = raw row-major byte region grids (Ishar 1:
  90×54; Ishar 2: 2 layers 60×90; Ishar 3: 2 layers 57×82), loaded by
  `cfopen`/`cfreadb` bytecode in `MAIN.DO` (all call sites hand-decoded,
  every length byte-exact vs file sizes: 4860/2×5400/2×4674, EN1
  3640/6050/6050, TAB1 361), dimensions declared by the games' own `cdim`
  array headers (stride 90/60/57), grid at runtime `basemain+0x80`
  (+`0x234a` twin), consumers censused (`omaintc 0x0080` in GERDEP/
  RPLAINE/ENCONT + every location script), party-position globals
  identified (`basemain+0x137d`/`+0x3fd0`), and a 90×54 ASCII render of
  CONT1 shows a real coherent region map. `MAP.DO` resolved as the
  320×126 auxiliary map *picture* (a sprite-doc prose error +1/+3 vs real
  +2/+4 header offsets corrected along the way). Rows closed:
  `ishar-firstperson-view-mechanism`, `ishar-overworld-representation`,
  `ishar-fic-files`, `ishar-map-grid-geometry`. New:
  `ishar-cell-value-semantics`, `ishar-fic-semantics`,
  `ishar-alis-bytecode-disassembler`; `ishar-walker-view` unblocked.
  Full evidence: `docs/ishar-container-format.md` §8 correction blocks +
  §9.

- **2026-08-31 (fifth pass — terrain-anchor mechanism traced to a real oracle gap, escalated)**:
  Pursued both concrete next steps named by the fourth pass. (1) Applied the
  sprite-directory technique's spirit to `MAIN.DO`'s own internal
  scene-table: found (via `copensc`, opcode 0x4e) that scene-id values are
  literal bytecode immediates, not static data — so a byte-pattern struct
  scan can't find real instances; ran one anyway across all 4 titles'
  `MAIN.bin` as a due-diligence check, got only weak/non-independent hits
  (a real negative, not under-effort). (2) Traced `calloctab` (0xe9, a
  generic lazy-allocator for VM scratch tables, not terrain-specific) and,
  more importantly, `cdefmap` (0xe3) — the actual writer of the
  `scene_addr+0x40`/`+0x42` fields `render_context` is built from. Found
  the exact mechanism (bytecode-embedded self-relative offset -> raw
  dimension bytes stored just before it, in the terrain-owning file's own
  bytes) but also found `opcodes.c`'s own dispatch table stubs opcode 0xe3
  (and its siblings 0xe4/0xe5/0xe8/0xf7/0xf8/0xfd) to a no-op for every
  game except Transarctica/Robinson's Requiem — **the reference oracle's
  own authors never reverse-engineered this for Ishar**. This is a genuine
  gap in the ground-truth oracle, not a search failure — escalated to
  `re-oracle` (process update this session: escalate directly to
  `re-oracle`, skip `re-codebreaker`) with a full self-contained brief.
  Result pending. See `docs/ishar-container-format.md` §8.1.

- **2026-08-31 (fourth pass — sprite format CONFIRMED, renderer architecture identified)**:
  Closed Priority 1 of the task brief (`ishar-png-render`, row removed —
  solved). Found and ported the per-script resource-directory mechanism
  (`adresdes()`, 2-level self-relative indirection) and 6 bitmap
  pixel-encoding types (raw/banked 4-bit, direct 8-bit, each masked/opaque)
  from `github.com/maestun/alis` (MIT), a real source-available ALIS-VM
  reimplementation documented "Playable" for exactly these titles/platform.
  Applied blind to real corpus bytes: 74/98, 119/137, 113/136, 31/36 files
  (Ishar 1/2/3/Crystals) have a valid directory, decoding 1,608/2,244/2,744/
  905 sprites respectively. Verified via genuinely recognizable rendered art
  (barbarian warriors, a dragon, a tree, an orc, a skeleton) — see
  `docs/ishar-sprite-format.md`. New module `tools/shared/ishar-sprites.ts`
  + batch pipeline `tools/shared/ishar-sprite-atlas.ts` + 4 per-title CLI
  wrappers. Real AGA colour palette resolution remains open
  (`ishar-sprite-palette`, new row) — bytecode-selected, not statically
  located.
  Made real progress on Priority 2 (the first-person mechanism question):
  `alis`'s `render3d.c`/`render3d_68k.c` implement a real heightfield/
  voxel-column terrain raycaster — a decisive qualitative answer (not a
  wall-tile compositor, more specific than a generic vector/placement-list
  format), grounded in source-available VM code for exactly this
  game+platform. The exact on-disk terrain-grid location remains open; an
  earlier numeric claim this session (`fileOffset18==0x0020` in 226/235
  files) was explicitly WITHDRAWN after finding its field-offset semantics
  apply to MAIN's own script data, not each file's own bytes — a real
  self-caught category error, documented as a correction rather than
  silently dropped. Priorities 3 (`MAP.DO` grid geometry) and 4 (walker
  `GameView`) were deliberately NOT attempted, since the terrain-geometry
  decode isn't yet at extractable-per-location confidence (new
  `ishar-walker-view` row, deferred). See
  `docs/ishar-container-format.md` §7-8.

- **2026-08-30 (third pass — user-confirmed game structure)**: the user
  (who has played these games) confirmed Ishar 1/2/3 are "completely
  first-person crawlers, except you spend a lot of time outdoors exploring
  islands and so on, still in first-person" — there is no separate top-down/
  node-graph overworld mode. This reframes (doesn't refute) the second
  pass's two open mechanism items: `ishar-overworld-representation` is now
  "what does the auxiliary map screen show", not "what does the player
  navigate through" (always first-person, indoors and out); it also
  *strengthens* `ishar-firstperson-view-mechanism`'s "one shared scene
  format" reading, since outdoor and indoor content sharing an identical
  header shape is exactly what one shared first-person compositor predicts.
  See the correction block in `docs/ishar-container-format.md` §6 and both
  rows' updated text below.

- **2026-08-30 (second pass — compression cracked)**: Closed 3 items from the
  first pass. **`ishar-compression-codec`**: found real open-source prior
  art for this exact engine (`github.com/maestun/silm-depack`,
  `github.com/maestun/alis`, both MIT) via `WebSearch`; ported both codecs
  (old PackBits-style RLE `0x81`/`0x80`, new LZ77-style bitstream `0xA1`)
  faithfully to `tools/shared/silmarils-unpack.ts`. Verified two ways:
  corpus-wide packed-byte-consumption self-consistency (83/97 exact for the
  new codec, all off-by-exactly-1 for the old codec — explained precisely
  by the reference's loop structure) and real readable decoded content
  (`MANUEL.CO`'s English manual table of contents, `MESSAGE2.CO`'s NPC
  dialogue). Full-corpus batch decompression now runs clean:
  ishar/amigaaga 98/98, ishar2/amigaaga 137/137, ishar3/amigaaga 136/136,
  crystalsofarborea/amiga 42/42 — see `tools/shared/ishar-decompress.ts`,
  `npm run <game>:decompress`. **`ishar-header-boundary`**: resolved as part
  of the codec crack — the "near-constant offset 17-22" bytes are the tail
  of the LZ77 dictionary, not unexplained padding (see
  `docs/ishar-container-format.md` §2.4). **`ishar-prior-art-search`**:
  done, found real prior art (above).
  Also made real progress on the two open content questions: `MAIN.DO`
  fully decoded (30-name monster roster, full location-name list, embedded
  level-editor debug strings implying a hierarchical country/region/zone
  coordinate model for the overworld) and a new cross-title structural
  finding — `MAP.DO`, all of Ishar 1's `*CAVE*.DO` files, several outdoor/
  monster graphics, AND Ishar 2's `DJ*.DO` dungeon files all share one
  identical 16-byte "scene/resource header" shape, arguing for one generic
  engine-wide scene descriptor format rather than separate tile-grid and
  wall-compositor formats. Both are STRUCTURAL/HYPOTHESIS, not yet code-
  confirmed (no disassembly trace of the renderer this session) — see the
  new `ishar-overworld-representation` and `ishar-firstperson-view-mechanism`
  rows. Fixed a real bug in `ishar-decompress.ts`'s handling of `classByte
  == 0x01` (stored) files, which were returning the whole raw buffer
  including the 6/22-byte container header as "content" — corrected to
  skip the header like every other class. `npx eslint`/`npx tsc --noEmit`
  clean on all new/changed files (4 real lint findings from a `reviewer`
  agent pass fixed: an unused catch binding, 3 `let`-should-be-`const`).

- **2026-08-30 (first pass)**: Container format cracked structurally across
  all 4 titles (16-byte header, `classByte`/24-bit decompressed-size
  field, two compressed sub-classes + one stored class — see
  `docs/ishar-container-format.md`). Confirmed `T.X`/`START` are real
  AmigaOS executables (a correction to the original task brief, which
  believed no executable existed for 3 of the 4 titles). Escalated the
  compression codec itself to the `amiga-disasm` agent (Ishar 1's `T.X`).
  Found `MAIN.DO`/`MAIN.CO` is a resource manifest via readable `.AO`
  filename strings. Found Crystals' `CARTE.CO` is uncompressed and
  contains real NPC names + travel UI text + a structural 8-entry record
  array. Built `tools/shared/ishar-container.ts` +
  `tools/shared/ishar-inventory.ts` and four per-title inventory CLI
  scripts, all run and verified against the real corpora (413 compressed
  + 6 stored + non-container files, 0 parse failures). File-role catalogs
  written for all 4 titles from filename evidence (French-language
  reading), confirming the overworld/outdoor vs. first-person-cave/dungeon
  split the task asked about exists as a real file-naming distinction —
  but no pixel/geometry content has been decoded yet, so the *mechanism*
  question for both remains open.
