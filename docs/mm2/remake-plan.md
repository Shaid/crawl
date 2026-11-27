# Might & Magic II remake: engine core (milestone 1, 2026-11-27)

The second implementation of the shell contract (`tools/remake/engine.ts`, `docs/remake-architecture.md`), written to settle that contract with a turn-based game after Black Crypt's real-time one.
Code: `tools/mm2/remake/`. It contains no rule logic and no UI: every rule is a harness-verified port in `tools/mm2/rules*.ts` (see `amiga/game-rules.md`, "MM2 rules status"). Retail data is read at runtime from the user's files (`data/mm2/amiga/data/`, gitignored) and is never committed; the retail-data tests skip cleanly when it is absent.

## Architecture

| File | Role |
|---|---|
| `image.ts` | The memory the rules run on. `dataImage()` parses the AmigaDOS hunks of the user's `mm2` and returns the relocated DATA hunk (the class / tier / hp tables the oracle used), mapped at the oracle's own addresses (DATA `0x160000`, `A4 = DATA + 0x7FFE`, BSS contiguous, 32 KB window). `FlatMem` = the mutable, bounds-checked counterpart of the harness's `StrictMem` (the rules take a `Mem`). A third address range holds the `monsters.dat` allocation (`A4-30658`). |
| `round.ts` | The battle round driver: `startBattle`, `beginRound`, `pickActor`, `battleRound(m, actors)`. The control flow of `rules2.ts roundLoop` cut at the round boundary with the two action routines as callbacks (the harness stubbed them, so `roundLoop` cannot interleave player orders). **Proven equal**: `round.test.ts` runs both on identical memory with identical scripted effects (30 fights over six screens, >100 actions, >30 rounds) and compares every byte of the A4 window and the action order; a null control (no status decay) diverges. |
| `engine.ts` | `Mm2Engine`: `detect`, `load`, `newGame(world, seed, opts)`, `step`, `view`, `save`, `restore`, `coverage`; `describeEvent`. Glue only: commands become sequences of verified rules. |
| `keys.ts`, `browser.ts`, `shell-entry.ts` | Key policy (pure, tested), walker-page hook (`?game=mm2&play=1`, optional `&seed=N&wander=PCT&map=SCREEN`), and the registry entry for the generic shell (one line to add in `tools/remake/engines.ts`). |
| `node-files.ts` | Node-side `FileSet` over `data/mm2/amiga/data/` for tests and headless runs. |

Flow: `detect(files)` (file names and sizes of `mm2` 181,524, `map.dat`, `attrib.dat`, `monsters.dat`, `items.dat`, `spells.dat`, `roster.dat`, plus the hunk magic) -> `load(files, 'amiga')` (immutable: DATA image, the data files, decoded names) -> `newGame(world, seed)` -> `step(state, cmds)` -> `view(state)`.

**Turn based.** `timing = { tickMs: 100, mode: 'turn' }`: nothing happens without a command; `step(st, [])` returns `[]` and changes no byte (tested). One command is one step of play and one engine `tick`.

**Determinism.** `seedToRng(seed)` = the 32-bit LCG state `A4-24802` (`seed * 0x41C64E6D + 0x3039`, game-rules 2). The original seeds it with `srand(clock)`, a 16-bit value, so a seed below 65,536 is exactly the game's `srand(seed)`. Same seed and command stream give the same events and bytes (tested, with a different seed and a one-byte change as null controls).

**Save / restore.** JSON bytes (stable key order): the 32 KB A4 window and the 60 screens (doors opened in play persist) as base64, plus the engine's few fields (facing, mode, pending prompt, loot, wander option). `restore(world, bytes)` re-runs the table loaders for the `monsters.dat` allocation. A restored mid-battle game continues byte-identically (tested).

**No UI knowledge.** `view()` is data (pose, wall field ahead, party sheets with known spells and carried item names, prompt, battle monsters, loot, clock). The party command menu (CODE+0x119C2) is UI and not harnessed (game-rules 14.7); the engine's commands stand in for it.

## Commands

`move forward|back`, `turn +-1`, `rest`, `unlock`, `bash`, `equip`, `cast`, `encounter` (forces one), `prompt attack|hide|run|bribe`, `round` (with per-member `attack | shoot | cast | run | wait` orders), `takeLoot`, `shopBuy`, `shopSell`, `train`, `warp` (debug).

## What is wired, and through which verified rule

| Area | Rules called (all harness-verified unless marked) |
|---|---|
| New game | `loadTable` (items / spells / monsters loaders, 14.1), roster file byte-swapped into the 48 resident records (the swap is `roster.ts`'s documented one, **code**), `rosterToggle` (party add, 15.6), `equipCommand` (each starter wields the first thing in the pack, 13.6). Party = the six starters of the retail roster, in Middlegate at the attrib entry cell. |
| Movement | The walker's `stepParty` / `setFacing` (`tools/walker-mm/maze3d.ts`, **code**: Vairn-derived collision rule), screen borders by the attrib neighbours; `advanceTime(1)` per step (13.7, the per-step tick is **code** 15.5). The live pages `A4-21946` / `A4-21690`, the facing mask / shift `A4-21976/-21975` and the cell byte `A4-21974` are kept as the door rules expect. |
| Encounter | `encounter` (10.2: generation, budget, surprise, Hide, Run, Bribe, with the bribe payments through `payPool`, 15.2). The prompt shows the monster list **before** the choice: the engine previews the encounter on a copy of memory (the list and the surprise roll do not depend on the answer), then replays the chosen answer on the real memory, so the draws are identical. |
| Battle | `startBattle` / `battleRound` (10.3); the party action = `partyAttack` + `resolvePartyHit` (4.2, 11.4: melee, ranged), `characterFlee` (10.3), or a spell; the monster action = `monsterTurn` (11.1) followed by what it asks for: `pickTargetMelee` / `pickTargetRanged` (11.2), `monsterMelee` (4.1) -> `damageChar` (4.3) -> `monsterSpecial` (11.3), `monsterAdvance` + `callForHelp` (15.1, 13.5), `monsterSpellVerb` (13.5) -> the four leaves (`monsterSpray`, `monsterHitOne`, `monsterCondAll`, `monsterCondOne`, 15.1), `partyEffect` for lingering effects. |
| Spells | Gates `spellSpCost` / `spellGemGate` / `spellSpGate` (6, 12.4), `castSpell` (13.1), `castCombat` (51 combat handlers) / `castNonCombat` + `castNonCombat2` (non-combat handlers), `chargeCast` (14.5). The spell engine's "does the hit kill" and "kill outright" are answered by the real `damageMonster` / `monsterDies` (11.4) instead of the harness's scripted answers (a `kills` oracle and a write hook on `A4-1310`). Spell book = `+0x51..0x56`, bit `n & 7` of byte `n >> 3` (5.3). |
| End of battle | `xpAward` (4.7), `treasure` / `lootItem` (12.3), gold / gems from `killReward` shared with `shareGold` / `shareGems` (15.2). |
| Rest, doors, shop, training | `rest` (5.5), `unlockDoor` / `bashDoor` (14.4), `shopPrice` + `buyItem` + `sellItem` (14.5, 15.3), `hallLoop` with key `T` (5.4, 12.2, 15.4). |

## Stubs and open items (also in `coverage()`)

| Item | Grade | Note |
|---|---|---|
| Wandering encounters | stub | The step handler's encounter roll is not harnessed. A percentage per step is an engine option (`wanderPct`, default 0; the walker page uses 5) drawn from the game's RNG. `encounter` forces one. |
| Retreat after a successful Run | hyp | CODE+0x11646 is not harnessed; the party is put back where it came from. |
| Melee hit save flags | hyp | `applyHit` (CODE+0xFF42) is UI + damage; the engine hands `damage_char` no luck / percentage save and no damage type. The attack-verb `rand(1,8)` the routine draws is drawn after the roll (order hyp). |
| Monster special `CODE+0x1042C` and spell verbs 9, 11-14, 29 | open | Reported as events, no effect. |
| event.dat scripts (signs, shops, inns, quests, teleports, fixed monsters) | stub | Event cells (`collision & 0x80`) are reported (`event-cell`), not executed; the opcode disassembler exists (`event-vm.ts`). Shops are therefore a one-line stock built by the command. |
| Door / chest trap effect | stub | The damage half is harnessed (15.7) but the picker that chooses the effect is UI; a sprung trap is reported (`trap: true`), no damage. |
| Gold / gems / loot hand-over after a fight | hyp | The UI part is not harnessed; policy above. |
| Which town screen holds a Hall of Training | hyp | Training is allowed on screens 0-9 (the hall tables are indexed by the screen). |
| Time a rest takes | open | `rest` does not advance the clock. |
| Passability skills, overland terrain classes | open | `mm2-overland-passability-0x9424`. |
| Starting gold, roster delete / full flows | closed | Starting gold is 0 (census); the retail starter characters are used as they ship (Sir Felgar carries 200 gold). |

## Tests (`tools/mm2/remake/`, 31; the 26 retail ones skip (or set `MM2_DATA_DIR` to an empty dir to check) without `data/mm2/amiga/data/`)

- `engine.test.ts` (26): detection and coverage (always run); new game, no-op step, walk / turn / wall / clock tick, screen border, fight to the end (XP, kills, log), party wipe and refusal, null control (a party that never attacks leaves the monsters alive), combat spell (SP paid, monsters hurt; resisted casts counted), lone-monster cast, null control (no SP / unknown spell), non-combat casts (First Aid, Light), rest, locked door unlock and bash (the door persists and the party walks through), shop buy / sell price rule, training after XP is set, prompt answers (hide / run / bribe / fight all occur over 40 seeds), wandering option, save / restore mid-battle, determinism (same seed equal, other seed diverges, one changed byte shows), parity (engine rest, cast, unlock and shop price equal the same rules called directly, byte for byte).
- `round.test.ts` (2): the round driver equals `roundLoop`; null control.
- `keys.test.ts` (3): key policy, HUD, registry entry.

## Playing it

`npm run dev`, then `/tools/walker/index.html?game=mm2&play=1` (dev server only: the retail files come through the `/data/` middleware). W/S move, Q/E turn, R rest, U unlock, B bash, T train, M meets monsters (debug); at an encounter A attack, H hide, R run, B bribe 100 gold; in battle Space plays a round, 1-6 select a member, C queues that member's first combat spell, F run, X wait, V shoot. The walker view draws the static map, so an opened door is not drawn open (the HUD says what is ahead). Headless frames were looked at in a real browser (the engine pose drives the 3D view and the minimap); they are not committed (retail art).
