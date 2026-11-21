---
title: Status & Open Work
description: What is solved and what remains open in the Might & Magic I project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/mm1/dosega/screens/title-0.png" alt="Might & Magic title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted DOS/EGA title sequence, screen 0.</figcaption>
</figure>

| Area | Status |
|------|--------|
| `MAZEDATA.DTA` | 55/55 screens decode byte-exact against the independent reference and disk file. |
| `WALLPIX.DTA` / `MONPIX.DTA` | 18 wall sets / 216 frustum slices and 76 monster portraits decode with zero remainder. |
| Roster and title screens | 18 starter characters and 10 title screens are extracted. |
| Items and monsters | 255 item and 195 monster entries match the ScummVM transcription. |
| `.OVR` overlays | Containers, selection fields, text, data headers and map-script behaviour are decoded through the clean-room engine oracle. |

## Open work

| Question | Current boundary |
|----------|------------------|
| `MM.RSM` address encoding | Symbol names and records are known; the 4-byte segment/offset encoding is answered by neither reference. |
| Live visual capture | A DOSBox screenshot pass would provide a stronger visual oracle than the structural checks. |
| Raw `.OVR` opcode disassembly | Behaviour is solved through ScummVM; the original 8086 code segments remain undisassembled. |

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/mm1/TODO.md)
for the full evidence trail.
