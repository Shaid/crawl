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
| `tools/blackcrypt/remake/browser.ts` | DOM shell: keyboard / blur wiring, text HUD (party, book page), live-scene attach. Hooked into the walker page by `?game=blackcrypt&play=1` (`&region=ntsc`; dev server only, files via the `/data/` middleware). |
| `tools/blackcrypt/remake/play-loop.ts` | `PlayLoop`: tick clock (PAL 160 / NTSC 166.7 ms), held-key repeat, tap protection, command budget, catch-up cap. No DOM, no real clock: `update(dtMs)` (fake clock in tests). |
| `tools/blackcrypt/remake/live-scene.ts`, `live-play.ts` | Live scene: `LiveEntityLevel` (CellQuery whose entity lists come from the engine), monster tiers / placement, effects, `createBcLive` (the plug `BlackCryptView.setLive` takes). |
| `tools/blackcrypt/remake/headless.ts` | Node renderer of the same asset stack as the walker (pngjs): frames without a browser. Reads `public/assets/blackcrypt/amiga` (gitignored). |
| `tools/blackcrypt/remake/chargen.ts` | Class templates, `checkDraft`, `StatPool`, `CharDraft` for `newGame({ party })`. |
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

## Live scene (2026-11-26)

`BcEngine.view().scene` lists the 4 x 3 squares in sight (depth 0-3, lateral -1..1, the walker's `project()` convention) with monsters, structures (door open bit = word `+0x0E` bit 0) and items. `BlackCryptView.setLive(live)` (tools/walker/games.ts) swaps the walker level's entity lists for the engine's (`LiveEntityLevel`), so the package's own `buildViewList` draws live doors, plaques, stairs and floor items (a picked-up item is gone, an opened door is open); monsters and effects are extra `DrawItem`s in the same painter's order, cropped to the 208x140 viewport. `refreshLive()` after each tick. `?play=1` loads the monster and BCSPEED banks.
Frames (headless, looked at): `build/blackcrypt/live-monster-map1-d1|d2|d3.png` (Rock Eye open at depth 1, closed ball at 2 and 3), `live-door-map1-closed|open.png`, `live-item-map1.png` / `-gone.png`, `live-effect-map1-hit.png`; browser smoke `remake-play-live.png`.
Grades: engine contents and door / item state = verified rules + code-grade loader; sprite choice by gfx id and map = `monster-names.json` (clusters rendered / confirmed, data-structure.md); **hyp:** tier per depth, foot line, lateral spacing, spread of several monsters, hit / cast effect frames (`bc-remake-monster-placement`).
Tests: `live-scene.test.ts` (14: tier ladders for Two Head and Rock Eye, crop, scene, door open, entity mapping, live level pass-through and swap, side-wall gate, retail frames with null controls: monster removed, item removed, door closed vs open, miss draws no effect).

> **Correction (2026-11-26) - "black right half of the viewport".** Not a view-width or compositing bug. The 3D viewport is 208x140 at the top left of the 320x200 screen (the confirmed blit descriptors; `slots.json` `viewport`); the right 112 px and the bottom strip are the game's UI panels, which the walker does not draw (`bc-remake-ui-panel`). The black band between ceiling and floor in some frames is an open square run with no wall within three squares.
> **Correction (2026-11-26) - the previous "walls and static props" claim was wrong for this checkout.** The generated `public/assets/blackcrypt/amiga/dungeon/slots.json` had been rewritten by `scripts/export_dungeon_slots.py` after `export_dungeon_props.py` had merged the prop slots, `floorItem` and `floorPlate` tables into it, so floor items, alcoves, plaques, door locks and plates were not drawn at all. `python3 scripts/export_dungeon_props.py` after the slots exporter restores them (34 -> 82 slots). Order matters: slots, then props. The headless test reads `slots.json`'s `floorItem` and fails loudly through "no scenario" if it is missing.

## Spell book and character creation (2026-11-26)

`newGame(world, seed, { party })`: four `CharDraft`s in class order (Fighter, Cleric, Magic User, Druid; slot = class). `checkDraft` (name 1-12 printable, each stat in [class minimum, 20], at most 25 points above the minimums, portrait 0-8) throws every reason; the default is the section 1.3 templates, so existing games are unchanged. Names are written at record `+0x02`, stats to `+0x64/66/65/68/67`, armour = T1[DEX] + 8, class bytes `+0x46/+0x47` = first page (0, 0, 5, 10), `+0x48` = 1. With `rules.spells` (the `spellBook` of `rules-tables.json` in the browser, the committed `rules_oracle/spellbook.json` in tests) only pages 0, 5, 10 start owned and `memorise` / recharge run the harnessed `memoriseClick` / `rechargeTick`; the view lists the book with timers. `openPage` and `learnPage` are stubs (page items, chain order, who may read, consumption: code-read only). The shell has keys (T select, Z X C V memorise, G-L cast) but no creation screen: **stub**, and whether the real screen demands a spent pool is **hyp** (we accept leftovers).
Tests: `chargen.test.ts` (16): each rejection, pool arithmetic exactly 25 / 26, `StatPool`, stats and armour where the game keeps them (DEX 16 beats DEX 12), invalid party builds nothing, save / restore with names and portraits, book ownership, memorise timer 1260 (INT 14) vs 1071 (INT 20, T2 -15%), null controls (timer running, unowned page, level gate, no book tables), retail party with kit.

## Pacing (2026-11-26)

`PlayLoop.update(dtMs)` runs one `BcEngine.step` per tick period; region PAL 160 ms (default, hyp) or NTSC 166.7 ms (game-rules 10.1), catch-up capped at 5 ticks (a stalled tab drops the rest), key press fires on its first tick (a tap released between ticks is not lost), a held key repeats after 400 ms once per tick (**hyp**: delay and rate are shell policy, the game's handling of Amiga auto-repeat is not decoded), movement / turn / attack repeat, open door does not, 2 commands per tick (hyp, as before), blur releases all keys. Frame-rate independence is a test (16 ms and 40 ms frames give byte-identical saves). `play-loop.test.ts` (12).

## Stubbed or hypothesised

- Map change (`+0x16C62` itself is open, game-rules 14.7): characters, carried items (and containers), light / compass / sight / haste counters, the clock and the buff / swing events are carried, everything else is the destination map; the ramp is only logged by the sim.
- Runtime object ids are sequential from 21 (ids 1-20 = starting kit); the game allocates from its free list. Rules read records, not numbers.
- Start pose: first corridor square of the map (`entrancePose`, same rule as the walker); the real new-game position is not in the data we decoded.
- Starting kit: bcdfp `0x585C` records as ids 1-20, five per character in pack row 0 (hyp); no weapon is equipped (bare hand until one is found).
- Spell book: wired (see above); page items and the book / creation UI are stubs.
- Browser harness: live monsters, doors, items and hit flashes are drawn (placement hyp); no right-hand / bottom UI panels, no audio, no automap hookup for engine moves beyond the walker's own.
- Not in the sim at all (see `game-rules.md` 14.7 / 15.6): LIGHT effect, held-party click whitelist, ray-kill composed harness.

## Next steps

1. Monster placement from the game's own blit code, facing / attack poses, per-spell effect sprites (`bc-remake-monster-placement`).
2. The UI panels (party, portraits, stats, message log) and a creation / book screen (`bc-remake-ui-panel`).
3. Map-change fidelity once the RE pass closes `+0x16C62`; per-map arrival poses.
4. Save slots and a launcher in the shared host shell; a second engine (MM2 or W6) to settle the contract.
5. Mouse hotspots beyond the door click; the game's own key-repeat behaviour if it can be decoded.

Frames (gitignored, retail art): `build/blackcrypt/remake-play.png` (milestone 1: engine driving pose and HUD), `remake-play-live.png` (browser, live scene + book HUD), `live-*.png` (headless).
