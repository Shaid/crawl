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
| ishar-overworld-representation | open | Is the overworld a node/location-graph, a tile grid, or a hierarchical zone/region/country grid? `MAIN.DO`'s embedded level-editor strings (`NUMERO DE CONTREE/ZONE/CODE`, `POSITION X/Y`, `EDITER TABLEAU ?`) point to a hierarchical coordinate model populated with discrete named location screens (village/temple/rampart/forest/lake) — CROSS-TITLE evidence now: found independently, with near-verbatim matching wording, in ALL THREE of Ishar 1/2/3's own `MAIN.DO`, not a one-off. Still HYPOTHESIS: no disassembly trace of what reads these fields, and `MAP.DO`'s decoded byte content (dominant-value histogram, consistent with *some* tile-raster region) not yet mapped to a grid geometry | `docs/ishar/amigaaga/data-structure.md` §3-4, `docs/ishar2/amigaaga/data-structure.md` §3, `docs/ishar3/amigaaga/data-structure.md` §2 | 2026-08-30 |
| ishar-firstperson-view-mechanism | open | Is there a per-depth wall-tile compositor, or a generic vector/placement-list scene format? STRUCTURAL evidence now favors the latter: `MAP.DO`, every Ishar-1 `*CAVE*.DO`, several outdoor/monster graphics, AND Ishar-2's `DJ*.DO` dungeon files all share one identical 16-byte header shape across both games — arguing for one generic scene/resource descriptor, not a dedicated per-content-type format. Not traced in disassembly; next step is finding what reads the offset-21 subtype byte. Separately CONFIRMED via decoded in-game text (Crystals' `MANUEL.CO` manual table of contents lists `THE MAP` and `3D MODE` as two distinct named systems) that the overworld and first-person views really are two separate player-facing modes in this engine, not a modern RE assumption — the *mechanism* question is still open, just the *existence of two modes* no longer is | `docs/ishar-container-format.md` §6, `docs/ishar/amigaaga/data-structure.md` §5, `docs/crystalsofarborea/amiga/data-structure.md` §4 | 2026-08-30 |
| ishar-fic-files | open | `.FIC` files (`CONT<N>.FIC`, `TAB1.FIC`, `EN1.FIC`, `RAZ.FIC`, `INIT.FIC`, `system-configuration`) have a structurally distinct, un-decoded format (no `.DO`/`.CO` header shape). Low priority per task brief — quick glance only, no decode attempted | `docs/ishar-container-format.md` §5 | 2026-08-30 |
| ishar-map-grid-geometry | open | `MAP.DO`'s decompressed payload (21,368 B) has a dominant-byte histogram plausible for a tile raster (`0x88` 21%, `0x66` 16.6%), unlike the cave files (dominant byte `0x00`) — but no width/height/tile-bank fields identified yet, so no actual grid could be rendered this pass | `docs/ishar/amigaaga/data-structure.md` §3 | 2026-08-30 |
| ishar-scene-header-subtype-byte | open | The shared 16-byte scene header (`ishar-firstperson-view-mechanism`'s evidence) has a varying byte at offset 21 (`0x0a` graphics/Ishar-1 caves, `0x47` Ishar-2 dungeon files, `0x1e` a third subgroup) that looks like a content-subtype discriminator — not traced to any consumer code | `docs/ishar-container-format.md` §6 | 2026-08-30 |
| ishar-t3-crystals-executable-trace | deferred | Ishar 3's `START` and Crystals' `T.X` were not disassembled this pass (only Ishar 1's `T.X` was traced) — the `0xA1`/`0x81` codec port is now verified corpus-wide by output self-consistency + readable content instead, which is strong enough evidence to not require this, but a direct trace on a second title's executable would still strengthen the "one shared codec" claim further | `docs/ishar-container-format.md` §1, §2.5 | 2026-08-30 |
| ishar-png-render | open | No PNG has been rendered yet from any decoded resource — pixel format/dimensions/palette are all still unconfirmed even with decompression fully working; `ORC.DO`/`VILLAGE.DO`/etc. are the most promising graphics candidates (share the scene-header shape, §5 of the Ishar-1 doc) | `docs/ishar/amigaaga/data-structure.md` §5 | 2026-08-30 |

## Session log

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
