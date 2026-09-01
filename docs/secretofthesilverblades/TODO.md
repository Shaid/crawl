# Secret of the Silver Blades — open work

Single status surface for this game (Amiga only). See
`docs/secretofthesilverblades/amiga/data-structure.md` and
`docs/goldbox-glib-format.md` for format details — this file only tracks
what's still open, never restates findings.

Third of four sibling Gold Box titles staged in this repo. See
`docs/curseoftheazurebonds/TODO.md` for the first sibling opened this same
pass (the shared "GLIB" container's fuller writeup lives there and in
`docs/goldbox-glib-format.md`).

## 2026-08-30 — GLIB container confirmed (same as Curse); wall-slice geometry confirmed; tile-bank pixel layout open (2nd instance)

- "GLIB" container format **CONFIRMED** identical to Curse's — 19/21 real
  `.GLB`/`.TLB` files chain with zero deviation; 2 truncated/corrupted
  (`DISK1/ALWAYS.TLB`, `DISK2/TITLE.TLB` — diagnosed as real floppy-dump
  damage, see `docs/goldbox-glib-format.md` §3).
- `WALLDEF.GLB`'s 156-byte wall-slice geometry **CONFIRMED** — 10/10 real
  entries exact multiples of 156 bytes (`amiga/data-structure.md` §2).
- The per-wall-id nested tile-bank scheme's composite-id arithmetic
  (`10*id+n`) is **CONFIRMED a second, independent time** — Secret's own
  `DISK2/8X8D.TLB` index decomposes exactly against `WALLDEF.GLB`'s own ids
  (`amiga/data-structure.md` §3b), matching Curse's finding and Pool of
  Radiance's original arithmetic.
- The same nested sub-container byte-layout puzzle from Curse (identical
  boilerplate header per entry, doesn't match real allocated span) is
  **confirmed present here too** — a second instance of the same open item,
  not a new one (`amiga/data-structure.md` §3b).
- A weaker "flat" tile-bank render (`DISK1/8X8D.TLB`, smaller 165-tile bank,
  cross-disk from `WALLDEF.GLB`) produced 66 real but visually noisy PNGs —
  labeled low confidence (`amiga/data-structure.md` §3a).

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Reuse Curse's `DISK1/8X8D.TLB`-equivalent flat tile bank against `DISK2/WALLDEF.GLB` | 29/95 candidate renders out-of-range (smaller bank); the 66 that fit render as noise, not coherent wall art | Cross-disk pairing likely semantically wrong here too, same as Curse's own caveat |
| Fixed-header-skip raw-tile decode (N=16) on `DISK2/8X8D.TLB`'s per-wall-id scheme, simplest direct-id wall (id 6) | Sane index range, but visually noisy "zigzag" pattern | Same failure signature as Curse's own attempts — see `caob-tile-bank-layout` |
| Covered by the shared `caob-tile-bank-layout` escalation (same puzzle, 2nd independent instance) | Pending at time of writing | Escalated once for all 3 titles together — see Curse's TODO for the brief and outcome |

## 2026-08-30 (same day, follow-up) — scheme-2 tile bank wired into the extractor and rendered

`caob-tile-bank-layout`'s `re-codebreaker` escalation resolved (see Curse's
TODO); the same fix generalizes here unchanged. 95/95 `WALLDEF.GLB` entries
now render via the semantically-correct scheme-2 pairing
(`walldef2-<id>-wall<n>-view6.png`), 0 skips, 90/95 non-degenerate. See
`docs/goldbox-glib-format.md` §5.7 and `amiga/data-structure.md` §3b's
update block for the composite-arithmetic subtlety (5 slices per wallset)
this integration surfaced.

## 2026-08-31 — `GEO.GLB` dungeon maze grid SOLVED (connectivity); walker built

17 levels' wall/door connectivity **CONFIRMED** (96.5%/97.5% cross-title
self-consistency oracle, same technique as Curse and Pool of Radiance — see
`docs/goldbox-glib-format.md` §7 and `amiga/data-structure.md` §5). Which
WALLDEF wall-art texture faces the player per square is NOT resolved
(escalated to `re-oracle`, shared item `caob-geo-plane01`, see Curse's
TODO). `tools/walker/games-goldbox.ts` provides a real interactive walker
for this title, built on the confirmed grid.

## 2026-08-31 (follow-up) — `re-oracle` escalation SOLVED planes 0/1 + resolved tile-bank index unit (shared with Curse)

Both `ssb-tile-bank-index-unit` and `ssb-geo-plane01` are CLOSED — same
escalation and resolution as Curse's (`docs/curseoftheazurebonds/TODO.md`'s
2026-08-31 follow-up section): a WALLDEF tile byte indexes one whole glyph
block, and GEO planes 0/1 are wall-art TYPE per direction indexing a
level-scoped ECL-loaded wallset table (plane 3's value labels were also
corrected: 0=solid, 1=passable, 2/3=locked door). `tools/shared/
goldbox-geo.ts` and `tools/walker/games-goldbox.ts` corrected accordingly.
See `docs/goldbox-glib-format.md` §7.2/§5.6.

## 2026-09-01 — ECL wallset-slot binding SOLVED for 5/17 levels

`ssb-wallset-ecl-binding` is CLOSED. Same ECL bytecode decode and
reachability-walk resolution as Curse (`tools/shared/goldbox-ecl.ts`)
statically resolved real WALLDEF ids for 5 of 17 levels (15 slots).
`tools/walker/games-goldbox.ts` now renders the real per-cell/per-direction
WALLDEF texture for those levels' cells, falling back to the existing
per-level placeholder elsewhere. Full writeup:
`docs/goldbox-glib-format.md` §7.4; per-title summary: `amiga/
data-structure.md` §5.1.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ssb-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-08-30 |
