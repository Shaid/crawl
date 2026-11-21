---
title: Status & Open Work
description: What is solved and what remains open in the Dungeon Hack project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/dungeonhack/dosvga/screens/hack-Main_Screen.png" alt="Dungeon Hack main title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted Dungeon Hack main screen/title card.</figcaption>
</figure>

| Area | Status |
|------|--------|
| Resource container and bitmaps | Confirmed against the AESOP interpreter; extracted assets are available in the DOS/VGA tree. |
| Palettes | Fixed-region palette assignments are known; 15% of non-fixed old-format bitmap palette assignments remain. |
| Audio | Sample container shape is known; the game's own sample rate and music cue payload remain open. |
| Generated dungeon | The MAZE generator and session-generated data files are explicitly deferred. |

## Open work

- Resolve the 97/632 non-fixed wall/floor/selection bitmap palettes.
- Refine the three `OPEN.RES` scene palette assignments.
- Decode the seven inner `CAT ` music-cue payloads.
- Keep AESOP SOP bytecode and generated-dungeon formats deferred unless the
  project scope expands beyond shipped asset data.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/dungeonhack/TODO.md)
for the six tracked rows.
