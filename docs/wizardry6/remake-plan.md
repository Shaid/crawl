# Wizardry 6 remake: engine core (milestone 1, 2026-11-28)

The third implementation of the shell contract (`tools/remake/engine.ts`, `docs/remake-architecture.md`), after Black Crypt (real time) and Might & Magic II (turn based).
Code: `tools/wizardry6/remake/`. It contains no rule logic and no UI: every rule is a harness-verified port in `tools/wizardry6/*.ts` (`amiga/game-rules.md`, "W6 rules status"). Retail data is read at runtime from the user's files (`data/wizardry6/amiga/`, gitignored) and the walker's generated level files (`public/assets/wizardry6/amiga/dungeon/levelNN.json`, `npm run w6:levels`, gitignored); nothing retail is committed. Amiga only: the SNES variant was not attempted (different level and map formats, the rules are the Amiga executable's; see `docs/wizardry6/snes/`), so `coverage()` lists it as open.

## Architecture

| File | Role |
|---|---|
| `image.ts` | The memory the rules run on. `dataHunk()` parses the AmigaDOS hunks of `Bane` and returns the relocated DATA hunk (the spell table at A4-31698, the item-kind table at A4-31716, the formation template ...); `baseImage()` adds SCENARIO.HDR (the persistent trigger tables at A4-30310) and all 14 levels' section-2 / section-3 maze blocks on the heap. A game is `freshMem(base)` (the sparse byte map `Mem` of `combat.ts`); a save is the diff against `base`. |
| `levels.ts` | The walker's level files (collision planes, section-3 entity links, entrance) as `W6Level`. |
| `party.ts` | The new-game party: **stub** (character creation and a new character's HP / stamina / skills were never found, game-rules 1.4). Race base + class minimum + a fixed pool spread, HP / stamina from the class table maximum plus a margin, equipment through the verified give-item (`divvy.ts giveItem`), equip copy item bytes +24..+39 -> record +240 (hyp, the layout matches the weapon block exactly). |
| `engine.ts` | `W6Engine` / `makeEngine(assets)`: `detect`, `load`, `newGame(world, seed, opts)`, `step`, `view`, `save`, `restore`, `coverage`; `describeEvent`. Glue: commands become sequences of verified rules. |
| `keys.ts`, `browser.ts`, `shell-entry.ts`, `view-factory.ts` | Key policy (pure, tested), walker-page hook (`?game=wizardry6&play=1`, optional `&seed=N`), the registry entry (`w6Entry`, one line in `tools/remake/engines.ts`), and the in-shell 3D view (the walker's pixel-exact `Wizardry6View` driven from `view().pose` through `createWalkerSurface`). |
| `node-files.ts` | Node-side `FileSet` over `data/wizardry6/amiga/` (`W6_DATA` overrides) and the level files, for tests. |

Flow: `detect(files)` (names and sizes of `Bane` 354,372, `scenario.dbs` 188,980, `scenario.hdr` 414, plus the hunk magic) -> `load(files, 'amiga')` (immutable: base image, scenario, levels, XP tables; levels and message text come from `makeEngine(assets)`, which the shell entry's `bind` builds from the generated assets) -> `newGame(world, seed, opts)` -> `step(state, cmds)` -> `view(state)`.

**Turn based.** `timing = { tickMs: 100, mode: 'turn' }`: nothing happens without a command; `step(st, [])` returns `[]` and changes no byte (tested). One command is one engine `tick`. W6 combat is *simultaneous* in the sense the contract cares about: every member's order and every monster's plan are set before the round, then one verified round (100-tick initiative loop) resolves them all; the engine exposes that as `plan` / `planAll` commands (collect orders) and `round` (resolve), not as one command per actor.

**Determinism.** `seedToRng(seed)`: splitmix32 -> the three 16-bit words of `W6Rng` (the game's generator, harness-verified). The original seeds from the clock and its seed source was not traced (`w6-rng-seed`), so the mapping is the engine's own. Same seed and command stream give the same game (tested, null control: other seed differs).

**Save / restore.** JSON bytes: the generator words, mode, pose, the fight / chest records and the memory diff against the base image (hex runs). `restore(world, bytes)` rebuilds the base from the user's files. A mid-battle round trip continues identically (tested).

**One memory image.** The party records (432 bytes at A4-17922), the 44-byte combat structs and monster records (`LAYOUT` of `combat-sim.ts`), the level blocks and the trigger tables all live in the one `Mem`; the verified rules read and write it exactly as they ran under Unicorn. Combat runs through `CombatWorld.gameRound` / `hasFled` / `finishFight` *adopted over the engine's own memory and generator* (`Object.create(CombatWorld.prototype)` + the fields): nothing is copied or re-implemented. Not called: `enableGameRound`, which would overwrite the real monster records' planner fields (it is for synthetic monsters).

## Commands

`move forward|back|left|right`, `turn +-1`, `camp`, `pickLock {who}`, `plan {member, plan}` and `planAll {plan}` (plan = `attack | cast {spell, power, tg, ti} | run | hide | useitem {slot} | swap {to}`, the `PartyPlan` of `combat-sim.ts`), `round`, loot: `take {who, index}` / `takeAll` / `leaveLoot`, chest: `chestInspect` / `chestDisarm {who, trap}` / `chestOpen` / `chestLeave`, debug: `encounter {id?}`, `chest {trapMask, treasure}`, `warp`.

## What is wired, and through which verified rule

| Area | Rules called |
|---|---|
| Movement | `movement.ts tryMove` on the walker planes (doors, locks, pits, the level-1 warp, off-map death, levitation off); the party's globals (level, region, local x / y, facing, absolute x / y, level-block pointers) are written to the A4 image after every move. |
| Cell entities | `entities.ts dispatchEntities` (LAB_06B6, harness) with handlers: kind 1 teleport and kind 7 door state (the arms of the walker's `arrive`, parity-tested against `arrive`), kinds 3, 6, 16 (`entityKind3/6/16`), kind 4 (`entityKind4`), kind 5 (inline). Other kinds are reported as `entity-unmodelled`. |
| Scripted fights | Level load (LAB_073F, **code**): transient triggers reloaded, bit-map cleared, each spot flooded with `scripted.ts setRegion`; per move `scriptedTest`; entry half `exploreEntry` after a fight (not after a flight, state 0x17). |
| World tick | `itemuse.ts stepTick`: clock, hunger, regeneration, poison, forced camp (`restParty`), wipe, wandering encounters (Random(1000) >= 995) with the pick `randenc.ts`. |
| Encounter | `encounter.ts startEncounter` (LAB_0A31) with a section-4 monster loader (the real scenario records). |
| Combat | `CombatWorld.gameRound`: planner, order of play, executor, attack resolver, weapon effects, status, casts (82 spell ids), summons, breath, hide, run, use item, swap. |
| End of fight | `finishFight`: `postCombatFull`, `compactGroup`, `decayBuffs`, `xpSplit`, `lootRoll` on the monster's treasure id (section 7). Then level-ups (hyp, see below), then the loot list. |
| Loot | `divvy.ts giveItem`, `removeListEntry`, `lootBlocksExit`; `takeAll` is the engine's policy (the divvy screen's cursor loop is UI). |
| Camp | `restParty` (2.5 percent interruption starts a wandering fight). |
| Chest | `pickTrap`, `canAct`, `inspectChest`, `disarmChest`, `chestTrap` (all 15 effects), `chestTreasureStep` + `lootRoll`. |
| Pick lock | `thief.ts pickLock` with a scripted poll (the last tumbler round counts). |

## Stubs and open items (also in `coverage()`)

| Item | Grade | Note |
|---|---|---|
| New-game party, starting HP / stamina / skills, party AC and resists | stub | `party.ts`; the AC byte of the combat struct is the constant 5 (the equipment-derived AC is not harnessed); the equip copy is a hypothesis. |
| Level-up timing | hyp | The pieces (levels gained, HP / stamina, attribute raise, spell tier) are verified; running them straight after the XP award is the engine's choice. |
| Entity kinds 2, 8-13, 21-25 | stub | `entity-unmodelled` events (TODO `w6-stubbed-entity-kinds`). Kind 3's event / shop state 0x15 is reported (`event-state`) and ignored. |
| Chests on the map | stub | No entity kind places a chest yet; `chest` is a debug command. That opening an armed chest springs its trap is hyp. |
| Loot screen input loop | stub | `takeAll` policy; `take` / `leaveLoot` honour the must-take flag (`lootBlocksExit`). |
| Out-of-combat casting (LAB_1D0D), use item outside a fight | code / open | Not exposed. |
| Retreat after a successful run | hyp | The party returns to the cell it stepped from (LAB_08E4 walks it back along its path). |
| Turning in place and the world tick | open | `tickOnTurn` (new-game option, default off); the code read says a turn loops through the same tick, not confirmed in play. |
| Water crossing (-18136), runtime door unlocks beyond `pickLock` | open | `w6-move-runtime-state`. |
| Shops, inns, NPC talk, training | open | UI and events. |
| SNES variant | open | Not attempted. |

## Tests (`tools/wizardry6/remake/`, 36; the 30 retail ones skip without `data/wizardry6/amiga/` or the level files)

- `engine.test.ts` (32): detection, coverage, seed ranges (always run); image tables equal the committed `spell-table.json`; determinism + other-seed null control; no-op step; walk / wall bump / turn; **parity: a random walk equals `tryMove` + `arrive` on 2,000 steps over 8 seeds**; teleporter with a level change; scripted fight on an armed cell; 0.5 percent wandering encounters; forced camp (and its null control); fight to a victory with XP, gold, loot, take; never-attacking null control; party wipe and refusal; cast (SP paid, damage); camp; level-up; chest trap / slay-all / disarm then open / inspect; pick lock; use item, swap, hide, run; save / restore mid-battle; **parity: every engine round equals the combat sim driven directly on a copy of the same memory (bytes and generator)** with a null control; a one-byte change in the user's monster record shows.
- `keys.test.ts` (4): key policy per mode, HUD, registration.

## Run

Shell: `npm run dev`, `/tools/remake/index.html?launch=wizardry6` (HUD, event log, key map, slots, 3D view from the walker renderer). Walker page: `/tools/walker/index.html?game=wizardry6&play=1`. Needs the retail files and `npm run w6:levels w6:atlas w6:slots` assets.
