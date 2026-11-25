# Might & Magic III (Amiga) rules oracle

Runs single routines from the retail `Might&MagicIII` executable (`data/mm3/amiga/Might&MagicIII`, 272,088 B) under a Unicorn
68000 core and records what the game reads, writes and returns. Nothing here emulates the Amiga: UI/text/animation callees are
replaced by logging stubs. Ground truth for `tools/mm3/rules.ts`; results and offsets in `docs/mm3/amiga/game-rules.md`.

```sh
python3 -m venv tools/mm3/rules_oracle/.venv && tools/mm3/rules_oracle/.venv/bin/pip install unicorn capstone
tools/mm3/rules_oracle/gen_vectors.sh          # full sets -> generated/ (gitignored), subsets -> vectors/
npx vitest run tools/mm3
```

| File | Purpose |
|---|---|
| `emu.py` | hunk loader. Root `CODE` (86,512 B) at `0x100000`, `DATA` (declared 0xF278 B incl. the zero BSS tail) at `0x200000`, `A4 = DATA + 0x7FFE`; the **eight overlay CODE hunks** (position independent, no RELOC32) at `0x300000 + seg*0x20000` (seg 1..8 = hunks 3..10). The jump table at `DATA+0x3C0` holds the overlay stubs (`BSR.W ovlmgr ; .w seg<<8 ; .w offset`, 8 bytes); they are patched to `JMP abs.l` into the loaded overlay (the real manager only pages the segment in). `Emu.stub(addr, ...)` replaces a routine by a logging no-op. |
| `harness.py` | per-call recorder: input footprint (every DATA/heap byte read before written), write set, return value, stub log |
| `rules.py` | vector generators (`rules.py UNIT OUT.json --n N`, `rules.py subset IN OUT.gz --n N`) |
| `gen_vectors.sh` | regenerates every unit (full sets are tens of MB; takes several minutes) |
| `lst.py`, `funcs.py`, `xref.py` | listing helpers over the executable: `lst.py root|1..8 START END` (capstone, `jsr d16(A4)` annotated with the jump-table target `F_<root offset>` / `OV<seg>_<offset>`), function map with RNG callers, jump-table xrefs. Redirect listings to the gitignored `data/mm3/amiga/dis/`. |
| `montables.py` | locates the 22 DOS `Mon*.dat` tables inside the Amiga DATA hunk (22/22 byte-exact); output committed as `vectors/montables.json` |

Vectors contain no retail data except the executable's own constant tables and synthetic characters/monster slots.
Do not commit `.venv/` or `generated/` (ignored here).

Pass 2 (`rules2.py`, same recorder): monster turn / turn order / damage to a monster / item generator / spell cast gate / training. `rules2.py UNIT OUT.json --n N`;
`xrefpc.py SEG HEX` lists PC-relative call sites of an overlay or root routine (the jump-table xrefs are `xref.py`). Tables are exported by
`npx tsx tools/mm3/rules-tables.ts` into `public/assets/mm3/amiga/data/rules-tables.json` (gitignored).
