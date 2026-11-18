# BT3 audit changes (2026-11-18)

Shared spec: `docs/bardstale-picture-format.md` (BT1/2/3 audit findings are applied there once; the BT1/BT2 changes files point here).

| Finding | Outcome |
|---|---|
| 1 slot 84 "truncated" | **Applied (code fix)**: `readBitByte` in `tools/shared/bardstale-codecs.ts` returns 0 at EOF (Okumura getc semantics) for the 3 bit-refill sites; exporter `REAL_PICTURE_COUNT` 84 -> 85; test flipped (slot 84 decodes to 19,712 B, >8 distinct nibble values) with a null control (record cut 40 B from EOF must throw); all 85 pictures asserted. Regenerated `public/assets/bardstale3/amiga/sprites/pics.*`: 85/85 decoded, 340 cells (was 84/84, 336). Row `bt3-slot84` deleted. |
| 2 4 extra remap rows | **Applied (doc)**: 85 + 3 `0xFF` rows (27, 81, 86); row `bt3-remap-extra-rows` deleted. |
| 3 XOR description | **Applied (doc)**: running chain over 14,784 B. |
| 8 monster banks | **Applied (doc/TODO)**: 48-byte stat records, not graphics. Row rewritten. |
| 9 maps.hi/lo | **Applied (doc/TODO)**: stock LZHUF records; row rewritten (`bt3-maps`). |
| 10, 11, 12, 15 | **Applied (doc)**: stock LZHUF; frame differences 28.6% mean; "0 misses" metric was circular; Kroah claim marked unverified. |
| 14 contradictions | **Applied**: removed non-existent `pics2` refs and BT1 `pics.pal.json` claim in headers; fixed typo; removed dead "Errors and fixes" cite. Extractor registration in `game-config.ts` deferred (row `bt-config-registration`, BT1 TODO). |
| 16 `.GRP` layout | **Applied (TODO)**: `bt3-grp-layout`. |
| 17 stale walker doc | **Applied**: `docs/walker-map-format-future-decision.md` no longer says BT is absent. |

Tests: `npx vitest run tools/shared/__tests__/bardstale-codecs.test.ts` 10/10 pass; `npx tsc --noEmit` clean for bardstale files.
Audit item verified by me: 85 pictures decode through the TS port; BT1/BT2 `unk` rule re-run independently (below). Audit items 2/8/9/16 were not re-run by me (taken from the report).
In-game checks for Cassandra: none needed (static data).
