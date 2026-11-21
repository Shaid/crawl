---
title: Status & Open Work
description: What is solved and what remains open in the Eye of the Beholder III project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/eotb3/dosvga/screens/chargen.png" alt="Eye of the Beholder III character generation title card" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted title-adjacent screen: the Character Generation card. An isolated game-title screen is not yet identified.</figcaption>
</figure>

| Area | Status |
|------|--------|
| Resource/bitmap formats | The AESOP resource container and old-format bitmap families are decoded; 279/312 bitmap palettes resolve to real colour. |
| Dungeon view | The native tile/depth compositor and its five-depth structure are identified. |
| Walker | No walker yet: per-tile VFX dispatch is in AESOP/16 area-class bytecode rather than directly in the native executable. |

## Open work

- Decompile the dungeon-view handlers in the `dungeon`/area-class SOP objects.
- Resolve the remaining letterbox and unmatched wall-palette bitmap families.
- Confirm the `DARK.GFF`/`LICH.GFF` fallback palette and keep the broader AESOP
  bytecode/SAVEGAME work out of the asset milestone.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/eotb3/TODO.md)
for the current 33-palette residual and the bounded walker target.
