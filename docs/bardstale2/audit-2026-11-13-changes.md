# BT2 audit changes (2026-11-18)

Shared work is recorded once in `docs/bardstale3/audit-2026-11-13-changes.md` and `docs/bardstale-picture-format.md`.

| Finding | Outcome |
|---|---|
| 4 `unk` | **Applied**: BT2 `pics` `unk` is little-endian = Huffman bit count + 7; re-run independently: 64/64 slots (incl. the 3 "placeholder" slots). Row `bt2-unk-field` deleted. |
| 5 placeholder records | **Applied (doc, extractor header, BT2 data-structure)**: valid 1-byte Huffman records, not identical; the wrong "10-byte header" text kept only as a superseded note. |
| 6 animation | **Applied (TODO)**: `bt2-animation` added (not re-run). |
| 7 shared container | **Applied (TODO)**: `bt2-wpics`/`other-banks`/`audio`/`anm` rewritten as "interpret"; `wpics` is a single 29,728 B record. |
| 13 count | **Applied (doc)**; BT2 TODO "not decisive" paths-tried entry deleted (wrong). |

Tests: see BT3 changes file. No asset changes for BT2.
