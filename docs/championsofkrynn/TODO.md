# Champions of Krynn — open work

See `docs/championsofkrynn/amiga/data-structure.md` for the full format
writeup and confirmed sections.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| cok-wall-addressing | open | How do WALLDEF view-index bytes address `8X8D1/2.DAA` tiles? The shipped flat bank is ~null by tile-seam agreement (0.23-0.50 vs null 0.16-0.34); the per-wall model (blank + 45 universal + entries `10W+1/10W+2`) scores 0.39-0.68; indices 186-236 unexplained (re-codebreaker target once only that range is unknown) | data-structure.md §4 correction (2026-11-18) | 2026-11-18 game-re |
| cok-wall-palette-verify | open | Wall tiles are coloured with `DUNGCOM.DAA` entries 0-15 (DOS-index-identical); confirm against an Amiga screenshot / longplay still | data-structure.md §4 correction (2026-11-18) | 2026-11-18 game-re |
| cok-ecl-opcode-table | open | ECL unknown-opcode ratio is 0.18-0.24% (not 0) under the v1.1 table — read the Champions exe's own operand-count table (as done for Dark Queen) and re-run the bindings | data-structure.md §5, §6 | 2026-11-18 game-re |
| cok-sprit-pic-container | open | `SPRIT1/2.DAA` and `pic1/2.DAA` are NOT the BE DAA container (parse 0 OK): u16 BE header length + 6-byte entries {id u8, 0 u8, offset u32 BE}, no sizes (fits 7/7 files across Champions+DKK); decode monster sprites / location pictures. Also untracked: `globals.daa`, `pointers.daa` (no directory) | audit-2026-11-13.md finding 8 | 2026-11-18 game-re |
