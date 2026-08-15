# Walker map format — future normalisation decision

**Status: deferred** — more games need decoding before committing to one model.
This document collects the findings so far so the decision can be made with full
context when the time comes. Scope grew 2026-08-15 to also cover **rendering
engine** normalisation (not just wall-storage format) — see that section below;
same "defer" conclusion, same reasoning.

---

## The two models in use today

### Per-cell redundant (Black Crypt, MM2, MM3, EotB1/2, LoL)

Each cell independently stores **all four of its own face values**. The wall between
cell A and its northern neighbour is encoded once on A (as A's north face) and again
on the neighbour (as its south face). The two values can differ — the game simply
never writes inconsistent data.

In the `@seer-project/dungeon` schema this is `wallStorage.kind = 'bitflags'` (BC,
1-bit per face) or a natural extension to 2-bit face values (MM2: N=bits 0-1,
E=2-3, S=4-5, W=6-7 packed into one byte per cell).

### Shared-edge (Wizardry 6)

Each wall edge is stored **once**, on whichever of its two adjacent cells "owns"
that plane. W6 uses `wallA` = north face, `wallB` = east face; querying a south or
west face requires reading the *neighbour's* `wallA`/`wallB` respectively. This is
`wallStorage.kind = 'shared-edge'` in the schema.

---

## Can W6's format be converted to per-cell?

Yes, trivially — one pass over the grid, copying neighbour values in:

```typescript
wallS[i] = y > 0 ? wallA[(y-1) * width + x] : FILL_WALL;
wallW[i] = x > 0 ? wallB[y * width + (x-1)] : FILL_WALL;
```

The only thing lost is the non-redundancy guarantee (there is now nothing enforcing
that A's south face agrees with B's north face). In practice this doesn't matter
since the source data had only one value for that edge to begin with.

---

## What one can do that the other cannot

### Asymmetric walls — per-cell wins

**Per-cell** handles asymmetric faces naturally: a torch on only the north face of a
wall, a secret door that looks like wall from one side and open from the other, an
alcove recess that only exists on one side — these are just different values on each
cell's face field. No extra mechanism needed.

**Shared-edge** cannot express face asymmetry in the wall planes at all: there is
literally one value for each edge. W6 compensates with the `feature`/`orient` planes:
a torch or alcove is a feature code on a specific cell with an orientation direction,
and `evalCellFace`'s 16-entry dispatch table converts it to a different return value
depending on whether the feature's orientation matches the viewer's facing. This is
more structured than ad-hoc asymmetry, but it is an *extra mechanism* required to
cover a gap in the base model.

| Scenario | Per-cell | Shared-edge |
|---|---|---|
| Torch on one side of a wall only | Different face value on each cell — free | Needs a feature code + orient on the decorated cell |
| Alcove / recess (open one side, wall the other) | Open on one cell's face, wall on the other — free | Cannot express in wall planes; needs a feature code |
| Secret door (wall from one side, open from other) | Different wall values on each cell's face — free | Needs a feature code dispatching differently based on orient vs facing |
| Symmetric door | Both cells' shared face = door by convention | Single value — natural and enforced |
| One-way passage | Different walkable/blocked values each direction — free | Needs a feature code or a separate movement-gate mechanism |

### Data integrity — shared-edge wins

Shared-edge makes it **impossible** for the two faces of a wall to disagree: there
is only one value. Per-cell models rely on the game never writing inconsistent data.
In practice this never causes problems (every game in this corpus is read-only from
the engine's perspective), but it is a genuine semantic advantage if you ever write
map data back.

### Query ergonomics — per-cell wins

Querying any face of any cell is a single array read with no branching.
Shared-edge requires a four-case switch to decide whether to read from the current
cell or a neighbour, plus bounds checks on the neighbour lookup. This is the entirety
of `evalCellFace`'s complexity budget.

---

## Outdoor / overworld areas

**Per-cell** is straightforwardly fine for outdoor maps. MM2 uses the identical
byte-per-cell scheme for its 16×16 outdoor screens as it does for dungeons. MM3's
outdoor world is a large flat tile grid, same format. Each cell independently records
what faces it presents; the redundancy is irrelevant at outdoor scale where most
cells are open ground anyway.

**Shared-edge** is theoretically cleaner for outdoor maps (open ground = wallA=0,
wallB=0; no data duplication), but the redundancy in per-cell models costs nothing
at outdoor scale either — open ground is just `0x00` per cell in both models.
The real issue for outdoor maps is usually **different data concerns** entirely:
elevation, tile type, encounter tables, transitions to indoor areas. Neither wall
model has a meaningful advantage there; both treat outdoor as "another flat grid."

One concrete case where shared-edge could be awkward outdoors: **cliff faces and
one-sided barriers** (you can walk up to a cliff from the south but not from the
north). Per-cell handles this trivially. Shared-edge would need feature codes for
it, the same as with indoor asymmetric walls.

---

## Per-game survey (as decoded so far)

| Game | Model | Face storage | Notes |
|---|---|---|---|
| Black Crypt | Per-cell redundant | 1-bit flags (N/E/S/W) per cell | `wallStorage.kind='bitflags'`; asymmetric walls used (one-way passages, directional features) |
| MM2 | Per-cell redundant | 2-bit values (N/E/S/W) packed in 1 byte per cell | 0=open, 1=wall, 2=wall+torch, 3=door; separate collision page mirrors visual page |
| MM3 | Per-cell redundant | Same as MM2 | Same engine/company as MM2 |
| Eye of the Beholder 1 & 2 | Per-cell redundant | 1–2 bit flags per face, packed per cell | Objects in a separate linked list indexed by cell |
| Lands of Lore | Per-cell redundant | Per-cell bitfield | Same Westwood team as EotB; objects/events in separate tables |
| Wizardry 6 | Shared-edge | 2-bit value per edge, stored once | wallA=north, wallB=east; south/west read neighbour; feature+orient planes handle face asymmetry |

---

## Open questions before deciding

- **What model do the remaining target games use?** If every unimplemented game
  uses per-cell, normalising to that model eliminates a code path and simplifies
  `FlatGridLevel` and all query code. If another game uses shared-edge (or a third
  model), that changes the calculus.

- **Does any future game rely on shared-edge's consistency guarantee?** If a game
  writes map data at runtime (procedural generation, save-game mutation), shared-edge
  prevents a class of bugs. Per-cell doesn't.

- **Is the `feature`/`orient` mechanism worth keeping distinct from the wall planes?**
  W6's system is clean and general — it separates "is there a wall here" from "what
  decorates this face." If you force W6 to per-cell, you either lose that distinction
  or you need to carry `feature`/`orient` as separate planes anyway (which is fine —
  they already are separate planes in the exported JSON).

- **Does the walker's rendering pipeline care?** The `@seer-project/dungeon` schema
  already abstracts both models behind `wallStorage`. The package's `FlatGridLevel`
  handles `shared-edge` via `sharedEdgeValueAt`; per-cell is simpler. Normalising W6
  to per-cell would let you delete `sharedEdgeValueAt` and its callers, but only if
  no future game also needs it.

---

## Recommendation (current state)

**Do not force one model yet.** The schema's abstraction is working. When all target
games are decoded, revisit with the complete survey: if shared-edge is W6-only,
normalise it on import and simplify the schema. If another game uses it, keep both.

The conversion from shared-edge to per-cell is cheap (one pass, no information loss
for read-only maps), so deferring costs nothing — the option remains open.

---

## Rendering engine normalisation (2026-08-15 survey)

A parallel question to the map-*format* one above: are the walker's rendering
engines themselves bespoke per game, or already normalised? Prompted by a user
question during MM3 walker debugging. Findings:

### Already two shared families, not five bespoke engines

| Family | Games | Renderer | Art representation |
|---|---|---|---|
| Slot-table / `DrawItem` composite | Black Crypt, Wizardry 6 | `@seer-project/dungeon`: `buildViewList.ts` (BC) / `tools/wizardry6/view-model.ts` (W6) emit `DrawItem[]`, composited by `compositeDrawList`/`IndexedSurface`/`CanvasPresenter` | Indexed (EHB/VGA-ramp) palette raster |
| Frustum blit engine | MM1, MM2 | `tools/walker-mm/maze3d.ts` (`buildIndoorScene`), draws `Blit`s straight to canvas via `drawImage` | Full-colour RGB sprite sheets |
| Bespoke (unshared) | MM3 | `tools/walker/mm3-indoor-view.ts` `buildWallList`, own 44-slot chain/guard dispatch, straight to canvas | Full-colour RGB sprite sheets |

So today's real shape is **two normalised engines covering four games, plus one
holdout**, not five one-off renderers. Both existing normalisations already carry
per-game config as *data*, matching exactly what was asked about (forward/lateral
depth, animation speed):

- Slot-table family: `SlotTableFile.depthCount`, `.lateralOffsets`,
  `.frontWallMaxDepth` (view extent); `AnimRef.ticksPerFrame`/`.periodTicks`/
  `.phase` (animation, e.g. Black Crypt's torches) — all in `slots.json`, none
  hardcoded in `buildViewList.ts` or the compositor.
- Frustum family: `maze3d.ts`'s depth-lane/blit-size tables are shared code, but
  per-screen wall-art selection (which `.32`/WALLPIX slice per lane) is already
  per-game/per-screen data (`wallEntries`, env lookup).

### Why MM3 doesn't fit either existing family

**Not the frustum family**: MM3 needs richer geometry than a few frustum lanes —
every one of 44 real screen positions (not just depth-0-front) needs its own real
per-position frame (confirmed against disassembly; using the frustum here was
tried first and is still the walker's degraded fallback when MM3's own table
fails to load — see `docs/walker-mm.md`).

**Not the slot-table family, without extending it** — this is the more
interesting gap, worth stating precisely. `SlotTableFile.slots` is a **direct
lookup**: one fixed screen key (`"front:<lateral>:<depth>"` etc.) → one `Slot`
(a fixed list of `PieceDraw`s), looked up unconditionally by `pushSlot`
(`buildViewList.ts`). It has *no* concept of "draw different art depending on
what kind of wall is here" built into the data — Black Crypt's own kind-varying
features (open/closed doors, alcove orientation) are **not** expressed in
`slots.json` at all; they're bespoke hardcoded TypeScript (`pushDoor`'s
`DOOR_FRAME_SLOTS`/`DOOR_LEAF_SLOTS` tables, `pushProps`'s per-type gating) that
sits *beside* the data-driven slot table, one function per feature class.

MM3's own system is a genuine generalisation of that exact problem: 44
geometry probes (`Slot.geom[facing] → (dx,dy,mask)`) each resolve a nearby
cell's wall-kind (0–7) and, via a per-probe 7-way dispatch (`Slot.arms[kind]`),
set a subset of a shared flag pool; a separate list of ~54 content **chains**
(keyed by output sprite, not by screen position) each check a suppression
precondition (`pre`: any of these flags active → don't fire — MM3's occlusion
mechanism, since chains can spatially overlap) and then draw the first `item`
whose `guards` intersect the active flags. That's expressive enough to cover
"7 possible wall kinds × 44 positions × torch-flicker × side-alternation" as
*data*, where Black Crypt currently needs one bespoke function per kind-varying
feature. See `tools/walker/mm3-indoor-view.ts` and
`docs/mm3/dosvga/data-structure.md` "Indoor 3-D view" for the real, verified
shape this is generalising from.

### Recommendation

Same as the map-format question above: **don't force a merge yet.** Two
normalisations already happened opportunistically, where the underlying games
were similar enough that sharing cost nothing. MM3 needed its own fidelity-first
decode instead of being bent to fit an existing engine, and that paid off
directly — the real disassembly-traced chain table is what let the recent
mirror-origin bug (`tools/walker/games-mm3.ts` `blitSprite`) be found and fixed
precisely, instead of papering over a symptom. Forcing MM3 into the slot-table
schema now, for a game family with no other members, would trade that fidelity
for an abstraction with no second user yet.

The concrete trigger to revisit: **a future game whose per-position art depends
on more than one discrete "kind" value with real occlusion between pieces** (the
thing MM3 needed and Black Crypt/W6 haven't). If one shows up, the superset
schema below is the shape to build toward — until then it's a sketch, not a
plan.

---

## MM3-compatible superset schema (sketch)

Not a proposal to implement now — a concrete answer to "what would it take,"
kept ready for the trigger condition above. Purely **additive** to
`SlotTableFile` (`@seer-project/dungeon`'s `schema/slots.ts`): existing
`slots`/`staticSlots`/`banks`/`ordering` fields, and every current consumer
(`buildViewList.ts`, `view-model.ts`), are untouched. A game opts in by
populating the two new fields instead of (or alongside) `slots`.

```typescript
/** One of the 44-style view-geometry probes MM3's `Slot.geom` represents,
 * generalised: for a given facing, which nearby cell/edge to query, and how
 * a raw wall-kind value there maps to flags in the shared pool below. */
interface GeometryProbe {
  id: string;
  /** Per facing (index = Dir4): [dx, dy, edgeMask] — same shape as MM3's
   * `Slot.geom[facing]`, `edgeMask` selecting which of the queried cell's
   * edges/kind field to read (game-specific encoding, opaque to the schema —
   * `CellQuery`-level, same abstraction `evalCellFace` already uses). */
  geom: [dx: number, dy: number, edgeMask: number][];
  /** Raw kind value (0..N) -> flag ids to activate. Index = kind. Mirrors
   * MM3's `Slot.arms[kind]`. */
  arms: string[][];
}

/** A conditional draw, generalising MM3's `Spec` (`imm`/`alt`/`alt2`/`pair`/
 * `pairinv`/`torch`) — picks a concrete value from per-redraw state. Reuses
 * `AnimRef`'s tick-driven idea for the common animated case instead of a
 * bespoke enum; `pair`/`pairinv`/`alt2` cover MM3's side-wall-alternation
 * idioms specifically (a 2-entry toggle keyed off a redraw counter, and its
 * left/right-inverted sibling — see `docs/mm3/dosvga/data-structure.md`
 * "Indoor 3-D view", DS `0x185`). */
type ConditionalValue =
  | number
  | AnimRef
  | { kind: 'toggle'; values: [number, number]; invert?: boolean };

interface ConditionalItem {
  /** Fires only if at least one of these flags is active. Empty = always. */
  guards: string[];
  destX: number;
  destY: number;
  frame: FrameRef | ConditionalValue;
  mirrorX?: ConditionalValue | boolean;
  blend?: BlendMode;
}

/** Generalises MM3's `Chain`: content keyed by what it draws, not by a fixed
 * screen slot, because a chain's screen position can depend on which item
 * fires (MM3: alternating left/right pair frames at the same x,y but a chain
 * can also represent occlusion-gated variants at different positions). */
interface ConditionalChain {
  bank: string;
  /** Suppresses the whole chain if any of these flags is active — MM3's
   * occlusion mechanism (a nearer piece's flag blocks a farther chain that
   * would otherwise overlap it). Empty = never suppressed. */
  pre: string[];
  /** Evaluated in order; the first item whose `guards` intersect the active
   * flag set draws (mirrors MM3's `buildWallList`: "for each chain, for each
   * item in order, first match wins, then move to the next chain"). */
  items: ConditionalItem[];
}

interface SlotTableFile {
  // ...existing fields unchanged...

  /** Opt-in probe/chain dispatch (MM3-style). A consumer that populates this
   * runs probes once per redraw to build the active flag set, then evaluates
   * every chain against it — see `tools/walker/mm3-indoor-view.ts`
   * `buildWallList` for the reference algorithm this generalises (keep them
   * in sync if this is ever implemented for real; that function is verified
   * against a live-disassembly oracle and should stay the source of truth
   * for the dispatch order/semantics, not be redesigned from scratch here). */
  probes?: GeometryProbe[];
  chains?: ConditionalChain[];
}
```

Notes on the design, not just the shape:

- **Why chains key by content, not position** — a direct `Record<posKey,
  Slot>` (like today's `slots`) can't express "this position's art depends on
  a *combination* of nearby cells' kinds, and a nearer combination should
  suppress a farther one" without either duplicating the position key per
  kind-combination (combinatorial blow-up — MM3 has up to 7 kinds × several
  contributing probes per screen position) or adding conditional logic
  *inside* a slot (which is what `chains`/`pre`/`guards` are — just factored
  out as their own list instead of nested inside `Record<string, Slot>`).
- **Backward compatible by construction**: `probes`/`chains` are optional; a
  consumer that doesn't set them (BC, W6 today) never evaluates them. A future
  MM3-style consumer could *also* use plain `slots` for its simple fixed
  pieces (ceiling/floor `staticSlots`, exactly as MM3's own walker already
  does for its floor/sky backdrop) and only reach for `probes`/`chains` where
  real kind-dependent dispatch is needed.
- **What this would buy Black Crypt for free, if adopted retroactively**: its
  door-frame/door-leaf open-vs-closed dispatch (`pushDoor`'s hardcoded
  `DOOR_FRAME_SLOTS`/`DOOR_LEAF_SLOTS`) and alcove-orientation gating
  (`pushProps`) are exactly the kind of "one screen position, several possible
  contents selected by a discrete state" problem `chains`/`guards` generalise
  — they could become data instead of one bespoke function per feature class.
  Not a reason to do this now (nothing is broken there today), but a sign the
  abstraction has a real second use, not just a fit-MM3-and-stop shape.
- **Deliberately not attempted**: unifying `PieceDraw`/`ConditionalItem`
  outright (they're kept as two related-but-separate shapes above) or folding
  `probes`/`arms` into `CellQuery`/`evalCellFace` directly. Both are real
  follow-on questions but need a second real consumer to design against —
  guessing the right shape from one data point (MM3) risks the same trap this
  whole document exists to avoid with the map-format question.

---

## Further prior-art survey (2026-08-15): games in `data/_unexplored_/`

Asked directly: of the games sitting in `data/_unexplored_/` but not yet
decoded here, which are "easy" because prior art (ScummVM, long-standing fan
RE communities) already documents them, and how would they land in the two
decisions above? Confidence is graded per game — **this repo** (actually
decoded/verified against real files here) is a different tier from
**external prior art** (well-established public documentation, not yet
cross-checked against the specific files in this corpus) is a different tier
again from **general recall, needs real RE**. Don't skip straight to treating
any of these as settled the way the "Per-game survey" table above is — that
table is repo-verified; this one mostly isn't yet.

### Eye of the Beholder 1/2 and Lands of Lore — confirmed, already this repo's tier 1

Not new findings, just closing the loop the user asked about: EOB1
(`docs/eotb/`), EOB2 (`docs/eotb2/`), and Lands of Lore (`docs/landsoflore/`)
are **already decoded in this repo**, sourced directly from ScummVM's engine
source (`docs/eotb/TODO.md`'s "2026-08-02, ScummVM source" entries) and the
public ModdingWiki EOB maze-format page. All three are per-cell redundant,
and — a nice confirmation of the family resemblance already claimed in the
survey table above — **Lands of Lore doesn't even have its own maze format**:
its `.CMZ` is "just an LCW-compressed copy of the same MAZ grid format EOB
uses" (`docs/landsoflore/landsoflore-formats-research.md:10-11`), `CHAR[N][4]`
N/E/S/W bytes per tile, byte-for-byte the same shape as EOB's `.MAZ`
(`docs/eotb/amiga/eotb-maze-spec.md`). These three add zero new rows to the
map-format decision (already "per-cell redundant", already in the table) —
their real relevance is to the **rendering-engine** question: no walker
exists for any of them yet, so which family (if either) they'd join is still
open. Given their per-cell wall storage and door/decoration-as-separate-flag
model reads structurally close to Black Crypt's, the slot-table family is the
first thing to try when a walker gets built — worth checking against the
MM3-compat superset above only if that turns out not to be enough (their
`.MAZ`/`.INF` door and decoration model looks close to Black Crypt's own
prop/door mechanism, not MM3's richer per-position kind dispatch, but this is
a hypothesis to test against real decode work, not yet a finding).

### Dungeon Master, Chaos Strikes Back, Dungeon Master II — external prior art, likely a third wall model

**Not decoded in this repo** (`data/_unexplored_/DungeonMaster{,2}`,
`ChaosStrikesBack` — Amiga WHDLoad dumps, `Dungeon.DAT`/`DungeonF.DAT`/
`DungeonG.DAT` headers spot-checked, not parsed). The map format itself is
**exceptionally well documented publicly** — decades of community reverse
engineering (the long-standing "Dungeon Master Encyclopaedia" fan site, plus
open-source engine reimplementations) have produced a mature, widely-cited
spec, distinct from ScummVM (DM was never a ScummVM target — it's not a
SCUMM-family adventure game). Recalled from that public prior art, **not yet
cross-checked against this repo's own dump**, so treat the specifics below as
a hypothesis to verify, not a citation-grade fact the way the EOB/LoL section
above is:

- DM's dungeon grid doesn't store per-face wall bytes **at all** — each
  square has a *type* (Wall, Open/Corridor/Room, Diagonal corner (4
  variants), Pit, Stairs, Door, Teleporter, ...) and a square only ever
  blocks movement/renders as a wall because *it itself* is Wall-typed, not
  because a neighbouring Open square carries a "there's a wall here" byte.
  Whether a given Open square shows a wall face on its north side is
  computed by asking "is my north neighbour a Wall square", not stored
  redundantly per-cell (per-cell model) or once per shared edge (shared-edge
  model) — the wall's existence is *derived from cell type*, stored on
  neither adjacent walkable cell. That's a **third category** neither of the
  two models above describes cleanly: call it **type-derived** for this
  document. It happens to guarantee the same consistency shared-edge does
  (a wall can't disagree with itself since there's only one type value per
  square, not per face), for a different structural reason.
- Doors are their own square type with an orientation bit (does the door
  bisect the square N-S or E-W) rather than a face value — closer in spirit
  to Wizardry 6's `feature`/`orient` planes than to per-cell face bytes.
  Items/monsters are a separate per-square linked list, same shape as EOB's
  already-noted "objects in a separate linked list indexed by cell".
- Chaos Strikes Back reuses DM1's engine and format essentially unchanged
  (same developer, same year, positioned as an expansion) — high confidence
  by genre/production-history reasoning, not independently checked here.
  Dungeon Master II (1995, different era, adds diagonal movement and
  higher-resolution VGA art) is likely a related but **not** byte-identical
  format — lower confidence than the DM1/CSB claim, flagged separately in
  case a future pass finds it diverges more than expected.

**Rendering-engine hypothesis, same confidence caveat**: DM's classic
first-person viewport is composited from a fixed set of named screen
positions (per depth/lateral slot, plus static floor/ceiling, plus animated
door-slab frames as the door slides open) — structurally the same shape as
the slot-table family's `Slot`/`PieceDraw` model, *not* MM3's richer flag/
chain dispatch (DM's per-position content is driven by one adjacent cell's
type, not a multi-probe occlusion-gated combination). Worth stating plainly:
**Black Crypt is a Dungeon-Master-styled dungeon crawler**, and the existing
`SlotTableFile` shape (`schema/slots.ts`'s own doc comment: "This is the file
M1 hand-authors from Black Crypt's fully-numeric front-wall/side-wall
placement tables") reads as directly descended from this exact family of
engine design. If that holds up under real decode work, DM/CSB (and possibly
DM2) would be the slot-table family's **third and fourth members**, not a
new bespoke engine and not a trigger for the MM3-compat superset — genuinely
good news for the "don't force normalisation" stance above, since it'd mean
the existing abstraction already covers more of the genre than the four
currently-implemented games suggest.

### Elvira, Elvira II, Waxworks (AGOS engine) — needs real RE, not just citation

**Lowest confidence tier of this survey — do not treat anything below as
established.** These three (plus Simon the Sorcerer 1/2, Personal Nightmare,
The Feeble Files) are commonly grouped under Adventure Soft's "AGOS" engine,
which ScummVM does support (`engines/agos/`) — but AGOS's ScummVM
implementation is documented and battle-tested for its point-and-click
adventure/puzzle mode, which is the bulk of what those games are. Elvira 1,
Elvira 2, and Waxworks each *also* have a first-person real-time dungeon-
crawl combat sub-mode (a comparatively minor feature of a much larger
adventure game), and general recall does not extend to that sub-mode's map
data format with any real confidence — unlike Dungeon Master above, this
isn't "well-documented, just not cross-checked here," it's "plausibly
documented somewhere in the ScummVM source or wiki, not established from
memory." A quick look at the actual corpus here doesn't help narrow it down
either: `data/_unexplored_/{Elvira,Elvira2,Waxworks}/data/*.pkd` are opaque
packed/compressed resource blobs (no readable structure without AGOS's own
decompressor), consistent with AGOS's known "VGA" resource-bundle
convention but not informative on their own.

**Before this franchise can be added to either survey table for real**, the
next step is a proper `game-re` pass against ScummVM's actual `engines/agos/`
source (the same approach that produced the EOB1 findings above, not a
recall-and-hope pass like the DM section) — specifically the dungeon/combat
sub-mode's room/grid data structure and its renderer, if ScummVM implements
that mode at all (worth confirming first; it's possible ScummVM treats the
combat sub-mode as out of scope the way it's historically deprioritised some
minigames in other engines). Until then: **no claim about AGOS's wall model
or rendering shape belongs in either decision** — this section exists to
record that the gap was checked and found to need real work, not to leave it
silently unconsidered.

### Summary for the two decisions

| Game | Map-format fit | Rendering-engine fit | Confidence |
|---|---|---|---|
| EOB1, EOB2 | Per-cell redundant (existing category) | Untested; slot-table family suspected | This repo (format); untested (renderer) |
| Lands of Lore | Per-cell redundant, byte-identical to EOB's | Untested; slot-table family suspected | This repo (format); untested (renderer) |
| Dungeon Master, Chaos Strikes Back | New category: **type-derived** (wall existence comes from cell type, stored on neither adjacent cell) | Slot-table family suspected (Black Crypt likely descends from this engine's design) | External prior art, not repo-verified |
| Dungeon Master II | Probably type-derived like DM1/CSB, format likely diverges in specifics | Probably slot-table family, less certain than DM1/CSB | External prior art, lower confidence |
| Elvira, Elvira II, Waxworks | Unknown | Unknown | Needs a real `game-re` pass against ScummVM's AGOS source before any claim |

---

## Second sweep (2026-08-15, part 2): what else did we miss

Two follow-up questions: (a) are there other dungeon crawlers already sitting
in `data/_unexplored_/` that the first pass didn't flag, and (b) are there
other well-documented engines (ScummVM or otherwise) for the genre entirely
missing from the corpus. Web-verified this time (not recalled-and-hedged like
the Dungeon Master section above) — every genre claim below has a citation.

### (a) Already in the corpus, missed by the first pass

The first pass only looked at the games the user named. The rest of
`data/_unexplored_/` wasn't screened for genre at all. Checked now, against
each game's `ReadMe`/`Manual` locally plus external confirmation:

| Directory | Game | Confirmed genre | Source |
|---|---|---|---|
| `abandonedplaces` | Abandoned Places: A Time for Heroes (1992, ArtGame) | Dungeon crawler, explicitly "plays similar to Dungeon Master" | [Wikipedia](https://en.wikipedia.org/wiki/Abandoned_Places:_A_Time_for_Heroes) |
| `abandonedplaces2` | Abandoned Places 2 (1993, ICE) | Same engine family; local Manual text confirms ("five by five grid" inventory, repeated "dungeon" references) | [dungeoncrawlers.org](https://www.dungeoncrawlers.org/game/abandoned-places-2/); local `Manual` |
| `CrystalDragon` | Crystal Dragon (1994, Magnetic Fields) | Dungeon crawler — "follows the same genre and setting as Dungeon Master" (my first-pass guess that this was a side-scroller was wrong; corrected here) | [OldGames.sk](https://www.oldgames.sk/en/game/crystal-dragon); [dungeoncrawlers.org](https://www.dungeoncrawlers.org/game/crystal-dragon/) |
| `EvilsDoomAGA` | Evil's Doom (1996, Olympia Software) | Amiga dungeon crawler RPG (my first-pass guess that this was a Doom-style raycasting FPS was also wrong) | [dungeoncrawlers.org](https://dungeoncrawlers.org/game/evils-doom/) |
| `HiredGuns` | Hired Guns (1993, DMA Design/Psygnosis) | RPG-shooter hybrid — 4 simultaneous first-person viewports, up to 4 players; grid-adjacent but a distinct split-screen multiplayer design, not a single-party crawler | [Wikipedia](https://en.wikipedia.org/wiki/Hired_Guns) |
| `LiberationCD32` | Liberation: Captive II (1994, Mindscape) | Sci-fi RPG, sequel to *Captive* (1990) — "movements in the four directions in a pseudo-3D environment" (grid-stepped, not smooth/continuous) | [Wikipedia: Captive](https://en.wikipedia.org/wiki/Captive_%28video_game%29); [Wikipedia: Liberation](https://en.wikipedia.org/wiki/Liberation:_Captive_2) |
| `Perihelion` | Perihelion: The Prophecy (1993, Morbid Visions/Psygnosis) | Cyberpunk RPG/dungeon-crawler | Wikipedia/MobyGames genre tags (search-confirmed, not independently re-checked) |
| `Zombi` | Zombi (1990, Ubi Soft, Amiga port) | **Not** this genre — first-person action-adventure/survival (Dawn of the Dead-inspired mall exploration), not a grid-based combat dungeon crawler | [Wikipedia](https://en.wikipedia.org/wiki/Zombi_%281986_video_game%29) |

Six of eight. Worth noting for calibration: two of my own first-pass guesses
about these specific titles (Crystal Dragon as a side-scroller, Evil's Doom
as a raycasting FPS) were wrong and caught only by actually checking —
exactly the failure mode the rest of this document exists to avoid, so
none of the six "confirmed dungeon crawler" rows above should be treated as
more than "worth a `game-re` pass" until someone actually opens their data
files. None are decoded here yet; none add a new row to either decision
until that happens.

### (b) Franchises not in the corpus at all, but documented (ScummVM or elsewhere)

- **Might and Magic IV/V ("World of Xeen") — ScummVM, confirmed.** ScummVM
  added a dedicated `xeen` engine; MM4 (*Clouds of Xeen*), MM5 (*Darkside of
  Xeen*), the combined *World of Xeen*, and the fan expansion *Swords of
  Xeen* are all playable through it — [ScummVM compatibility
  page](https://www.scummvm.org/compatibility/2.1.2/mm:worldofxeen/),
  [announcement](https://rpgwatch.com/news/world-of-xeen--supported-by-scummvm-40020.html).
  Directly relevant to this project specifically: MM3's own maze-wall-word
  decode this session already had to explicitly rule out "Xeen's `MazeData`"
  as a false-cognate format (`docs/mm3/dosvga/data-structure.md`: "Xeen uses
  a full 4-bit wall-type value where MM3 splits 3+1"), so Xeen's format is
  already known to be **per-cell but differently packed** than MM1-3's — a
  fifth per-cell variant if it's ever added, not a new category. Not present
  in this corpus at all (no `data/_unexplored_/xeen`-style folder); would
  need its own acquisition before any decode work.
- **Ultima Underworld I/II — confirmed *not* ScummVM, but thoroughly
  documented elsewhere.** The genre's other landmark title (1992, first
  texture-mapped first-person dungeon crawler) was never a ScummVM target;
  it has its own long-standing independent documentation instead — the
  [Codex of Ultima Wisdom wiki's format
  page](https://wiki.ultimacodex.com/wiki/Ultima_Underworld_internal_formats)
  (`LEV.ARK`, level chunks, texture-list chunks — UW1 has "135 (0x87) entries,
  9 levels × 15 blocks"), the independent [bootstrike.com format
  spec](http://bootstrike.com/Ultima/Online/uwformat.php), and open-source
  reimplementations/tools (`uwsav-dump`, the UWE map editor). Underworld's
  engine is famous specifically for **not** being grid-locked the way every
  game in the survey tables above is (smooth movement/rotation, tilted
  floors, freeform texture mapping) — if it's ever added, it likely doesn't
  fit *either* wall-storage category above, and its renderer almost
  certainly doesn't fit either engine family in the rendering-engine section
  (real texture-mapped 3-D, not a discrete-slot compositor at all). Flag
  this as a probable **third+fourth** outlier alongside Dungeon Master's
  type-derived wall model, not a trigger to force anything — same
  "needs a second real consumer" caution as everywhere else in this doc.
- **SSI "Gold Box" engine (Pool of Radiance, Curse of the Azure Bonds,
  Secret of the Silver Blades, Pools of Darkness, the Krynn/Buck Rogers
  spin-offs) — not ScummVM, real independent prior art exists.** An
  [Amiga Development wiki reverse-engineering
  project](http://amiga-dev.wikidot.com/project:pool-of-radiance) documents
  Pool of Radiance's data files (`ByteKiller 2.0`-compressed, with a
  cross-platform unpacker), and the [Gold Box
  Companion](https://gbc.zorbus.net/)/Gold Box Explorer tools exist for
  browsing the format generally. Recalled (not yet re-verified against these
  specific sources' content), with the same hedge as the Dungeon Master
  section: Gold Box's first-person view is primarily decorative — the
  top-down auto-map is the real navigation tool, and the "3-D" window shows
  one of a small library of static pre-drawn scene pictures selected by
  matching the local wall pattern, not a per-depth composited render the way
  DM/EOB/MM/BC are. If that holds up, Gold Box's renderer is **simpler than
  every family in this document** — a single-picture lookup, not a
  multi-slot compositor — and wouldn't need either existing family or the
  MM3-compat superset. Map data storage model (per-cell vs. otherwise) not
  established even at hypothesis level yet.
- **Bard's Tale I/II/III — not ScummVM, deep independent community
  documentation.** [Kroah's Game Reverse Engineering
  page](http://bringerp.free.fr/RE/BardsTale/bard1.php5), a [Z80
  disassembly on GitHub](https://github.com/Bedazzle/Bards-tale) (ZX
  Spectrum port), and the [bardstale.brotherhood.de
  wiki](https://bardstale.brotherhood.de/) collectively document walls,
  doors, "specials" (spinners, teleporters), monster placement, and message
  triggers; the IBM PC level data is Huffman-compressed. Predates Dungeon
  Master (1985 vs. 1987) and, like Gold Box, is generally understood to use
  a simpler nested-rectangle/static-picture first-person view rather than
  DM-style real compositing — same "simpler than everything in this
  document" hypothesis as Gold Box, same low confidence pending a real
  pass. Not present in this corpus.

**Net effect on the recommendation**: none of this changes the "don't force
a merge yet" stance — if anything it reinforces it. The genre spans at least
four structurally distinct wall-storage ideas now (per-cell redundant,
shared-edge, Dungeon Master's type-derived, Ultima Underworld's freeform/
non-grid) and at least three renderer shapes (slot-table, frustum, MM3's
probe/chain dispatch, plus a plausible fourth "static picture lookup" for
Gold Box/Bard's Tale, plus Underworld's real 3-D outside all of them) — more
variety than four games justified normalising around, not less. The concrete
next step, if any of this is worth pursuing, is a real `game-re` pass on
whichever one game is most wanted next, not a speculative schema change.
