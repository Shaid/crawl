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

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| pod-tile-bank-index-unit | open | Shares `caob-tile-bank-index-unit` (tile-vs-block index unit); this title's 257-block/56-byte banks against a byte index are the strongest evidence for the block reading | `docs/goldbox-glib-format.md` §5.6 | 2026-08-30 re-codebreaker |
| pod-item-dat-vs-items-dat | open | Both `ITEM.DAT` and `ITEMS.DAT` are present; their relationship (which is real/active) not investigated | `amiga/data-structure.md` §0 | 2026-08-30 |
| pod-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-08-30 |
