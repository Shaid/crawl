# BT1 audit changes (2026-11-18)

Shared work is recorded once in `docs/bardstale3/audit-2026-11-13-changes.md` and `docs/bardstale-picture-format.md`.

| Finding | Outcome |
|---|---|
| 4 `unk` = bit count | **Applied (doc/code comment/TODO)**: re-ran independently: BT1 `pics` big-endian `unk` == consumed Huffman bits on 54/55 (record 54 differs by 10; audit attributes it to the last record needing a byte past EOF). Row `bt1-unk-field` deleted. No decoder sanity check added (deferred; low value). |
| 6 animation overlay | **Applied (doc/TODO)**: `bt1-animation-overlay` answered and replaced by `bt1-animation-format` (not re-run by me). |
| 7 shared container / levs | **Applied (TODO/doc)**: `bt1-other-banks` rewritten to "interpret"; added `bt1-levs-cells`, `bt1-audio` rewritten. Not re-run by me. |
| 13 count field | **Applied (doc)**: first offset / 4. |
| 16 inventory gaps | **Applied (TODO)**: `bt1-city-dir`, `bt1-c-scrambled`. |
| 14 BT1 extractor header | **Applied**: false `pics.pal.json` claim removed. |

Tests: see BT3 changes file (10/10). No asset changes for BT1.
