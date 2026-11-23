# Ishar-engine family — open work

Single status surface for **Crystals of Arborea, Ishar 1, Ishar 2, and
Ishar 3** (all share one container/codec family — see
`docs/ishar-container-format.md`). This is still an exploratory pass
(started 2026-08-30) — the container/compression layer is now fully
confirmed via real prior art (`github.com/maestun/silm-depack`/`alis`);
per-title content semantics (overworld/dungeon-view mechanism) remain a
from-scratch investigation.

See `docs/ishar-container-format.md` for the shared container spec,
`docs/ishar/amigaaga/data-structure.md` / `docs/ishar2/amigaaga/
data-structure.md` / `docs/ishar3/amigaaga/data-structure.md` /
`docs/crystalsofarborea/amiga/data-structure.md` for per-title findings.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ishar-main-manifest-structure | open | `MAIN.DO`'s content is now fully readable in all 3 Ishar titles (resource manifest + monster roster + level-editor strings — the earlier "Ishar 2/3 don't show readable strings" note was a false negative from checking pre-decompression bytes, corrected this session), but its *binary record structure* (per-scene resource lists as actual records with offsets/counts, not just repeated substrings found via `strings`) is still not decoded | `docs/ishar-container-format.md` §3, `docs/ishar/amigaaga/data-structure.md` §4, `docs/ishar2/amigaaga/data-structure.md` §3, `docs/ishar3/amigaaga/data-structure.md` §2 | 2026-08-30 |
| ishar-cell-value-semantics | open | The region-grid cell-value alphabet (§9.2: `0x00` void, low codes = terrain/feature, high-bit `0x9D`/`0xCC-0xCE`/`0xE1`/`0xE5-0xE6` = obstacle classes; cells read sign-extended so `< 0` is the natural blocked test — HYPOTHESIS) needs its value→walkability and value→scene-script dispatch decoded (very likely the `cswitch` streams around `MAIN.bin+0x18e8..0x1c74` where all the location `.AO` names sit) | `docs/ishar-container-format.md` §9.2 | 2026-09-01 re-oracle |
| ishar-walkability-rule | open (narrowed) | Walker collision `isBlocked` (cell < 0) is a hypothesis; GERDEP's real test is at `+0xc38` (target cell `dirb(18)` against [-25,-1] and specific negatives, plus a party/NPC table), not ported. **2026-11-22:** on a 129-action real walk in the oracle the cell<0 rule predicted every move and every refusal but one (an orc occupying the cell), so the terrain half agrees on that path; NPC occupancy is not modelled **2026-11-23:** the shape of Ishar 1 GERDEP `+0xc38` is traced. Inputs: local 18 = target cell, 19 = current cell, 17 = the pressed button. The buffer is `0x2380` for an even region code (`0x1508`) and `0x80` for an odd one. The routine first requires a living party member (`0x1542`/`0x15ec` over 5 slots). Target cells from -25 to -1 and from -43 to -40 are refused, with door and lock messages. -80, -81 and -82 are passages. Every other negative target is refused (`+0x11c3`). Current cells from -46 to -8 restrict which directions you can leave by (wall-side codes; switch at `+0x11d5`, edge check at `+0x1629`). Target cells use the same codes (`+0x13a9`). This matches crawl's cell < 0 rule for plain cells. The edge-side codes and the occupancy check at `+0x1629` are not ported. **2026-11-23 port:** `isharEnter` (Ishar 1 spec `enter`, used by the walker, the oracle move prediction and the route planner) implements GERDEP's step test. Negative target cells are refused, except passages -80/-81 (a per-region destination table) and -82 (to region 6). The 129-action regression walk agrees on 128 of 129 moves; the remaining one is an orc. PARAM's 40-entry gate table (`0x3c00`/`0x3c34`/`0x3b64`) is not a plain-cell obstacle list: applying it refused steps the game allows. Read-back walks still show unexplained persistent refusals onto positive cells: a vertical line at CONT1 col 53->54, CONT2 col 38->39, and the CONT3 (9,26) causeway. GERDEP's monster check (`+0x1584`, 28 slots) is the next suspect, since NPC removal leaves those slots filled. **2026-11-23 (monster check, ported):** that was it. GERDEP `+0x1584` refuses the step when a slot of the EN1 monster table (slots 28..`0x3697`-1 = 69) has hp `0x1b22` > 0, region `0x3910` = the region code, kind `0x22f2` < 0, z `0x3a48` = 0 and stands on the target (`0x3fd0`/`0x3fd1`). MAIN `+0x4a97` loads the arrays from `EN1.FIC` (file offsets in `ISHAR1_MONSTER_ARRAYS`, byte-exact against the oracle's boot memory). The CONT3 (9,26) causeway is slot 46, a static guard (hp 70). The CONT1 col 54 and CONT2 col 39 "lines" are roaming monsters ENCONT spawned into slots 60-64: they keep following the party after `noNpcs` kills their scripts, so every step toward them was refused one cell further on. `isharEnter`/`spec.enter` take an `occupied` predicate (`ishar1Occupancy`); the oracle dumps the six arrays after every walk step (`stepMemdumps`) and the move prediction reads the previous step's dump. Move agreement on a 359-action read-back walk (CONT1 -> CONT2 -> CONT1): **85.8% -> 99.7%** (308 -> 358). The one left is not a refusal: GEREN starts MESSAGEE.DO as the party nears Bormin (slot 28, kind 15, an NPC at CONT1 15,29) and the message swallows the next press; the same press is the 129-action regression walk's one disagreement (earlier put down to "an orc"). The side-wall switch (`+0x11d5`, current cell -46..-8, gate check `+0x1629`) is not ported because no reachable cell has those codes: every negative target is refused first and the passage destinations are -80/-81 cells; its target twin `+0x13a9` is dead for the same reason. The walker does not simulate monsters, so it passes no occupancy and walks through them. | `ishar-container-format.md` §8.8; `tools/ishar/__tests__/oracle-parity.test.ts`, `ishar1-step-test.test.ts` | 2026-11-23 |
| ishar-fic-semantics | open (narrowed) | **2026-11-22: buffer roles solved for Ishar 1** — odd CONT files load into `+0x80`, even into `+0x234a` (MAIN `+0x49c2`); MAIN `+0xb0f` preloads the next region at row > 45 and the previous at row < 8 (neighbour staging, not a pristine copy); `IsharGridBuffers` reproduces it, oracle-verified across the CONT1->CONT2 boundary. Ishar 2/3 layer 1 is read by the scene scripts as buffer B (oracle-verified for Ishar 2's start group). Still open: `EN1.FIC` record layouts, `TAB1.FIC`'s role | `docs/ishar-container-format.md` §8.8, §9.1-9.3 | 2026-11-22 |
| ishar-scene-header-subtype-byte | closed | **Resolved 2026-11-13: not a subtype byte** — byte 21 is the low byte of the ALIS script header's `vram_alloc_sz` (`script.c:845-850`); local-offset bound holds 89/89 (Ishar 1) and 130/130 (Ishar 2), null controls fail. Was: The shared 16-byte scene header (§6's evidence) has a varying byte at offset 21 (`0x0a` graphics/Ishar-1 caves, `0x47` Ishar-2 dungeon files, `0x1e` a third subgroup) that looks like a content-subtype discriminator — not traced to any consumer code. (Note: this header is the ALIS *script* header — `id@0`, `code_loc@+4`→bytecode entry, `dirOff@+0x0e` — per §9's `script.c` layout, so the "subtype byte" is a script-header field, likely `vram_alloc`-adjacent) | `docs/ishar-container-format.md` §6, §9; `ishar-container-format.md` § "Review — 2026-11-13 `re-codebreaker` gap audit", finding 4 | 2026-11-13 re-codebreaker |
| ishar-firstperson-generalize | open (narrowed) | **Correction (2026-11-22):** the old per-script verdicts ("RENDERED, wired, CONFIRMED") measured coherence, not agreement with the game; against the alis oracle the single-script frames reached 0-31% of the game's placements. Replaced for Ishar 1/2 by `tools/shared/ishar-scene.ts` (whole region group, coroutine wakes, zone add-ons, grid buffers): **100% of placements and of pixels outside NPC boxes** on Ishar 1 CONT1 (60 random poses + a 129-action real walk into CONT2) and Ishar 2's start area. Still open: Ishar 1 town/cave codes 11-15 and regions 3-6 against the game, Ishar 2 beyond its start group (`ishar2-scene-groups`), Ishar 3 entirely (`ishar3-oracle-boot`), Crystals | `docs/ishar-container-format.md` §8.8; `tools/ishar/oracle/` | 2026-11-22 |
| ishar-cavint-sceneLayer-writer | open | `CAVINT.bin`'s own real cell-value alphabet is confirmed to live in `INIT.FIC`'s Z=1 sub-array (not Z=0), meaning the real game must set `omainb(0x2b3c)` to 1 somewhere in `CAVINT`'s own launch path (most likely `MAIN.CO`'s scene/location dispatcher). Write site still not located — a follow-up pass found a concrete structural blocker: `MAIN.bin`'s reached CFG covers only 2.5% of the file, stopping at an indirect-jump opcode family (`cjsrabs`/`cjmpabs`/`cjsrind16`/etc, `0x0b`-`0x10`) `alis-disasm.ts` doesn't implement and the reference `alis` source itself leaves as empty `[N/I]` stubs (no operand width derivable) — a genuine oracle gap of the same class `cdefmap` was (§8.1), confirmed NOT Crystals-specific (Ishar 1's own `MAIN.bin` hits it 61 times). Good `re-oracle` candidate, not escalated this pass | `docs/ishar-container-format.md` §8.5, `docs/crystalsofarborea/amiga/data-structure.md` §8's second follow-up correction block | 2026-09-03 |
| ishar-t3-crystals-executable-trace | deferred | Ishar 3's `START` and Crystals' `T.X` were not disassembled this pass (only Ishar 1's `T.X` was traced) — the `0xA1`/`0x81` codec port is now verified corpus-wide by output self-consistency + readable content instead, which is strong enough evidence to not require this, but a direct trace on a second title's executable would still strengthen the "one shared codec" claim further | `docs/ishar-container-format.md` §1, §2.5 | 2026-08-30 |
| crystals-carte-array-role | open | `CARTE.CO`'s two confirmed 8-element scratch arrays (`0x3c`/`0x46`) match the 8 confirmed UI strings `JON/ZACH/IRVAN/AKEER/OLBAR/THORM/ALL/NONE` in count+order (STRUCTURAL), but which array means "currently selected" vs. some other axis, and what index 0's un-written default value really is, is not decoded | `docs/crystalsofarborea/amiga/data-structure.md` §3.5 | 2026-09-01 |
| crystals-carte-destination-mechanism | open | The real "travel to a location" mechanism: a confirmed consumer region hit-tests the 8 checklist rows (`cftstset`+"forme" collision test) and calls `clive` (load-and-run-another-script-by-id) on confirmation, but the literal script id(s) `clive` loads, and any per-location map hotspot/placement table (for "click a place on the map"), were not found this session | `docs/crystalsofarborea/amiga/data-structure.md` §3.5 | 2026-09-01 |
| ishar-palette-non-ishar1-titles | open (narrowed) | Ishar 1 settled (FOND `cpalette 8`). **2026-11-22:** Ishar 2's start state has `0x519f` = 1, so FOND1 installs slot 3 (oracle: 100% pixel match with slot 3); the walker's scene now names the slot per backdrop. Open: when `0x519f` moves to 2/3 in play, FVILLE's default, Ishar 3 and Crystals | `docs/ishar-sprite-format.md` §5; `tools/shared/ishar-scene.ts` | 2026-11-22 |
| ishar-cstop-yield-cfg | open (narrowed) | **2026-11-22:** the interpreter side is fixed — `AlisScriptRunner` resumes after `cstop`/`csleep` at the instruction end (FOND's `cpalette 8` and its per-wake alternation now run, oracle-verified). `alis-disasm.ts`'s static CFG still ends paths at `cstop`; give it a resume edge so static traces see post-yield code | `ishar-container-format.md` § "2026-11-13 follow-up", finding 3; §8.8 | 2026-11-22 |
| crystals-perspective-divide | open | Crystals' screen-14 `cdefsc` has `config[0x17]` (`creducing`) = 3, not negative, so the reference `deptopix()` perspective divide may be active there (Ishar 1/2/3: 0xff, disabled); `crystals-firstperson.ts` never divides | `ishar-container-format.md` § "2026-11-13 follow-up", finding 2 | 2026-11-13 game-re |
| ishar-family-docs | open | Bring the four titles' raw docs up to the per-title standard (`docs/<id>/{plan.md,TODO.md,<platform>/data-structure.md}`, as `docs/eotb/` and the 2026-11-21 Amiga titles have). Specifically: a `plan.md` per title, framed for the core-title goal of a full browser remake, with the ALIS script interpreter as the main remake system; a current-state summary at the top of this file, ahead of the 600-line session log; and expanded Ishar 2/3 data-structure notes (85 and 69 lines today vs Ishar 1's 203 and Crystals' 623). Per-title TODO split, or keep this single family file: decide during the pass | this file; `docs/ishar*/`, `docs/crystalsofarborea/`, `docs/ishar-container-format.md`, `docs/ishar-sprite-format.md` | 2026-11-21 backlog |
| ishar-www-pages | open (after `ishar-family-docs`) | Write the site pages for `ishar`, `ishar2`, `ishar3` and `crystalsofarborea` (`www/src/content/docs/<id>/index.mdx` + `status.md`, `seer-website` skill bar), add them to `_sidebar.json`, the all-games status board and the home `GameCardGrid`, and drop Ishar from the home page's "uncurated backlog" paragraph. Possibly a shared family page for the container/codec and ALIS engine | `www/src/content/docs/status/index.mdx`, `www/src/content/docs/index.mdx` | 2026-11-21 backlog |
| ishar3-map-orientation | closed | **Closed 2026-11-22 (superseded):** the first-person view no longer depends on a display orientation — `IsharScene` feeds the scripts the game's own row/col/raw-facing globals, and the oracle confirmed the raw-facing step directions (1/2/3/4 = col-1/row+1/col+1/row-1) on real walks in Ishar 1. Ishar 3's start pose (CONT1-3 row 2 col 50, raw facing 1) is read from the game. What remains is cosmetic (which way the top-down map is drawn) and moves with `ishar3-oracle-boot`. Was: Ishar 3's `Koren-Bahnir` map comparison inconclusive, transpose assumed | `ishar-container-format.md` §8.8 | 2026-11-22 |
| ishar2-scene-groups | open (narrowed) | **2026-11-23:** CONT1's sub-zones are modelled and measured. GERDEP `+0x162a..+0x18ff` (called after each step from `+0x1411`, input local 20 = the grid-B cell stepped onto) sets zone `0x4ef2`; a new game starts in zone 4. MAIN's zone add-ons were read off the oracle's start/kill trace for every zone pair: zone 1 VILLAGE1, zone 3 BOAT, zones 5/9 FORET1 (restarted on entering 9), zones 2/4 none. FOND1's palette follows the day phase `0x519f` (slots 3/4/5; MAIN advances it on a timer, around frames 12965/14965). A 128-action real walk through zones 4, 1 and 3 matches 100% of placements and pixels with roaming NPCs removed (`noNpcs`, harness `ALIS_HARNESS_NOENT`). Region code `0x2d18` stays 1 at the CONT1 edges (rows run off-grid), so region travel is not by grid edge. Still open: Ishar 2 regions 2-7 (door-cell zones, `\|cell\| - 40`) and how the game changes region; the gradual day/night palette fade (`ctopalet`, about 2000 frames) is not modelled, only the phase's end slot **Region travel:** Ishar 2's regions are islands (GERDEP `+0x194d` prints Irvan's/Thorm's/Zach's/Jon's/Akeer's/Olbar's Island from `0x2d18`). No decoded script writes `0x2d18`, so the writer is in MAIN's undecoded blocks. Rows past 89 do not change region: the party walks on into the grid-B bytes, off the map. So travel is an in-game action (boat or map), not a grid edge. **2026-11-23 (later): the region writer is found.** MAIN `+0x374` stores a message value (`cstore oscan`) in `0x51bf` and starts `+0xede`. Its `cswitch2` at `+0xee6` (base 3) is the arrival table: each arm writes row `0x2ab4`, col `0x2ab5`, region `0x2d18`, zone `0x4ef2` and raw facing `0x2ab6`. Selectors -2..8 are ten destinations on regions 1-7. Selector -3 returns to the position saved in `0x4fd1`/`0x5074`/`0x5075`/`0x5076`; GESORT sends it (type 14), so it is probably a recall spell. Ported as `ISHAR2_TRAVEL` (checked against MAIN's bytes in `ishar2-travel.test.ts`); the walker's T key jumps through the destinations. Still open: which script sends the island selectors (the boat trip; MARIN and PPTRAVEL are candidates, neither decodes a send), so the oracle cannot drive a trip yet. The other islands' scene groups go through MAIN loaders `+0x37f4`/`+0x377a`/`+0x3872`/`+0x38d9` (called from the region switches `+0x1795`/`+0x1821`/`+0x1884`), not decoded. **2026-11-23 (islands, measured):** the island selectors come from MAP, the travel map (`+0xcf` switch on the clicked form - 20, `csend 0 14 sel`; islands 2-4/6-8 need the flags `0x4fc2..0x4fc5`), only in travel mode (MAP `dirb 12`, set from `0x51c4`); MAIN message 25 opens the map with that mode: FRISE's map button sends 25,0 (view only), GERDEP sends 25,1 when the party steps forward onto region 4's grid-B 127 (the dock) and 14,-2 on 126. MAIN message 30 (PP3MN, a dialogue) is a ship to selector -1. The "loaders" `+0x37f4`/`+0x377a`/`+0x3872`/`+0x38d9` are not scene loaders: they are disk prompts (Disk B/A/C/D). The scene groups are MAIN `+0x16f8` (2 FARBO+ARBO, 3 FVILLE+VHOUSE2, 4 MONTAGNE+FMONT, 5-7 none) and the zone starters `+0x2156`/`+0x24ce` (`ISHAR2_ZONE_ADDONS`: town quarters, dungeon walls FDJCAT/FDJ1/FDJ2 with DJCAT/DJ1/DJ2, which start PCAVE). The palettes follow the day phase like FOND1. The step test GERDEP `+0xb72` is ported (`ishar2Enter`: monsters in the party's own cell block one side, dungeon doors on cell edges with flags `0x4aa4`). The oracle drives every trip with the new harness command `send` (`captureTrip`); all ten selectors land as `ISHAR2_TRAVEL` says. 40-action walks from each arrival: 360/360 moves; placements 100% everywhere except 3 VHOUSE2 sprites on Zach's Island (height 26 vs -1 on the first three frames after arrival); masked pixels 99.94-100%. Still open: the region 4 cliff (76,2) leads to LOSTGAME, not modelled; the red damage flash in the dungeons; NPCs on the islands not measured. | `tools/shared/ishar-scene.ts` `ISHAR2_TITLE`; `tools/ishar/__tests__/oracle-parity.test.ts` | 2026-11-23 |
| ishar3-oracle-boot | closed | **Closed 2026-11-23.** Ishar 3 paces its intro on the 50 Hz timer. The harness's virtual clock (`ALIS_HARNESS_VCLOCK=1`: no SDL timer; the timer routine and host tick/delay calls are driven per presented frame) makes the boot deterministic in fast mode: 4060 frames, about 1 s. `ISHAR3_TITLE` covers the Maz start group. VWALL, VHOUSE2, VHOUSE1, FVILLE, VDEC1 and VDEC2 run with engine-3.0 entity coordinates at vram 0/8/16, a one-dimensional `0x15f8` table, and an indirect buffer B at `0x14ae` (= CONT layer 1, verified byte-exact). Result: 100% of placements and of pixels outside NPC boxes over 60 random poses and a 75-action real walk. The reference element-list rules were ported at the same time: a plain put reuses the element's first sprite, which explained VDEC1's 5 extra sprites. Still open: the other Ishar 3 regions' groups | `tools/ishar/oracle/README.md`; `tools/shared/ishar-scene.ts` `ISHAR3_TITLE` | 2026-11-23 |
| ishar3-regions | open (narrowed) | **2026-11-24:** Ishar 3's MAIN decodes with the engine-3.0 operand shapes: region code `0x14b9` (1 in Maz), location code `0x3b33` (2 at the start) and the 57-arm location loader `+0x18d4` (Maz districts 1-13, dungeons 21-28, monster sets 30-57; `ishar-container-format.md` §8.8 item 16). The day/night palette is modelled (`cdarkpal` factors `0x3f82..`, from the hour `0x3c08`): a 171-action Maz walk went from 24.6% to 99.99% of masked pixels, placements 4112/4114. **2026-11-24 (later):** the travel is traced: gate cells (grid B = 100) -> GERDEP `+0xe04` -> MAIN message 38 -> destination table `+0x41ed` -> SPACE2 -> region load; region -> CONT mapping and every region group decoded (§8.8 item 16). The oracle drove a trip to the forest (region 5); FORET+FFORET measured at 98.0% placements (one FFORET composite sprite placed at height 20 by the game, 0 by crawl) and 100.000% masked pixels over 80 frames, but the walk got stuck after 8 steps at CONT4-3 (7,8) (cause untraced). Still open: the FFORET height residual, the stuck cell, measuring the jungle (3/4), dungeons (7/8, with their location add-ons) and mountains (9/10), and Maz's location add-ons beyond the start (1, 4-13). Every savestate load advances Ishar 3's clock by hours, so measure with single-leg walks. | `tools/shared/ishar-scene.ts` `ISHAR3_TITLE`; `tools/ishar/__tests__/oracle-parity.test.ts` | 2026-11-24 |
| ishar1-scene-towns-regions | open (narrowed) | Ishar 1 town/cave codes 11-15 (FVILLE/VILLE/FONTAINE, caves) and regions 3-6 (rampart/inville/village zones 7-18, temple) are modelled from the traced MAIN/GERDEP code but not yet measured against the game: poking the region code does not reload the region, and a real walk toward CONT3 ended in a fatal encounter in CONT2. Route around NPCs (or poke the encounter state off) and measure **2026-11-23 follow-up:** with roaming NPCs removed (`noNpcs`) the encounter no longer ends the walk, and every view the walk reached still matched 100% (a 226-action walk through CONT1 and CONT2). It still did not reach CONT3. Open-loop walks drift: the game drops some forward presses for a few frames after a step (for example 2 presses at CONT1 22,25 and then a successful step), so the scripted route goes out of sync. A planner that blocks each refused cell and replans did not converge. Next step: a closed-loop walk, reading the position back between actions, or chained savestates (`save` after each leg). The cells -80, -81 and -82 are intra-region passages in GERDEP `+0x101c..+0x11be` (for example CONT1 21,14 leads to 17,67); only -82 changes region (to 6). How the region codes 11-15 are entered is still untraced. **2026-11-23 (read-back walks):** `captureLegWalk` (legs from savestates in a private game directory, replanned from where the game stands, `expect` holds input from the first action the game did not follow) gets through the drift. The scene matches 100% of placements and of pixels outside NPC boxes on every view frame of the walks: CONT1 and CONT2 (about 360 frames from the new-game start), CONT3 (56 frames) and CONT4 (82 frames). Region 5, region 6 and the town codes 11-15 are still not reached. Blockers, in order: (1) entering CONT3 runs MONSTRE.DO's manual-protection prompt. MONSTRE's answer table is at `+0x446` and holds 8 (page, line, word) entries. Letters are stored as A=1, and the check is at `+0x3eb`. The oracle answers it by key presses, found with `ALIS_HARNESS_STRCMP`, which logs key reads. (2) CONT3 (9,26) is a causeway cell of value 1, and the game refuses it even with no NPCs. The cause is untraced; the walk poked past it. (3) The party dies near CONT4 (43,18) even with HP poked each leg, and the game restarts. Two regions are matched but not driven by the walker yet: region 5 (via passages) and region 6 (via the -82 cell at CONT5 50,49). **2026-11-23 (blockers resolved, CONT5 and the first cave measured):** (2) is GERDEP's monster check (slot 46, see `ishar-walkability-rule`). (3) is a ranged monster, not a trap: EN1 slot 48 (CONT4 40,15, kind -1, hp 55) hits the party whenever both \|drow\| and \|dcol\| are at most 5. GEREN `+0x27` loops over the monster slots, GEREN `+0xe5e` sets the range, and the HP write is at GEREN `+0xc9b`. Measured by poking positions: hits at distance 5 on either axis, never at 6. Killing slot 48 (`pokew 1b82 0`) stops it. Its first hit (up to 18) kills the new-game party (Aramir alone, 12 hp). `ishar1Danger` gives the planner those cells. Walks now keep hp at 500 (`pokew 1542 500`). CONT5's gateway at (6,24) is held by slot 58 (kind -1); the walk removes it (`pokew 1b96 0`). **CONT5 (region 5): 41 view frames, 100% of placements and of pixels outside NPC boxes.** **Caves:** the cell value 81 at CONT5 (13,24) switches the region code to 15, a cave on the CONT5 grid. TELEP.DO first asks its own manual-protection word; its table holds 8 entries and has the same layout as MONSTRE's. Region 15's group is MCAVE, FCAVE2, SCAVE and COLCAVE. MCAVE draws the doors through a child entity, PCAVE: it starts PCAVE with `clive`, passes it the door position through `shimw`, and COLCAVE kills PCAVE on the next wake. MCAVE also reads PARAM's door table (`0x3c00`/`0x3c34`/`0x3b64`). Three interpreter decoding bugs hid all of this (`clistent`/`crstent` destinations, two-word `ohim*`/`shim*` operands, `clive`); see `ishar-container-format.md` §8.8. **Cave walk (12 actions at CONT5 14..16,24): 100% of placements and masked pixels (was 16%).** **2026-11-23 (later): cave movement and the temple, measured.**

Movement rules, all measured in the oracle:
- **Doors** (`ishar1DoorShut`). A cell holding 50..69 has a door on one edge: (value - 50) mod 4 gives north, south, west or east. Crossing that edge, in either direction, is refused while the door's PARAM entry is shut. Example: (16,24) = 51 refuses the step south; opening entry 11 (`poke 3b6f 1`) lets the party through. (30,33) = 53 refuses the step into it from the east.
- **Gates.** A cell holding 82..85 refuses the step onto it while its entry is shut.
- **Passages.** The move delta still applies after the jump (GERDEP `+0x5d8`/`+0x9d2` add the step). For example, (49,19) east onto the -81 lands on (36,27), not on the table's (36,26).
- **Cave mouth.** CONT5 (13,24) switches the region code 5 <-> 15 (`ishar1CavePortal`; the writer is MAIN `+0x1b11`).

Scene:
- MCAVE also reads a second PARAM list of 22 (row, col) entries (`0x3c68`/`0x3c9c`, levers?) and its state table `0x3b98`.
- The oracle now dumps `0x3b64` and `0x3b98` every step and feeds them to the scene (`IsharPartyState.tables`).

Walk set-up. The walks keep hp at 500, open every door and kill the guards on the route by poking hp 0: slots 33, 41 and 49-57 (cave), 34-39 (temple) and the roaming 60-69. Doing so changes the game, so these walks measure only scenery and movement.

Results, all at 100% of placements and of pixels outside NPC boxes:

| Area | View frames | Moves the game made, as predicted |
|---|---|---|
| CONT5 cave (region 15) | 52 + 50 + 45 + 16 + 24 | 100% (except the first frame after a poke) |
| Temple (region 6), entered by the -82 cell | 79 | 79/79 |

Still open:
- how doors and levers are worked in play (the walks poked them open);
- ~~town codes 13/14 and the other cave codes~~ (done, see below);
- ~~the zone add-on INCAVE~~ (done, see below);
- the walker does not model regions 12-15 (its world has no cave or town layer).

**2026-11-23 (later): gateways, towns and the second cave, measured.** The region code changes at fixed cells, traced in MAIN's per-region position checks `+0xfb3..+0x149c` (writers `+0x3039`/`+0x3052` caves, `+0x306b`/`+0x3081` towns, each ±10). Inner -> outer cells: CONT2 cave (27,37) -> (27,38); CONT5 cave (13,24) -> (12,24); CONT3 town (18,73) -> (17,73) and (32,57) -> (32,56); CONT4 town (26,72) -> (25,72) and (33,65) -> (33,64). There is no code 11. `ishar1RegionPortal` replaces `ishar1CavePortal`. INCAVE is a position add-on (MAIN `+0x11e4`/`+0x121a` region 5, `+0x1031`/`+0x1070` region 2), and it wins equal-depth ties over the group. Sprites with depth < 0 are listed but not drawn. Mid-game walks must start with the game's zone (`0x3eac`, now dumped each step). Results, all 100% of placements and of pixels outside NPC boxes: town 13 (51 frames), town 14 (13), cave 12 (59, in and out), CONT2 with INCAVE (73), CONT5 corridor with INCAVE (14). Moves: all as predicted except one where the walk's own poke removed the town guards between legs. Leaving town 13 runs MONSTRE's manual prompt again. Entering a town spawns guards (kind -4) into slots 60-69. Savestates: `town13`, `town14`, `cave12`.

Doors, partly traced: PCAVE gives a door a click form (`cforme`) only when it is adjacent and its index is below 24 or above 40; index 40 also needs item -24 in a party inventory (`0x1568`); PCAVE `+0x1c4` then sets the door's PARAM flag. Negative indices are levers (state `0x3b98`; lever drawn up at 0, down at 1/2). Clicking the door, or ACTION then the door, in the oracle did not open CONT5 door 11 (16,24): the click has to hit the form in the mouse entity's coordinates, not yet worked out. The ACTION menu offers PICK LOCK. **2026-11-23 (later):** PCAVE's interrupt handler (`+0x20`, `cswitch2` on the message) runs `+0x1c4` on message 19: it sets the door's `0x3b64` flag and plays the door sound. Message 20 runs the lever switch `+0x213`, which writes `0x3b64`/`0x3b98` per lever. No script sends 19 with a literal `csend`. FRISE's view hit test is `cftstset` at `+0x3113`: it takes a pointer entity's x/depth/height and steps the depth by 2 until a form answers. Clicks and holds on door 11 (CONT5 16,24, facing south) changed nothing in the oracle, and neither did clicks on the plate beside it: no script woke and the flag stayed 0. Door 40 (`+0x120`): facing it from the adjacent cell, PCAVE looks for item -24 in inventory column 11 (`0x1568`) of a living member and starts MESSAGEI (id 14) with message 18 when one holds it, 17 when none does. The walker's E key opens a clickable door the party faces (`ishar1FacingDoor`, `ishar1DoorClickable`). Levers are not modelled.

The protection answers are automated: `tools/ishar/oracle/manual.ts` reads MONSTRE's and TELEP's tables and answers a prompt by trying the words (verified at the cave mouth, about 60 s per try). | `docs/ishar-container-format.md` §8.8 | 2026-11-23 |
| ishar-npcs | open (narrowed) | **2026-11-23:** NPCs and monsters are drawn by the game's own entity scripts, now run by `IsharScene` (`spec.entities`). Ishar 1 uses ENCONT, which `clive`s a monster script per EN1 slot in view and passes it x/depth/height through `shimw`. Ishar 2 uses EAFF, the same mechanism. Ishar 3 uses AFFPV (the Maz townspeople, VPERSO1..5) plus EAFF. EN1.FIC is MAIN's `cfreadb` run in all three titles (`ISHAR*_EN1_READS`). Measured with no NPC masking: Ishar 1 walks 100% of placements (Bormin, Kiriela, Naim, Fragorn, roaming wolves, 111 town-guard sprites in town 13) and 99.99-100% of pixels. Ishar 2: 91 of 93 bear sprites exact. Ishar 3: 131 of 133 townspeople within 12 px (their x adds `ornd`, the engine's shared random generator, which crawl cannot reproduce; 63 exact). Open: (1) a monster in the cell in front plays a per-frame close-up animation (MINOTOR `+0xb6`) that crawl draws as idle; (2) GEREN's monster movement and roaming spawns (the walker shows the new-game EN1 places); (3) Ishar 3's townspeople table (`0x4012..`) has no loader found yet, so the walker draws none; (4) floor objects (AFFOBJ/OBJET) | `docs/ishar-container-format.md` §8.8 item 17, §9.3; `tools/ishar/__tests__/ishar-entities.test.ts`, `oracle-parity.test.ts` (townspeople) | 2026-11-23 |
| ishar-scene-tie-slots | open (low) | After a region change the game's equal-depth tie order follows each new script's entity slot (slots freed by the killed group are reused); `IsharScene` uses start order. Costs 10 pixels over a 129-frame walk. Model slot allocation (`script_live` slot reuse) if it ever matters | `tools/ishar/__tests__/oracle-parity.test.ts` (walk test comment) | 2026-11-22 |

## Session log

- **2026-11-23 (Ishar 2 islands):** the oracle now drives Ishar 2's
  island trips. A new harness command, `send`, queues a message for MAIN
  the way `csend` does; `captureTrip` sends MAIN message 14 with a travel
  selector, which is what the travel map (MAP) sends when an island is
  clicked. All ten selectors arrive where `ISHAR2_TRAVEL` says. The island
  scene groups (MAIN `+0x16f8`), the zone add-ons (`+0x2156`/`+0x24ce`) and
  GERDEP's step test (`+0xb72`) are ported. 40-action walks from each
  arrival match 360/360 moves and 100% of placements on every island but
  Zach's (3 sprites); pixels 99.94-100%.

- **2026-11-23 (NPCs and monsters):** the walker draws NPCs and monsters
  the way the game does: it runs each title's entity scripts (Ishar 1
  ENCONT, Ishar 2 EAFF, Ishar 3 AFFPV + EAFF) on the EN1 memory. The
  oracle dumps that memory every step, and the walker reads it from
  EN1.FIC. Fixed on the way:
  - `oprnd`, a seeded hash;
  - `csound`'s five operands;
  - table stores;
  - Ishar 3 scripts decoded as engine 2.0.

  Results:
  - Ishar 1: 100% of placements on every live-NPC walk. That includes
    town 13 with its gate guards, reached with the protection answered at
    run time.
  - Ishar 3: Maz townspeople 131/133 within 12 px.
  - Ishar 2: bears 91/93.

  The remaining gap is the engine's shared random generator (`ornd`).
  See §8.8 item 17.

- **2026-11-22 (alis oracle pass):** built `tools/ishar/oracle/`, which
  runs `maestun/alis` (MIT, pinned 31b1811) plus a harness patch. It is
  headless and frame-locked, uses savestates, and dumps the live display
  list. A sweep, a real-walk capture and a vitest run against it. Found and
  fixed in the walker:
  1. a single script instead of the region group's union;
  2. mirroring (`cxput*` invert `xinv`);
  3. buffer B fed layer 0 instead of the neighbour/layer 1;
  4. the backdrop treated as fixed when it alternates per wake;
  5. a placeholder sky/ground instead of palette 0;
  6. interpreter gaps (no coroutine resume, `cstart`, `cdim`, s16
     semantics, type-0x01 rects);
  7. absolute N/E/S/W movement and arbitrary start poses.

  Measured, old walker -> new:
  - Ishar 1 CONT1: 31% -> 100% of placements;
  - Ishar 2 start area: 11% -> 100% of placements.

  Pixels outside NPC boxes now match 100%. Null controls score 5-9%. The
  interpreter was partly written from alis, so agreement is not fully
  independent. See `ishar-container-format.md` §8.8.


- **2026-09-03 (fifteenth pass — 4 bounded loose ends: 1 closed as
  superseded by a parallel session, 1 CONFIRMED by direct disassembly, 1
  checked-and-refuted, 1 left open with a sharper structural blocker)**:
  **Item 1** (`ishar-greyscale-atlas-normalize`): wired
  `ishar-sprite-atlas.ts` to `isharBitmapToNormalizedGreyscaleRGBA()` and
  re-ran the atlas pipeline for all 4 titles from clean state (same decode
  counts as before — 1608/2244/2744/931 sprites — confirming no regression);
  verified the fix directly on a real corpus example (`KNIGHT.DO` idx13,
  index range 124-127): flat-scale render collapsed to values `{105,106}`
  (near-indistinguishable), normalized render spans `{30,100,170,240}` (full
  contrast). A concurrent sibling session then landed real AGA palette
  recovery on top of this exact change (`ishar-palette.ts`, `resolveIsharOwnPalette`/
  `mergeIsharPalettes`) and re-ran the pipeline again with real colour (all
  74 Ishar 1 atlases now `hasPalette: true`) — row closed as superseded, not
  independently re-claimed. **Item 2** (`ishar-cavint-sceneLayer-writer`):
  attempted to locate `MAIN.CO`'s real `omainb(0x2b3c)=1` write for
  `CAVINT`; not found, but found a concrete NEW reason why — `MAIN.bin`'s
  reached CFG (`alis-disasm.ts` from its entry point) covers only 312 of
  12,448 bytes (2.5%) before hitting an indirect-jump opcode family
  (`cjsrabs`/`cjmpabs`/`cjsrind16`/`cjsrind24`/`cjmpind16`/`cjmpind24`,
  `0x0b`-`0x10`) this project's disassembler doesn't implement — confirmed
  these are real instruction-boundary hits (not a decode desync, each
  follows a legitimate `cnul` fallthrough) and confirmed NOT Crystals-
  specific (Ishar 1's own already-trusted `MAIN.bin` hits the same family
  61 times). The reference `alis` source itself stubs all 6 opcodes as
  `[N/I]` with zero operand-reading code, so no width can be derived from
  it — a genuine oracle gap of the same class `cdefmap` was (§8.1, resolved
  via `re-oracle`). Not escalated this pass (bounded/optional item per this
  session's scope); flagged as a good future `re-oracle` candidate. Row
  text updated with this sharper evidence, left open. **Item 3**
  (`ishar-firstperson-backdrop-anchor`): disassembled `FOND.bin` directly —
  the WHOLE script is 12 instructions, 0 branches, 0 loops, exactly 2
  `cputnat` calls at hardcoded (position/facing-independent) screen anchors,
  then `cstop`. A second backdrop script (`FTEMPLE.bin`) shows the same
  shape at smaller scale (11 instructions, 1 `cputnat`). This is direct
  code-level proof there is no missing tiling/repeat loop — exactly 2 fixed
  panels IS FOND.bin's complete, real, intentional behaviour. Row CLOSED
  (UNVERIFIED → CONFIRMED); no code change needed. **Item 4** (quick check,
  not a TODO row): checked `MAIN.bin`'s manifest for a
  `cload(fville.AO); cload(village.AO)` adjacent pair analogous to
  TEMPLE's confirmed `ftemple.AO`/`temple.AO` zero-gap pair — REFUTED.
  `fville.AO` sits inside a CAVE-entry dispatch chain
  (`fcave`/`colcave`/`fville`/`mcave`/`scave`/`fcave2`, each gated by its
  own branch), not the location-scripts registration zone; the nearest
  `.AO` load is actually `ville.AO` (`VILLE.DO`, a file distinct from
  `VILLAGE.DO`), and even that pair fails the strict zero-gap test (real
  branch bytecode in between). `village.AO` itself is ~4,500 bytes away, in
  the monster-roster bulk-registration block (a negative control showing
  zero-gap adjacency alone isn't sufficient evidence outside an isolated
  context). No code change made — `VILLAGE.bin` correctly keeps the shared
  `FOND.bin` backdrop. Verification: `npx tsc --noEmit -p .` and
  `npx eslint` clean on all changed files; `npm test` still 370/370 (no
  regressions — no runtime code was changed by items 2-4, only docs; item
  1's change was a like-for-like render-function swap with an
  already-existing, already-used function). No amiberry/emulator use. Full
  evidence: `docs/ishar-container-format.md` §8.2 (FOND.bin correction),
  §8.7 (FVILLE/VILLAGE correction), `docs/crystalsofarborea/amiga/
  data-structure.md` §8 (CAVINT follow-up correction).

- **2026-09-01 (concurrent pass, run alongside the fifteenth pass above —
  `ishar-sprite-palette` CLOSED, real AGA colour recovered)**: Traced real
  `cpalette`/`ctopalet` call sites (`tools/shared/alis-disasm.ts`) across
  Ishar 1's `.DO` corpus (38 hits) to answer §5's open question. Most
  monster/portrait scripts (`DRAGON.DO`, `GEANT.DO`, `SKELET.DO`, ...)
  resolve to a literal `oimmb` directory-index operand; `MAIN.DO`'s own 12
  call sites resolve to a `basemain`-relative global byte or a runtime
  restore/load-slot-0 boolean, with no static write site found in the
  reached CFG — but this turned out to be the wrong question, since NO
  outdoor location script (`FORET.bin`, `VILLAGE.bin`, etc.) issues a
  `cpalette` call at all. The real unlock: every genuine palette resource
  carries a dedicated, zero-false-positive marker byte at its resolved
  header (`paldata[0] === 0xFE`, 62 hits corpus-wide, cross-checked against
  every known bitmap `type` byte) — `findIsharPaletteSlotIndex()`
  (`tools/shared/ishar-palette.ts`, new) finds a script's own palette
  directly by directory scan, sidestepping the bytecode-index trace
  entirely. Cross-checked independently: 15+ monster scripts' own literal
  `cpalette oimmb(N)` operands land EXACTLY on their own `0xFE` slot.
  `FOND.DO`'s slot 8 (256-entry, 24-bit AGA RGB, 16 material-ramp banks) is
  Ishar 1's shared world palette — near-identical to several other
  location scripts' own embedded copies (`GERDEP.DO` differs in 6/256
  entries), and every outdoor script has zero `0xFE` slots of its own,
  consistent with the already-documented shared-`FOND.bin`-backdrop
  convention. Ported `topalette()`'s two on-disk encodings (16-colour
  nibble-packed and AGA 24-bit RGB-triplet) and its persistent-palette-
  buffer overlay semantics (`mergeIsharPalettes()`) directly from
  `image.c`. Applied to the batch atlas pipeline (`ishar-sprite-atlas.ts`,
  own-palette-then-world-palette-then-greyscale-fallback, zero decode-count
  regression) and to a new first-person preview
  (`tools/ishar/amigaaga/firstperson-preview.ts` → `public/assets/ishar/
  amigaaga/screens/foret-color.png`, 196 real sprite placements). Result:
  74/74 Ishar 1 atlases now real colour; generalizes usefully but
  incompletely to Ishar 2 (74/119), Ishar 3 (64/113), and Crystals of
  Arborea (12/33) since none of those ship one shared `FOND`-equivalent
  file (see the new `ishar-palette-non-ishar1-titles` row). Visual
  confirmation (Method §4): red/dark-red dragon, green tree foliage over
  brown trunks, tan/brown humanoid skin tones (Ishar 1); an orange dragon
  amid yellow-orange fire frames (Ishar 2); a dramatic burning-forest death
  screen with a red/orange fire sky (Crystals) — all genuinely plausible,
  none garish/random. The `FORET.bin` colour/greyscale pair is especially
  decisive: the same backdrop panels that are illegible static noise in
  greyscale immediately read as blue sky + white clouds over green grass
  in colour. `npx tsc --noEmit -p .`/`npx eslint` clean on all
  changed/new files; `npm test` still 370/370 (no regressions — every
  existing caller that omits the new optional `palette` field renders
  byte-identically to before). No amiberry/emulator use — static
  disassembly + directory census + `Read`-based visual inspection only.
  Full evidence: `docs/ishar-sprite-format.md` §5.

- **2026-09-02 (fourteenth pass — Ishar 3 first-person CONFIRMED, correcting
  the thirteenth pass's "4 unconditional diamond-scan blocks" verdict)**:
  Tasked with fully disassembling the 4 scan blocks' lateral-bound
  narrow/widen logic per the thirteenth pass's own stated next step. A full
  CFG-level disassembly of `FORET.bin` (247 instructions, 0 errors) found
  the prior verdict's central claim was WRONG: the 4 `cjsr target=1127`
  call sites are NOT unconditional — each sits inside its own facing-gated
  block (one per `cswitch2 base=2 count=4` target, exactly Ishar 1/2's
  shell), and every block ends with `cjmp` to the shared `cret`. Only ONE
  block runs per frame, selected by facing, never 4 — the earlier "4x
  quadrant scan" reading came from a flat call-site grep that never checked
  CFG reachability (see `false-positive-bytecode-hit-without-cfg-
  reachability.md`, a new pitfall this session). Independently
  double-checked the interpreter's comparison-operator semantics against
  `github.com/maestun/alis`'s real source (fetched directly via `curl`,
  `src/opernames.c`) to rule out an operand-order decode bug as an
  alternative explanation — confirmed `alis-interp.ts`'s `acc-before OP
  new-operand` convention matches `osup()`'s real C implementation exactly.
  **Result: no code change was needed in `alis-interp.ts` or
  `ishar3-firstperson.ts`.** Running the existing, unmodified renderer
  against real `FORET.bin`/`JUNGLE.bin` bytecode + real `CONT4-3.FIC` grid
  cells at 7 real position/facing combinations produced coherent,
  recognizable forest/jungle scenes for 6/7 (the 7th, an interior position
  facing directly at a non-forest patch, rendered an empty-but-plausible
  backdrop-only frame — not garbage). A real, source-confirmed residual
  quirk (one lateral-scan bound can widen toward a region edge instead of
  shrinking, and the per-ring narrowing loop's exact-match condition never
  catches up) was re-confirmed but found to be empirically HARMLESS for
  interior positions (over-wide placements land off-screen and get clipped)
  — only visibly messier at a grid CORNER (`(7,3)`, the prior session's own
  test position, which explains why that session saw a genuinely worse
  result there than the interior positions this session tested). Shipped:
  `tools/ishar3/amigaaga/scripts.ts` (new, matches Ishar 1/2's convention),
  `tools/walker/games-ishar.ts`'s `LOCATION_SCRIPTS.ishar3`/
  `RENDER_FRAME.ishar3` now wired (`foret`+`fforet`, `jungle`+`fjungle`,
  region pattern `CONT4`) — `KeyF`/`KeyC` now work for Ishar 3 exactly like
  Ishar 1/2. `ishar3-firstperson.ts`'s module doc rewritten (CONFIRMED, not
  "attempted, not achieved"). No amiberry/emulator use — static
  disassembly + real-cell scanning + `Read`-based visual inspection only.
  `npx tsc --noEmit -p .`/`npx eslint` clean on all changed/new files;
  `npm test` still 370/370 (no regressions — see below). Full evidence:
  `docs/ishar-container-format.md` §8.6's correction block.

- **2026-09-01 (thirteenth pass — Ishar 2 first-person CONFIRMED (two
  scripts), Ishar 3 attempted and left OPEN with a well-scoped negative)**:
  Generalized the proven Ishar 1 mechanism (§8.2-8.5) rather than
  reinventing it. Tried Ishar 2's dungeon files (`DJ*.DO`) first per the
  task's own initial suggestion — rejected (`DJ1.bin` is a 100 KB,
  1,303-instruction script with a genuinely different rectangular-area-scan
  structure). Pivoted to outdoor scripts: **Ishar 2's `FORET1.bin`+
  `FOND1.bin` and `VILLE.bin`+`FVILLE.bin` both RENDER end-to-end**
  (structural-correspondence global derivation against Ishar 1's own
  confirmed shell — `partyX=0x2ab4`, `partyY=0x2ab5`, `partyFacing=0x2ab6`,
  same `+1` facing convention), verified against real `CONT1.FIC`/
  `CONT3.FIC` cells: 9 real position/facing renders, all visually distinct
  and non-degenerate (coherent tree/root structures for FORET1; recognizable
  building rooflines/walls for VILLE, each facing showing a different
  silhouette). Shipped `tools/shared/ishar2-firstperson.ts`,
  `tools/ishar2/amigaaga/scripts.ts`, and generalized
  `tools/walker/games-ishar.ts` (`LOCATION_SCRIPTS`/`RENDER_FRAME` now keyed
  by game id, `IsharLocation` carries its own optional per-location backdrop
  for Ishar 2's convention) — `KeyF`/`KeyC` now work for Ishar 2 exactly as
  they already did for Ishar 1. **Ishar 3 attempted, NOT achieved.** Globals
  (`partyX=0x14b6`, `partyY=0x257`, `partyFacing=0x14b7`) and screen
  constants ARE confirmed by disassembly, and a facing raw-value table
  (`[-2,-1,2,1]`) was derived by tracing per-block world-coordinate updates
  — but rendering `FORET.bin` against real `CONT4-3.FIC` cells produces
  noisy, non-forest output at every position/facing tried (5 combinations,
  2 test cells including one edge and one interior, ruling out a clamp
  artifact). Root-caused via direct disassembly of the shared per-cell
  subroutine chain: Ishar 3's outdoor scripts execute an unconditional
  4-quadrant "diamond scan" (4 separate `cjsr` call sites, none gated by the
  facing dispatch) rather than Ishar 1/2's single facing-selected forward
  scan, and the outer ring loop's lateral-bound narrow/widen logic lets the
  effective lateral magnitude reach ~28-49 (not the ~7 the initial clamp
  suggests), producing screen x-offsets from -9,408 to +1,197 against a
  255px screen. Confirmed NOT script-specific (`JUNGLE.bin` shares the
  identical 4x-`cjsr` shell). Not escalated to `re-oracle` — the negative is
  well-scoped with concrete file offsets and a specific structural
  difference identified, and the task explicitly permitted leaving one
  title as a scoped follow-up. `ishar3-firstperson.ts`'s module doc
  corrected to state this honestly (no working render claimed); NOT wired
  into the walker (`LOCATION_SCRIPTS.ishar3 = []`). No amiberry/emulator
  use — static disassembly + real-cell scanning + `Read`-based visual
  inspection only. `npx tsc --noEmit -p .`/`npx eslint` clean on all
  changed/new files; `npm test` still 370/370 (no regressions). Full
  evidence: `docs/ishar-container-format.md` §8.6 (including the full
  paths-tried table for Ishar 3).

- **2026-09-02 (twelfth pass — RAMPART/PLAINE (Ishar 1) and PLAGES/CAVINT
  (Crystals) all RENDERED, by disassembling each script's own cell-value
  dispatch instead of guessing test positions)**: The prior pass left
  `RAMPART.bin`/`PLAINE.bin` at "disassembles clean, not traced" and
  `PLAGES.bin`/`CAVINT.bin` at "tried at the wrong (ARBRE-borrowed) test
  position, blank frame." This pass disassembled each of the four scripts'
  own `cswitch1`/`cswitch2` cell-value dispatch directly
  (`tools/shared/alis-disasm.ts`, no new tooling) to get each script's real
  accepted cell-value set, then scanned the real data source (`CONT*.FIC`
  for Ishar, `INIT.FIC` for Crystals) for matching cells — the same method
  §8.3/`docs/ishar-container-format.md` used for `VILLAGE.bin`, generalized.
  **`PLAINE.bin`** (`cswitch1`, 20-value set) found 1,039 matching cells in
  `CONT1.FIC`; 4 rendered poses show a wide grass-field texture band with
  foreground shrub clumps. **`RAMPART.bin`** (`cswitch2 base=-100 count=11`,
  values `100..111`) found 101+58 matching cells in `CONT3`/`CONT4.FIC`
  forming a real closed fortress-perimeter polygon (no other rendered
  script's cluster is a closed ring); 3 of 4 rendered poses show tall
  tower/wall silhouettes rising above the horizon, visually distinct from
  every other script. **`PLAGES.bin`** (`cswitch1`, `{-25..-20,50}`) found
  787 matching Z=0 cells in `INIT.FIC`, densely clustered along the map's
  `x=94` edge; 4 rendered poses show a rocky/dune coastal texture.
  **`CAVINT.bin`** (`cswitch1`, `{-94..-90,-79..-70,80..85}`) found ZERO
  matches in `INIT.FIC`'s Z=0 sub-array despite reading the identical
  default-0 `sceneLayer` global as `PLAGES`/`ARBRE` — but 1,947 matches in
  the Z=1 sub-array, forming real closed room/wall outlines. This is a real
  **correction**: the previous session's "tested with `sceneLayer=1`, blank
  frame, inconclusive" was a wrong TEST POSITION, not a wrong layer guess —
  Z=1 really is `CAVINT`'s content, confirmed by disassembly + real cell
  matching this time, and the real game must set the `sceneLayer` global to
  1 somewhere in `CAVINT`'s own launch path (new open row
  `ishar-cavint-sceneLayer-writer`, since that write site itself wasn't
  located). 4 rendered `CAVINT` poses (forced `sceneLayer=1`) show dense,
  mostly-enclosed interior frames, visually distinct from every outdoor
  script. All 4 scripts shipped: `tools/ishar/amigaaga/scripts.ts` (+
  `plaine`/`rampart`), `tools/crystalsofarborea/amiga/scripts.ts` (+
  `plages`/`cavint`), and wired into their respective walkers' `KeyC`
  cycles (`tools/walker/games-ishar.ts` — `firstPersonAvailable`'s region
  gate widened from `CONT1`-only to `CONT1|CONT3|CONT4` since `RAMPART`'s
  real cluster spans `CONT3`/`CONT4`; `tools/walker/
  games-crystalsofarborea.ts` — added a per-script `sceneLayer` field so
  `CAVINT` renders with `sceneLayer=1` while every other script keeps the
  default 0). `npx tsc --noEmit -p .` and `npx eslint` clean on all
  changed/new files; `npm test` still 370/370 (no regressions). No
  amiberry/emulator use — static disassembly + real-cell scanning +
  `Read`-based visual inspection only, per this session's constraints. Full
  evidence: `docs/ishar-container-format.md` §8.4-8.5,
  `docs/crystalsofarborea/amiga/data-structure.md` §8's second correction
  block. Rows closed: `crystals-plages-cavint-position`,
  `crystals-scene-layer-selector-role` (superseded by the narrower
  `ishar-cavint-sceneLayer-writer`); `ishar-firstperson-generalize`'s text
  updated (not closed — Ishar 2/3 and `ORC.bin` remain out of scope).

- **2026-09-02 (eleventh pass — Crystals of Arborea's local-scene-array
  indexing SOLVED, `ARBRE.CO` renders a real forest first-person view)**:
  Closed `crystals-local-scene-array-indexing` (previous pass's open item).
  Re-derived the real `tabchar()` push/pop semantics directly from the
  vendored `github.com/maestun/alis` source (`alis.c:1431`'s `*acc++` reads
  the SAME direction `opushacc`/`opile` push/pop the VM eval stack, i.e.
  LIFO) and found the previous pass's best-effort formula had the right
  shape but the wrong pop order (FIFO instead of LIFO). Real formula:
  `index = direct + 2*pop() + 114*pop()`, `direct = omainb(0x2b3c)`
  (defaults to 0, no writer found), first `pop()` = last-pushed
  (`odirb(0x25)`), second `pop()` = first-pushed (`odirb(0x24)`). Verified
  three independent ways: (1) the formula's implied bounds tile
  `INIT.FIC`'s real 10,830-byte size with ZERO remainder (`95*114=10,830`
  exactly); (2) a whole-array visual render at `Z=0`/`Z=1` shows two
  different coherent maps (a sparse terrain-feature map matching Ishar 1's
  `CONT1.FIC` alphabet shape, and a dense room/building-outline grid,
  matching `MANUEL.CO`'s own "THE MAP"/"3D MODE" distinction); (3) feeding
  the formula real bytes into `alis-interp.ts` and running `ARBRE.bin`'s
  actual bytecode for 4 real positions/facings produces frames that are,
  via `Read`, unambiguously forest scenes (multiple distinct trees,
  responsive to position/facing) — `ARBRE` being French for "tree".
  `NPLAINE.bin` ("plain") independently renders a semantically different
  sparse low-vegetation band at the same position. `PLAGES.bin`/
  `CAVINT.bin` were tried with the same formula/position and produced
  non-trivial placement counts but blank frames (expected — wrong test
  position for either script's own cell range, not a formula failure; new
  open item `crystals-plages-cavint-position`). `CAVINT.bin` was also found
  to use the same formula for a second, structurally distinct purpose (8
  call sites with `+1`/`-1` neighbour-offset arithmetic — a movement/
  collision test analogous to `GERDEP.bin`, not traced further). Shipped:
  `tools/shared/crystals-firstperson.ts` (new), a `fillPlaceholderSkyGround()`
  helper factored out of `ishar-firstperson.ts` (regression-verified: FORET
  still produces its expected non-zero placement count unchanged),
  `tools/crystalsofarborea/amiga/scripts.ts` (exports `ARBRE.bin`/
  `NPLAINE.bin` + raw `INIT.FIC` as browser assets, not wired into
  `package.json`), and a `KeyF`/`KeyC`/`WASD` first-person test-bench mode
  added to `tools/walker/games-crystalsofarborea.ts` (the existing
  checklist-screen mode is unchanged and still the default). New open item
  `crystals-scene-layer-selector-role` (what sets `omainb(0x2b3c)`, and
  whether `Z=1` is really the indoor layer). `npx tsc --noEmit -p .` and
  `npx eslint` clean on all changed/new files; `npm test` still 370/370 (no
  regressions). Full evidence: `docs/ishar-container-format.md` §8.3
  (correction block), `docs/crystalsofarborea/amiga/data-structure.md` §8
  (correction block), `tools/shared/crystals-firstperson.ts`'s module doc.

- **2026-09-02 (tenth pass — generalization: a second Ishar 1 location
  RENDERED, a third attempted, a real N-ary indexing mechanism found in
  Crystals of Arborea)**: Following §8.2's single-script proof of concept,
  generalized `renderIsharForestFrame()` -> `renderIsharLocationFrame()`
  (no behavior change, regression-checked). **`VILLAGE.bin` now RENDERS
  end-to-end** — shares `FORET.bin`'s exact facing/ring-loop shell
  byte-for-byte but dispatches cell value via a building-style `cswitch2`
  (base=0x19, count=0x18, values `-25..-1`); verified against a REAL
  `CONT1.FIC` cluster (`x=52-56,y=14-20`, matching this project's own
  earlier visual note of "building/compound rectangles" in that exact
  area) — 4 test poses all show a coherent, recognizable timber-framed
  building (roof trusses, support beams), a stronger visual result than
  FORET's abstract band. Exported as `scripts/village.bin` and wired into
  `tools/walker/games-ishar.ts` via a new `KeyC` cycle-location control
  (honestly labeled as a manual test-bench selector, not the real
  undecoded region-to-scene dispatch). **`TEMPLE.bin` attempted, result
  INCONCLUSIVE**: disassembles clean under the same shell, real matching
  cell found and rendered, but only 7 placements resulted with no visible
  foreground structure — reported honestly as a partial result, NOT wired.

  > **Correction (2026-09-02 follow-up pass)**: this INCONCLUSIVE verdict
  > was caused by a sign error, not a real absence of data. `TEMPLE.bin`'s
  > `cswitch2 base=-10 count=6` dispatch was scanned as accepted value
  > range `[-10,-4]`, found only 4 matching cells corpus-wide. Re-deriving
  > the formula directly from `alis`'s `opcodes.c` source (`index = value +
  > base`, so `value = index - base`) gives the real range `[10,16]` —
  > hundreds of real matches in `CONT3`/`CONT4`/`CONT6`. Rendered 6 test
  > poses at real clusters: values 11/12 place a MIRRORED PILLAR PAIR
  > (`dx=∓99`/`dx=∓113`) when facing N/S (looking down a colonnade) and a
  > smaller facade sprite facing E/W — a coherent, distinctly
  > temple/architectural composition, visually confirmed via `Read` across
  > all 6 renders (symmetric paired columns, a stone-arch backdrop). Also
  > found: `MAIN.bin`'s resource manifest has a straight-line
  > `cload("ftemple.AO"); cload("temple.AO")` pair (byte-exact instruction-
  > length apart, no branch between) — TEMPLE's real companion backdrop is
  > its own `FTEMPLE.bin` (a stone-arch texture), not the shared `fond.bin`
  > every other Ishar 1 script here uses. Both backdrops render plausibly;
  > `FTEMPLE.bin` was shipped as the default since it's the location's own
  > confirmed asset. `TEMPLE.bin` is now wired into `LOCATION_SCRIPTS`
  > (`tools/walker/games-ishar.ts`) with `fondKey: 'ftemple'`, regions
  > `CONT3`/`CONT4`/`CONT6`. The `ishar-firstperson-generalize` row above
  > is updated accordingly (it stays open — Ishar 3 and `ORC.bin` remain
  > unresolved). `RAMPART.bin`/`PLAINE.bin` were already RENDERED in the
  > §8.4 pass; this correction did not touch them.

  `RAMPART.bin`/`PLAINE.bin` disassemble clean (same shell) but weren't
  traced further; Ishar 2/3 not attempted (time-budget triage, not a
  blocker). **Crystals of Arborea investigation**: found several outdoor
  scripts (`ARBRE.CO`/`PLAGES.CO`/`NPLAINE.CO`/`CAVINT.CO`) sharing Ishar
  1's exact scene-compositor shell (different global offsets), plus a real
  previously-undocumented content-load mechanism (`MAIN.CO` loads the real
  `INIT.FIC` file, 10,830 bytes byte-exact, into `basemain+0x7c` in one
  `cfreadb`, spanning several `cdim`-declared arrays — a parallel to Ishar
  1's `EN1.FIC` scatter convention). Tracing `github.com/maestun/alis`'s
  real `tabchar()` (`alis.c:1431`) and `cdim` (`opcodes.c:613`) found
  `omaintc` is genuinely **N-ary** (not the fixed 2-value `(x,y)` read this
  project's interpreter hardcoded) — generalized `alis-interp.ts`'s
  `SceneEnv.readGrid` to the real formula (a `pop()` closure), with Ishar
  1's own callers updated to reproduce the previously-verified 1-pop
  behavior exactly (regression-checked via VILLAGE's unchanged placement
  count). A best-effort Crystals-specific formula was tried against
  `ARBRE.bin` with real `INIT.FIC` bytes — produced a clearly-wrong result
  (600 placements, all off-screen), so this is reported as an open,
  NOT-shipped finding (new row `crystals-local-scene-array-indexing`) —
  the mechanism itself is solid and traced to source, only the final
  per-title constant assignment is unresolved. `npx tsc --noEmit -p .`/
  `npx eslint` clean on all changed files; `npm test` still 370/370 (no
  regressions). Full evidence: `docs/ishar-container-format.md` §8.3,
  `docs/crystalsofarborea/amiga/data-structure.md` §8.

- **2026-09-01 (ninth pass — first-person renderer implemented: ONE Ishar 1
  location working end-to-end, real ALIS bytecode executed)**: Following
  §8/§8.1's finding that a location script's own compiled bytecode IS the
  first-person renderer, built the minimum tooling to actually run one and
  produce real frames. New: `tools/shared/alis-disasm.ts` (a real, general
  ALIS bytecode disassembler — closes `ishar-alis-bytecode-disassembler`,
  verified 256/256 instructions against a prior session's hand-checked
  `foret.dis` reference disassembly, 0 diffs), `tools/shared/alis-interp.ts`
  (a scoped interpreter that executes a script's placement logic against
  real region-grid + party-pose inputs), `tools/shared/ishar-firstperson.ts`
  (orchestration: runs `FOND.bin`+`FORET.bin`, resolves placements through
  the already-confirmed sprite directory, composites a frame), and
  `tools/shared/ishar-script-export.ts` + `tools/ishar/amigaaga/scripts.ts`
  (ships the two scripts' decompressed bytes as browser-fetchable binary
  assets, sidestepping `silmarils-unpack.ts`'s Node-`Buffer` dependency in
  the browser). Found and fixed 3 real bugs while diffing against the
  reference disassembly (`cswitch1`/`cswitch2` target address off by 2,
  their "no-match" fallthrough address captured before vs. after the jump
  table, `oimmb`/`oimmw` needing sign-extension unlike structurally similar
  address-operand tokens) plus one empirically-derived finding (the raw
  facing byte is `compassIndex + 1`, not `compassIndex`) and one corrected
  byte-offset transcription from the original `re-oracle` brief (Ishar 1's
  `cscreen 0x000e` field offsets — values were right, positions were off by
  a constant 5). Also found and fixed a real VISUALIZATION bug (not a
  decode bug) in the already-shipped `isharBitmapToGreyscaleRGBA()`: its
  fixed 0-255 grey scale silently renders any `palOffset`-shifted bitmap as
  a near-flat block; added `isharBitmapToNormalizedGreyscaleRGBA()`
  (per-bitmap min-max stretch) and used it in the new renderer (new open
  row `ishar-greyscale-atlas-normalize` for applying it corpus-wide).
  Verified: disassembly match (above); numeric sanity (depth/elevation/LOD
  values all in-range and matching independently-derived formulas); real
  position-and-facing-responsive behaviour (9-21 placements varying across
  4 test poses, and a closer-vs-farther pose pair showing the expected
  taller/more-prominent near silhouette); visual inspection via `Read`
  (greyscale, no palette) shows a coherent three-band outdoor scene —
  honestly characterized as stylized/textured bands, not individually
  legible tree sprites. Wired into `tools/walker/games-ishar.ts`: a `KeyF`
  toggle switches Ishar 1's `CONT1` region between the existing top-down
  view (unchanged default, and still the ONLY view for every other
  region/game) and the new first-person render, cached by pose and
  recomputed only on movement. `npx tsc --noEmit -p .`/`npx eslint` clean
  on all new/changed files; `npm test` (370 tests) unaffected; a live
  browser check was NOT performed (no Playwright install available, and
  installing one was out of scope — package.json edits were disallowed
  this session). Closed `ishar-alis-bytecode-disassembler` and
  `ishar-walker-topdown-only` (superseded by the two new, narrower rows
  below). New rows: `ishar-firstperson-generalize`,
  `ishar-firstperson-backdrop-anchor`, `ishar-greyscale-atlas-normalize`.
  Full evidence: `docs/ishar-container-format.md` §8.2.

- **2026-09-01 (eighth pass — Crystals of Arborea's `CARTE.CO` overworld
  cracked: no region grid, no destination graph — a party-roster bytecode
  UI)**: Crystals has no `CONT*.FIC` files at all (confirmed: only
  `INIT.FIC` exists on disk), so the Ishar region-grid walker technique
  doesn't apply. Found and fixed a real, generalizable pipeline bug along
  the way: `silmarils-unpack.ts`'s `unpackSilmarilsScript()` only recognized
  the two compressed packer kinds, silently skipping every `classByte==0x01`
  ("stored") file — including `CARTE.CO` itself — in the sprite-atlas
  pipeline (added a `PACKER_KIND_STORED` branch; Crystals now 33/42 files
  with a decodable sprite directory, 931 sprites, up from 31/36 and 905;
  Ishar 1/2/3 re-verified byte-identical, confirming no regression). With
  `CARTE.CO`'s own sprite directory now reachable, resolved its confirmed
  map picture (an island/coastline silhouette). Then built a from-scratch
  mini ALIS interpreter (covering just the opcodes/opernames/storenames
  involved — `cscmov`/`cstore`/`oimmb`/`ofin`/`odirtc`/`sdirtc`/`seval`)
  and used it to fully resolve the previously-"structural, unclear" 8-entry
  byte-record array found in the first pass: it is real, self-terminating
  bytecode (1×`cscmov` + 15×`cstore`, ending exactly at the expected
  boundary on an unrelated opcode) that initializes two 8-element scratch
  arrays whose index order matches, exactly, 8 confirmed UI strings found
  later in the file — `JON/ZACH/IRVAN/AKEER/OLBAR/THORM/ALL/NONE` — a
  **correction** of the original "8-directional adjacency table" hypothesis
  to a **party-roster/companion-selection checklist**. Found a real
  consumer region (`cftstset` hit-test + `cboxf` highlight-draw + `clive`
  script-launch-by-id) implementing click-to-toggle interaction, confirming
  the screen is mouse-driven UI, not a walked space. Built
  `tools/walker/games-crystalsofarborea.ts` (`CrystalsOfArboreaView`): a
  menu/checklist `GameView` (map picture backdrop + 8 togglable rows +
  MOVE/EXIT), explicitly NOT a grid walker or first-person view, matching
  what's actually confirmed. `npx tsc --noEmit -p .`/`npx eslint` clean,
  `npm test` (370 tests) unaffected. New open rows:
  `crystals-carte-array-role`, `crystals-carte-destination-mechanism`. See
  `docs/crystalsofarborea/amiga/data-structure.md` §3.5, §7.

- **2026-09-01 (seventh pass — walker built on the confirmed region grids,
  re-oracle's claims independently re-verified)**: Before trusting the
  escalation's report, independently re-verified its two most falsifiable
  claims with this project's own tools: (1) rendered `CONT1.FIC` (Ishar 1)
  as a 90×54 ASCII/pixel grid — unmistakably coherent (closed building/
  compound rectangles, road lines, a bordered coastline blob), and Ishar
  2's `CONT1.FIC` at 60×90 similarly shows a smooth closed coastline
  outline; (2) re-decoded `MAP.DO` with this project's own (already-correct,
  +2/+4 offset) sprite decoder — resolves to exactly the claimed single
  320×126 type-0x12 bitmap, and its shipped greyscale render legibly shows
  the title "RENDORIA" over map artwork. Both independent checks passed
  decisively, so the escalation's report is treated as CONFIRMED per this
  project's verification bar (not just accepted on narrative). Built
  `tools/shared/ishar-regions.ts` (decoder + the HYPOTHESIS-labeled
  `isBlocked()` walkability rule) and a batch export pipeline
  (`tools/shared/ishar-region-export.ts`, per-title CLI wrappers) writing
  `public/assets/<game>/amigaaga/data/regions.json` — all 19 region grids
  (6+7+6) decode cleanly. Built `tools/walker/games-ishar.ts` (`GameView`
  for Ishar 1/2/3): a TOP-DOWN region-grid explorer (party dot + facing
  arrow over a colour-classified cell render), not a first-person view —
  honestly scoped to what's actually confirmed (`ishar-walker-topdown-only`,
  new row, supersedes the now-closed `ishar-walker-view`). `npx tsc --noEmit`
  (whole project) and `npx eslint` (all new files) both clean; a Node smoke
  test (fetch stubbed to local files) confirmed region loading, level
  listing, and movement/blocking logic all behave correctly.

- **2026-09-01 (sixth pass — `re-oracle` escalation returned: premise refuted, world grids SOLVED)**:
  The escalation succeeded by dissolving the wall rather than crossing it.
  (1) **Premise correction**: `render3d.c`'s raycaster is version-gated
  (`opcodes.c:1409` `if (alis.platform.version >= 31)`) and per
  `script.c`'s own version table Ishar 1/2/3 are v20/21/30 — **no Ishar
  title ever executes the heightfield renderer**; it's Robinson's
  Requiem's (v31). The "oracle gap" (`cdefmap` unimplemented for Ishar)
  was no gap: Ishar never issues those opcodes. Ishar's first-person view
  is generic VM sprite compositing. (2) **The real world data found and
  solved**: `CONT<n>.FIC` = raw row-major byte region grids (Ishar 1:
  90×54; Ishar 2: 2 layers 60×90; Ishar 3: 2 layers 57×82), loaded by
  `cfopen`/`cfreadb` bytecode in `MAIN.DO` (all call sites hand-decoded,
  every length byte-exact vs file sizes: 4860/2×5400/2×4674, EN1
  3640/6050/6050, TAB1 361), dimensions declared by the games' own `cdim`
  array headers (stride 90/60/57), grid at runtime `basemain+0x80`
  (+`0x234a` twin), consumers censused (`omaintc 0x0080` in GERDEP/
  RPLAINE/ENCONT + every location script), party-position globals
  identified (`basemain+0x137d`/`+0x3fd0`), and a 90×54 ASCII render of
  CONT1 shows a real coherent region map. `MAP.DO` resolved as the
  320×126 auxiliary map *picture* (a sprite-doc prose error +1/+3 vs real
  +2/+4 header offsets corrected along the way). Rows closed:
  `ishar-firstperson-view-mechanism`, `ishar-overworld-representation`,
  `ishar-fic-files`, `ishar-map-grid-geometry`. New:
  `ishar-cell-value-semantics`, `ishar-fic-semantics`,
  `ishar-alis-bytecode-disassembler`; `ishar-walker-view` unblocked.
  Full evidence: `docs/ishar-container-format.md` §8 correction blocks +
  §9.

- **2026-08-31 (fifth pass — terrain-anchor mechanism traced to a real oracle gap, escalated)**:
  Pursued both concrete next steps named by the fourth pass. (1) Applied the
  sprite-directory technique's spirit to `MAIN.DO`'s own internal
  scene-table: found (via `copensc`, opcode 0x4e) that scene-id values are
  literal bytecode immediates, not static data — so a byte-pattern struct
  scan can't find real instances; ran one anyway across all 4 titles'
  `MAIN.bin` as a due-diligence check, got only weak/non-independent hits
  (a real negative, not under-effort). (2) Traced `calloctab` (0xe9, a
  generic lazy-allocator for VM scratch tables, not terrain-specific) and,
  more importantly, `cdefmap` (0xe3) — the actual writer of the
  `scene_addr+0x40`/`+0x42` fields `render_context` is built from. Found
  the exact mechanism (bytecode-embedded self-relative offset -> raw
  dimension bytes stored just before it, in the terrain-owning file's own
  bytes) but also found `opcodes.c`'s own dispatch table stubs opcode 0xe3
  (and its siblings 0xe4/0xe5/0xe8/0xf7/0xf8/0xfd) to a no-op for every
  game except Transarctica/Robinson's Requiem — **the reference oracle's
  own authors never reverse-engineered this for Ishar**. This is a genuine
  gap in the ground-truth oracle, not a search failure — escalated to
  `re-oracle` (process update this session: escalate directly to
  `re-oracle`, skip `re-codebreaker`) with a full self-contained brief.
  Result pending. See `docs/ishar-container-format.md` §8.1.

- **2026-08-31 (fourth pass — sprite format CONFIRMED, renderer architecture identified)**:
  Closed Priority 1 of the task brief (`ishar-png-render`, row removed —
  solved). Found and ported the per-script resource-directory mechanism
  (`adresdes()`, 2-level self-relative indirection) and 6 bitmap
  pixel-encoding types (raw/banked 4-bit, direct 8-bit, each masked/opaque)
  from `github.com/maestun/alis` (MIT), a real source-available ALIS-VM
  reimplementation documented "Playable" for exactly these titles/platform.
  Applied blind to real corpus bytes: 74/98, 119/137, 113/136, 31/36 files
  (Ishar 1/2/3/Crystals) have a valid directory, decoding 1,608/2,244/2,744/
  905 sprites respectively. Verified via genuinely recognizable rendered art
  (barbarian warriors, a dragon, a tree, an orc, a skeleton) — see
  `docs/ishar-sprite-format.md`. New module `tools/shared/ishar-sprites.ts`
  + batch pipeline `tools/shared/ishar-sprite-atlas.ts` + 4 per-title CLI
  wrappers. Real AGA colour palette resolution remains open
  (`ishar-sprite-palette`, new row) — bytecode-selected, not statically
  located.
  Made real progress on Priority 2 (the first-person mechanism question):
  `alis`'s `render3d.c`/`render3d_68k.c` implement a real heightfield/
  voxel-column terrain raycaster — a decisive qualitative answer (not a
  wall-tile compositor, more specific than a generic vector/placement-list
  format), grounded in source-available VM code for exactly this
  game+platform. The exact on-disk terrain-grid location remains open; an
  earlier numeric claim this session (`fileOffset18==0x0020` in 226/235
  files) was explicitly WITHDRAWN after finding its field-offset semantics
  apply to MAIN's own script data, not each file's own bytes — a real
  self-caught category error, documented as a correction rather than
  silently dropped. Priorities 3 (`MAP.DO` grid geometry) and 4 (walker
  `GameView`) were deliberately NOT attempted, since the terrain-geometry
  decode isn't yet at extractable-per-location confidence (new
  `ishar-walker-view` row, deferred). See
  `docs/ishar-container-format.md` §7-8.

- **2026-08-30 (third pass — user-confirmed game structure)**: the user
  (who has played these games) confirmed Ishar 1/2/3 are "completely
  first-person crawlers, except you spend a lot of time outdoors exploring
  islands and so on, still in first-person" — there is no separate top-down/
  node-graph overworld mode. This reframes (doesn't refute) the second
  pass's two open mechanism items: `ishar-overworld-representation` is now
  "what does the auxiliary map screen show", not "what does the player
  navigate through" (always first-person, indoors and out); it also
  *strengthens* `ishar-firstperson-view-mechanism`'s "one shared scene
  format" reading, since outdoor and indoor content sharing an identical
  header shape is exactly what one shared first-person compositor predicts.
  See the correction block in `docs/ishar-container-format.md` §6 and both
  rows' updated text below.

- **2026-08-30 (second pass — compression cracked)**: Closed 3 items from the
  first pass. **`ishar-compression-codec`**: found real open-source prior
  art for this exact engine (`github.com/maestun/silm-depack`,
  `github.com/maestun/alis`, both MIT) via `WebSearch`; ported both codecs
  (old PackBits-style RLE `0x81`/`0x80`, new LZ77-style bitstream `0xA1`)
  faithfully to `tools/shared/silmarils-unpack.ts`. Verified two ways:
  corpus-wide packed-byte-consumption self-consistency (83/97 exact for the
  new codec, all off-by-exactly-1 for the old codec — explained precisely
  by the reference's loop structure) and real readable decoded content
  (`MANUEL.CO`'s English manual table of contents, `MESSAGE2.CO`'s NPC
  dialogue). Full-corpus batch decompression now runs clean:
  ishar/amigaaga 98/98, ishar2/amigaaga 137/137, ishar3/amigaaga 136/136,
  crystalsofarborea/amiga 42/42 — see `tools/shared/ishar-decompress.ts`,
  `npm run <game>:decompress`. **`ishar-header-boundary`**: resolved as part
  of the codec crack — the "near-constant offset 17-22" bytes are the tail
  of the LZ77 dictionary, not unexplained padding (see
  `docs/ishar-container-format.md` §2.4). **`ishar-prior-art-search`**:
  done, found real prior art (above).
  Also made real progress on the two open content questions: `MAIN.DO`
  fully decoded (30-name monster roster, full location-name list, embedded
  level-editor debug strings implying a hierarchical country/region/zone
  coordinate model for the overworld) and a new cross-title structural
  finding — `MAP.DO`, all of Ishar 1's `*CAVE*.DO` files, several outdoor/
  monster graphics, AND Ishar 2's `DJ*.DO` dungeon files all share one
  identical 16-byte "scene/resource header" shape, arguing for one generic
  engine-wide scene descriptor format rather than separate tile-grid and
  wall-compositor formats. Both are STRUCTURAL/HYPOTHESIS, not yet code-
  confirmed (no disassembly trace of the renderer this session) — see the
  new `ishar-overworld-representation` and `ishar-firstperson-view-mechanism`
  rows. Fixed a real bug in `ishar-decompress.ts`'s handling of `classByte
  == 0x01` (stored) files, which were returning the whole raw buffer
  including the 6/22-byte container header as "content" — corrected to
  skip the header like every other class. `npx eslint`/`npx tsc --noEmit`
  clean on all new/changed files (4 real lint findings from a `reviewer`
  agent pass fixed: an unused catch binding, 3 `let`-should-be-`const`).

- **2026-08-30 (first pass)**: Container format cracked structurally across
  all 4 titles (16-byte header, `classByte`/24-bit decompressed-size
  field, two compressed sub-classes + one stored class — see
  `docs/ishar-container-format.md`). Confirmed `T.X`/`START` are real
  AmigaOS executables (a correction to the original task brief, which
  believed no executable existed for 3 of the 4 titles). Escalated the
  compression codec itself to the `amiga-disasm` agent (Ishar 1's `T.X`).
  Found `MAIN.DO`/`MAIN.CO` is a resource manifest via readable `.AO`
  filename strings. Found Crystals' `CARTE.CO` is uncompressed and
  contains real NPC names + travel UI text + a structural 8-entry record
  array. Built `tools/shared/ishar-container.ts` +
  `tools/shared/ishar-inventory.ts` and four per-title inventory CLI
  scripts, all run and verified against the real corpora (413 compressed
  + 6 stored + non-container files, 0 parse failures). File-role catalogs
  written for all 4 titles from filename evidence (French-language
  reading), confirming the overworld/outdoor vs. first-person-cave/dungeon
  split the task asked about exists as a real file-naming distinction —
  but no pixel/geometry content has been decoded yet, so the *mechanism*
  question for both remains open.
