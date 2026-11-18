# Dungeon Hack: audit 2026-11-13, changes applied (2026-11-18)

| Finding | Outcome |
|---|---|
| EOB3 doc claims `ITEMTYPE.DAT` applies to Dungeon Hack | **Applied.** No such file in `data/dungeonhack`; claim removed (EOB3 correction doc retracted, `docs/eotb3/dosvga/data-structure.md` s6.2). |
| `HACK.RES`/`OPEN.RES` container tiling | **Confirmed, recorded.** Re-derived with my own parser: uncovered bytes = `lost_space` (45,816 / 12,588). Note added to `dosvga/data-structure.md` s1. |

`docs/dungeonhack/TODO.md` unchanged (rows already convention-clean). No code changes, no tests needed.
