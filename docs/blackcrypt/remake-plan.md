# Black Crypt remake: engine core (milestone 1)

First implementation of the shell contract in `docs/remake-architecture.md` (`tools/remake/engine.ts`). The core is `tools/blackcrypt/remake/`; it contains no rule logic and no UI.
All rules are the harness-verified ports (`../bc-sim.ts` over `rules*.ts`, see `amiga/game-rules.md` section 14.1 and 15). Retail data is read at runtime from the user's files and is never committed.

## Architecture

| File | Role |
|---|---|
| `tools/remake/engine.ts` | The contract: `Engine<World, State, Cmd, Ev, View>`, `FileSet`, `Detection`, `CoverageRow`. Types only. |
| `tools/blackcrypt/remake/bcdfs.ts` | Reader for all 13 maps of `bcdfs` (squares, entity chains, monster pairs, loot / container children, action chains). Original code from the documented loader; cross-checked against `levels.json`. |
| `tools/blackcrypt/remake/world-load.ts` | Writes a parsed map into the sim's A4 image the way the game's loader does: square longwords verbatim, 20-byte records verbatim, chains / loot / container / secondary links, action table at A4+0x836, free list. |
| `tools/blackcrypt/remake/engine.ts` | `BcEngine`: `detect`, `load`, `newGame`, `step`, `view`, `save`, `restore`, `coverage`, `timing.tickMs = 160` (8 PAL vblanks). Map change on stairs. `describeEvent` for text HUDs. |
| `tools/blackcrypt/remake/browser.ts` | Minimal shell: tick clock, key map, text HUD. Hooked into the walker page by `?game=blackcrypt&play=1` (dev server only, files via the `/data/` middleware). |
| `tools/blackcrypt/remake/synth.ts` | Builders for synthetic maps used by the tests (no retail data). |

Flow: `BcEngine.detect(files)` -> `load(files, 'amiga')` (maps, starting kit; the rules tables are bound with `BcEngine.withRules(rules)` from the committed `rules_oracle/vectors.json`) -> `newGame(world, seed)` -> `step(state, cmds)` once per 160 ms, returning that tick's events -> `view(state)`.
Determinism: the seed maps to the game's 6-byte RNG (`seedToRng`); the same seed and command stream give the same events and bytes. State is one mutable A4 image, so `step` mutates in place (the draft contract's value semantics were dropped); `save`/`restore` is the snapshot (JSON bytes: A4 image, RNG, spell book, flags).
Commands are the sim's `Cmd` (`move`, `turn`, `attack`, `openDoor`, `cast`, `memorise`, `pickup`, `drop`, `equip`, `use`, `useKey`, `cursor`, `trigger`, `rest`, `wait`).

## Covered (all through the verified ports)

Melee, weapons and swing timing; monster behaviour VM, pursuit, ranged, activation scan, generators, possession / stone; death, loot, XP, level-up, DamageCharacter; the event queue and buff expiries; party spells, rays and simple spells; doors, the enter test, traps, plates, levers, glyphs, pits, keys, item use, Ram-boss items; vitals, hunger, weight; map loading from the real `bcdfs` (13/13 maps load, run 300 ticks and round-trip a save); stairs between maps.

## Tests (`tools/blackcrypt/remake/`)

- `engine.test.ts` (15): scenarios on synthetic maps: walk and wall bump, fight to death (XP), cast a ray, door bump / open, trap, pick up and drink a potion, loot drop, stairs, save/restore round trip, determinism per seed, parity.
  Parity: (a) stepping through `BcEngine` equals driving the restored `BcSim` directly, event for event and byte for byte; (b) the `bc-playthrough` scenario built by hand on `BcSim` and loaded as a map gives the same ordered log (ids aside). Null controls: no-attack party leaves the monster alive; a different command stream after a snapshot diverges; a one-byte image change shows up; another seed gives another timeline.
- `retail.test.ts` (5, skipped without `data/blackcrypt/amiga/`): detection, 13 maps + 20-record kit, cells and entrance squares equal the walker's `levels.json` on every populated square, every map runs and round-trips, the starting party carries its kit.

## Stubbed or hypothesised

- Map change (`+0x16C62` itself is open, game-rules 14.7): characters, carried items (and containers), light / compass / sight / haste counters, the clock and the buff / swing events are carried, everything else is the destination map; the ramp is only logged by the sim.
- Runtime object ids are sequential from 21 (ids 1-20 = starting kit); the game allocates from its free list. Rules read records, not numbers.
- Start pose: first corridor square of the map (`entrancePose`, same rule as the walker); the real new-game position is not in the data we decoded.
- Starting kit: bcdfp `0x585C` records as ids 1-20, five per character in pack row 0 (hyp); no weapon is equipped (bare hand until one is found).
- Spell book memorise / recharge: `BcConfig.spells` is not set by `newGame` (JS state outside the image); spells in slots can be cast, memorising needs the book wired.
- Browser harness: the walker view draws walls and static props; live monster, door and item sprites are not driven by the engine, so combat is text only. No audio, no automap hookup for engine moves beyond the walker's own.
- Not in the sim at all (see `game-rules.md` 14.7 / 15.6): LIGHT effect, held-party click whitelist, ray-kill composed harness.

## Next steps

1. Live sprites: map `view()` monsters / doors / items to the walker's draw items (needs the view model to expose depth-ranked squares).
2. Wire the spell book (`cfg.spells`) and character creation so a new game starts from the chargen screen.
3. Map-change fidelity once the RE pass closes `+0x16C62`; per-map arrival poses.
4. Save slots and a launcher in the shared host shell; a second engine (MM2 or W6) to settle the contract.
5. Real-time pacing and input (held keys, mouse clicks on hotspots).

Frame: `build/blackcrypt/remake-play.png (gitignored: it contains retail art)` (walker page, engine driving the pose and HUD).
