---
title: Status & Open Work
description: What is solved and what remains open for Abandoned Places 2 (Amiga) - container, packer and tileset geometry are done and exported; level cells, slot destinations and palettes are open.
---

Abandoned Places 2 has had a recon pass and an export pass (2026-11-21, commit
`09a59a1`). The container, packer and tileset geometry are confirmed, and the
tilesets are published as 149 atlases. The colours in those atlases are a
hypothesis.

| Area | Status | Evidence |
|---|---|---|
| `ap2.dir` (617 shipped records, sections 0–3) | **Confirmed** | 4/4 section ends = blob size; 0 contiguity breaks |
| ArtGame packer (shared with AP1) | **Confirmed, committed** | 262/262 packed records: `chk == 0`, input consumed, size exact. `tools/shared/artgame-kernel.ts` |
| Tileset `.def`/`.ofs` geometry | **Confirmed** | 1,962/1,962 non-empty records; every `.bpl` ends at its last record |
| Plane layout (colour first, mask last) | **Confirmed** | 0 non-zero pixels outside the mask over about 110,000 px; mask-first leaks 25–85% |
| Tileset atlases | **Exported** | 149 atlases, 1,962 frames, `public/assets/abandonedplaces2/amiga/sprites/` |
| Palettes for 4-plane set art | Hypothesis | `set_NN.clr` indices 0–15; indices 12–15 look like a run-time ramp |
| Palettes for 5-plane art (monsters, on-wall, items, fire) | Hypothesis, probably wrong | Skeleton `mon_00` renders with orange and blue bones |
| Level grid (32×32 × 8 B) | **Rendered** | 28/28 header invariants; `dng_00` is a coherent maze |
| Cell bytes 0–4 and trailing level blocks | Open | Not decoded |
| Renderer slot destinations | Open | Per-piece geometry known; view placement table not found in `main` |
| `.ani`, `bank*`, `.cfs`, `pic_NN` | Open | Sizes only |
| Text | Standard | Plain ASCII with `\l` codes |
| Music / SFX | Standard | ProTracker `M.K.` and TFMX |

## Open work

- What do `dng_NN.dat` cell bytes 0–4 and the byte-5 flags `0x40`/`0x80` mean,
  and what are the 8 trailing blocks (objects, monsters, events)? `ap2-dng-cells`
- Where in `main` is the slot destination table that places each `.def` record
  in the 192×135 view? `ap2-slot-dest-table`
- How are the `.ani` animations (37,260 B), `bank*.bpl` + `.cfs`, the `pic_NN`
  pictures and the `chrset*` fonts laid out? `ap2-misc-gfx`
- Which palette do the 5-plane images (`mon_*`, `onwl_*`, `items`, `fire`, …)
  use for indices 16–31, and how is the depth or torch ramp in indices 12–15
  written at run time? `ap2-image-palettes`

## What you can check in-game

The notes ask for four checks, which would settle `ap2-image-palettes` and
confirm the slot placement:

1. A first-person corridor in dungeon 0 (set 00): the tint of the front and side
   walls at each depth, the floor and ceiling colours, and whether the lime
   pixels are real.
2. A corridor in a level that uses another set, such as set 03, whose palette is
   the only one that uses indices 16–31, to compare tints.
3. A skeleton (`mon_00`) at near range, for the true monster colours.
4. A door or gate (`gt_`), stairs (`strd_`/`stru_`), a pit and an on-wall
   decoration, to check their placement against the sidecars' `slotX`/`slotY`
   (the x offset inside the frame, and y measured from the top of the 135-row
   view).

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/abandonedplaces2/TODO.md)
for evidence pointers, and [the overview](../) for the format details and the
atlases.
