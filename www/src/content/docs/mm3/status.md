---
title: Status & Open Work
description: What is solved and what remains open in the Might & Magic III project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/mm3/amiga/screens/intro.cc_e1.png" alt="Might and Magic III title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted Amiga intro/title screen.</figcaption>
</figure>

| Area | Status |
|------|--------|
| Amiga `.cc` archives | 553 entries decode through the game's LZ77 container path. |
| DOS `MM3.CC` | 558 entries decode through the encrypted TOC and LZHUF path. |
| Sprite cells | 1,811/1,811 Amiga frames decode byte-exact; monster, face, icon, picture and outro groups render coherently. |
| DOS graphics | Screens, palettes, sprites, monster data and indoor view tables are extracted. |
| Maze records | Indoor and outdoor maze structures are decoded, including the real per-position indoor view and the outdoor layer semantics. |
| Viewer | Amiga and DOS extraction/viewer hooks are present; browser verification and the last outdoor promotion remain. |

## Open work

- Finish the DOS-side live browser verification (`mm3-wire-viewer`).
- Promote the verified outdoor draw list into the TypeScript walker and replace
  the older terrain colour swatches with real art (`mm3-outdoor-view-port`).
- Keep the remaining monster-stat and maze-trailer unknowns explicit rather than
  naming them from visual similarity alone.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/mm3/TODO.md)
for the current row-level ledger.
