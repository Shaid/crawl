# Pools of Darkness — open work

Single status surface for this game (Amiga only). See
`docs/poolsofdarkness/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Fourth and last sibling Gold Box title staged in this repo. See
`docs/curseoftheazurebonds/TODO.md` for the first sibling opened this same
pass (the shared "GLIB" container's fuller writeup lives there and in
`docs/goldbox-glib-format.md`).

## 2026-08-30 — GLIB container confirmed (same as Curse/Secret); wall-slice geometry confirmed; a real format simplification found; no working tile-pixel render

- "GLIB" container format **CONFIRMED** identical to Curse/Secret's — 19/24
  real `.GLB`/`.TLB` files chain with zero deviation; 5 truncated/corrupted
  (the highest of the three titles — `docs/goldbox-glib-format.md` §3).
- `WALLDEF.GLB`'s 156-byte wall-slice geometry **CONFIRMED** — 6/6 real
  entries exact multiples of 156 bytes (`amiga/data-structure.md` §2).
- **A real format simplification found**: Pools packs all of a wall's
  wallset variants (15 slices = 3 wallsets) into ONE outer directory entry,
  rather than Curse/Secret's separate `10*id+n` composite directory entries
  — confirmed via a plain, non-composite 1:1 index (`amiga/data-structure.md`
  §2). The underlying 156-byte slice geometry is unaffected.
- The per-wall-id nested tile-bank byte-layout puzzle (same open item as
  Curse/Secret) is confirmed present a THIRD time, with a DIFFERENT
  game-specific boilerplate constant (15,488/257 tiles here vs 3,660/70 in
  Curse/Secret) — this rules out "hardcoded Curse-specific value" as an
  explanation and supports a genuine, still-unresolved per-build template
  mechanism (`amiga/data-structure.md` §3b).
- **No wall-view PNG could be rendered this pass** — this title's only
  candidate "flat" tile-bank file (`DISK1/8X8DA.TLB`) is degenerate (a
  single id, decoding to zero usable tiles), unlike Curse's and Secret's
  own flat-bank files (`amiga/data-structure.md` §3a).

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Build a flat tile bank from `DISK1/8X8DA.TLB` (only candidate "flat"-scheme file) | Bank size 1 (placeholder only) — the file's sole id (202) has an empty nested sub-container | No usable pixel source found for this title; not pursued further given Curse/Secret's own cross-disk flat-bank pairings are already only weak/moderate evidence, not strong proof |
| Reuse Curse/Secret's fixed-header-skip heuristic on `Disk2/8X8D.TLB`'s per-wall-id scheme | Not re-attempted this pass | Curse's and Secret's identical symptom (2 titles, 2 well-formed hypotheses) already meets this repo's escalation bar for a bounded sub-problem; re-running the same negative on a 3rd title without a new method would not add evidence — see `game-re.md`'s escalation ladder ("two passes returning the same negative... the third pass must change method") |
| Covered by the shared `caob-tile-bank-layout` escalation (same puzzle, 3rd independent instance, different boilerplate constant) | Pending at time of writing | Escalated once for all 3 titles together — see Curse's TODO for the brief and outcome |

## 2026-08-30 (same day, follow-up) — scheme-2 tile bank wired into the extractor; this title's first real texture render

`pod-no-render` resolved: `Disk2/8X8D.TLB` maps `WALLDEF.GLB`'s ids directly
(§2's simplification), so the shared "try the direct id first" logic (added
for exactly this case — see `docs/goldbox-glib-format.md` §5.7) needed no
title-specific code. 90/90 entries render (`walldef2-<id>-wall<n>-view6.png`),
0 skips, 83/90 non-degenerate — Pools' first shipped texture asset.

## 2026-08-31 — `GEO.GLB` dungeon maze grid SOLVED (connectivity); walker built

32 levels' wall/door connectivity **CONFIRMED** (96.6%/95.1% cross-title
self-consistency oracle, same technique as Curse/Secret/Pool of Radiance —
see `docs/goldbox-glib-format.md` §7 and `amiga/data-structure.md` §5).
Which WALLDEF wall-art texture faces the player per square is NOT resolved
(escalated to `re-oracle`, shared item `caob-geo-plane01`, see Curse's
TODO). `tools/walker/games-goldbox.ts` provides a real interactive walker
for this title, built on the confirmed grid.

## 2026-08-31 (follow-up) — `re-oracle` escalation SOLVED planes 0/1 + resolved tile-bank index unit (shared with Curse)

Both `pod-tile-bank-index-unit` and `pod-geo-plane01` are CLOSED — same
escalation and resolution as Curse's (`docs/curseoftheazurebonds/TODO.md`'s
2026-08-31 follow-up section): a WALLDEF tile byte indexes one whole glyph
block (this title's own 257-block/56-byte arithmetic was in fact the
strongest single piece of evidence for that reading), and GEO planes 0/1
are wall-art TYPE per direction indexing a level-scoped ECL-loaded wallset
table (plane 3's value labels were also corrected: 0=solid, 1=passable,
2/3=locked door). `tools/shared/goldbox-geo.ts` and `tools/walker/
games-goldbox.ts` corrected accordingly. See `docs/goldbox-glib-format.md`
§7.2/§5.6.

## 2026-09-01 — ECL wallset-slot binding SOLVED for 32/32 levels

`pod-wallset-ecl-binding` is CLOSED. The previous "0/32, engine revision
computes ids at runtime" verdict was wrong — a `re-oracle` escalation found
Pools of Darkness runs a v1.3 opcode table where wallset loading moved to
opcode `0x21` ("LOAD FILES", 2 operands, 2nd fills all 3 slots), not `0x37`
(now an unrelated NPC-by-name query); the old table's misparse is what
made every "hit" look memory-dereferenced. Re-derived directly from real
`Disk3/ECL.GLB` bytes this session with the corrected table
(`OPCODE_TABLE_POOLS_V13`, `tools/shared/goldbox-ecl.ts`): 28/32 levels
resolve directly (ids in `{1-6}`, this title's own `WALLDEF.GLB` space,
clustering thematically by geo id), and a new `NEWECL` cross-block-chaining
mechanism (found this session, not in the escalation's original report)
resolves the remaining 4 (`17`/`49`/`71`/`84`, each handing execution to a
different block that resolves cleanly) for a clean **32/32, 96 slots** —
full coverage. Full writeup: `amiga/data-structure.md` §5.1,
`docs/goldbox-glib-format.md` §7.4.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| pod-item-dat-vs-items-dat | open | Both `ITEM.DAT` and `ITEMS.DAT` are present; their relationship (which is real/active) not investigated | `amiga/data-structure.md` §0 | 2026-08-30 |
| pod-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-08-30 |
