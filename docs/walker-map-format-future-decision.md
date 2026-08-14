# Walker map format — future normalisation decision

**Status: deferred** — more games need decoding before committing to one model.
This document collects the findings so far so the decision can be made with full
context when the time comes.

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
