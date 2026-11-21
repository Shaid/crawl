---
title: Dungeon & Walker
description: The confirmed Wizardry 6 maze data and first-person view composers.
---

# Dungeon & Walker

The dungeon work is where the Amiga and SNES investigations converge most
usefully: both contain real level geometry and a real view composer, but the
addressing and art systems are completely platform-specific.

## Amiga: from `scenario.dbs` to a view

The initial `mazedata.ega` interpretation was corrected when its consumer was
traced. It is an art bank and compose-list library, not the level grid. The
actual 14-level maze geometry lives in sections 2/3 of `scenario.dbs`, where
the level loader expands region data and the view code evaluates the current
cell and its five visible neighbours.

The current exporter and walker reproduce the confirmed part of that path:

1. Load the selected level's region/cell planes.
2. Apply the facing-to-plane mapping and per-cell feature evaluation.
3. Dispatch front, side, door and feature pieces through the traced view
   tables.
4. Composite the real Amiga art into a 320×200 corridor frame.

<div class="view-grid">
<figure><img src="/assets/wizardry6/amiga/maps/through-dungeon-16-10-f0.png" alt="Wizardry 6 Amiga through-dungeon render" /><figcaption>Cell-driven render from a real level pose.</figcaption></figure>
<figure><img src="/assets/wizardry6/amiga/maps/through-dungeon-30-4-f0.png" alt="Wizardry 6 Amiga dungeon door render" /><figcaption>Another real pose, including a different level's art.</figcaption></figure>
<figure><img src="/assets/wizardry6/amiga/maps/maze-level07.png" alt="Wizardry 6 Amiga level 7 top-down map" /><figcaption>Exported level geometry, level 7.</figcaption></figure>
</div>

The remaining gap is not “find the dungeon format” anymore. It is the runtime
entity/prop layer: deferred records can refer to `.PIC` cel tokens for monsters,
NPCs and decorations, and the shared walker still has Black Crypt-shaped
assumptions that need to become game-neutral.

## SNES: tilemap, CHR and compose libraries

The SNES view is a native composer. The ROM contains expanding-frustum piece
tables, 4bpp dungeon art, region-selected palettes and a level/feature loader.
The decisive sample below is a single compose record that fills the whole
first-person viewport with a carved portal, torches, masonry and a perspective
floor.

<figure>
<img src="/assets/wizardry6/snes/screens/dungeon-view-sample.png" alt="Wizardry 6 SNES first-person dungeon view sample" style="image-rendering:pixelated;image-rendering:crisp-edges;max-width:28rem;width:100%;" />
<figcaption>SNES dungeon-view sample: a confirmed compose-piece render with the real region palette.</figcaption>
</figure>

The SNES maze table is independently cross-checked against the Amiga level
oracle at high agreement, including region origins and the major placement
reversal. Some feature-byte flags and runtime semantics remain open because
they do not affect the current static map and composer proof.

<style>
{`
.view-grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); }
.view-grid img { image-rendering:pixelated; width:100%; }
figure { margin:1.25rem 0; }
figcaption { color:var(--sl-color-gray-3); font-size:.86rem; margin-top:.4rem; }
`}
</style>
