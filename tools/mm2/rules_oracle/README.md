# Might & Magic II (Amiga) rules oracle

Runs single routines from the retail `mm2` executable (`data/mm2/amiga/data/mm2`) under a Unicorn
68000 core and records what the game reads, writes and returns. Nothing here emulates the Amiga:
UI/text/key-wait callees are replaced by logging stubs. Ground truth for `tools/mm2/rules.ts`;
results and offsets in `docs/mm2/amiga/game-rules.md`.

```sh
python3 -m venv tools/mm2/rules_oracle/.venv && tools/mm2/rules_oracle/.venv/bin/pip install unicorn capstone
tools/mm2/rules_oracle/gen_vectors.sh          # full sets -> generated/ (gitignored), subsets -> vectors/
npx vitest run tools/mm2/__tests__/rules.test.ts
```

| File | Purpose |
|---|---|
| `emu.py` | root-hunk loader (CODE/DATA + contiguous BSS, `A4 = DATA+0x7FFE`), C-call helper, function stubs (`quiet=True` stubs are not logged; a stub's own writes via `e.w8/w16/w32` become part of the recorded write footprint) |
| `harness.py` | per-call recorder: input footprint, written bytes, return value, stub log |
| `rules4.py` | pass 3 generators (spells, item use, equip, clock; merges its units into `rules.UNITS`, same CLI) |
| `rules5.py` | pass 4 generators (overlay hunk: character creation, table loaders, attrib load; doors, shop, cast charge, 16 more non-combat spells; merges into `rules.UNITS`, same CLI) |
| `rules6.py` | pass 5 generators (undead engine, monster leaves, advance, shop sell/examine, party pool, Hall loop via `Emu.call_range(frame=)` + `Rec.run(call_fn=)`; merges into `rules.UNITS`) |
| `rules.py` | vector generators per unit (`rules.py UNIT OUT.json --n N`, `rules.py subset IN OUT.gz --n N`) |
| `replay.py` | replay one recorded vector with a trace of `rand()` calls |
| `resolve_asm.py`, `funcs.py`, `v.py`, `summ.py`, `lab.sh`, `show.sh` | listing helpers over the IRA disassembly (`data/mm2/amiga/mm2.asm`, gitignored; build it from the root hunks only: IRA rejects `HUNK_OVERLAY`, so `head -c $((0x28818)) mm2 > mm2root`, set `CODE $18 - $2593C` in the `.cnf`, then `resolve_asm.py`) |

Vectors never contain the user's retail data except the monster-record bytes a routine read (the
committed subsets use synthetic records only) and the executable's own constant tables. Pass 2
units (`encgroup` ... `traincost` in `rules.py`) write synthetic monster and item tables at the
addresses the overlay loader would use (`A4-30658` monsters pointer, `A4-16126` items); action/UI
callees (party command menu CODE+0x119C2, monster leaf actions, bribe payments, key input) are
logged stubs whose scripted answers are stored in the vector and replayed by the port.
Do not commit `.venv/` (ignored).

Pass 3 (`rules4.py`) runs spell handlers through the real dispatchers CODE+0xCD90 / 0xCFD0 and the real `partyEffect`; only key input (CODE+0x97A2, 0x42AA) and `damage_monster` / `monster_dies` are scripted. Pass 4 (`rules5.py`) maps the overlay hunk (file `0x28854`, `emu.OVL_BASE`; call overlay routines with `OVL_REL + off`). It reaches the root libc through the A4 jump table already present in DATA, so only `Emu.stub_libc` (file read CODE+0x2117E, alloc CODE+0x23E5C) is needed; `Emu.call_range` runs a fragment of a larger routine (the table loaders inside the startup function).
