---
title: Graphics Formats
description: Wizardry 6 screens, cels, maze art, fonts, portraits and palettes.
---

# Graphics Formats

Wizardry 6 has three important graphics families on Amiga: sparse `.PIC` cels,
fixed `.EGA` full-screen bitplanes and the variable-record `mazedata.ega` art
bank. The DOS/EGA side preserves the shapes with a different compression and
directory detail. The SNES side uses native 2bpp/4bpp tiles, CHR streams and
runtime palette uploads.

## Amiga `.PIC` cels

Each file begins with 25 fixed 26-byte directory slots. A slot contains a
file-relative data offset, tile width/height and a 20-byte LSB-first tile
presence mask. Only present 8×8 tiles are stored, 32 bytes per tile, so the
next directory offset gives a complete zero-residue length check. The cel is a
standalone sprite or picture element, not a horizontal band of a larger image.

<figure>
<img src="/assets/wizardry6/amiga/sprites/monsters.png" alt="Wizardry 6 Amiga monster cel atlas" style="image-rendering:pixelated;width:100%;" />
<figcaption>Amiga monster cels: 712 rendered frames across the 60 `.PIC` files.</figcaption>
</figure>

## `.EGA` screens and maze art

The three full-screen `.EGA` files use fixed 320×200, four-plane bitmaps with
the game palette traced from the executable. `mazedata.ega` is different: its
153 directory records point to variable-size four-plane art blocks, followed
by a 366-entry compose-list sub-table. The game consumes those records to build
the first-person view from perspective pieces.

<figure>
<img src="/assets/wizardry6/amiga/maps/mazedata-indexed.png" alt="Wizardry 6 Amiga mazedata art atlas" style="image-rendering:pixelated;width:100%;" />
<figcaption>The 153-record Amiga maze-art bank, rendered as an indexed atlas.</figcaption>
</figure>

## SNES graphics

The SNES extraction maps the ROM's tile banks and their consumers rather than
pretending they are Amiga bitplanes. Confirmed banks include the opening
sequence, UI icons, portraits, dungeon/environment art, creature sprites and
spell/combat animations. The dungeon view is composed from 1,893 view pieces
and palette groups selected by region.

<div class="image-grid">
<figure><img src="/assets/wizardry6/snes/screens/title-backdrop.png" alt="Wizardry 6 SNES title backdrop" /><figcaption>SNES title backdrop.</figcaption></figure>
<figure><img src="/assets/wizardry6/snes/sprites/portraits.png" alt="Wizardry 6 SNES portrait tiles" /><figcaption>Confirmed portrait bank.</figcaption></figure>
<figure><img src="/assets/wizardry6/snes/sprites/spell-animations.png" alt="Wizardry 6 SNES spell animation atlas" /><figcaption>Spell and combat animation bank.</figcaption></figure>
</div>

<style>
{`
figure { margin:1.25rem 0; }
figcaption { color:var(--sl-color-gray-3); font-size:.86rem; margin-top:.4rem; }
.image-grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(12rem,1fr)); }
.image-grid img { background:#08080b; image-rendering:pixelated; max-height:22rem; object-fit:contain; width:100%; }
`}
</style>
