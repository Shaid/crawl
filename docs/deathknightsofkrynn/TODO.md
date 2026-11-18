# Death Knights of Krynn — open work

See `docs/deathknightsofkrynn/amiga/data-structure.md` for the format
writeup and confirmed sections.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dkok-3levels | open | 3/19 levels (GEO ids 65, 80, 97 — not 16) have no statically-resolved ECL wallset binding — non-dungeon scripts, or dynamic? | data-structure.md §5 correction (2026-11-18) | 2026-11-18 game-re |
| dkok-direct-slice-verify | open | Verify the direct-slice model (one 15-slice walldef supplies all 3 slot ranges, wall type t -> slice t-1) with a null-controlled tile-seam oracle or a screenshot; currently coverage-only | data-structure.md §5 correction | 2026-11-18 game-re |
| dkok-geoprefix | open | GEO record's leading 2-byte prefix is non-constant per level (repeated values like `0111` x7, `ccdd` x4 look like buffer garbage) — meaning not decoded | data-structure.md §2 "GEO" | 2026-11-18 game-re |
| dkok-sprit-pic-container | open | `SPRIT1.DAA`/`PIC1.DAA`/`PIC2.DAA` (and `globals.daa`/`pointers.daa`) are NOT the BE DAA container: u16 BE header length + 6-byte entries {id u8, 0 u8, offset u32 BE}, no sizes (fits 7/7 files); payloads start `00 xx 03 00 58 00 0b fc` — decode monster sprites / location pictures | data-structure.md §1 correction | 2026-11-18 game-re |
