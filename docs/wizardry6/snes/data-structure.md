# Wizardry 6: Bane of the Cosmic Forge — SNES (Super Famicom) data format

Status: **second pass — first confirmed graphics decode**. Source data: `data/wizardry6/snes/Wizardry
VI - Kindan no Mahitsu (Japan).sfc` (3,145,728 bytes, 1 file; the sibling
`.zip` is a redundant copy of the same ROM and was not used). Released in
Japan by ASCII Corporation, September 29, 1995.

This is a **from-scratch corpus, unrelated to the Amiga port's code or data
layout** beyond sharing the game's design (same 14-class roster, same
monster bestiary). The Amiga document
(`docs/wizardry6/amiga/data-structure.md`) is useful only as an *oracle* for
cross-checking game-content facts (class list, monster names) — nothing
about its file formats, executable structure, or codec choices carries
over. This SNES release runs on a 65816 CPU with an entirely different
toolchain (looks like a Japanese in-house engine, not a direct port of the
Sir-Tech DOS/Amiga codebase — see "Prior art check" below).

Confidence levels used throughout, same convention as the Amiga doc:
**confirmed** (verified against an independent oracle — disassembly, a
rendered/legible result, or a byte-exact structural invariant),
**rendered** (plausible, self-consistent result, not independently
cross-checked), **hypothesis** (structurally motivated guess, not yet
verified).

## Prior art check

Searched the web for existing disassembly/romhacking work on this specific
release (`WebSearch`: "Wizardry VI Kindan no Mahitsu SFC romhacking
disassembly reverse engineering"). Found only ROM-database/download-site
listings (superfamicom.org, gamehacking.org, wowroms, openretro) confirming
basic facts (24 Mbit ROM, LoROM, September 1995 release, "improved
graphics/music vs. the DOS version") — no disassembly, no format
documentation, no fan translation project. This is a from-scratch corpus
for the seer project family, same as the Amiga port was.

---

## 1. ROM header and memory map

### 1.1 File layout — confirmed

- File size 3,145,728 bytes (0x300000), evenly divisible by 0x8000 (exactly
  96 banks of 32 KB) — **no 512-byte copier header present**. Checked two
  ways: (a) `3145728 % 0x8000 == 0` but `(3145728 - 512) % 0x8000 ==
  0x7E00 != 0` — stripping a hypothetical header would misalign every bank
  boundary; (b) the internal header (below) parses correctly and its
  checksum/complement validate at the un-stripped offset, which would not
  happen at a shifted offset.
- **LoROM** mapping confirmed both by the mapping-mode header byte (`0x30`,
  see below) and structurally: the internal header lives at file offset
  `0x7FC0` (= CPU address `$00:FFC0`), which is exactly where LoROM puts it
  (bank `$00`, CPU address window `$8000`-`$FFFF` maps 1:1 to file offset
  `0x0000`-`0x7FFF`). The equivalent HiROM offset (file `0xFFC0`) is all
  zero bytes — not a valid header.
- General LoROM file-offset↔CPU-address conversion used throughout this
  doc: for a file offset `o`, `bank = floor(o / 0x8000)`,
  `addr = 0x8000 + (o mod 0x8000)`, giving CPU address `bank:addr`. Code
  and data in banks `$00`-`$3F` execute from the low banks directly; banks
  `$80`-`$FF` are hardware mirrors of `$00`-`$7F` (i.e. `$9E:8A4A` and
  `$1E:8A4A` are the same physical byte, file offset `0xF0A4A` — both forms
  appear in citations below, whichever the disassembly used literally).

### 1.2 Internal header — confirmed (file offset `0x7FC0`-`0x7FDF`)

| Offset | Size | Field | Value | Notes |
|---|---|---|---|---|
| `0x7FC0` | 21 | Title | `"WIZARDRY 6 BCF       "` | space-padded ASCII |
| `0x7FD5` | 1 | Map mode | `0x30` | LoROM + FastROM (bit `0x20`=FastROM, low nibble `0x0`=LoROM) |
| `0x7FD6` | 1 | ROM type | `0x02` | ROM+RAM+Battery (SRAM save) |
| `0x7FD7` | 1 | ROM size | `0x0C` | `2^12` KB = 4096 KB — see 1.3 |
| `0x7FD8` | 1 | RAM size | `0x05` | `2^5` KB = 32 KB SRAM |
| `0x7FD9` | 1 | Country | `0x00` | Japan |
| `0x7FDA` | 1 | Licensee/dev ID | `0x33` | fixed value signalling the extended header (new-style licensee code lives elsewhere); not further decoded this pass |
| `0x7FDB` | 1 | Version | `0x00` | |
| `0x7FDC` | 2 | Checksum complement | `0xDEE0` | LE |
| `0x7FDE` | 2 | Checksum | `0x211F` | LE; `complement XOR checksum == 0xFFFF` — **validates** |

### 1.3 The size-field discrepancy — confirmed, normal SNES convention

The header's ROM-size byte (`0x0C` → 4096 KB / 32 Mbit) does **not** match
the real file size (3,145,728 B = 3072 KB / 24 Mbit). This is the standard,
well-documented SNES header quirk, not a truncated dump or a copier-header
artefact: the ROM-size field only encodes powers of two (`size_KB =
2^value`), so a cartridge whose true size isn't a power-of-two number of
Mbit (24 Mbit here — `3 * 2^3`, not itself a power of two) has no exact
code to declare and must round up to the next one (32 Mbit, code `0x0C`).
Confirmed independently by a websearch snippet describing this release as
"24 Mb ROM" — matching the *real* file size, not the header's declared
size. The RAM-size field (32 KB) matches the same source's "256 Kb SRAM"
figure exactly (256 kilobit = 32 KB), an independent cross-check that the
header is being read correctly.

### 1.4 Vector table — confirmed (file offset `0x7FE0`-`0x7FFF`)

| Vector | File offset | Value | Target (file offset) |
|---|---|---|---|
| Native COP | `0x7FE4` | `$82DF` | `0x02DF` |
| Native BRK | `0x7FE6` | `$82DF` | `0x02DF` |
| Native ABORT | `0x7FE8` | `$82DF` | `0x02DF` |
| Native NMI | `0x7FEA` | `$818F` | `0x018F` |
| Native IRQ | `0x7FEE` | `$82DF` | `0x02DF` |
| Emulation RESET | `0x7FFC` | `$8000` | `0x0000` |
| Emulation IRQ/BRK | `0x7FFE` | `$82DF` | `0x02DF` |

Only NMI (native) and RESET (emulation — the only mode the CPU can be in at
power-on) are meaningfully distinct; every other vector points at the same
`$82DF` (`RTI`) stub, i.e. COP/BRK/ABORT/emulation-NMI are all unused.

---

## 2. CPU / entry points

### 2.1 Disassembler tooling note — important caveat

radare2 6.1.9 in this environment ships a native `snes` bin+asm plugin
(`format=sfc`, `arch=snes`, virtual addressing on — CPU addresses can be
used directly, e.g. `pd @ 0x8000` reads file offset `0x0000`). **However
its linear disassembler does not track the 65816's M/X accumulator/index
width flags** (set by `REP`/`SEP`). Emulation-mode code starts with 8-bit
A/X/Y; r2 appears to assume 16-bit immediates from the very first
instruction, so any 8-bit-immediate instruction run is mis-decoded
(wrong operand byte count) until a later `REP`/`SEP` happens to
resynchronize it by luck. Concretely, at file offset `0x800F` (CPU
`$800F`) the real code is (byte-verified manually against the raw hex):

```
a9 01          LDA #$01        ; 8-bit immediate (M=1, still emulation-mode width)
8d 0d 42       STA $420D       ; MEMSEL — enable FastROM
5c 18 80 80    JML $808018
```
— 9 bytes total, landing exactly on `$8018` where r2's own disassembly
(coincidentally) resynchronizes with `REP #$30`. r2's own output for this
span instead shows `lda #0x8d01`, `ora 0x5c42`, `clc`, `bra 0x007f98` —
garbage, decoded with a phantom 16-bit-A assumption. **Any r2 disassembly
across a mode-switch boundary in this ROM must be spot-checked against raw
bytes by hand** (as done throughout this document) rather than trusted
verbatim. Filed as a durable pitfall — see
`~/.claude/agents/game-re-lessons/r2-snes-flag-width-blind.md`.

Given this, the linear dumps in `docs/wizardry6/snes/disasm/` (`ira`-style
raw output, not hand-corrected) should be read as a *starting point* for
manual verification, not as ground truth on their own.

### 2.2 Reset / boot sequence — confirmed (byte-verified by hand)

CPU address `$00:8000` (file offset `0x0000`):

```
ad 10 42       LDA $4210          ; RDNMI — read+clear NMI flag
9c 00 42       STZ $4200          ; NMITIMEN — disable NMI/auto-joypad
78             SEI
d8             CLD
a9 8f          LDA #$8F
8d 00 21       STA $2100          ; INIDISP — forced blank, brightness 0xF
18 fb          CLC : XCE          ; switch to native mode
a9 01          LDA #$01
8d 0d 42       STA $420D          ; MEMSEL — enable FastROM
5c 18 80 80    JML $008018
```
at `$008018`:
```
c2 30          REP #$30           ; A/X/Y all 16-bit
a2 00 00       LDX #$0000
[loop] 74 00 / e8 e8 / e0 f0 1f / d0 f7
               STZ $00,X : INX : INX : CPX #$1FF0 : BNE  ; zero WRAM $0000-$1FEF
a9 ef 1f       LDA #$1FEF
1b             TAS                ; S = $1FEF (stack pointer)
a9 00 21       LDA #$2100
5b             TCD                ; Direct Page = $2100 — compresses all
                                   ; further $21xx/$42xx register access
                                   ; into 1-2-byte DP-relative opcodes
e2 20          SEP #$20           ; A back to 8-bit
... (bytes 0x8030-0x80DE)         ; per-register init writes covering
                                   ; PPU $21xx and CPU/DMA $42xx registers
                                   ; via the DP=$2100 trick above
```
Then (`$8100`-ish): a small loop initializing a table at zero-page/DP
`$00`-`$1F` in pairs (via a helper at `$8278`/`$828F`), followed by another
loop at `$81E0` incrementing counter `$0330`ish and calling `$828F` again —
**hypothesis**: this looks like initializing a jump/dispatch or object
table, not yet traced to a specific consumer. Then at `$8184`:

```
22 4a 8a 9e    JSL $9E8A4A        ; one-time call — see §5, this is the
                                   ; SPC700 driver-upload routine
a9 81          LDA #$81
8d 00 42       STA $4200          ; NMITIMEN — enable NMI (auto-joypad too)
80 fe          BRA $818D          ; infinite spin
```

**This confirms the engine's overall shape**: RESET does one-time hardware
+ audio-driver init, then enables NMI and spins forever — all real
per-frame game logic must run inside interrupt handlers (NMI, confirmed
below; possibly IRQ too, not traced this pass).

### 2.3 NMI handler — confirmed shape, dispatch target not yet named

Native NMI vector → `$818F` → `JMP $008193`. Fully disassembled and
flag-state-verified this session (file `0x193`-`0x257`, ~140 instructions,
via the flag-aware `dis65816.py` probe — see §3.2's method note) with
`m8 x16` holding stable the whole way (no further mode switches inside
this span):

- `SEP #$20`; re-read `$4210` (ack NMI); re-enable NMITIMEN (`LDA #$01;
  STA $4200`); restore stack pointer (`REP #$10; LDX #$1FEF; TXS`);
  force-blank/brightness write (`LDA #$8F; STA $2100`); `JSR $BF73`
  (still not traced into); wait on `$4212` bit 0 (HVBJOY); a fixed
  brightness write (`LDA #$0F; STA $2100`) then spin-wait on `$4212` bit
  7 (VBLANK).
- **Joypad edge detection, confirmed**: two near-identical 16-bit
  sequences (DP `$10`-`$17` against `$4218`/JOY1L, DP `$18`-`$1F` against
  `$421A`/JOY2L) each computing `newpress = ~prev_held & curr_reading`
  via `EOR #$FFFF` + a chain of three `AND`s — the standard "this frame
  minus last frame" new-button-press idiom, one block per controller
  port.
- `JSR $C233`, then a conditional `JSL $82C3BD` gated on DP `$82` being
  non-zero (role not traced).
- **WRAM table walk, confirmed structurally**: a loop over `$0100`-`$0110`
  (step 4) then `$0110`-`$0350` (step `0x20`) calling helper `$8259` per
  entry. `$8259` (file `0x259`): `STX $20` (save the loop index), `LDA
  $00,X` (read a 16-bit value from the WRAM table entry itself), `TCS`
  (loads that value directly into the hardware stack pointer!), `SEP
  #$20; RTS`. This is a **non-obvious indirection whose exact purpose
  wasn't resolved** this session — using `TCS` immediately before `RTS`
  makes the entry's own stored value double as a temporary stack-pointer
  base for the `RTS` that follows, which reads its return address from
  *that* location rather than the real call stack. This table is the
  same one built at RESET time (§2.2) via helpers `$8278`/`$828F`, whose
  build-time values look like 16-bit ROM addresses (e.g. `$8921`,
  `$F76F`, `$887F`...) — consistent with a **function-pointer-style
  dispatch table**, but the `TCS`-based call convention is unusual enough
  that this is flagged as open rather than assumed.
- Ends with `INC $22`, re-reads `$4210`/writes `$4200` (NMI
  re-enable), then `JSL $81E3DC` in a tight self-loop (`BRA` back to
  itself).

**`$81E3DC` traced this session — refutes the "real game-logic entry
point" hypothesis.** File offset `0x00e3dc` (CPU `$01:E3DC`, mirror
`$81:E3DC`), byte-verified against raw hex (`e2 20 a5 8a eb a9 00 c2 20 38
65 8a 85 8a 0a e2 20 a9 00 eb 6b`, 21 bytes exactly, zero ambiguity):

```
00e3dc: SEP #$20
00e3de: LDA $8a        ; A.lo = mem[$8a] (m8: low byte only)
00e3e0: XBA            ; swap A halves -- moves that byte into A.hi
00e3e1: LDA #$00       ; A.lo = 0 (m8)
00e3e3: REP #$20       ; m16
00e3e5: SEC
00e3e6: ADC $8a        ; 16-bit add against mem[$8a:8b], with carry set
00e3e8: STA $8a        ; store back to $8a:8b
00e3ea: ASL A          ; result *2, discarded (no further store)
00e3eb: SEP #$20
00e3ed: LDA #$00
00e3ef: XBA
00e3f0: RTL
```

This is a **13-instruction leaf function with zero branches**, confirmed
complete (the `RTL` is the only exit, and no branch instruction appears
anywhere in the body, so there's no hidden alternate path this trace
missed). It reads and rewrites a 16-bit value at DP `$8a` via a somewhat
unusual byte-shuffle (`XBA`-based high/low swap before the 16-bit add) and
returns — **this is not a large game-logic dispatcher**, refuting the
prior session's framing of it as "the strongest remaining candidate for
the real game-logic entry point". The exact arithmetic purpose (a scaled
tick counter? a checksum/hash step? something else keyed off the `XBA`
byte-swap) wasn't further interpreted this session — flagged as open, but
low priority, since the main finding (this is *not* where per-frame game
logic runs) is the one that mattered for this item.

**Where real per-frame game logic runs is now the open question**, not
"what does `$81E3DC` do" — the byte immediately after this function's
`RTL` (file `0x00e3f1`) turned out to be the start of a *different*,
unrelated function (`STA $004202` / WRMPYA, a hardware-multiply setup,
followed by its own `JSL $81E3DC` call) purely by ROM adjacency, which is
itself a useful data point: `$81E3DC` is evidently a small, widely-reused
low-level primitive called from multiple, unrelated places (much like
`JSR $8267`'s pervasive per-frame-yield role seen throughout this ROM),
not a single dedicated game-logic entry point. The NMI handler's own
`BRA`-back-to-`JSL` self-loop (file `0x253`-`0x257`) means the NMI handler
never actually returns in the normal sense — it calls this small utility
forever in a tight loop with no other work interleaved, which is
consistent with "the NMI merely ticks a low-level counter/timer forever"
and real gameplay logic running elsewhere (a separate IRQ handler not yet
traced, or code that polls DP `$8a`/other flags from within the seemingly
inert RESET-time spin loop at `$818D` — that spin loop was previously read
as a truly empty `BRA` with no polling visible in the ~3-instruction span
disassembled at the time, but wasn't re-examined this session with the
`$8a` counter's existence in mind).

This section's confidence upgrades from **rendered** to **confirmed** for
everything through the `$8259` table-walk loop and now through the
`$81E3DC` leaf function itself (all byte-verified, flag-state stable
throughout); the `$8259` helper's `TCS` semantics, `$81E3DC`'s exact
arithmetic purpose, and — the real remaining open question — where the
game's actual per-frame logic executes, are all still open.

> **Correction (this session) — the "where does per-frame game logic run"
> question is resolved.** A `re-codebreaker` escalation (researching an
> unrelated title-screen lead) recognized `$8259` for what it actually is: a
> **cooperative coroutine scheduler**, not a mysterious one-off indirection.
> Independently re-verified byte-for-byte this session (not just trusted
> from the escalation report):
>
> | CPU | File | Role |
> |---|---|---|
> | `$8259` | `0x0259` | task **resume** — load the slot's saved SP, `TCS`, `RTS` *into* the task |
> | `$8267` | `0x0267` | task **yield** — `TSC`, save SP to the slot, restore kernel SP `$1FED`, `RTS` |
> | `$8263` | `0x0263` | far-yield wrapper (`JSR $8267; RTL`) — this is the pervasive `JSL $808263` seen all over the ROM |
> | `$8273` | `0x0273` | idle task body (`JSR $8267; BRA $8273`) |
> | `$828F` | `0x028F` | set task entry: `LDY $02,X; STY $00,X; STA $0001,Y` — stores `entry − 1` (the idle task proves this: its stored value `$8272` resumes execution at `$8273`, i.e. `RTS` semantics add 1 back) |
>
> RESET registers **10 cooperative tasks** at file `0x011E`–`0x0182` (slot
> `$0330` is permanently disabled via `LDA #$01 / CMP #$01 / BEQ` at file
> `0x0171`). Task entry points (file offsets): `0x0922, 0x7770, 0x0880,
> 0x7D4A, 0x768A, 0x76C5, 0x765E, 0x763E, 0x6D8D`. **Slot `$0100` → file
> `0x0922` is the boot/opening-sequence task** — confirmed by hand
> disassembly this session (file `0x0922`-`0x092d`):
> ```
> 000922: 22 00 80 81   JSL $818000
> 000926: 20 67 82      JSR $8267        ; yield
> 000929: 22 00 80 8d   JSL $8d8000      ; opening-sequence controller, see section 3.8
> 00092d: 20 67 82      JSR $8267        ; yield
> ```
> The apparently-empty RESET spin loop (§2.2, `$818D`) and the NMI handler's
> `$8259`/`$8267`-based table walk are this scheduler's kernel: NMI resumes
> each active task once per frame; each task runs until it calls `JSR
> $8267` (yield) or its far-call wrapper `JSL $808263`, at which point
> control returns to the NMI handler to resume the next task. This closes
> the `snes-nmi-main-loop` open item — there is no separate "main loop" to
> find, the scheduler *is* the main loop, and per-frame game logic lives in
> whichever task is currently running (each task's own body, not traced
> exhaustively this session beyond the boot/opening task above).

Raw dumps: `docs/wizardry6/snes/disasm/reset_startup.txt` (file
`0x8000`-`0x84xx`, ~500 lines, r2 output — **not hand-corrected for the
§2.1 flag-width issue past the first ~40 instructions**, use with care).

---

## 3. Graphics

### 3.1 Tile pixel format — confirmed

SNES-standard 4bpp bitplane-interleaved 8x8 tiles: for each of 8 rows, byte
pairs (bitplane0, bitplane1) come first for all 8 rows (16 bytes), then byte
pairs (bitplane2, bitplane3) for all 8 rows (16 bytes) — 32 bytes/tile, the
standard SNES convention (**not** Amiga's plane-major layout). Implementation:
`tools/shared/snes-ppu.ts` (`decodeTile4bpp`/`decodeTile2bpp`/`composeTileGrid`,
ported from the `strike` project's SNES module and independently
re-confirmed here).

### 3.2 Monster/NPC face-portrait bank — confirmed

**Directory table**: file offset `0x105D1` (bank 2; CPU `$82:85D1`, reached
with Data Bank register `$82` — set via `PHB`/`LDA #$82`/`PHA`/`PLB` at file
`0x10279`/CPU `$00:8279`). 2 bytes per entry, LE, nominal 60 slots (index
bound `CPX #$3C` observed at the loader, file `0x10271`/CPU `$00:8271` and
again at `0x102d4`). Each entry word is a CPU address within ROM bank `$85`
(mirror of bank `$05`); converts to a file offset via
`0x28000 + (word - 0x8000)`.

**Byte-exact structural invariant (the confirming oracle)**: directory
indices 0-29, when their target file offsets are *sorted* by address, are
**exactly `0x120` (288) bytes apart with zero deviation across all 29
gaps** — a uniform array of 30 fixed-size records, physically contiguous in
ROM from file `0x28b97` to `0x2ad57`. The byte immediately before `0x28b97`
is the null terminator of an unrelated ASCII item-name string
(`"MAGICFOOD"`), and the bytes immediately after `0x2ad57` do not decode as
tile data (checkerboard/flat-block pattern under the same 4bpp decode,
confirmed noise) — both clean, independent boundaries. Six more directory
entries (indices 30-35) point at a second, separately-located run of six
more `0x120`-byte records at file `0x2e000`-`0x2e6c0` (same stride,
confirmed the same way).

> **Correction (this session):** the claim that bytes immediately after
> `0x2ad57` are "noise" was wrong — they're a *different*, real, legible
> tile bank, just not the portrait-record format. Tracing the font-tile-bank
> lead (§4.3) found two confirmed `MVN`-based ROM→WRAM loaders (file
> `0x008e42` and `0x0080b9`) whose ROM sources are `0x2ad57` and `0x2c177`
> respectively — both squarely inside this "noise" span. Rendering the
> whole `0x2ad57`-`0x2e000` gap at 4bpp (405 tiles) shows a coherent
> gradient/border-decoration strip followed by individually legible UI
> icon tiles, including unambiguous half-width `E`/`S`/`W`/`N` compass
> letters (a dungeon-navigation facing indicator) and item/action icons
> (a chest, boots/footprints, arrows). The original "noise" verdict was
> from checking too narrow a byte window immediately at the boundary
> (which does start with a flatter gradient/border pattern that looks
> checkerboard-ish in isolation) without decoding further into the block.
> The `0x28b97`-`0x2ad57` **directory boundary itself is unaffected** — the
> portrait pool A stride invariant (29/29 gaps exactly `0x120`) still holds
> and this correction only concerns what's *classified* as immediately
> following it.

**Record format**: each 288-byte record is 9 standard 4bpp tiles (§3.1),
composed 3x3 (row-major tile order) into one 24x24px image. **Confirmed by
the render itself**, not just a plausible shape or byte-count match: all 36
decoded records (indices 0-35) produce unambiguous, individually
recognisable creature/NPC faces — human/humanoid faces of varying age and
gender, hooded figures, an oni/demon mask, and distinct animal heads (a
wolf, a cat, what looks like a bird/eagle, a dog) — not noise, not a
repeating abstract pattern, not a plausible-but-ambiguous blob. **Now
rendered in full colour** using the confirmed per-pair CGRAM palette (see
§3.3) — the colour render is itself additional confirming evidence for this
section's directory/record-boundary claims, since a wrong tile boundary or
record size would produce colour-region noise, not the coherent facial
shading actually seen. Index 35 (the last of the pool-B run) still renders
visibly noisier than the other 35 in outline/shape terms and should be
treated as lower-confidence.

Extractor: `tools/wizardry6/snes/decode-portrait-tiles.ts`. It re-derives
and asserts the 288-byte stride invariant at run time (refuses to write
output if it doesn't hold — same pattern as `decode-class-titles.ts`).
Output: `public/assets/wizardry6/snes/sprites/portraits.png` (36-frame
shelf-packed atlas, full colour) + `portraits.json` (frame sidecar, now
also carrying `paletteGroup`/`paletteFileOffset` per frame) +
`manifest.json` entry (`palette: null` — colours are baked into the PNG,
see §3.3).

How this was found (method note for future SNES-graphics tracing on this
ROM): two leads were followed in parallel and one paid off. (1) The
`"FACE1"` debug tag (file `0x65E54`, §3.4) was traced forward through its
call site into a 15-entry resource-type dispatch table in ROM bank `$0C`
(file `0x66a0e`, CPU `$0C:EA0E`) — this turned out to be a **different**
subsystem (its handlers bit-serially read `$4017`, a joypad-only hardware
register, strongly suggesting an input/peripheral-polling system, not
graphics) and was a dead end for this section, documented so a future
session doesn't re-walk it expecting tile data. (2) In parallel, a
whole-ROM byte-pattern scan for the `MVN` opcode (`0x54`) filtered to
operand pairs where exactly one bank byte was `$7E`/`$7F` (WRAM) turned up
91 candidates; the operand *order* (which byte is source vs. destination
bank) was disambiguated empirically, not assumed, by checking which of the
two possible readings ever implied a `WRAM → ROM` direction (nonsensical,
since ROM can't be written) versus `ROM → WRAM` (sensible) — first operand
byte = destination bank, second = source bank. Several candidates in ROM
bank `2` (ROM offsets `0x102db`/`0x10343`/`0x1038f`) shared the exact
shape `MVN $7f,$85` with a fixed length (`0x120`); disassembling the
surrounding code (file `0x10260` onward) showed the `X` register (MVN's
source low-word) being loaded 2 instructions earlier from an indexed table
read (`LDY $85D1,X`) — that table read is the directory this section is
built on. This ROM does **not** stage this resource type through a
decompressor — the `MVN` is a **plain, uncompressed memory copy**; ROM
bank `$85`/`$05` itself holds the raw tile bytes at their cited file
offsets, directly readable with no runtime decode step.

A flag-aware linear 65816 disassembler probe (per
`~/.claude/agents/game-re-lessons/r2-snes-flag-width-blind.md`'s
recommended fix) was written for this session
(`dis65816.py`, session scratchpad, not committed — throwaway per the
lesson's own guidance) and used for all disassembly in this section; every
cited instruction was flag-state-verified against the raw bytes, not
trusted from a flag-blind r2 dump.

### 3.3 Palette — confirmed

**Found by tracing the tile loader's own callers, not by re-searching bank
2's loader code.** The `STA $2121`/`$2122`/`$420B` byte-pattern search of
file `0x10000`-`0x18000` (previous session, zero hits) was the wrong place
to look: palette load isn't part of the tile-copy routine (file `0x1025c`,
CPU `$82:825c`) at all — it's a *sibling* routine invoked by the same
caller. A whole-ROM byte search for `JSL $82825c` (the tile loader's own
entry point) found exactly two call sites, file `0x321a` and `0x324a` (CPU
`$00:B21A`/`$00:B24A`) — the second of these, `0x324a`, calls the tile
loader followed immediately by `JSL $82eeb5` and `JSL $82efec` (screen/tilemap
setup, unrelated to palette — see paths-tried table) but tracing *up* one
more level (the same 6-KB event-loop function these call sites live in) led
to the real palette routine via an independent search below.

**Palette-load routine — confirmed** (file `0x1067f`, CPU `$82:867F` /
mirror `$02:867F`, byte-verified with the flag-aware `dis65816.py` probe,
`m8 x16` throughout):

```
1067f: SEP #$20
010681: LDA #$0a         ; literal constant 10
010683: STA $ca           ; $ca = 10 -- CGRAM-DMA table record selector, see below
010687: LDA $0b7c
01068a: BNE $0106bb        ; skip if already loaded (cache/dirty guard)
01068c: LDA $094c          ; selector value (portrait/face ID)
01068f: REP #$20
010691: ASL A : ASL A : ASL A : ASL A   ; value * 16
010695: AND #$0fe0         ; clears bit 4 -- net effect: floor(value/2) * 32
010698: TAY
010699: LDX #$0040
01069c: SEP #$20
01069e: LDA #$20 : STA $24  ; loop counter = 32 (bytes)
0106a2: PHB : LDA #$82 : PHA : PLB   ; DBR = $82
0106a7: LDA $8764,Y         ; source: ROM bank $82 offset $8764+Y (file 0x10764+Y)
0106aa: STA $7e3800,X       ; dest: WRAM $7e:3840 (X starts at 0x40)
0106ae: INY : INX : DEC $24 : BNE $0106a7   ; 32-byte copy loop
0106b4: PLB
0106b5: LDA $23 : ORA #$02 : STA $23   ; set CGRAM-dirty flag (bit 1)
0106bb: RTL
```

This copies **32 bytes (16 BGR555 colours)** from ROM into WRAM `$7e:3840`,
then sets flag byte `$23` bit 1 (the CGRAM-dirty flag polled by the generic
per-frame DMA dispatcher, file `0x3ff2`/CPU `$00:BFF2` — previously
documented in §3.4 below at its `0x4029`-area CGADD-write instruction,
which is *inside* this same dispatcher, not a separate site as the prior
pass assumed).

**The CGRAM-DMA table record confirms the destination.** The dispatcher's
CGRAM branch (file `0x3ffc` onward) reads three parallel byte-offset arrays
at file `0x4162`/`0x4163`/`0x4165` (CPU `$00:C162`/`$00:C163`/`$00:C165`),
each indexed directly by `$ca` (not pre-scaled) — i.e. record fields are
literally 1 byte apart in file layout, not a single interleaved struct.
Dumping all 16 possible `$ca` values (0-15) against this 3-field read shows
**exactly one** produces a plausible, in-range CGADD/address/size triple —
`$ca=10`: `CGADD=$20, src=$7e:3840, size=0x20` — while every other value
from 0-15 produces nonsensically large size fields (thousands to tens of
thousands of bytes) or CGADD/address combinations that don't correspond to
anything else in this ROM. This is the same "the record's own fields refuse
to be sane except at one index" invariant style used elsewhere in this
project (`byte-scan-tag-byte-vs-wrong-stride.md`), and it independently
confirms both the `$ca=10` literal constant *and* the WRAM `$7e:3840`
destination address computed above — the loader writes to exactly the
address this DMA record reads from. `CGADD=$20` places the palette at CGRAM
colour 32, i.e. **SNES BG/OBJ sub-palette 2** (colours 32-47 of the
256-colour CGRAM space).

**Palette-group selection — confirmed structurally, verified by render.**
The `(value << 4) & 0x0fe0` computation is mathematically `floor(value/2) *
32` (bit 4 of the shifted value is unconditionally cleared by the mask) —
i.e. **two consecutive selector values share one 16-colour palette group**.
Applying `paletteGroup = floor(directoryIndex / 2)` against the confirmed
36-entry portrait directory (§3.2) and reading `16 * 2 = 32` bytes per group
starting at file `0x10764` (CPU `$82:8764`, the literal source address in
the disassembly above) produces, for every group tried (0-25+ checked by
hand, all 18 groups needed for the 36 portraits checked via the extractor):
plausible near-face-shaped colour ramps — outline/shadow colours, one or
more skin-tone-like mid-range colours, a distinct hair/fur colour band, and
a white highlight as the last entry — not random noise. **Rendering all 36
portraits with this scheme is the real confirming oracle**: every portrait
renders as coherent, recognisable art — correct skin tones on face regions,
matching fur colours on the animal heads (wolf, cat, dog), green scale
shading on the dragon-like head, and — notably — portraits 0 and 1 (palette
group 0, which is genuinely all-zero/black in ROM) render as plain black
silhouettes, consistent with Wizardry's traditional "unidentified monster"
silhouette convention rather than looking like a decode error. No colour
region is scrambled or mismatched to the wrong facial feature across any of
the 36 renders. Colour index 0 in every group is `(0,0,255)` pure blue, a
common dev-tool placeholder for "transparent/unused" — rendered as alpha 0
per the existing convention (index 0 = transparent), same as the prior
greyscale render.

The selector variable at DP `$094c` (loaded just before the shift/mask) was
*not* traced to a confirmed live write site specific to the portrait-viewer
screen — the one absolute write to `$094c` found nearby (file `0x3b2a`,
inside a large UI-screen-init routine) stores a fixed constant (`0x50 =
80`, out of the 0-35 directory range) that looks like it belongs to an
unrelated on-screen UI element, not portrait selection. This does not
weaken the palette-decode confirmation itself (which rests on the render
oracle + the CGRAM-record invariant, both independent of what exactly
writes `$094c` at runtime) — it only means "what game state feeds this
selector" (character ID? monster ID? something else?) is still open. Not
blocking; noted in the paths-tried table.

Extractor: `tools/wizardry6/snes/decode-portrait-tiles.ts`, updated this
session to read the real per-pair palette (`decodeCgramPalette` in
`tools/shared/snes-ppu.ts`) instead of the greyscale fallback. Output:
`public/assets/wizardry6/snes/sprites/portraits.png` (now full colour) +
`portraits.json` (frame sidecar, now also carries `paletteGroup`/
`paletteFileOffset` per frame) + `manifest.json` (`palette: null` still,
since colours are baked directly into the PNG — same convention the Amiga
corpus uses for its baked-colour sprite atlases).

### 3.2b UI icon bank palette — confirmed

**Closes the `snes-ui-icon-palette` open item.** The confirmed 405-tile UI
icon bank (§3.2's correction, file `0x2ad57`-`0x2e000`) is loaded through
the *same* shared palette-copy routine as the portrait bank, but entered 4
bytes into its body (file `0x1069c`/`0x106a0`, CPU `$82:869C`/`$82:86A0` —
literally mid-function, skipping the selector-computation prologue at
`0x1067f` that §3.3 documents), called directly with explicit `X`/`Y`/`A`
operands instead of a computed selector index. Two call sites, both in the
same bank-2 resource-loading module as the portrait/UI-icon tile loaders:

```
013ad7: a9 14         LDA #$14
013ad9: 85 ca         STA $ca
013adb: a2 00 01      LDX #$0100
013ade: a0 c0 05      LDY #$05c0
013ae1: 22 9c 86 82   JSL $82869c
```
```
013b0d: a9 14         LDA #$14
013b0f: 85 ca         STA $ca
013b11: a2 00 01      LDX #$0100
013b14: a0 60 06      LDY #$0660
013b17: 22 9c 86 82   JSL $82869c
```

Both set the generic CGRAM-DMA dispatcher's `$ca` selector (§3.3) to `20`
(`0x14`) immediately after the copy. Cross-checking against the confirmed
dispatch table (file `0x4162`/`0x4163`/`0x4165`): `$ca=20` → CGADD `0x80`
(sub-palette 8, CGRAM colours 128-143), source WRAM `$7e:3900`, size 32
bytes (16 colours) — and the call sites' own operands match this
byte-for-byte: `X=0x0100` → copy destination `$7e:3800+0x100 = $7e:3900`
(exactly the table's source address); the routine's hardcoded loop count is
32 bytes (matches the table's size field exactly, no override needed for
this entry point).

Both sites read from the **same shared CGRAM colour-group table** the
portrait bank uses (file `0x10764`, 32 bytes/16-colours per group, §3.3) —
group 46 (`Y=0x5c0 = 46*32`) and group 51 (`Y=0x660 = 51*32`). Groups 45-52
of that table share a fixed "UI chrome" sub-palette at indices 8-12 in
every group (a gold/tan border colour `(172,115,8)` in 8-bit-per-channel
terms, dark green, black outline, dark red) with the remaining indices
varying slightly per group — consistent with two colour *variants* of the
same icon set (plausibly two different menu/window screens both reusing
CGRAM slot 8), not two unrelated resources.

**Confirmed by render**: applying group 46 (or 51) to the UI icon tile bank
produces coherent, non-scrambled art — round medallion/badge icons with
gold borders (matching the confirmed compass-letter badges), grey
tunnel/passage-wall decoration, arrows, and item icons all render in
plausible, structurally consistent colour. Zero colour-region scrambling
across the whole 405-tile bank at either group.

Extractor: `tools/wizardry6/snes/decode-ui-icons.ts`, updated this session
to bake group 46 in as the primary render (group 51 recorded as a
confirmed alternate in the JSON sidecar, `paletteAlternateGroups`, not
separately rendered). Output: `public/assets/wizardry6/snes/sprites/
ui-icons.png` (now full colour) + `ui-icons.json` + `manifest.json`
(`palette: null`, colours baked in, same convention as portraits).

### 3.4 Other DMA sites (context, superseded in role by §3.2)

- **DMA register usage census** (byte-pattern search across the whole
  ROM): `STA $420B` (MDMAEN, start DMA) appears 72 times; direct absolute
  `STA $2116`/`$2118` (VRAM address/data, non-DP-relative form) only 2-3
  times — almost all PPU register access in this ROM goes through the
  `DP=$2100` trick established at reset (§2.2), so a literal byte scan for
  `$21xx` absolute addressing under-counts real hits by roughly two orders
  of magnitude.
- Hand-decoded one DMA setup site at file `0x3FA6` (CPU `$00:BFA6`):
  channel 0, B-bus target `$04` (OAMDATA), source `$7E:FC00` (WRAM), size
  `0x0202` (514 bytes ≈ OAM table size) — **rendered**: an OAM-clear/init
  DMA from a pre-built WRAM buffer, not a graphics-tile load.
- Hand-decoded a second site at file `0x4029` (CPU `$00:C029`): channel 1,
  writes `$2121` (CGADD, palette write address) then sets B-bus target
  `$22` (CGDATA) — **confirmed shape as a palette (CGRAM) DMA**, source
  address/size read from a small table (`LDX $C163,Y` / `LDX $C165,Y`,
  file `0x4162` onward, byte/word/word triples: CGADD-start byte, WRAM
  source-address word, size word — **confirmed** by direct disassembly
  this session, DBR verified `$00` at this call site) rather than a fixed
  constant, i.e. this screen-palette path stages colours into WRAM `$7E`
  first and DMAs from there to CGRAM — but see §3.3, this is a separate
  index space (`$ca`) from the face-portrait directory and was not traced
  to a ROM-side palette source this pass.
- Confirmed `0x508DD`-area (CPU `$0A:88DD`/file `0x508c9`, function
  `$88C9`) as a **VRAM tile-upload loop**, disassembled fully this
  session: per-cell loop (17 iterations) DMAs `0x14`-byte (20-byte)
  chunks from WRAM bank `$7F` (source low-word from a caller-supplied `X`
  argument, `+0x14` per iteration) to VRAM (dest word address `+0x20`
  words per iteration) via DMA channel 0 (`$4300`-`$4306`). Caller
  (`$8868`-area) invokes it with 8 different `X` values spaced `0x154`
  (340) bytes apart — **not yet connected to §3.2's portrait bank** (340
  isn't a multiple of 288, and the per-iteration 20-byte transfer size
  doesn't match a whole-tile or whole-tile-pair boundary at 4bpp/2bpp);
  read as a **separate** UI/font-cell VRAM upload path, still open — see
  §4.3. Immediately preceding the caller's 8-iteration loop is a small,
  separate, fixed 64-byte VRAM DMA (file `0x50830`-area, source ROM bank
  `$8a`/mirror `$0a` offset `0x8c49` -> file `0x50c49`) — unrelated to the
  `$7f` staging question, noted here only so a future pass doesn't re-find
  and re-trace it as if it were new. **This session traced one hop further
  back into where `$88C9`'s WRAM `$7f` source data itself comes from** —
  see §3.5's boot-init trace, which narrows (but does not close) the
  previously "not traced" `$7f:0000`-`0x0aa0` range.
- One suggestive, single-occurrence debug tag was found at file `0x65E54`:
  the literal string `"=SHVCAW6JWIZARDRY6 NO.01 WIZARDRY6 FACE1 "`
  (`SHVC-AW6J` = this cartridge's real Nintendo product code) sitting
  immediately before code that DMAs/copies into WRAM `$7E:3000`-family
  addresses. Traced this session: this specific call site (file
  `0x65e7c`) invokes the same bank-`$0C` resource-type dispatcher as §3.2
  with resource type `0`, which is a no-op handler (`STZ $ea29; RTS`) —
  the "FACE1" string is very likely just a nearby build-time label, **not**
  functionally tied to this specific call. Read as a one-off asset-bank
  comment, not a repeating directory.
- `render_tiles.py`-style blind probes (2bpp/4bpp, several speculative
  offsets) from the prior pass found nothing — see the paths-tried table;
  superseded by the traced-loader approach in §3.2.

**Extractor for the UI icon bank — committed this session.**
`tools/wizardry6/snes/decode-ui-icons.ts` decodes all 405 tiles from file
`0x2ad57`-`0x2e000` (re-deriving and asserting the span against the
portrait directory's own pool-A/pool-B boundaries at run time, refusing to
write output if they don't match — same guard pattern as
`decode-portrait-tiles.ts`). Output: `public/assets/wizardry6/snes/sprites/
ui-icons.png` (405-frame shelf-packed atlas, one 8x8 sprite per tile,
**greyscale** — see below) + `ui-icons.json` (frame sidecar) +
`manifest.json` entry. Palette for this bank is **not confirmed**: a
byte-pattern search of the entire boot-init span (file `0x8000`-`0x9200`,
covering both confirmed source MVN call sites `0x008e42`/`0x0080b9`) for
DP-relative `STA $21`/`$22` (CGADD/CGDATA under the `DP=$2100` convention)
and absolute `STA $2121`/`$2122` found **zero hits** — unlike the portrait
bank, this tile bank's ROM→WRAM copy has no adjacent CGRAM-palette-load
sibling routine to trace, so its real in-game colour is unknown. Rendered
in a flat 16-level greyscale ramp so the icon shapes stay legible without
asserting an unverified colour.

See `docs/wizardry6/TODO.md` for this item's tracking row (palette,
§3.3, is now the only open sub-item for the *portrait* bank — the
pixel/tile format and one full confirmed asset are done; the UI icon
bank's own palette is a separate, still-open item, see the paths-tried
table).

### 3.5 Full CGRAM palette load — confirmed, but relocated (see correction)

> **Correction (this session): file-offset↔CPU-address bank error found and
> fixed.** The previous write-up below cited this `MVN` as living at "file
> `0x8060`-area, CPU `$00:8060`-ish", inside RESET's one-time init span. That
> is wrong on two counts, both traced to the same root cause: file offset
> `0x8060` is **`>= 0x8000`**, so by this doc's own §1.1 conversion formula
> (`bank = floor(o / 0x8000)`) it falls in **bank `$01`**, not bank `$00` —
> the correct CPU address is `$01:8068` (mirror `$81:8068`), not `$00:8060`.
> Re-derived and byte-verified this session with the same conversion
> mistake caught before it propagated further: the function containing this
> `MVN` starts at file `0x801d` (CPU `$01:801D` / mirror `$81:801D`, byte
> pattern `a9 8f 8d 00 21 8b a9 ff 22 04 80 81 ...`), **not** inside RESET's
> `0x0030`-`0x00DE` init span (which stays entirely within bank `$00`, file
> `<0x8000`, the whole time — RESET never crosses a bank boundary via
> straight-line execution, which isn't possible without an explicit far
> jump). `$81:801D` is instead called from the **boot/opening task**'s own
> body (§2.3's scheduler correction) at file `0x095b` (`22 1d 80 81` = `JSL
> $81801D`), confirmed by direct disassembly this session:
> ```
> 000953: a9 ff         LDA #$ff
> 000955: 85 26         STA $26
> 000957: 22 90 f1 82   JSL $82f190
> 00095b: 22 1d 80 81   JSL $81801d      ; <- this function, see below
> 00095f: 20 f2 bf      JSR $bff2
> ```
> **Practical effect on this section's conclusion**: this is **not** a
> boot-time/RESET-time snapshot and not obviously a "title screen" palette
> either — it's set up by ordinary task-scheduler-driven code that also does
> real VRAM DMA setup in the same function body (BG3 tile upload to VRAM
> word `$2000`, confirmed a few instructions later in the same function via
> `STA $2115`/`STX $2116`/DMA channel setup at file `0x8032`-`0x805a`) —
> most consistent with a **general main-game-screen palette load**, not a
> dedicated title/logo palette. The real located title-screen art is now
> confirmed via a completely different path — see section 3.8.
>
> The byte-level content/size findings below (512 bytes, full 256-colour
> CGRAM image) are otherwise unaffected by this correction — only the
> location and role were wrong.

A standalone `MVN` inside `$81:801D`'s body (file `0x8062`-area, CPU
`$01:8062`-ish), byte-verified by hand:

```
008062: LDX #$a7e4       ; source addr within bank $82 (mirror $02)
008065: LDY #$3800        ; dest addr in WRAM $7e
008068: LDA #$01ff        ; count-1 = 511 -> 512 bytes
00806b: MVN $7e,$82        ; dst=WRAM $7e, src=ROM bank $82
```

Source file offset: `0x10000 + (0xa7e4 - 0x8000) = 0x127e4`. **512 bytes
is byte-exact for a full 256-colour CGRAM image** (256 x 2-byte BGR555
words) — this is a structural invariant, not a guess: CGRAM is exactly 512
bytes on real hardware, and this is the only MVN found anywhere in the ROM
whose size (`0x200`) matches that exactly. Decoding it as 256 BGR555
colours and rendering a 16x16 swatch grid (session scratchpad, not
committed) shows **coherent, non-random structure**: a greyscale UI ramp,
an orange/tan skin-tone gradient in the same row range portraits use
(sub-palette 2, colours 32-47 — consistent with, but at a **different**
ROM source address than, the confirmed per-pair portrait palette at
`0x10764`, §3.3), and repeating grey/white vertical-stripe columns in the
lower half matching the "3D bevel" border/gradient pattern seen in the
confirmed UI icon bank (§3.2's correction). Given the correction above,
this is now read as a **general main-game-screen CGRAM snapshot**, loaded
once by the boot task early in the startup sequence (not by RESET itself,
and not obviously title-screen-specific) — not as a single screen's
dedicated palette. Not traced further to a specific consumer (e.g.
whether/when this snapshot gets DMA'd to hardware CGRAM, versus just
sitting in WRAM `$7e:3800` as a staging buffer some other routine reads
from) — flagged open, but the location/size/shape are confirmed.

Immediately following in the same function body (`$81:801D`, not RESET's
own init span — see correction above): a chain of WRAM-to-WRAM `MVN`s that
zero-clear large stretches of both WRAM banks (`$7e`/`$7f`, via the
classic "seed one zero word, then `MVN bank,bank` with `Y=X+2` to
self-propagate it forward" idiom — confirmed at file `0x8093`-`0x80a0`ish,
clearing WRAM `$7f` entirely, `count=0x3ffe` words), then **one WRAM→WRAM
copy relevant to the still-open `$88C9` question (§3.4, §4.3)**: `MVN
$7f,$7e` at file `~0x80ab` (`X=$e000`, `Y=$06e0`, count `0x6c0`=1728
bytes) copies WRAM `$7e:e000`-`$7e:e6c0` into WRAM `$7f:06e0`-`$7f:0da0` —
**exactly** abutting the confirmed UI-icon-bank MVN's destination
(`$7f:0da0`, §4.3's `0x0080b9` finding) with zero gap. This narrows
`$88C9`'s still-unexplained low WRAM range (previously "`$7f:0000`-`0x0aa0`
not traced to a ROM source") to two sub-questions: `$7f:0000`-`0x06e0` is
still completely unaccounted for (no write to it found in this boot span),
and `$7f:06e0`-`0x0da0` is now traced **one hop back** to WRAM `$7e:e000`,
not directly to ROM — what fills `$7e:e000` itself was not found in this
session's search of the immediate boot-init byte range (a byte-pattern
search for `LDX`/`LDY #$e000` in file `0x8000`-`0x8200` found only the one
occurrence already cited above, i.e. no prior write establishes it within
this narrow window — either an earlier, unlocated part of the boot
sequence writes it, or it's runtime/hardware-power-on state read as-is).
Not resolved this session; see the paths-tried table.

> **Correction/closure (this session): the `snes-88c9-wram7f-source`
> question is resolved.** A `re-codebreaker` escalation found the ROM's
> general-purpose LZSS decompressor (`$83:8000`, file `0x18000` — see
> section 3.8) and confirmed its decompression output always lands at
> **WRAM `$7f:0000`**. `$88C9`'s WRAM `$7f` source range is simply this
> decompressor's own output buffer — there is no separate ROM source to
> find for the `0x0000`-`0x06e0` sub-range; it's populated at runtime by
> whichever `JSL $838000` call most recently ran (22 confirmed call sites
> ROM-wide). Independently re-verified this session: the LZSS decoder was
> re-implemented from scratch (not copied) and run against 3 unrelated
> resources (see section 3.8), all three producing exact byte-count matches
> and two producing fully legible renders — strong evidence the codec
> itself is correctly understood, which is what this closure rests on.

### 3.6 Title screen / full-screen art — confirmed, see section 3.8

> **Correction (this session): found.** The dead end documented below (from
> a prior session) is preserved for the record, but is now superseded — a
> `re-codebreaker` escalation located the full opening sequence (publisher
> logo, copyright screen, title backdrop + lightning overlay, a Mode 7
> sequence, and a scrolling panorama), and this session independently
> re-verified 3 of those screens plus the dialogue font with from-scratch
> renders (not just trusting the escalation's report) — see **section
> 3.8** for the full write-up, extractor, and assets. The root cause of
> every prior failed attempt (this session's own and the escalation's first
> four approaches) was the same: these resources are **LZSS-compressed**
> (codec at `$83:8000`, file `0x18000`), so any census assuming the
> uncompressed `MVN`/raw-DMA shape that worked for the face-portrait and
> UI-icon banks (section 3.2) could never find them.

No lead found this session despite two independent approaches (see the
paths-tried table for the full account). This section documents a
**false-positive dead end worth recording** so a future pass doesn't
repeat it: a naive DMA census that looked for `LDA #imm16` immediately
preceding a `STA $43x5`/`$43x6` (DMA size register) write, applied to all
72 `STA $420B` (MDMAEN) trigger sites, reported two candidate ~35KB
transfers (file `0x50261`/`0x684f9`, sizes 36223/36130 bytes) that looked
like a plausible full-screen-bitmap-sized upload. **Hand-disassembling the
actual call site refutes this**: the real size register at `0x50261` is
loaded from an **indexed table read** (`LDA $8a8149,X` / `STA $4305`), not
from an immediate — the heuristic's "nearest preceding `LDA #imm16`"
match was picking up an unrelated stray immediate load a few instructions
earlier in the same 60-byte lookback window, not the actual operand
feeding the size register. This call site is in fact the **already-known**
`$88C9`-adjacent bank-`$0A` DMA dispatcher region (§3.4) — table-driven,
size varies per call, not a single large fixed transfer. No new lead for
this item resulted from that DMA census, and the size values it reported
should not be trusted or re-cited.

The boot-time full CGRAM palette load (§3.5) is a plausible *candidate*
piece of a title screen (or could equally be a general default UI
palette used throughout, e.g. for menu borders) — no accompanying tile
*data* load was found nearby it in the same boot-init span to corroborate
either reading. Where actual per-frame game logic (and therefore any
screen-drawing code, title screen included) executes is still the open
`snes-nmi-main-loop` question (§2.3) — without that, there is no top-down
path into title-screen-specific code to trace forward from, only blind
bottom-up census techniques, which did not pan out this session.

### 3.7 Full-body monster/character sprites — not located (checked, inconclusive)

Checked both leads suggested for this item:

- **A second, larger-record directory near the confirmed portrait
  directory** (file `0x105D1`, §3.2): the 120 bytes immediately preceding
  it (file `0x105a0`-`0x105d0`) hold a different array of 2-byte words, all
  in the range `0x3000`-`0x39ff` — structurally unlike the confirmed
  directory's own encoding (CPU addresses within ROM bank `$85`, i.e. high
  byte `0x8x`-`0x9x`), so this is **not** the same lookup mechanism reused
  for a second resource; role not identified, not pursued further. No
  second `0x120`-byte-stride (or any other clean fixed-stride) run of
  larger records was found adjacent to the confirmed directory in either
  direction.
- **The 15-entry resource-type dispatch table** (file `0x66a0e`, previously
  identified in §3.2's method note as a dead end for the *portrait* bank):
  re-checked this session by disassembling the first ~20 bytes of all 15
  handlers. Handler 0 confirms the already-documented no-op (`STZ $ea29;
  RTS`); every other handler examined opens with `JSR $eecb` or a close
  variant, consistent with the doc's existing "input/peripheral-polling
  subsystem" reading — **re-confirmed as unrelated to graphics loading**,
  not a hidden sprite-bank dispatcher.

No evidence of a full-body sprite bank was found by either check. Given the
SNES port's confirmed asset budget elsewhere (36 small 24x24px face
portraits, no larger figure art found anywhere in the resource-loader
paths traced so far across two sessions), it's plausible this port simply
**doesn't ship full-body monster/character art** — but this is not proven,
only an absence-of-evidence result from two bounded checks, not an
exhaustive search of the ROM. Left open rather than asserted either way;
see the paths-tried table.

**Update (this session): two more large graphics banks were found and
fully characterized (spell/combat animations, §6.4; the opening sequence,
§3.8), and neither contains full-body figure art either** — the spell
animation bank's largest single frames top out around a handful of tiles
(24x24px mode-B frames, or small mode-A composites), and the opening
sequence is screen-background/logo/text art, not character sprites. This
doesn't newly prove absence (still not an exhaustive ROM search), but it
does rule out two more entire resource families as hiding places, making
the "this port doesn't ship full-body art" reading somewhat more likely
than before. Not escalated this session — see the paths-tried table for
why (no new concrete lead to hand an escalation, only two more negative
results).

<details>
<summary>Original first-pass notes (superseded by §3.1-3.4 above, kept for history)</summary>

No graphics format was decoded to a confirmed pixel-level render in the
first pass. What was found then:

- **DMA register usage census** (byte-pattern search across the whole
  ROM): `STA $420B` (MDMAEN, start DMA) appears 72 times; direct absolute
  `STA $2116`/`$2118` (VRAM address/data, non-DP-relative form) only 2-3
  times — almost all PPU register access in this ROM goes through the
  `DP=$2100` trick established at reset (§2.2), so a literal byte scan for
  `$21xx` absolute addressing under-counts real hits by roughly two orders
  of magnitude. Any future graphics-loader trace needs to account for this
  (search for `85`/`95`/`8D` *zero-page-relative* forms with the DP
  context in mind, not just absolute `8D xx 21`).
- Hand-decoded one DMA setup site at file `0x3FA6` (CPU `$00:BFA6`):
  channel 0, B-bus target `$04` (OAMDATA), source `$7E:FC00` (WRAM), size
  `0x0202` (514 bytes ≈ OAM table size) — **rendered**: an OAM-clear/init
  DMA from a pre-built WRAM buffer, not a graphics-tile load.
- Hand-decoded a second site at file `0x4029` (CPU `$00:C029`): channel 1,
  writes `$2121` (CGADD, palette write address) then sets B-bus target
  `$22` (CGDATA) — **confirmed shape as a palette (CGRAM) DMA**, source
  address/size read from a small table (`LDX $C163,Y` / `LDX $C165,Y`)
  rather than a fixed constant, i.e. palettes are staged into WRAM first
  (probably decompressed there) and then DMA'd to CGRAM per-screen. The
  literal absolute addresses `$C163`/`$C165` are cited as written in the
  operand; the effective data bank at that point in the code was not
  traced, so the true source table location is **hypothesis**, not
  confirmed.
- Located a third DMA-adjacent site at file `0x508DD` (CPU `$0A:88DD`)
  that writes `$2115` (VMAIN) and `$2116` (VMADDL, direct absolute form
  this time) inside a loop incrementing a zero-page pointer by `0x14`
  bytes and the VRAM address by `0x20` words per iteration — the
  strongest lead found for an actual tile-data VRAM upload loop, but the
  loop's source pointer origin (ROM vs. a decompression output buffer)
  was not traced.
- No compressor was identified. `ancient identify` (this project's usual
  first check for a renamed/known compressor) was **not run** this pass —
  there is no confirmed compressed-block boundary yet to hand it, and
  guessing offsets to feed it produces noise, not signal. This is the
  natural next step once one of the above DMA sites is traced back to a
  concrete source-data start address.
- One suggestive, single-occurrence debug tag was found at file `0x65E54`:
  the literal string `"=SHVCAW6JWIZARDRY6 NO.01 WIZARDRY6 FACE1 "`
  (`SHVC-AW6J` = this cartridge's real Nintendo product code) sitting
  immediately before code that DMAs/copies into WRAM `$7E:3000`-family
  addresses. Read as a one-off build-time asset label ("this ROM bank
  holds portrait-face bank #1"), not a repeating directory — the same
  4-byte `SHVC` signature and `WIZARDRY6` string were searched for
  byte-exact across the *entire* ROM and this is the only hit. A second,
  unrelated-looking tag `"FAT0SHVC"` sits at file `0x66C29` next to a
  small table of mostly-`0x00`/`0x03` bytes; role not determined.
- `render_tiles.py`-style probes (2bpp/4bpp SNES tile decode — 2-plane
  pairs interleaved per row, the standard `bpN row0, bpN+1 row0, bpN
  row1, ...` SNES layout, **not** the Amiga's plane-major layout) were run
  against several speculative offsets (`0x40000`, `0x50000`, `0x60000`,
  `0x65E00`, `0x66C00`, `0x68000`, `0xA900`, `0xAA00`) blind. None produced
  a recognizable image — all noise. This blind-offset approach is
  considered exhausted; see the paths-tried table below.

See `docs/wizardry6/TODO.md` for this item's tracking row.

</details>

### 3.8 Opening sequence (title/logo/copyright screens) — confirmed

Found via a `re-codebreaker` escalation (brief: locate the title-screen
art, given the game's real per-frame dispatch had never been traced —
see §2.3's correction, which the same escalation also resolved as a side
effect of researching this). **Independently re-verified this session**:
the LZSS decoder below was re-implemented from scratch from the
escalation's cited disassembly (not copy-pasted), run directly against the
ROM, and its output composed into images by this session's own code —
see `verify-escalation-artifacts-not-just-claims.md`.

**The codec — confirmed.** ROM routine `$83:8000` (file `0x18000`) is a
general-purpose LZSS decompressor, 2 KB sliding window:

- Stream: `[u16 LE streamLength-2][body]` — `streamLength` (header value +
  2) is the exact total byte count of header + body.
  body: repeating groups of 1 control byte + up to 8 tokens, LSB-first.
  - control bit `0` → literal: 1 raw byte.
  - control bit `1` → match: 2 bytes `b0,b1`. `offset = b0 | ((b1&0x07)<<8)`
    (11-bit window offset), `length = (b1>>3)+3` (3-34 bytes),
    `base = max(0, outputLenSoFar - 0x800)`, copy `length` bytes from
    `output[base+offset ..]` (self-referential/overlapping copies are
    valid, standard LZSS).
- Implementation: `tools/shared/snes-lzss.ts` (`decodeLzss`).
- **22 confirmed `JSL $838000` call sites** across the ROM — this is the
  general SNES-side graphics codec for this release, not specific to any
  one resource family. (Portraits and the UI icon bank, §3.2/§3.2b, are
  *not* compressed — plain `MVN` copies — this codec is used for larger
  resources: the opening sequence below and the spell/combat animation
  bank, §6.4.)

**Verification (re-derived, not trusted from the escalation report)**: the
decoder was run against 3 unrelated resources — this section's logo and
copyright screen, and §6.4's spell-animation record 0 — all three consume
**exactly** their declared header length with zero overrun. The two
opening screens render as fully legible content (below); record 0 renders
as a coherent organic/particle shape (§6.4).

**Screen layout — confirmed.** Each opening-sequence resource decompresses
to `[tilemap][chr tiles]`: a standard SNES BG tilemap (2 bytes/entry,
`vhopppcc cccccccc` — tile number in the low 10 bits) immediately followed
by the 4bpp or 2bpp tile graphics it references. Tilemap size varies by
resource (`32x28` = 896 entries for a normal single screen; `64x32` = 2048
entries for a double-wide backdrop).

| # | Resource (file offset) | Unpacked size | Tilemap | Chr | bpp | Content | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | `0x020000` | 3648 B | 32x28 | 1856 B / 58 tiles | 4 | ASCII Corp logo | **confirmed** |
| 2 | `0x06a136` | 7920 B | 32x28 | 6128 B / 383 tiles | 2 | Sir-tech copyright text | **confirmed** |
| 3a | `0x0693c6` | 8416 B | 64x32 | 4320 B / 135 tiles | 4 | Title backdrop (night sky/horizon) | rendered |
| 3b | `0x06aecd` | 7904 B | 64x32 | 3808 B / 119 tiles | 4 | Lightning-bolt overlay (sparse, ~22% of cells) | rendered |

**Confirmed by render (decisive oracle)**: resource 1 composes to the
unmistakable **"ASCII" wordmark**; resource 2 composes to fully legible
English text — *"Bane of the Cosmic Forge, Copyright (c) 1995 David W.
Bradley and Sir-tech Software, Inc. All rights reserved. Wizardry is a
registered trademark of Sir-tech Software, Inc. "Wizardry - Bane of the
Cosmic Forge" is a copyrighted program licensed to ASCII Corporation by
Sir-tech Software, Inc. Japanese Translation by Game Studio, Inc. and
ASCII Corporation."* — reproduced independently by this session's own
composition code, not just described by the escalation. Resources 3a/3b
render as coherent (not noise) horizon/mountain-silhouette and
lightning-bolt-fragment shapes respectively, but have no legible-text-level
oracle, so they're marked **rendered** (plausible, structurally sound)
rather than **confirmed**.

**Also found and confirmed — the dialogue font (closes
`snes-font-tile-bank`)**: file `0x04c653`, 4096 bytes, **uncompressed**
(plain tile bank, same convention as the portrait/UI-icon banks — not
LZSS), 256 tiles, 2bpp. DMA'd to VRAM by the same task-scheduler-driven
function that loads the main-screen CGRAM snapshot (`$81:801D`, §3.5's
correction). **Confirmed by render**: the full 256-tile bank composes to
an unmistakably legible glyph set — digits `0`-`9`, the full `A`-`Z`
alphabet, hiragana, katakana, and assorted UI symbols (arrows, boxes,
cursor glyphs). This is the glyph bank needed to render the confirmed
half-width-katakana monster names (§6.2) and any other in-game text — the
glyph-to-character-code mapping (which byte value selects which of the 256
tiles) was not decoded this session, only the raw tile bank.

**Now extracted (follow-up session), closing `snes-opening-screens-4-5`.**
Both remaining located-but-unextracted resources have been composed and
independently verified from scratch (fresh Python probe, not any
escalation script):

- **Panorama** (files `0x023b2a` chr + `0x0272ff` tilemap): the tilemap
  decompresses to exactly `240*15*2 = 7200` bytes and the chr to exactly
  `659*32 = 21088` bytes — both byte-exact matches to the claimed `240x15`
  grid and 659-tile count. Composing it **column-major**
  (`col = idx/15, row = idx%15`) produces an unambiguous, legible scrolling
  scene: a night sky with a crescent moon, a row of dead/bare trees with
  root silhouettes, still-water reflections, and a distant tower/ruin
  silhouette at the far right — a decisive render oracle. Row-major
  composition (tried for comparison) is unambiguous garbage, confirming
  column-major is correct. **Confirmed.**
- **Mode 7 sequence** (file `0x02112c`): decompresses to 16216 bytes total.
  The first 24 bytes are not tile data (11 zero bytes then an ascending
  `01 02 03...0b` ramp — role undetermined); the remaining 16192 bytes are
  exactly 253 whole 8bpp **linear** (not bitplane — Mode 7's BG1 is always
  8bpp linear, 1 byte/pixel, 64 bytes/tile) tiles. No stored tilemap was
  found alongside it, so this is rendered as a flat contact-sheet texture
  atlas, not a composed picture — shows repeating blocky/stippled texture
  (consistent with a rotating ground/floor effect) plus one small distinct
  icon-like fragment. Structurally coherent, not noise, but not
  independently legible the way the panorama is. **Rendered**, not
  confirmed.

**Palette — not confirmed for any of section 3.8's resources.** The
boot/main-screen CGRAM snapshot (§3.5) was tried against a sample frame
and produced a plausible but unverified colour result. All assets here are
rendered in greyscale, per project convention (never assert an unconfirmed
palette).

Also added as a bonus this session (quick win using the DMA-descriptor
byte offsets §3.13 already documented): the **ending screen**'s BG2 layer
(file `0x060000`, tilemap slice at decompressed offset `0x0aa0`, chr slice
at `0x11a0`) composes to unmistakably legible **"To Be Continued..."**
text on a starfield — a decisive render oracle, independently re-derived
from scratch this session (not from the escalation). **Confirmed.** BG1
(the starfield backdrop proper, 8bpp, 461 tiles) is not composed — its
tilemap is constant-filled at load and written dynamically at runtime, so
there is no static ROM tilemap to render it from. The other two §3.13
screens (main gameplay screen `0x05104b`, space-scene cutscene `0x058000`)
are still not extracted — both need a multi-slice VRAM-DMA composer beyond
what this extractor implements (`0x05104b`'s BG1/BG2 tilemaps are partial
*patches*, not full base tilemaps) — see the TODO row.

Extractor: `tools/wizardry6/snes/decode-opening-sequence.ts`. Output:
`public/assets/wizardry6/snes/screens/logo.png`, `copyright.png`,
`title-backdrop.png`, `title-lightning.png`, `panorama.png`,
`mode7-texture.png`, `ending.png` (each a full composed screen image,
greyscale) + `public/assets/wizardry6/snes/sprites/font.png` + `font.json`
(256-tile atlas) + `manifest.json` entries.

---

### 3.9 Whole-ROM region map — confirmed (session 6)

Session 6 mapped every remaining unaccounted region of the ROM. The
previous sessions' picture was substantially incomplete: **banks `$0E`-`$1D`
(512 KB) and banks `$40`-`$5F` (1 MB) — together half the cartridge — were
not covered by any confirmed finding**, and a prior session's entropy census
flagged only banks `$20`-`$31` as unaccounted, missing both of these.

| Banks | File range | Contents | Confidence |
|---|---|---|---|
| `$00`-`$0D` | `0x000000`-`0x070000` | 65816 code, portraits (§3.2), UI icons (§3.2b), dialogue font (§3.8), opening-sequence resources | confirmed (prior sessions) |
| `$0E`-`$1D` | `0x070000`-`0x0F0000` | **Raw uncompressed 4bpp tile art** — dungeon/environment walls, figures, and the main kanji/kana font (§3.10, §4.4) | confirmed (render) |
| `$1E` | `0x0F0000`-`0x0F8000` | SPC700 driver + upload handshake (§5.1-§5.3) | confirmed (prior) |
| `$1F`-`$31` | `0x0F8000`-`0x190000` | **BRR audio sample data** (§5.4) | confirmed (structural) |
| `$32`-`$3F` | `0x190000`-`0x200000` | Spell/combat animation bank (§6.4) | confirmed (prior) |
| `$40` | `0x200000`-`0x208000` | Creature-sprite resource table + 7-byte record pool (§3.11) | confirmed (disassembly) |
| `$41`-`$42` | `0x208000`-`0x218000` | UI/window tilemap compose-piece libraries (§6.5) | confirmed (disassembly) |
| `$43`-`$45` | `0x218000`-`0x230000` | Script / message token streams (§6.6) | confirmed (disassembly) |
| `$46`-`$5F` | `0x230000`-`0x300000` | Creature-sprite CHR (LZSS) + OAM frame lists (§3.11) | confirmed (disassembly + render) |

The ROM's final ~500 bytes (`0x2FFE00`-`0x300000`) are filler: the ASCII
string `"Game Studio Inc."` repeated — the SFC port's developer.

### 3.10 Dungeon / environment tile-art banks — confirmed by render (banks `$0E`-`$1D`)

**This is the SNES analog of the Amiga port's `mazedata.ega`** (see
`docs/wizardry6/amiga/data-structure.md` §4) and the answer to the
long-open dungeon-art question.

File `0x070000`-`0x0F0000` (512 KB, banks `$0E`-`$1D`) is **plain
uncompressed 4bpp SNES tile data** — no container, no directory header at
the region start, no compression. It was missed by every prior session
because it is invisible to all three censuses used so far: it is not
LZSS-compressed (so no `JSL $838000` call site points at it), it is not
`MVN`-copied with an immediate source bank in the common idiom, and it is
not reachable from the `$C0:8000` resource table.

Bank-by-bank content, from a blind 4bpp tile render at 32 tiles/row
(session scratchpad `banks_0e_1d.png`, `zoom_b10.png`, `b10_wall_32.png`):

| Bank | File | Content |
|---|---|---|
| `$0E`-`$0F` | `0x070000`-`0x080000` | Figure/creature line art |
| `$10`-`$19` | `0x080000`-`0x0D0000` | **Dungeon/environment art** — large stone-masonry wall faces with mortar joints and arched openings, plus banded rows of smaller architectural fragments at progressively reduced scale (the perspective-depth variants) |
| `$1A`-`$1B` | `0x0D0000`-`0x0E0000` | Framed-picture art + dense pattern/texture tiles |
| `$1C`-`$1D` | `0x0E0000`-`0x0F0000` | Main 16x16 kanji/kana font (§4.4) |

**Verification (render oracle, quantified):** bank `$10` rendered at 32
tiles/row from file `0x080000`+96 tiles produces a contiguous, unambiguous
stone-block wall with continuous horizontal mortar courses running the full
256-pixel width across 4+ tile rows, two distinct arched openings, and
below it banded rows of smaller wall/doorframe fragments. This matches the
Amiga corpus's own confirmed `mazedata.ega` content description (§4.3
there: perspective-scaled brick walls, doors, archways). No palette is
applied — greyscale only, per project convention.

**Storage layout — hypothesis, not confirmed.** The tiles are *not* stored
as a fixed-width raster image: a vertical-edge-continuity scan (match the
bottom pixel row of tile `t` against the top row of tile `t+cols`, over
tiles 96-600 of bank `$10`) gives 0.325 / 0.346 / 0.279 / 0.228 for
`cols` = 8 / 12 / 16 / 32 — a shallow, monotonically-decaying curve with no
peak, i.e. pure locality, no periodic structure. They are therefore a
**loose tile pool addressed by tilemap indices**, consistent with the
compose-piece system in §6.5.

> **Now confirmed (dungeon-composer session).** The "loose tile pool"
> hypothesis is correct and the addressing is fully traced: cell words in
> the §6.5 piece libraries carry a 4-bit bank field (`bits 10-13`, `+$90`)
> and a 10-bit tile index (`bits 0-9`), giving `bank $90-$99` x 1024 tiles
> = this exact 10,240-tile span. Pieces are blitted into an 18x15 software
> bitmap at WRAM `$7E:5000` under a near-to-far painter's algorithm. Full
> spec and quantified verification in **§3.14**.

> **Independently re-verified (follow-up session).** Per
> `verify-escalation-artifacts-not-just-claims.md`, re-derived the render
> from scratch (fresh Python 4bpp tile decoder, not the escalation's own
> script) at the exact cited offset/tile-row and reproduced the same
> content: a contiguous stone-block wall with continuous mortar courses,
> an arched opening, and banded rows of smaller architectural fragments
> below it — confirms this is real, structured, non-random content, not
> an artifact of the escalation's own rendering code. Extractor committed
> this session: `tools/wizardry6/snes/decode-dungeon-art.ts` dumps the
> confirmed `$10`-`$19` span (file `0x080000`-`0x0D0000`, 10,240 tiles) as
> a flat greyscale contact-sheet atlas — output:
> `public/assets/wizardry6/snes/sprites/dungeon-art.png`/`.json`. The
> compose-list/addressing question above is unaffected by this and remains
> open.

### 3.11 Full-body creature/monster sprite bank — confirmed (banks `$40`-`$5F`)

Closes the long-open `snes-full-body-sprites` item (§3.7), which four
bounded checks across three prior sessions failed to find.

**Master table — file `0x200000` (CPU `$C0:8000`), 251 entries, 4 bytes each:**

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0x00` | 2 | `recordPtr` | CPU address (bank `$C0`) of a 7-byte pool record; always ≡ `0x83EC` (mod 7) |
| `+0x02` | 2 | `palOfs` | Byte offset into the **shared CGRAM colour-group table** (file `0x10764`, §3.3) — *not* a VRAM destination. Values `0x0000`-`0x2040` in multiples of `0x20`; see the palette section below |

> **Correction (re-oracle verification session):** the `+0x02` word previously
> documented as a "destination word" is a **palette offset**: `palOfs / 0x20`
> is a group index into the same 32-byte colour-group table the portrait bank
> (§3.3) and UI icon bank (§3.2b) use. Three entries (master slots 115, 237,
> 238 → records 49-51) carry `0x2040`, slightly above the previously claimed
> `0x2000` maximum — legal under the palette reading (group 258). Consecutive
> master slots sharing one pool record carry *consecutive* `palOfs` values
> (e.g. record 1 ← slots with `0x16A0/0x16C0/0x16E0`) — classic
> **palette-swapped monster families** sharing CHR.

Table length is self-describing: the lowest `recordPtr` value is `0x83EC`,
so the table occupies `$8000`-`$83EB` = 251 entries exactly. The 251 slots
reference **100 distinct** pool records.

**Record pool — file `0x2003EC` (CPU `$C0:83EC`), 100 records, 7 bytes each:**

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0x00` | 3 | `ptrA` | 24-bit LoROM pointer to the CHR resource |
| `+0x03` | 3 | `ptrB` | 24-bit LoROM pointer to the OAM/frame-list structure |
| `+0x06` | 1 | `flag` | `0x00` (98 records) or `0x03` (2 records) |

The pool ends exactly where the first resource begins (`0x2006A8` =
`0x2003EC` + 100x7), a byte-exact self-consistency check.

**Resource layout at `ptrA`:** `[u16 type][LZSS stream]`. The LZSS stream
starts at `ptrA+2` and uses the already-confirmed `$83:8000` codec (§3.8),
whose own header is the stream length. `type` ∈ {0,1,2,3,4} (50/3/42/3/2
records respectively).

**Verification (byte-exact structural invariant):** for 84 of 100 records,
`ptrB == ptrA + 4 + lzssHeaderLength` exactly — i.e. the frame-list
structure is stored immediately after the CHR stream. For the other 16 the
frame list lives elsewhere (notably records 44/45/46 share one CHR at
`0x250000` with three different frame lists, and 83/84 share `0x2A0000`).
**All 100 records decompress cleanly with zero overrun**, and every output
length is a whole number of 4bpp tiles: 8192 bytes (256 tiles) x91,
16384 (512 tiles) x8, 10240 (320 tiles) x1.

**Consumers — two, both confirmed by disassembly:**

- `0x05F61E`-`0x05F650` (CPU `$0A:F61E`): `LDA $85F1F8` → index;
  `AND #$00FF; ASL; ASL; TAX; LDA $C08000,X` → `recordPtr`;
  `LDA $C08002,X` → `dest`; then `LDA [$04],Y` at `Y=0` → `+0x02` giving
  the source address, which is **incremented by 2** (`ADC #$0002`) before
  `STA $00` — this is the disassembly proof that the LZSS stream starts at
  `ptrA+2`, skipping the `type` word. `Y=2` reads the bank byte into `$02`.
  `JSL $838000` at `0x05F64D`.
- `0x0072FF`-`0x0073B8` (CPU `$00:F2FF`): the same table, read the same way
  (`LDA $C08000,X` at `0x007318`), but this consumer reads **all** the
  record's fields — `Y=0`→`ptrA` low16, `Y=2`→`ptrA` bank, `Y=3`→`ptrB`
  low16 (then `+5`, stored to `$D0`/`$DF`), `Y=5`→`ptrB` bank, `Y=6`→`flag`
  (added to `$0E`). It calls `JSL $838000` at `0x0073B8`, then `MVN $7F,$7F`
  copies `0x2000` or `0x4000` bytes from `$7F:0000` to `$7F:4000+$3E`.
  The `ptrB+5` arithmetic confirms the frame-list structure has a **5-byte
  header** — matching the observed bytes (e.g. `0x2FEA5E`: `0a 74 40 60 98`
  then a chain of `[u16 nextPtr][4-byte OAM entries...][0xFF]` frames,
  where each `nextPtr` is self-referentially exact).

**Load-path details resolved (re-oracle verification session):** the apparent
discrepancy that consumer 2 stores `ptrA` *without* the `+2` type-word skip
into `$00` is resolved inside its helper `JSR $F58E` (file `0x758E`): that
routine reads the type word via `LDA [$00]` (`0x759B`), dispatches on
`type & 6` through a 3-entry jump table at file `0x75BF` (`$F5C5` for types
0/1, `$F60A` for 2/3, `$F617` for 4), and *then* performs `LDA $00; ADC
#$0002; STA $00` (`0x75AE`) before the `JSL $838000` — so the stream starts
at `ptrA+2` for both consumers. The same routine walks the frame chain at
`0x75F9`-`0x7607` (`LDA long $0000D0 → $04; LDA [$04],Y=0 → $D0` repeated N
times), which is the disassembly proof that **frame bytes 0-1 are a u16
next-frame CPU address (same bank)** and `$D0` is the current-frame pointer.
The 5-byte header unpacks (consumer 2, `0x735A`-`0x737C`) as: byte 0 →
`JSL $81E3F1` (the RNG — elsewhere used as `LDA #$64; JSL $81E3F1` d100
rolls) then `+1` → `$D3`, i.e. a **randomized start-frame count 1..byte0**;
bytes 1-4 → `$D7/$D9`, `$DA`, `$DB`, `$DC` (semantics still open). Chains
may **loop** (e.g. record 0's third frame's `nextPtr` points back at its
first) — animation cycles, so header byte 0 is best read as the cycle
length for the randomized entry point.

**Frame entry format — confirmed by render oracle:**
`[attr][tile][x][y]`, one per composed hardware sprite, `0xFF` terminator:

| Byte | Field | Notes |
|---|---|---|
| 0 | `attr` | bit 0 = tile bit 8; bit 1 = palette-row select (creature palettes are 2 CGRAM rows, see below); bit 4 = size (1 = 16x16, 0 = 8x8); bit 5 = h-flip; bit 6 = v-flip; bits 2-3, 7 unobserved (histogram over all 64,325 entries: only bits `0x01/0x02/0x10/0x20/0x40` ever set) |
| 1 | `tile` | low 8 bits of tile index into the decompressed CHR sheet (16 tiles/row, OBJ name-table layout: a 16x16 sprite uses `t, t+1, t+16, t+17`). Full index = `(attr & 1) << 8 \| tile`, taken **mod the sheet's tile count** for 256-tile records (the bit-8 values reflect the record's fixed staging half of the shared 512-tile OBJ space) |
| 2 | `x` | signed 8-bit pixel offset |
| 3 | `y` | signed 8-bit pixel offset |

All 100 records' chains parse cleanly under this scheme (every frame
`0xFF`-terminated, every `nextPtr` self-consistent, no entry overruns).
Composed figures reach ~250 px tall (record 61).

**Palette — solved (closes the palette sub-item).** Consumer 1, immediately
after decompression (`0x05F651`-`0x05F65E`): `LDX #$0140; LDY $40 (palOfs);
LDA #$40; JSL $8286A0` — the §3.2b shared palette-copy entry point, which
copies `A`=**64 bytes = two 16-colour BGR555 rows** from `$82:8764 + palOfs`
(file `0x10764 + palOfs`) to CGRAM shadow `$7E:3800 + 0x140`, then sets the
`$23` CGRAM-dirty bit. It then sets `$CA = 0x1E` (30), and the generic
CGRAM-DMA dispatch record for `$ca=30` (file `0x4162/0x4163/0x4165` arrays,
§3.3 method) reads `CGADD=$A0, src=$7E:3940, size=0x40` — byte-for-byte
matching the call's own operands. `CGADD $A0` = CGRAM colours 160-191 =
**OBJ palettes 2-3**: each creature gets two rows, and entry `attr` bit 1
selects the row — exactly SNES OAM palette semantics, independently
confirming the entries are OBJ metasprites. The palette region
`0x10764`-`0x127E3` (4,160 words) has **zero** words with bit 15 set (random
data would show ~50%), a decisive BGR555 invariant.

**Content (render oracle):** all 100 resources rendered as 4bpp tile sheets
(session scratchpad `bank40_contact.png`) show detailed full-body creature
artwork — dragons, insectoids, jellyfish, mushroom creatures, winged
figures, and at least one robed humanoid. **No dungeon architecture.**

**Decisive oracle (re-oracle verification session):** composing frames with
the entry format + palette above (scratchpad `w6snes/h3_r*.png`,
`compose311.py`) produces unmistakable, correctly-coloured full-body
figures with coherent animation frames: record 1 an **armoured knight**
(red tabard, green cape; sword-raised and arms-overhead poses), record 23 a
**pink jellyfish** with animated tentacles and ground shadow, record 43 a
**skeletal reaper** over green tentacles, record 61 a ~250 px **winged
purple demon**, record 92 a **horned red demon**, record 99 a wild-haired
**scythe wielder**, record 2 a cloaked wraith whose first two frames are
dither-patterned materialize-in frames (consistent with the randomized
start-frame mechanic). Record 40 (the 320-tile record) is fire/eruption
effect art rather than a creature.

> **Independently re-verified, twice (follow-up sessions).** Per
> `verify-escalation-artifacts-not-just-claims.md`:
>
> 1. **First pass** (re-`codebreaker` result): re-derived the master
>    table / record pool parse from scratch (fresh Python, not the
>    escalation's script) and independently confirmed: 251 master-table
>    entries resolve to exactly 100 distinct pool records, all congruent
>    mod 7 to pool base `0x83EC`; the pool's own end
>    (`0x2003EC + 100*7 = 0x2006A8`) equals the lowest resolved `ptrA` file
>    offset across all 100 records, byte-exact; all 100 records
>    LZSS-decompress cleanly to a whole number of 4bpp tiles (8192B x91,
>    16384B x8, 10240B x1 — exact match); and
>    `ptrB == ptrA + 2 + lzssStreamLength` (re-derived independently from
>    the `[u16 type][LZSS stream]` layout, not copied) holds for exactly
>    84/100 records, reproducing the escalation's own count.
> 2. **Second pass** (re-`oracle` result — the palette/pose format): hex-
>    dumped the cited consumer address (file `0x05f651`) by hand and
>    confirmed the disassembly claim byte-for-byte (`a2 40 01 a4 40 a9 40
>    22 a0 86 82` = `LDX #$0140; LDY $40; LDA #$40; JSL $8286A0`); cross-
>    checked the CGRAM-DMA dispatch record for `$ca=30` against the
>    already-confirmed 3-array formula (section 3.3) and got
>    `CGADD=0xA0, src=$7e:3940, size=0x40`, matching the call's own operands
>    exactly; independently confirmed zero BGR555 high-bit words across all
>    4,160 palette-region words; and — the decisive check — **wrote a
>    fresh, from-scratch frame-chain parser and palette-based compositor**
>    (never opened the escalation's own script) and rendered real posed,
>    coloured frames: record 1 is an unmistakable armoured knight (red
>    tabard, dark cape, sword raised), record 61 a winged purple demon,
>    record 92 a horned red demon — all matching the escalation's own
>    descriptions exactly, reproduced completely independently.
>
> Extractor **upgraded this session** (was raw greyscale tile sheets, now
> composed colour poses): `tools/wizardry6/snes/decode-creature-sprites.ts`
> renders each record's first animation frame via its real OAM entry list
> and confirmed palette, packed into one shelf-packed atlas — output:
> `public/assets/wizardry6/snes/sprites/creature-sprites.png`/`.json`. Each
> record's full `frameCount` and any palette-swap alternates
> (`palOfsAlternates`) are recorded in the JSON sidecar but not all
> rendered (only frame 0, one palette per record) — see the TODO row for
> what a fuller animation-atlas extractor would still need.

> **Second upgrade + `type` field decoded (2026-08-16, closes the
> remaining `snes-creature-sprite-details` sub-items):**
>
> - **All frames rendered**: the extractor now composes every record's
>   full animation chain — **3,701 frames across 100/100 records**
>   (`creature_NNN_fFF` atlas naming; chains are visited-guarded since
>   they legitimately loop). Spot-check renders: record 1's knight cycles
>   through spear-raised and arms-overhead attack poses; record 23's
>   jellyfish animates its tentacles — coherent through every frame.
> - **`type` semantics confirmed** (the `$00:F58E` dispatch's three
>   handlers, disassembled at file `0x75C5`/`0x760A`/`0x7617`): types
>   **0/1** = normal creature — screen position from a formation-slot
>   table at `$00:F3D8` (with a −2 rank adjustment when `$0871[$d5]==4`)
>   and a **randomized animation start phase** (`JSL $81E3DC` RNG, 0-15
>   `+0x10`, accumulated in `$0bea`, applied by walking the frame chain
>   that many hops); types **2/3** = position taken from the frame-list
>   **header bytes** instead (`$d8+X`, X from `$0e`) — which is what
>   §3.11's "header bytes 1-4, semantics open" bytes are for; type **4**
>   = fixed position `0xF0` (the effect-art records). The word table
>   directly after `$F617` (file `0x761E`: `0000 0040 0004 0048 ...`) is
>   the per-slot staging-offset array those positions index.

> **Correction to §3.7:** full-body monster/character sprites *do* exist in
> this ROM and are now located. The prior sessions' negative was
> methodological: every check looked for a directory resembling the
> portrait bank's, or for a `MVN`/DMA census hit, and this bank is reached
> through neither (a 4-byte indirection table into a 7-byte record pool,
> consumed via long addressing `LDA $C08000,X`).

### 3.12 Screen setup and VRAM layout — confirmed

The three background layers are shadowed in WRAM and DMA'd per frame under
dirty-flag control (`LSR $23` per layer) by the routine at `0x004034`:

> **Extended in §3.14.9.** `$23` is not just a per-layer flag byte — it is an
> 8-slot **DMA request word, one bit per DMA channel** (bit *N* ⇔ channel
> *N* for N = 0-6), and the dispatcher's real entry point is file
> `0x003f78`, not `0x004034` (which is the middle of the chain, bit 2's
> block). §3.14.9 has the full bit table, including bit 6 — the slot that
> uploads the first-person view. The three rows below are bits 2/3/4.

| WRAM shadow | Size | VRAM word | Layer |
|---|---|---|---|
| `$7E:2000` | `0x800` | `$7400` | BG1 tilemap |
| `$7E:2800` | `0x800` | `$7800` | BG2 tilemap |
| `$7E:3000` | `0x800` | `$7C00` | BG3 tilemap |

A bulk variant at `0x008037` uploads all three at once (`$7E:2000`,
`0x1800` bytes).

**Main gameplay screen** (`0x050260`-`0x050560`): `BGMODE=$09` (mode 1,
BG3 high priority), `BG12NBA=$24` (BG1 char base word `$4000`, BG2 `$2000`),
`BG34NBA=$06` (BG3 `$6000`), `BG1SC/BG2SC/BG3SC = $74/$78/$7C`.
The per-frame content upload at `0x0080DE`-`0x00814D` gives the layer roles
unambiguously:

| VRAM word | Size | Source | Role |
|---|---|---|---|
| `$4000` | 16384 | `$7F:0000` | BG1 chars — **512 4bpp tiles, the main picture layer** |
| `$2000` | 12512 | `$7F:4000` | BG2 chars — 391 tiles (**one-shot at screen load**; tiles 240+ are overwritten every frame by the view upload, §3.14.9) |
| `$6000` | 4096 | `$89:C653` | BG3 chars — the confirmed 256-tile dialogue font (§3.8/§4.3) |

So BG1 is a 512-tile picture layer whose CHR is staged at `$7F:0000` and
whose tilemap is CPU-composed into `$7E:2000`; BG3 is the text layer.

> **Correction — Mode 7 is *not* the dungeon-view mechanism.** A whole-ROM
> census of every Mode 7 register write (`$211A` M7SEL, `$211B`-`$211E`
> M7A-M7D, `$211F`/`$2120` M7X/M7Y) finds **exactly 9 sites, all inside the
> single contiguous span `0x068564`-`0x0685C4`**, which sits in the
> opening-sequence straight-line call chain (`0x068046`-`0x068992`). Mode 7
> is used by the title/opening sequence only and by nothing else in the
> ROM. `BGMODE` is written at 10 sites; the gameplay ones set mode 1
> (`$09`) and one screen sets mode 3 (`$03`, §3.13).

### 3.13 Cluster-B screen resources — resolved

The bank-`$0A` screen-setup routines each decompress one LZSS resource into
`$7F:0000` and then DMA slices of it to VRAM. Reading the DMA descriptor
chain gives each resource's internal layout exactly (every one of these
partitions its decompressed output with **zero leftover bytes**, a clean
structural check).

- **`0x05104b` — the main gameplay screen resource** (decompresses to
  `0x60C0` = 24768 bytes). Layout: `0x0000`+`0x300` → VRAM `$7860`
  (BG2 tilemap patch); `0x0300`+`0x100` → `$75C0` (BG1 tilemap patch);
  `0x0400`+`0x14C0` → `$2000` (BG2 chars, 166 tiles); `0x18C0`+`0x800` →
  `$4000` (BG1 chars, 64 tiles); `0x20C0`+`0x4000` → `$0000` (OBJ chars,
  512 tiles). Renders as an **outdoor night landscape** — a moon, clouds,
  a sea horizon and stippled foliage/rock texture. Not dungeon wall art;
  the prior session's "brick/checkerboard-hatch" reading was the foliage
  stipple.
- **`0x060000` — the ending screen** (decompresses to `0x8AE0` = 35552
  bytes; `BGMODE=$03`, `BG12NBA=$62`). Layout: `0x0AA0`+`0x700` → `$7800`
  (BG2 tilemap, 32x28); `0x11A0`+`0x600` → `$6000` (BG2 chars, 48 tiles);
  `0x17A0`+`0x7340` → `$2000` (BG1 chars, 461 **8bpp** tiles — mode 3's
  BG1 is 8bpp, which is why the prior session's 4bpp render looked like
  noise). Composing BG2 through its own tilemap renders a starfield with
  the words **"To Be Continued..."** — this is the game's ending screen
  (Wizardry 6 leads into Wizardry 7). BG1's tilemap is constant-filled at
  load and written dynamically at runtime.
- **`0x058000`** — a scrolling **space scene** (planets, a nebula, a planet
  surface): `0x0000`+`0xB40` → `$7460` (1440-entry tilemap, `BG1SC=$76`
  = 32x64 map); `0x0B40`+`0x2420` → `$4000` (BG1 chars, 289 tiles);
  `0x2F60`+`0xBE0` → `$0000` (OBJ chars). Composed render is a clean,
  coherent 256x384 image — this also independently validates the
  `[tilemap][chr]` composition method.
- `0x05A797`, `0x05428C`, `0x05718D` — Japanese text screen, menu/dialog
  frame graphics, and a small UI icon set respectively (prior session's
  readings, unchanged).

> **Both remaining screens extracted (2026-08-16, closes
> `snes-opening-screens-4-5-extras`):**
> - **`0x058000` space scene** — the "1440 entries don't cleanly factor"
>   puzzle resolves via the DMA destination itself: VRAM word `$7460` is
>   `0x60` words = **3 rows into** the `$7400` 32x64 map, and
>   `96 + 1440 = 1536 = 32*48` — the stored content is exactly **rows
>   3-47**, i.e. a 32x45 image. Composed (flip bits honoured) it renders a
>   complete 256x360 vertical space vista — nebula, three planets, dense
>   starfield, and a planet-surface horizon across the bottom. Decisive,
>   **confirmed**. `screens/space-scene.png`.
> - **`0x05104b` gameplay screen** — extracted as its two **stored tilemap
>   patches** (the honest static state, per §3.14.9's finding that the BG2
>   rect is runtime-overwritten while the first-person view is up): BG2
>   rows 3-14 (`screens/gameplay-sky.png` — a moon, a large planet, cloud
>   banks and mountain silhouettes: the outdoor sky band) and BG1 rows
>   14-17 (`screens/gameplay-bg1-strip.png`). BG2 patch **confirmed** by
>   render; no full-screen composite is possible from ROM alone (the base
>   tilemaps are CPU-composed at runtime, §3.12).
>
> Extractor: `decode-opening-sequence.ts` (`composeFlipped` — the new
> screens need the tilemap flip bits, which the logo/copyright composer
> never did).

### 3.14 First-person dungeon view composer — confirmed (`$03:E209`-`$03:E3B8`)

Closes the addressing half of `snes-dungeon-art-composer`. This is the SNES
analog of the Amiga port's `DrawMazePiece` + compose list
(`docs/wizardry6/amiga/data-structure.md` §4.1-§4.4) and answers how the
banks-`$10`-`$19` tile pool (§3.10) is selected and placed.

**The view is a software-rendered 18x15-tile bitmap, not a tilemap.** All
offsets below are file-relative unless written as `$bb:aaaa` (CPU).

| WRAM | Size | Role |
|---|---|---|
| `$7E:5000` | `0x21C0` (8640 B) | **View CHR buffer** — 270 4bpp tiles = 18x15 cells = 144x120 px |
| `$7E:3DE0` | `0x21C` (540 B) | **Occupancy array** — one u16 per cell, parallel to the above, init `$FFFF` |
| `$7E:4000` | `w*h` words | Per-piece linear staging buffer (one piece at a time) |
| `$7E:421C` | `$4c` bytes | **Compose list** — u16 piece words, `$4c` = byte cursor |

`$82:F810` (file `0x017810`) resets the view: `MVN` one 32-byte tile from
`$90:8040` to `$7E:5000`, propagate it over 8672 B, then fill `$7E:3DE0`+
with 270 words of `$FFFF`. Boot-time equivalent at file `0x00807B`.

#### 3.14.1 Grid geometry — confirmed

Two independent constants fix the grid, with zero deviation:

- Row-base table `$83:EB2C` (file `0x01EB2C`), 15 u16 entries: `0x0000,
  0x0240, 0x0480, … 0x1F80`. `rowTable[y] == y*576` holds **0/15
  violations**; 576 = 18 tiles x 32 B.
- The row-advance immediate `ADC #$0240` at `$03:E3A3` (file `0x01E3A3`)
  independently gives the same 576-byte row stride.
- `15 * 576 = 8640` = exactly the `$7E:5000` buffer size.

Destination byte offset for cell `(x,y)`, computed at `$03:E2F6`-`$03:E30E`:

```
destByte = x*32 + rowTable[y]          ; ASL x5 ; ADC $EB2C,X  (X = y*2)
cellWord = destByte >> 4               ; LSR x4 -> $08 = byte index into
                                       ;   $7E:3DE0 / $7E:4000 (= (y*18+x)*2)
```

#### 3.14.2 Cell word — confirmed (`$03:E336`-`$03:E34D`)

Each u16 in a piece's payload is a **direct reference into the ROM tile
pool**, not a VRAM tilemap entry:

| Bits | Field | Derivation |
|---|---|---|
| 0-9 | `tile` | `AND #$03FF`; `ASL` x5 then `ORA #$8000` → CPU offset `$8000 + tile*32` |
| 10-13 | `bankSel` | high byte `AND #$3C`, `LSR` x2, `ORA #$90` → source bank `$90`-`$9F` |
| 14 | unused | not read by the blitter |
| 15 | `hasAlpha` | set = tile contains transparent pixels, later pieces may still draw behind it |

Source file offset = `(bank & 0x7F) * 0x8000 + tile * 32`. Bank selectors
0-9 give `$90`-`$99`, the mirrors of the confirmed dungeon-art pool banks
`$10`-`$19` — 10 banks x 1024 tiles = the 10,240-tile pool of §3.10 exactly.

#### 3.14.3 Piece record — confirmed

Libraries are u16 pointer tables at file `0x208000` (`$C1:8000`) and
`0x210000` (`$C2:8000`); a compose-list word is a **byte offset** into its
table, with bit 15 selecting `$C2` (`AND #$7FFF` first).

| Offset | Size | Field |
|---|---|---|
| `+0x00` | 1 | `x` — destination column (0-17) |
| `+0x01` | 1 | `y` — destination row (0-14) |
| `+0x02` | 1 | `w` — width in cells |
| `+0x03` | 1 | `h` — height in cells |
| `+0x04` | 2/6 | optional `$FFFE`,`[strideLo\|startHi]`,`newPtr` or `$FFFF`,`newPtr` |
| … | `w*h*2` | cell words, `stride` extra bytes per row |

> **Correction (this session): the `0xFFFE`-redirect shape is now fully
> confirmed by disassembly**, not a hypothesis. Full trace:
> `$03:E25A`-`$03:E2EC` (file `0x01e25a`-`0x01e2ec`) is the routine that
> resolves one compose-list entry into piece cells (reads the list word at
> `$7E:421C,X`, masks bit 15 to pick `$C1`/`$C2`, indexes the table, then
> handles the marker at record `+4`). The two-byte marker checks are
> `$03:E29D` (`C9 FE FF` = `CMP #$FFFE`) and `$03:E2AC` (`C9 FF FF` =
> `CMP #$FFFF`), both unique whole-ROM hits when censused as 16-bit
> immediates — file offsets `0x1e29d`/`0x1e2ac`, squarely inside the
> already-confirmed composer body range.
>
> For the `0xFFFE` case, the word at record `+6` is read into DP `$06`/`$07`
> (`$03:E2A4`), then **split**: `$03:E2BC`-`$03:E2BE` copies the **high
> byte** (DP `$07`) into `Y` *before* the column loop starts (`LDA $07;
> TAY`) — this is the cell-array **starting byte offset**, letting a piece
> begin mid-row/mid-column of a wider shared source. `$03:E2BF` then zeroes
> DP `$07` (`STZ $07`), so the later per-row `ADC $06` at `$03:E2E2`
> (`TYA; CLC; ADC $06; TAY`, run once after each row's column loop) only
> ever adds the **low byte** — an *extra* stride on top of the `w*2` bytes
> the column loop already consumed walking that row's own `w` cells.
> I.e. `sourceRowWidthCells = w + (word & 0xFF)/2`, and the piece's first
> cell sits `(word >> 8)` bytes = `(word >> 8)/2` cells into that row.
>
> This refutes the prior "constant 6 bytes/row, startHi/strideLo
> unresolved" hypothesis outright: across all 134 `0xFFFE` records, the
> low byte (the real per-row stride) takes at least 8 distinct values
> (2, 4, 6, 8, 10, 18, 20, 22 bytes) — only 9/134 records happened to have
> the literal value the old hardcoded guess used, so the other 125/134
> (93%) were rendering with the wrong cell offsets before this fix.
>
> **Verified structurally**: of the 65 distinct shared-`newPtr` redirect
> targets, 63 are referenced by more than one record (132/134 records);
> grouping by `newPtr` and shape (`w`,`h`), **every group implies a single
> self-consistent source row width** (`w + strideLo/2`) across all its
> members — the one apparent exception on a first pass turned out to be
> two independently-consistent subgroups (a depth-2 and a depth-3 piece
> pair) sharing one `newPtr` coincidentally, not a real violation. Mirrored
> left/right piece pairs (e.g. table `$C1` index 317 at viewport `x=15`
> vs. index 322 at `x=0`, both `newPtr=0x97FE`, `w=3,h=5`) decode to
> physically sensible mirrored sub-windows of the same 4-cell-wide shared
> source (`startOfs=0` reading cells 0-2 vs. `startOfs=2` reading cells
> 1-3) — exactly the "mirrored crop of a shared texture" shape the
> pre-correction prose speculated but never proved. A before/after
> comparison of one record's decoded cell words (table `$C1` index 317)
> shows the corrected read producing a clean, structurally coherent
> repeating pattern (the same tile repeated down 4 of 5 rows, consistent
> with a uniform masonry/shadow column) where the old hardcoded-6 read
> produced scrambled, inconsistent values row to row.
>
> Extractor `tools/wizardry6/snes/decode-dungeon-composer.ts` implements
> this; all 134 `0xFFFE` records are now marked `confidence: "confirmed"`
> in the sidecar JSON (previously `"hypothesis"`). Structural invariant
> unchanged and re-verified after the fix: 1893/1893 records still fit the
> 18x15 viewport, 0 violations; pool cross-check 23,477/24,545 (95.6%).

#### 3.14.4 Painter's algorithm — confirmed (`$03:E31F`-`$03:E3B8`)

Pieces are drawn **near-to-far**; the occupancy array clips them, so each
piece can be authored as a complete trapezoid:

```
for each cell of the piece:
    word = staging[$7E:4000 + i]
    if word == 0:            continue          ; BEQ $E388 — transparent cell
    old = occ[cellIndex]
    if (old & 0x8000) == 0:  continue          ; BPL $E386 — cell already opaque
    occ[cellIndex] = word                      ; STA $3DE0,X
    if (old >> 8) == 0xFF:   copy 32 bytes     ; still empty -> opaque tile copy
    else:                    merge behind      ; JSR $E3B9 — per-bitplane, only
                                               ;   where dest pixel is still 0
```

The merge routine at `$03:E3B9` masks `$8080`, `$4040`, `$2020`, `$1010`,
`$0808`, `$0404`, … across the tile's two plane pairs (`$5000,Y` and
`$5010,Y`), i.e. per-pixel "draw only where transparent".

#### 3.14.5 Compose-list construction — confirmed structure

`$03:E223` is the dungeon-view entry: it computes a floor/ceiling parity
flag `(($0906 ^ $0908 ^ $0904) & 1) * 2` into `$8e` (party X ^ Y ^ facing),
calls `$80:C69F` to build the list, then `$82:F810` to clear the view.

`$80:C69F` (file `0x00469F`) walks **26 frustum slots**. Party position is
`$0906` (X), `$0908` (Y), `$0905` (level), `$0904` (facing); the map cell
address is `$50 = 0xC8 + 24*($a8+7-$0906) + ($0908-$aa)`, and maze cells are
read from `$7E:4540`. Per slot it dispatches through a 26-entry handler
address table at `$80:C829` (file `0x004829`, indexed `slot*2`) via
`JMP ($0000)` at `$80:CD07`.

Each handler supplies a **per-depth piece-index table base in bank `$89`**
(bank byte `#$89` set at file `0x004709`). `$80:CC40`/`$80:CC72` look up
`table[wallValue]` and append it to the compose list:

```
LDX $4c ; STA $7E421C,X ; INX ; INX ; STX $4c      ; $80:CC65-$80:CC6D
```
with `$FFFF` meaning "emit nothing".

The tables form a clean perspective series (**depth is encoded by position
in the table**, exactly as on the Amiga):

| Element | depth 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Front (facing) wall | `$89:EB1A` 12x9 @(3,2) | `$89:EC04` 8x6 @(5,3) | `$89:ECEE` 6x5 @(6,3) | `$89:EE74` 4x3 @(7,4) | `$89:F096` 2x2 @(8,4) |
| Left side wall | `$89:EB68` 3x9 @(0,2) | `$89:EC52` 5x6 @(0,3) | `$89:EDD8` 2x5 @(0,3) | `$89:EFFA` 2x3 @(0,4) | `$89:F1CE` 2x2 @(0,4) |
| Right side wall | `$89:EBB6` 3x9 @(15,2) | `$89:ECA0` 5x6 @(13,3) | `$89:EE26` 2x5 @(16,3) | `$89:F048` 2x3 @(16,4) | `$89:F306` 2x2 @(16,4) |

(bank `$89` → file `0x48000 + (addr - 0x8000)`; e.g. `$89:EB68` = file
`0x04EB68`.) Left and right tables are exact mirrors (`x = 0` vs
`x + w = 18`) and sit 0x4E bytes apart. A further ~30 tables cover the
intermediate lateral columns at `x = 1,2,4,6,10,12,13,14,16`.

> **All of those tables are now catalogued** — §3.14.12's handler table
> lists every slot's art-record address (44 distinct tables incl. the
> per-depth receding-edge `F3xx`/`F7xx`/`F8xx` families and slot 0's
> own-cell `F356`/`F6C6`), and the "table = one entry per wallValue"
> reading is refined there (39-word records, word index = code + variant
> offset via `$80:DE4E`).

#### 3.14.6 Verification — quantified

- **Structural invariant, zero deviation:** every piece must fit the 18x15
  viewport (`x+w <= 18`, `y+h <= 15`). Library `$C1` is self-describing
  (first pointer `$89DE` ⇒ `(0x89DE-0x8000)/2 = 1263` entries, matching the
  observed count): **1263/1263 records parse and 1263/1263 fit, 0
  violations**. Library `$C2` over its 630 non-null entries: **630/630 fit,
  0 violations**. Combined **1893 records, 0 violations**.
- **Pool cross-check:** 27,271 of 28,792 non-zero cell words (94.7%)
  resolve to banks `$90`-`$99` — the §3.10 pool — the remainder to `$9C`-`$9F`
  (the §4.4 font banks, used for text overlaid in the view).
- **Render oracle (decisive):** composing piece `$8216` (`$C2` index 267)
  through the recovered structure produces a complete, legible first-person
  dungeon view — a carved stone portal with an interlace-knotwork lintel,
  flanking pilasters, two ornate standing wall-torches, ashlar masonry side
  walls and a checkerboard-tiled floor receding in perspective. Composing
  the depth-0/1 side-wall tables plus the full-view wall backdrop `$823E`
  renders a coherent dead-end corridor (270 cells drawn, 114 clipped by the
  occupancy test) with mortar courses continuous across piece boundaries.

> **Independently re-verified (follow-up session).** Per
> `verify-escalation-artifacts-not-just-claims.md`:
>
> 1. **Disassembly spot-check.** Hand-extracted raw bytes at every cited
>    address directly from the ROM (not via the escalation's own tooling)
>    and decoded them by hand: `$82:F810` (file `0x017810`) is
>    `PHB; REP #$20; LDX #$8040; LDY #$5000; LDA #$001F; MVN $7E,$90` (the
>    32-byte tile copy) followed by a second `MVN $7E,$7E` with
>    `LDA #$21BF` (8640-byte self-propagate) — matches the doc's MVN
>    operand-order convention and reproduces the 8672-byte total-touched
>    figure exactly (32 + 8640, with the boundary arithmetic working out
>    byte-for-byte, not just approximately). The row-base table at file
>    `0x01EB2C` decodes to `0, 576, 1152, …, 8064` — `rowTable[y]==y*576`
>    holds 0/15 violations, reproduced independently. The cell-word decode
>    at file `0x01E336` (`AND #$03FF; ASL x5; ORA #$8000` then, after
>    `SEP #$20`, `AND #$3C; LSR x2; ORA #$90`) matches byte-for-byte. Most
>    decisively, the two painter's-algorithm branch instructions' *target
>    addresses*, recomputed from their raw displacement bytes rather than
>    trusted from prose (`f0 64` at file `0x01E322` → target `0x01E388`;
>    `10 55` at file `0x01E32F` → target `0x01E386`), reproduce the doc's
>    cited `$E388`/`$E386` exactly — branch-target arithmetic is very hard
>    to get right by accident, so this is strong confirmation the citations
>    are real, not plausible-looking approximations.
> 2. **Fresh re-derivation of library `$C2`'s table length.** The
>    self-describing trick that gives `$C1`'s length (1263, from its first
>    entry) does *not* generalize to `$C2` when applied naively (gives 980,
>    wrong). Independently walked the raw `$C2` pointer stream by hand and
>    found where it stops looking like valid ascending CPU addresses — the
>    breakdown happens exactly at table index 632, after which the "values"
>    are small, non-monotonic, and include several `< 0x8000` (i.e. actual
>    piece-payload bytes being misread as more table entries). This
>    independently reproduces the escalation's 632-slot / 630-non-null
>    count without having read its own derivation.
> 3. **Structural invariant, reproduced independently.** A fresh Python
>    parser (never opened the escalation's own scripts) walking both
>    libraries with the table lengths above gets **1263/1263 (`$C1`) and
>    630/630 non-null (`$C2`) records fitting the 18x15 viewport, 0
>    violations combined across 1893 records** — exactly reproducing the
>    escalation's own numbers from a fresh implementation.
> 4. **Decisive render, reproduced pixel-exact.** A from-scratch Python
>    4bpp tile decoder + record parser, rendering library `$C2` index 267
>    (the full-viewport "backdrop" piece), reproduces the same described
>    image (stone portal, knotwork lintel, twin standing torches, ashlar
>    masonry, checkerboard floor) — visually confirmed by inspection. Once
>    the finding was promoted to a committed TypeScript extractor
>    (`tools/wizardry6/snes/decode-dungeon-composer.ts`), the two
>    independent renders were diffed pixel-by-pixel: **0 mismatches across
>    17,280 pixels** (144x120, RGBA).
> 5. **Pool cross-check, reproduced in the same shape.** The committed
>    extractor's own run reports 23,471/24,544 non-zero cell words (95.6%)
>    resolving into the confirmed dungeon-art pool banks `$90`-`$99`, the
>    remainder into the confirmed font banks (`$9C`-`$9F`) plus a smaller
>    share of bank `$9A` (mirrors ROM bank `$1A`, "framed-picture art +
>    dense pattern/texture tiles" per §3.10 — plausible additional view
>    content, e.g. floor/ceiling texture, not previously called out by the
>    escalation but not inconsistent with its finding either) — same
>    overwhelming-majority shape as the escalation's own 94.7% figure, exact
>    percentage differing slightly because the committed extractor fully
>    implements the `0xFFFE`/`0xFFFF` redirect-record cell resolution (see
>    §3.14.3 note below) where an earlier, cruder verification pass did not.
>
> One correction to §3.14.3 (as it read at the time): the `0xFFFE`-redirect
> shape's exact `startHi`/`strideLo` bit semantics were **not**
> independently re-derived this session — the committed extractor
> implemented the constant-6-bytes-per-row reading straight from the
> pre-existing §6.5 prose as a **hypothesis**, flagged per-record in the
> JSON sidecar's `confidence` field (134/1893 records, 7%; the other
> 1759/1893 — plain records and the simpler `0xFFFF` redirect — were
> confirmed). This did not affect any of the invariant/render verification
> above, which used plain records only.
>
> **Superseded (follow-up session): now fully confirmed by disassembly.**
> See the correction block at the top of §3.14.3 — the field is not a
> constant, it's `[strideLo][startHi]` read directly from the record and
> used to seed/advance the source cursor; all 134 records are now
> `confidence: "confirmed"`.

#### 3.14.7 Maze cell format and frustum evaluator — confirmed (this session)

Closes the "cell value / offset table" half of `snes-dungeon-view-render`.
This is the SNES analog of the Amiga port's `EvalCellFace`
(`docs/wizardry6/amiga/data-structure.md` §4.7.2) — the mechanism that
decides, for a given frustum slot and facing, which wall/feature code
`$80:C69F` looks up in the per-depth bank-`$89` piece tables (§3.14.5).

> **Correction to §3.14.5's TODO citation**: the "`$80:D700` per-slot/
> facing offset table" named in a prior session's `TODO.md` row does not
> exist at that address — `$80:D700` is mid-instruction inside an
> unrelated routine and was never backed by a disassembly citation in this
> file (caught per `tracker-prose-is-not-evidence.md`, chasing the
> Evidence pointer before building on it). The real table is at
> **`$80:DD4B`**, derived and disassembly-confirmed below.

All addresses below are disassembly-confirmed this session with a
flag-aware linear 65816 disassembler (`dis65816.py`, session scratchpad,
per `r2-snes-flag-width-blind.md`), hand-verified against raw ROM bytes.

**WRAM layout — five parallel 24x24 (576-cell) arrays**, one byte per
cell, row-major, row stride 24:

| WRAM | Role | Confidence |
|---|---|---|
| `$7E:4300` | packed wall-type field, 4x 2-bit sub-fields per byte (below) | confirmed |
| `$7E:4540` | feature/orientation byte (below) | confirmed |
| `$7E:4780` | secondary feature byte (per-cell, role not decoded) | confirmed (location only) |
| `$7E:DBC0` | fourth parallel array, role not decoded | confirmed (location only) |
| `$7E:AC00` | scripted-trigger overlay flag (below) | confirmed (mechanism), rendered (semantics) |

**`$7E:4540` cell byte — confirmed** (`$80:CD6F`-`$80:CDA5`, file
`0x004d6f`-`0x004da5`):

```
raw = mem[$7E:4540 + cellIndex]
if raw >= 0xC0: (top-bit marker, masked off below regardless)
wallValue = raw & 0x3F          ; AND #$3f, $80:CD7D
if wallValue == 0: no feature
orientation = wallValue & 0x30  ; bits 4-5, 2-bit compass-relative value
feature     = wallValue & 0x0F  ; bits 0-3, 0-15
if feature == 6:                 ; door special case
    if currentSlot == 3: append a fixed door piece (word 0x02E8)
    feature -> treated as empty (0)
elif orientation == <facing-relative constant in $42> and feature < 13:
    Y = feature + 3               ; promotes into the same table as below
```

`0x0D`/`0x0E`/`0x4E` recur throughout unrelated movement-logic code (file
`0x00176B`, `0x0023xx`-`0x0024xx`) as explicit `CMP` sentinels for "no
feature here" — matches the per-level default-seed table `$80:DB8D`
(below), whose 14 entries are almost entirely `0x0D`/`0x0E`.

**`$7E:4300` cell byte — confirmed, 4 packed 2-bit wall-type fields**
(`$80:CD36`-`$80:CD68`, file `0x004d36`-`0x004d68`). Each byte holds one
2-bit wall-type value (0-3) per **rotation-relative** direction:

| Bit range | Handler | Extraction |
|---|---|---|
| 0-1 | `$80:CD36` | `AND #$03` |
| 2-3 | `$80:CD42` | `AND #$0C`, `LSR` x2 |
| 4-5 | `$80:CD4E` | `AND #$30`, `LSR` x4 |
| 6-7 | `$80:CD5A` | `LSR` x6 |

Which field applies for "current facing" (`$52`), "+90°" (`$54`), "+180°"
(`$56`), "+270°" (`$68`) is selected by a **4-entry rotation table**
(disassembled at file `0x004d28`-`0x004d36`, period-4 array `{$CD5A,
$CD36, $CD42, $CD4E}` read with a sliding `Y=facing*2` window against 4
base addresses 2 bytes apart — the same "shared sliding-window table"
trick used elsewhere in this ROM). This is the SNES's replacement for
Amiga's shared-edge two-plane-plus-neighbour-lookup scheme (§4.7.2): all
4 sides are stored redundantly per cell here, so no neighbour-cell read is
needed at render time — a materially different but functionally
equivalent design choice, confirmed structurally (not just by analogy).

The extracted 2-bit field (or, if `$7E:4540`'s feature/orientation check
above matches, `feature+3` instead) indexes **`$80:DE1B`**
(`Y = field | (feature+3)`, `LDA $DE1B,Y`), a 16-entry byte table (raw
bytes: `00 00 00 02 00 00 04 04 04 04 00 02 04 00 18 18`) whose output
feeds `$80:CC40`/`$80:CC72`'s existing table-index lookup (§3.14.5) —
the exact final field-to-`wallValue`-index arithmetic downstream of this
point was not re-traced to full closure this session (see paths-tried).

> **Now fully closed — see §3.14.12.** `$80:DE1B`'s output is not the
> table index at all: it is the **second-draw selector** (`$42`) for an
> *additional* piece drawn after the main one (e.g. `DE1B[3] = 2` gives
> wall value 3 its doorway frame under the closed-door leaf). The main
> index is simply `word = record[DE4E[(code*2 + variant) & 0xFE]]`, i.e.
> word index = code for variant 0. Also corrected there: this section's
> earlier note that "`$80:D700` does not exist at that address" was wrong
> — `$DD4B` is the frustum table, but `$80:D700` is a real, separate
> 6-word facing-rotated far-side-cell delta table used by the resolver.
> And the `0x0D`/`0x0E` "no feature" sentinels are now identified as
> **floor/ceiling style selectors** (§3.14.12's floor/ceiling pass).

**Frustum offset table — confirmed, decisive structural match**
(`$80:DD4B`, file `0x005d4b`, 26 signed i16, LE): per-slot cell offset
added to the party's base cell `$50` (`$80:CDF0`, `X = table[$58] + $50`,
`$58` steps `+2` per slot). Raw values: `-1, +1, -24, -25, -23, -48, -49,
-47, -72, -50, -46, -73, -71, -96, -74, -97, -70, -95, -75, -98, -69,
-94, -99, -100, -93, -92`. Decomposing each as `depth*(-24) + lateral`
(row stride 24 = confirmed elsewhere, §3.14.1) gives **exactly** the
classic expanding first-person frustum, zero deviation:

| Depth | Lateral offsets | Slot count |
|---|---|---|
| 0 | -1, +1 | 2 |
| 1 | -1, 0, +1 | 3 |
| 2 | -2, -1, 0, +1, +2 | 5 |
| 3 | -3, -2, -1, 0, +1, +2, +3 | 7 |
| 4 | -4, -3, -2, -1, 0, +1, +2, +3, +4 | 9 |

`2+3+5+7+9 = 26` — matches the slot count exactly, and matches §3.14.5's
independently-confirmed 5-depth front/left/right piece-table series
one-for-one (depth 0 has no centre slot because the straight-ahead
backdrop is drawn by a separate always-present piece, not through this
per-slot mechanism). This is strong, self-verifying confirmation of the
whole per-slot dispatch model.

**Level initialization — confirmed** (`$80:D2D3`-`$80:D332`, file
`0x0052d3`-`0x005332`): on level load, all five arrays above are
uniformly seeded and self-propagated (`MVN $7e,$7e`, one seed byte/word
+ an `N-1`-length self-copy, `1+575=576` or `2+574=576` bytes) from tiny
per-level scalar tables:

- `$80:DB7F` (14 bytes, one per level: `80 80 00 20 20 80 80 80 80 80 80
  40 80 40 80`) seeds `$7E:4780` and also feeds a floor/ceiling-variant
  flag (`$0E`/`$BB`) used elsewhere in `$80:C69F`.
- `$80:DB8D` (14 bytes: `0D 0E 0E 0E 0D 0E 0D 0E 00 0E 00 0E 4F 0E`) seeds
  `$7E:4540` — almost entirely the confirmed "empty" sentinels `0x0D`/
  `0x0E`, with levels 8 and 10 (0-indexed) defaulting to `0x00` (a real
  feature code, not empty) and level 12 to `0x4F` — plausibly special
  level types (fully-enclosed arena, unique encounter).
- `$7E:4300` and `$7E:DBC0` are seeded uniformly to `0x00`.

A second, **region-shaped** default-fill routine (`$80:D450`-`$80:D49D`,
file `0x005450`-`0x00549d`) then overlays per-region uniform fills: a
per-level record list at `$80:D510` indexes (via `$80:D49C`, an
absolute-pointer-minus-base trick) into 4-byte records at `$80:D4B6`
(`[startCellIndex][rowCount][cellsPerRow][pad]`), each describing one
rectangular region within the 24-wide grid that gets uniformly reset to
`0x00`/`0x0D` — this is the SNES analog of Amiga's 12 8x8-region
placement table (§4.7.3's `+0x1e0`/`+0x1ec` origin arrays), just with
one flat 24-wide grid instead of Amiga's per-region-origin indirection.

**Runtime wall mutation — confirmed** (file `0x001446`-`0x00145b`):
`AND`s a facing-indexed 2-bit clear-mask (table `$80:9501`) into
`$7E:4300,X` and immediately calls `JSL $80:C69F` to rebuild the compose
list — a scripted "open a wall segment" primitive, directly analogous to
Amiga's runtime-mutable `SetBitField` (§4.7.3). One call site found (an
inline scripted trigger, not a generalized reusable primitive with its
own calling convention).

**Scripted per-cell trigger scanner — confirmed** (**`$82:D245`-`$82:D2AA`,
file `0x015245`-`0x0152aa`**; sole caller `$80:C69F` itself, file
`0x004705`, immediately after computing `$50`). Reads a per-level
indirect-long record list (bank fixed via DP `$02=$82`, the same
"DP holds the bank byte" convention used for the bank-`$89` piece
tables), 5 bytes/record, terminated by `0xFF`:

```
[localCoord: u8][facingOrFF80: u8][cellOffset: i16][value: u8]
```

`localCoord` is matched against `$42 = ((partyY - originY[idx]) << 4) |
(partyX - originX[idx])` (computed by the sibling `$80:D2B6`, per-region
origin tables at `$80:D78E`/`$80:D790` indexed the same way as the
region-fill mechanism above); `facingOrFF80` is matched against `$0904`
unless its top bit is set (wildcard). On a match, `value` is written to
`$7E:AC00[$50 + cellOffset]` and the scan stops (only the party's own
current cell/facing is checked, once per view-rebuild — not evaluated
per frustum slot). This is a genuine, ROM-resident, ***per-level, sparse,
scripted*** content table — the clearest evidence found this session that
individual dungeon content (likely message/trap/torch/door-reveal
triggers, not general wall geometry — see §3.14.8) is data-driven rather
than baked into code, even though it isn't a *bulk* per-cell array.

> **Correction (bulk-maze-source escalation, `re-codebreaker`) — this
> scanner's bank was wrong, and the error is what hid the bulk loader.**
> The address range was previously written as `$80:D245`-`$80:D2AA` /
> file `0x005245`-`0x0052aa`. The `$7E:AC00` scanner is really in bank
> **`$82`** (the doc's own prose already said "bank fixed via DP
> `$02=$82`", and the paths-tried table already carried the correct file
> offset `0x015254`) — the only `STA $7EAC00` anywhere in the ROM is at
> file `0x015250` = `$82:D250`; a whole-ROM census finds no `$7E:AC00`
> store in bank `$80` at all. File `0x005245`-`0x0052aa` is a **different
> routine that happens to share the low address `D245`**: it is the tail
> of the per-region maze blitter `$80:D25B` (§3.14.8) plus an automap
> bit-setter at `$80:D295` (`ORA $7EE6C0,X; STA $7EE6C0,X`). The prior
> session therefore disassembled the bulk loader it was searching for and
> recorded it as the trigger scanner. Same class as
> `game-re-tooling/snes.md`'s "a file offset `>= 0x8000` is never bank
> `$00`" bullet: a bank-`$80` mirror label was attached to a bank-`$82`
> routine, and nothing about the low 16 bits flags the mistake.

#### 3.14.8 Bulk per-level maze table — confirmed (`$86:8000`, file `0x030000`)

Closes `snes-maze-wall-source`. **The SNES port does store its dungeon
geometry as passable data**, in a flat 14-record ROM table — hypotheses
(1) and (2) of the previous session's "what remains open" note are both
refuted. All of it is byte-verified against the Amiga port's
`scenario.dbs` section 2 (§4.7.3 of `amiga/data-structure.md`).

**ROM tables**

| What | File offset | CPU | Size | Confidence |
|---|---|---|---|---|
| Per-level maze records | `0x030000`-`0x0353FF` | `$86:8000`+ | 14 × 1536 B | confirmed |
| Per-level region-origin table | `0x00578E`-`0x005A2D` | `$80:D78E` | 14 × 12 × 4 B | confirmed |
| Phase-2 patch pointer table + records | `0x05DFB4`-`0x05E274` | `$8B:DFB4` | 28 B + 166 × 4 B | confirmed |
| Phase-2 bit-mask table | `0x05DFAC` | `$8B:DFAC` | 8 B (`01 02 04 … 80`) | confirmed |
| Phase-3 patch pointer table + records | `0x065C5A`-`0x065E49` | `$8C:DC5A` | 28 B + 91 × 5 B | confirmed |

**Maze record layout (1536 B/level, stride confirmed by the loader's own
`level*6` → `XBA` arithmetic).** 96 blocks of 16 bytes; block *i* holds
cells `8i … 8i+7`:

| Offset in block | Size | Field |
|---|---|---|
| `+0x0` | 8 | **feature/orientation** bytes (→ `$7E:9D00` → `$7E:4540`) |
| `+0x8` | 8 | **wall** bytes (→ `$7E:9A00` → `$7E:4300`) |

i.e. two 768-byte planes interleaved at 8-byte granularity.
`cellIndex = region*64 + major*8 + minor`, region `0-11`, exactly the
Amiga's `region*64 + localY*8 + localX` with the **major axis reversed**
(SNES `major` = Amiga `7 - localY`) — the same reversal that appears as
the `$a8 + 7 - $0906` term in `$80:C69F`'s `$50` formula (§3.14.5).

**Loader — `$8B:DE64` (file `0x05DE64`), one caller: `$80:D073` (file
`0x005073`).** Phase 1, the bulk copy:

```
$8B:DE64  AD 05 09     LDA $0905          ; level
$8B:DE67  8D 02 42     STA $4202          ; WRMPYA
$8B:DE6A  A9 06        LDA #$06
$8B:DE6C  8D 03 42     STA $4203          ; WRMPYB  -> level*6
$8B:DE6F  A2 00 00     LDX #$0000
$8B:DE76  AD 16 42     LDA $4216          ; product low byte
$8B:DE79  EB           XBA                ; *256   -> Y = level*1536
$8B:DE7A  A8           TAY
$8B:DE7C  A9 86 48 AB  LDA #$86; PHA; PLB ; DBR = $86  (ROM file 0x030000)
$8B:DE80  C2 20        REP #$20
$8B:DE82  B9 00 80     LDA $8000,Y        ; feature words
$8B:DE85  9F 00 9D 7E  STA $7E9D00,X
$8B:DE89  B9 08 80     LDA $8008,Y        ; wall words
$8B:DE8C  9F 00 9A 7E  STA $7E9A00,X
$8B:DE90  C8 C8 E8 E8  INY INY INX INX
$8B:DE94  8A 29 07 00  TXA; AND #$0007
$8B:DE98  D0 E8        BNE $DE82          ; 4 iterations (8 dest bytes)
$8B:DE9A  98 18 69 08 00 A8   TYA; CLC; ADC #$0008; TAY   ; skip the other plane
$8B:DEA0  E0 00 03     CPX #$0300         ; 768 = 12 regions x 64 cells
$8B:DEA3  D0 DD        BNE $DE82
```

Phase 2 (`$8B:DEAB`-`$8B:DEDF`) and phase 3 (`$8B:DEE0`-`$8B:DF72`) then
apply **quest-flag-conditional cell overrides** onto the 1536-byte
staging block (`$7E:9A00`-`$7E:9FFF`, wall at `+0`-`+767`, feature at
`+768`-`+1535`). Both are per-level lists reached through a 14-entry u16
pointer table whose values are byte offsets *relative to the pointer
table's own base*:

> **Fully disassembled this session** (`$8B:DEAB`-`$8B:DEDF`, file
> `0x05deab`-`0x05dedf`; `$8B:DEE0`-`$8B:DF72`, file `0x05dee0`-`0x05df72`;
> the two shared condition helpers `$8B:DF74`/`$8B:DF90`, file
> `0x05df74`-`0x05dfb4`) — closes the "not yet decoded by the extractor"
> gap noted below. Both record layouts and every offset/count below were
> re-derived from raw ROM bytes and cross-checked against the
> pre-existing structural invariant (166 phase-2 / 91 phase-3 records,
> every offset `< 1536`) — exact match, confirming both the byte layout
> and the terminator conditions. Implemented in
> `tools/wizardry6/snes/decode-maze.ts` (`patchesPhase2`/`patchesPhase3`
> per level in `data/maze.json`); **not** baked into the rendered maps —
> see below for why.

- **Phase 2**, 4-byte records `[condFlag][value][offset u16]`, `0x00`
  terminator: `if flagBit(cond) then staging[offset] = value` (`STA
  $7E9A00,X` with `X=offset`; since wall is `+0`-`+767` and feature is
  `+768`-`+1535` immediately after it in the same 1536-byte block, one
  base address serves both planes — an offset `>= 768` lands in the
  feature array automatically, no separate branch needed). The condition
  test `$8B:DF90` splits `cond` into `bitmask[cond & 7]` (table
  `$8B:DFAC`, confirmed bytes `01 02 04 08 10 20 40 80`) and byte
  `$00:09C0 + (cond >> 3)` — the global quest-flag bitmap. `cond == 0` is
  reserved as the terminator here, so every real phase-2 record is
  genuinely conditional (can be skipped).
- **Phase 3**, 5-byte records `[cond][wallMask][featValue][offset u16]`,
  terminator = any byte with bit 7 set (always `0xFF` in practice).
  **Correction to this section's prior framing**: `cond` does **not**
  gate whether a phase-3 record applies — every record is always applied,
  every time the level loads. What `cond` (or, for the special case
  `cond == 0`, a fixed bit-0-then-bit-1 test on the same byte) actually
  selects is **which of two merge formulas** to use, via a *second*,
  separate condition helper (`$8B:DF74`, base `$00:0AA0`, same bitmask
  table — a different quest-flag bitmap byte than phase 2's `$00:09C0`).
  If the tested bit is set: `wall[offset] = (wall[offset] & wallMask) |
  (~wallMask & 0xAA)` and `feature[offset] = (feature[offset] & 0xC0) |
  featValue`. If clear: `wall[offset] = (wall[offset] & wallMask) |
  (~wallMask & 0x55)` and `feature[offset] = feature[offset] & 0xC0`
  (`featValue` is never read on this branch). **The `0x55`/`0xAA`
  constants are the low/high bit of each of the four 2-bit wall
  sub-fields** — an independent corroboration of the 4×2-bit packing of
  §3.14.7, from a code path unrelated to that section's extractor. Net
  effect: phase 3 always writes *something* to both planes at `offset`;
  the quest-flag state only chooses which of two pre-authored variants
  (with vs. without the feature value) gets written.

Applying either phase's output for real requires the player's save-file
quest-flag bitmap (`$00:09C0`/`$00:0AA0`), which is runtime state with no
ROM-resident default — there is no single "correct" static maze once
these are in play. The committed extractor decodes and exposes both
patch lists as structured per-level metadata (condition byte, resolved
plane/cell index, values) but does not bake a guessed flag state into the
rendered base-layout maps, consistent with the project's convention of
not asserting an unverified fact.

**Region-origin table `$80:D78E` — confirmed.** 12 entries/level, 4 bytes
each (`u16 originX`, `u16 originY`), 48 bytes/level, 14 levels. The
per-level base offset is computed at `$80:D08B` (file `0x00508B`) as
`$08 = level * 48` (`WRMPYB = #$30`), and the per-region cursor `$0e`
walks it 4 bytes at a time.

**Region blitter `$80:D25B` (file `0x00525B`-`0x005294`).** Copies one
region's 64 cells out of the staging planes into the 24×24 view grid:

```
Y = ($0e - $08) * 16        ; (region*4)*16 = region*64  <- source cell offset
X = $3e                     ; destination cell index in the 24x24 grid
repeat 8 rows:
  repeat 8 cells:
    $7E:4300[X] = $7E:9A00[Y]      ; wall            ($80:D265/$80:D268)
    $7E:4540[X] = $7E:9D00[Y]      ; feature         ($80:D26B/$80:D26E)
    $7E:4780[X] = $7E:49C0[$0e++]  ; floor/ceiling variant
    Y++ ; X++
  X = $3e + 24 ; $3e = X           ; ADC #$0018 — the confirmed 24-wide row stride
```

`$7E:49C0` is a 64-byte scratch built at `$80:D181`-`$80:D1B3` by
unpacking the four 2-bit fields of a per-level byte from `$80:DB9B` —
floor/ceiling variant selection, not maze content.

**Cross-platform field mapping (this is what pins the semantics).** With
SNES cell `(g, r, c)` ↔ Amiga cell `(g, 7-r, c)`, and Amiga global maze
coordinates `gy = originY[g] + (7-r)`, `gx = originX[g] + c`:

| SNES wall byte | Amiga equivalent | Meaning |
|---|---|---|
| bits 0-1 | `planeA[cell]` | wall on the `+gy` side |
| bits 2-3 | `planeB[cell]` | wall on the `+gx` side |
| bits 4-5 | `planeA[cell at (gy-1, gx)]` | wall on the `-gy` side |
| bits 6-7 | `planeB[cell at (gy, gx-1)]` | wall on the `-gx` side |

This is exactly the "all 4 sides stored redundantly per cell, so no
neighbour read is needed at render time" design §3.14.7 predicted — now
confirmed against the Amiga's shared-edge scheme rather than merely
argued by analogy.

SNES feature byte: **bits 0-5** = Amiga `(orientation << 4) | feature`
(the `AND #$3f` at `$80:CD7D`); **bits 6-7** are separate per-cell flags
with no Amiga counterpart. `0x0D`/`0x0E` (and `0x4E` = `0x0E` under the
mask) are the SNES's "no feature" sentinels where the Amiga stores `0x00`
— consistent with the per-level default-seed table `$80:DB8D` (§3.14.7).

> **Partial advance (follow-up session): bit 6 has a real reader in
> isolation, but it's level-specific, not a general per-cell semantic.**
> A byte-pattern census of all 24 whole-ROM `LDA $7E4540,X` sites (raw
> feature-byte reads, before the `AND #$3F` mask most consumers apply)
> found one that tests bit 6 **on its own**, distinct from the many
> already-confirmed `CMP #$C0`/`BCS` "both flag bits set" marker checks
> (§3.14.7's "top-bit marker", unaffected by this finding): file
> `0x004441` (CPU `$80:C441`), gated behind `LDA $0964; BEQ ...; LDA
> $0905; CMP #$08` (dungeon level `== 8`) and `LDA $094D; BNE ...`
> (an unidentified second flag) before reaching `LDA $7E4540,X; CMP
> #$4E; BEQ ...; AND #$C0; CMP #$40; BEQ $44A9` — `AND #$C0; CMP #$40`
> isolates bits 6-7 and tests for exactly `01` (bit 6 set, bit 7 clear),
> branching to a level-8-specific handler at file `0x0044A9` (not traced
> further this session). This shows bit 6 is read and acted on by at
> least one real consumer, but the gating on a *specific* dungeon level
> (`$0905 == 8`) and an unnamed second flag (`$0964`, `$094D`) suggests a
> scripted, level-8-specific event trigger rather than a universal
> per-cell rendering flag — consistent with level 8's already-noted
> anomalous default feature-seed value (`0x00`, not `0x0D`/`0x0E`,
> §3.14.7's `$80:DB8D` table). Bit 7 in isolation (as opposed to the
> combined `>=0xC0` marker) still has no identified reader. Not chased
> further — the level-8 handler at `0x0044A9` and the `$0964`/`$094D`
> flags are a new, narrower lead for a future session, not a closure.

**Verification — quantified, oracle = Amiga `scenario.dbs` section 2**
(an entirely independent binary, independently reverse-engineered).

> **Independently re-verified this session** (per
> `verify-escalation-artifacts-not-just-claims.md`): a fresh Python
> comparator, written from scratch against this section's prose (never
> the escalation's own script), reproduced the wall-plane and
> region-origin numbers below to the exact fraction. **One escalation
> claim did not reproduce and is corrected here**: the escalation
> reported "levels 0, 3 and 6 are 768/768 exact on the feature plane".
> Independent re-checking found this **false** — under the
> escalation's own stated feature-sentinel-normalisation rule, only
> **level 6** is exact (768/768); level 0 has 15 mismatches (98.05%) and
> level 3 has 2 (99.74%). Level 4, not flagged by the escalation at all,
> is actually the *worst*-agreeing level (95.96%, 31 mismatches). The
> qualitative conclusion (very high agreement, a small residual
> explained by genuine cross-release content edits, not decode error)
> still holds and was itself independently reproduced — only the
> specific "which levels are exact" claim was wrong.
>
> The sentinel-normalisation rule used for this independent check: SNES
> feature-nibble `0x0D` **or** `0x0E` (the union of both possible "no
> feature" sentinel bytes actually observed in the table, not only the
> value predicted by that level's own runtime-default byte at
> `$80:DB8D`, §3.14.7 — a handful of levels' *baked* table content uses
> the other sentinel than their own runtime default) is treated as
> equivalent to Amiga feature `0`. This raises aggregate feature
> agreement from a raw 87.6% (no sentinel normalisation) to the 99.07%
> reported below — independently reproducing the escalation's headline
> shape (very high, not perfect, agreement) even though the exact
> percentage and the "which levels are exact" detail differ slightly.

| Plane | Agreement | |
|---|---|---|
| wall bits 0-1 vs `planeA[cell]` | 10688 / 10752 | 99.40% |
| wall bits 2-3 vs `planeB[cell]` | 10697 / 10752 | 99.49% |
| wall bits 4-5 vs `planeA[gy-1]` | 9385 / 9408 | 99.76% |
| wall bits 6-7 vs `planeB[gx-1]` | 9383 / 9408 | 99.73% |
| feature byte (masked, sentinel-normalised, union rule above) | 10652 / 10752 | 99.07% |
| region-origin pairs | 167 / 168 | 99.40% |

(10752 = 14 levels × 768 cells. Only **level 6** is exact on the feature
plane, 768/768 — see the correction above. The neighbour rows use
9408 = 14 × 768 × 7/8, conservatively excluding every cell on the edge
of its own 8×8 region regardless of whether an adjacent placed region
would supply a valid neighbour — a simpler exclusion rule than the
escalation's own (which only excludes truly-unplaced neighbours,
giving denominators 10038/9979 there), reproducing the same
~99.7-99.8% agreement either way. The one region-origin mismatch is
level 13 region 2, `(140,140)` on SNES vs `(0,0)` on Amiga — an unused
region given a placeholder value on one platform, `(0,0)` on the
other.)

The ~0.5% residue is **not** decode error and **not** explained by the
conditional patch lists (only 1 of 61 feature and 1 of 114 wall
mismatching cells is named by any patch record). It is structured
1990-original-vs-1995-remake content editing: 20 cells where the Amiga
has feature `7` and the SNES has none, 16 where the SNES adds feature
`15` and the Amiga has none, and ~12 where the SNES blanks an Amiga
feature `3`/`12`.

**Structural invariants, zero deviation** (independent of the oracle):

- `1536 = 96 × 16`, and the loader's own `level*6` → `XBA` (`×256`)
  arithmetic yields exactly `level*1536`.
- `CPX #$0300` = 768 = 12 regions × 64 cells — matches the Amiga's
  per-level cell count exactly.
- `$08 = level*48` = 12 regions × 4 bytes, and `($0e - $08) × 16 =
  region × 64` recovers the source cell offset exactly.
- The 14-record table ends at `0x035400`, where an unrelated ascending
  u16 pointer table begins — a clean, self-evident boundary.
- Both patch pointer tables: **14/14 levels' pointers land exactly one
  byte past the previous level's terminator**, and the first pointer
  (`0x001C`) is exactly the 28-byte pointer table's own length. All 166
  + 91 record offsets are `< 1536`, zero out-of-range.

**Render oracle (decisive).** Decoding the table with nothing but the
above (no Amiga input) and laying each level's 12 regions out at their
`$80:D78E` origins produces 14 coherent dungeon maps — winding corridor
networks, enclosed rooms, symmetric ornamental chambers, and door-valued
edges distinct from plain walls. Nothing resembles the uniform fill the
previous session could only produce.

> **Independently re-verified and promoted to a committed extractor this
> session.** A from-scratch TypeScript implementation
> (`tools/wizardry6/snes/decode-maze.ts`, never opened the escalation's
> own scripts) reproduces the table/origin decode and renders all 14
> levels as top-down PNG maps (`public/assets/wizardry6/snes/screens/maze/
> maze-levelNN.png`), oracle-guarded on the structural invariants above.
> Per-level nonzero-wall-cell counts from this independent run: 241-700
> of 768 cells per level (level 10 lowest, level 2 highest) — a
> different range than the escalation's own "144-608" figure, most
> likely a different counting convention (e.g. distinct wall *segments*
> vs. this extractor's "cells with any nonzero 2-bit sub-field"), not
> re-derived further since both figures agree on the qualitative point
> (a substantial, non-uniform fraction of each level is walled). The
> rendered maps themselves are the decisive check: every level shows
> unmistakable maze structure (connected rooms, corridors, symmetric
> chambers) inspected visually, matching the escalation's own
> characterization. JSON output: `public/assets/wizardry6/snes/data/maze.json`
> (768 cells × 14 levels, raw `wall`/`feature` bytes plus region/major/
> minor indices and the 12 region origins per level).
>
> **Now decoded (follow-up session)**: the two quest-flag-conditional
> patch lists (`$8B:DFB4`, `$8C:DC5A`) are fully disassembled and exposed
> as structured per-level metadata (`patchesPhase2`/`patchesPhase3` in
> `data/maze.json`) — see the corrected phase-2/phase-3 write-up above.
> They are not baked into the rendered base-layout maps (needs an assumed
> save-file quest-flag state, out of scope for a static asset). ~~Still
> open: the exact non-zero wall sub-field *value* semantics (which of
> 1-3 means "door" vs "solid wall")~~ — **CLOSED this session, on both
> platforms at once**: `0 = open, 1 = open doorway, 2 = solid wall,
> 3 = closed door`, confirmed by the full dispatch trace + decisive art
> renders in **§3.14.12** (and transferring to the Amiga via the
> byte-identical maze data + its structurally-matching dispatch). The
> two SNES-only feature-byte flag bits (6-7) remain as before (bit 6:
> level-8-gated reader only; bit 7: no reader) — see
> `docs/wizardry6/TODO.md`.

#### 3.14.9 `$7E:5000` → VRAM display path — confirmed (`re-codebreaker`)

Closes `snes-dungeon-view-vram`. There is **no intermediate copy**: the
composed buffer is DMA'd straight from WRAM `$7E:5000` to VRAM by the
per-frame dirty-flag DMA dispatcher, and the view is displayed as an
**18x15 window of BG2**, whose tilemap holds a plain ascending tile-index
ramp starting at tile 240.

> **Correction to a prior session's `LDX #$5000` finding.** The site at
> file `0x001fd2` was recorded as "targets WRAM `$7F:5000` because it sets
> `LDA #$7f; STA $b6` immediately after". That reading is wrong: `$b0` (the
> register `LDX #$5000` is stored into) is the **VRAM word address** of the
> generic dirty-bit-7 DMA slot, not a WRAM source address — bit 7's block at
> file `0x004120` does `LDX $b0; STX $2116`. `$b2`/`$b6` are the source
> address/bank and `$b4` the size. So that site uploads `$1000` bytes from
> `$7F:<Y>` to VRAM word `$5000`. Still unrelated to the dungeon view, but
> for a different reason. The whole `LDX #$5000` search was structurally
> incapable of finding the answer regardless: the real address never appears
> as an instruction immediate at all — it is a **data word in a parameter
> table** (`$80:C18C`).

**The `$23` dirty-flag byte is an 8-slot DMA request word, one bit per DMA
channel.** The per-frame dispatcher entry is file `0x003f78`
(`$80:BF78`): `LDA #$02; STA $24; LDA #$80; STA $2115` (VMAIN = word
increment) then a straight chain of `LSR $23` / `BCC skip` / channel setup.
Bit *N* drives DMA channel *N* for N = 0-6:

| Bit | `LSR` at | Channel | VRAM word dest | Source | Size | Role |
|---|---|---|---|---|---|---|
| 0 | `0x003f81` | 0 | (OAM, `$2104`) | `$7E:FC00` | `$0220` | Sprite OAM |
| 1 | `0x003ffe` | 1 | (CGRAM, `$2122`) | `$7E:` tbl `$80:C163` | tbl `$80:C165` | Palette, selector `$ca` (§3.3) |
| 2 | `0x00402e` | 2 | `$7400` | `$7E:2000` | `$0800` | BG1 tilemap |
| 3 | `0x00405a` | 3 | `$7800` | `$7E:2800` | `$0800` | **BG2 tilemap** |
| 4 | `0x004086` | 4 | `$7C00` | `$7E:3000` | `$0800` | BG3 tilemap |
| 5 | `0x0040b2` | 5 | tbl `$80:C144` | `$7F:` tbl `$80:C14E` | tbl `$80:C158` | BG3 (text) CHR patches, selector `$0b3e` |
| 6 | `0x0040e6` | 6 | tbl `$80:C18A` | `$7E:` tbl `$80:C18C` | tbl `$80:C18E` | **View-window CHR**, selector `$8f` |
| 7 | `0x00411a` | 5 | `$b0` | `$b6`:`$b2` | `$b4` | Generic ad-hoc slot |

(Bit ⇔ channel identity for bits 0-6 is a zero-deviation structural check on
the numbering: each block's `STA $420b` mask is exactly `1 << bitIndex`.
Entry `0x003ff2` is a "skip OAM" variant that jumps into the chain at bit 1.)

**Bit-6 parameter table — `$80:C18A`, file `0x00418a`, 3 records, stride 6.**
`$8f` holds the *byte* offset directly (`LDA $8f; TAY`, unscaled), and is
`STZ`'d by the block after use, so `$8f == 0` is the resting state.

| `$8f` | `$2116` VMADD (word) | `$4362` src | `$4364` bank | `$4365` size |
|---|---|---|---|---|
| `0` | `$2F00` | `$5000` | `$7E` | `$21E0` (8672 B, 271 tiles) |
| `6` | `$2F00` | `$5000` | `$7E` | `$10F0` (4336 B) — first half |
| `12` | `$3778` | `$60F0` | `$7E` | `$10F0` (4336 B) — second half |

`$00:97FE` (file `0x0017fe`) is the request helper — `STA $8f; LDA $23;
ORA #$40; STA $23` — called with A = 6 or 12 by the portrait/CGRAM fade
paths (e.g. file `0x0023b0`, `0x001849`, `0x0018b6`), which split the same
buffer across two frames. **The dungeon-view composer never touches `$8f`**:
its epilogue at `$03:E24D` (file `0x01e24d`) is

```
E24D  E2 20        SEP #$20
E24F  A9 80 48 AB  LDA #$80; PHA; PLB      ; DBR = $80
E253  A5 23        LDA $23
E255  09 40        ORA #$40                ; request DMA channel 6
E257  85 23        STA $23
E259  6B           RTL
```

so it inherits `$8f == 0` and gets the full 8672-byte single-shot upload.

**Tilemap installer — `$03:E1CC`, file `0x01e1cc`** (10 `JSL $83E1CC` call
sites; idempotent, guarded by reading back the first entry):

```
E1CC  AF CE 28 7E  LDA $7E28CE       ; BG2 tilemap entry 103 = row 3, col 7
E1D0  C9 F0        CMP #$F0          ; low byte already 240 -> view already installed
E1D2  F0 34        BEQ $E208
E1D4  A9 0F 85 24  LDA #$0F; STA $24 ; 15 rows
E1D8  A2 F0 08     LDX #$08F0        ; first tilemap word: tile 240, palette 2, pri 0
E1DB  86 42        STX $42
E1DD  A2 00 00     LDX #$0000
E1E0  C2 20        REP #$20                     ; --- row loop
E1E2  A0 12 00     LDY #$0012        ; 18 columns
E1E5  86 00        STX $00
E1E7  A5 42        LDA $42                      ; --- column loop
E1E9  9F CE 28 7E  STA $7E28CE,X
E1ED  1A E8 E8 88  INC A; INX; INX; DEY
E1F1  D0 F6        BNE $E1E7
E1F3  85 42        STA $42
E1F5  A5 00 18 69 40 00   LDA $00; CLC; ADC #$0040   ; +32 entries = next map row
E1FB  AA E2 20 C6 24      TAX; SEP #$20; DEC $24
E200  D0 DE        BNE $E1E0
E202  A5 23 09 08 85 23   LDA $23; ORA #$08; STA $23 ; request BG2-tilemap DMA (bit 3)
E208  6B           RTL
```

i.e. `tilemapWord(x,y) = $08F0 + y*18 + x` written to BG2 tilemap entry
`103 + y*32 + x`.

**Complete chain (all steps confirmed):**

```
$83:E1CC  install BG2 tilemap ramp -> $7E:28CE.. ; set $23 bit 3   (once per screen)
$83:E223  compose view                            (per movement/turn)
   |-- JSL $80:C69F   build compose list -> $7E:421C
   |-- JSL $82:F810   clear $7E:5000..$71DF (8672 B) + occupancy $7E:3DE0 (270 words)
   |-- JSR $83:E25A   painter's-algorithm blit of each piece into $7E:5000
   `-- $23 |= $40                                 (request DMA channel 6)
$80:BF78  per-frame dispatcher
   |-- bit 3 -> ch3: $7E:2800 +$800  -> VRAM word $7800  (BG2 tilemap)
   `-- bit 6 -> ch6: $7E:5000 +$21E0 -> VRAM word $2F00  (BG2 CHR tiles 240-510)
PPU       BGMODE=$09 (mode 1), BG12NBA=$24 -> BG2 char base word $2000,
          BG2SC=$78 -> BG2 tilemap base word $7800, 32x32
```

**On-screen geometry:** BG2 tilemap cols 7-24, rows 3-17 → a 144x120 px
window at screen pixel `(56, 24)`-`(199, 143)`, palette 2, priority 0.

`BG12NBA = $24` (BG2 char base word `$2000`) is written at both gameplay
setup sites, file `0x050271` and file `0x00086f`; the only other non-opening
value is `$62` at file `0x050768`, which is §3.13's mode-3 ending screen and
never runs the view. So the char base is `$2000` for every screen that can
display the view.

Because the installer is guarded and on-demand, the *stored* BG2 tilemap for
a screen (e.g. §3.13's `0x05104b` patch) holds that rect's **non-view**
content; the ramp overwrites it while the view is up.

> **Correction to §3.12.** §3.12's "BG2 chars — 391 tiles from `$7F:4000`"
> (file `0x0080DE`-`0x00814D`) is a **one-shot screen-load** bulk upload, not
> a per-frame one; the per-frame BG2 CHR traffic is the bit-6 view upload
> above. The two overlap in VRAM: the screen-load writes BG2 tiles 0-390
> (words `$2000`-`$3870`) and the view then overwrites tiles 240-510
> (words `$2F00`-`$3FF0`) every time it is recomposed. Only BG2 tiles 0-239
> are stable UI/window art. §3.12's table entry is otherwise correct.

##### Verification — quantified, zero deviation

12 independent structural checks, all from raw ROM bytes
(`verify.py`, session scratchpad):

- **Table self-consistency (3/3 exact):** `rec2.src == rec1.src + rec1.size`
  (`$5000 + $10F0 = $60F0`); `rec2.VMADD == rec1.VMADD + rec1.size/2`
  (`$2F00 + $0878 = $3778`); `rec1.size + rec2.size == rec0.size`
  (4336 + 4336 = 8672). The two half-records provably partition the single
  full record.
- **Clear region == DMA size, byte-exact:** `$82:F810`'s `MVN $7E,$7E` with
  `LDX #$5000; LDY #$5020; LDA #$21BF` touches `$5000`-`$71DF` = **8672
  bytes = exactly the `$21E0` DMA size**, and is a whole number of 4bpp
  tiles (271). The occupancy clear (`LDA #$0219`, dest `$3DE2`) covers
  `$3DE0`-`$3FFB` = 540 bytes = **270 words = exactly 18x15 cells**.
- **Cross-site VRAM address agreement:** `BG2charBase + tile240*16 ==
  rec0.VMADD` → `$2000 + $0F00 = $2F00`. The char base comes from
  `BG12NBA = $24` at file `0x050270` (screen setup), the tile index from
  `LDX #$08F0` at file `0x01e1d9` (tilemap installer), the VMADD from the
  data table at file `0x00418a` — **three unrelated code/data sites agree.**
- **Index-function agreement, 270/270 cells, 0 mismatches:** the tilemap
  installer's sequential ramp (`+1` per column, 18 columns, carried across
  15 rows) and the composer's independent destination arithmetic
  (`destByte = x*32 + rowTable[y]`, §3.14.1) yield the *identical* buffer
  tile index `x + y*18` for every one of the 270 cells.
- **Geometry constants agree:** installer `LDY #$0012` = 18 columns and
  `LDA #$0F` = 15 rows reproduce §3.14.1's 18x15 grid; row stride
  `ADC #$0040` = 64 bytes = 32 entries = the 32x32 map size implied by
  `BG2SC = $78` (size bits 0).
- **Dirty-bit numbering, self-proving:** each block's `STA $420b` mask is
  exactly `1 << bitIndex` for bits 0-6 (channel N ⇔ bit N), and the tilemap
  installer sets bit 3, whose block DMAs `$7E:2800` → VRAM word `$7800` —
  precisely the buffer it just wrote to and the base `BG2SC` declares.
- **Independent corroboration of the window identity:** the HDMA-enable gate
  at file `0x003fb0` (`LDA $7E28CE; CMP #$F0; BNE skip`) uses the *same*
  "BG2 tilemap entry 103 low byte == 240" test as `$03:E1CC`'s own guard, as
  its "is the first-person view on screen" condition — two unrelated sites
  treating tile 240 at entry 103 as the view's signature.

Not confirmed (hypothesis): the 271st uploaded tile (index 510, the 32-byte
slack between the 8640 bytes of cells and the 8672-byte DMA/clear extent) is
never referenced by the tilemap and appears to be padding.

> **Independently re-verified (follow-up session).** Per
> `verify-escalation-artifacts-not-just-claims.md`: hand-extracted raw bytes
> at every cited address directly from the ROM (fresh Python, never the
> escalation's own `verify.py`) and decoded them by hand — all reproduced
> byte-exact: the composer epilogue at file `0x01e24d`
> (`e2 20 a9 80 48 ab a5 23 09 40 85 23 6b`, decoding to
> `SEP #$20; LDA #$80; PHA; PLB; LDA $23; ORA #$40; STA $23; RTL`); the
> bit-6 parameter table at file `0x00418a`
> (`00 2f 00 50 e0 21 | 00 2f 00 50 f0 10 | 78 37 f0 60 f0 10`), which
> independently reproduces the three-record VMADD/src/size figures and the
> `rec1+rec2==rec0` partition check; and the tilemap installer at file
> `0x01e1cc`, including the `LDX #$08F0` immediate (`a2 f0 08`) decoding to
> tile 240/palette 2/priority 0 exactly as claimed, and the row/column loop
> structure (`LDY #$0012` = 18, `LDA #$0F` = 15, `ADC #$0040` row stride).
> No discrepancies found against any cited byte sequence. This is now the
> corpus's sixth clean escalation-verification pass (see the "fifth
> instance" already logged in that lesson file for the maze-table
> escalation) — nothing wrong this time, but the check is cheap and routine
> per that lesson's standing rule.

#### 3.14.10 Dungeon-view CGRAM palette — confirmed (`re-codebreaker`)

Closes the palette half of `snes-dungeon-view-render`. The view has **no
dedicated palette of its own**: it renders through **BG sub-palette 2
(CGRAM colours 32-47)**, a *shared context slot* whose contents are
swapped **per dungeon region** from the same 16-colour group table the
portrait and UI-icon banks use (file `0x10764`, §3.3/§3.2b). Twelve
distinct dungeon palettes exist — **groups 40-52**.

> **Correction to §3.3 — the `$ca` dispatch table is an 8-record,
> 5-byte-stride array, not "3 parallel byte-offset arrays".** §3.3 read
> `LDA $C162,Y` / `LDX $C163,Y` / `LDX $C165,Y` as three separate arrays
> each indexed by `$ca` directly. They are one interleaved record array:
> base file `0x004162`, record *i* at `+5i` = `[CGADD u8][srcAddr u16]
> [size u16]`, and `$ca` holds the **byte offset** `5i` (same
> "index-is-a-byte-offset" convention as the bit-6 table in §3.14.9 and
> the compose-list words in §3.14.3). Three independent proofs:
> **(a)** all 16 whole-ROM `LDA #imm; STA $ca` sites load a multiple of 5
> — 16/16, 0 deviations (values `$0a`,`$14`,`$1e`,`$23` = records 2,4,6,7);
> **(b)** the array is exactly 8 records = 40 bytes and ends at file
> `0x00418a`, which is byte-for-byte where §3.14.9's bit-6 table begins —
> zero gap; **(c)** 7 of the 8 records satisfy
> `srcAddr == 0x3800 + CGADD*2` exactly (see the shadow-buffer finding
> below). §3.3's "sweep all 256 `$ca` values and only one extra is sane"
> result was an artefact of scanning at stride 1 through a stride-5 table;
> record 5 is a genuine record, not a dead entry.

**`$7E:3800` is a full 512-byte CGRAM shadow image — confirmed.** Every
`$ca` record sources from it, and record 0 uploads the whole thing:

| `$ca` | rec | CGADD | source | size | shadow colour | Role |
|---|---|---|---|---|---|---|
| `0` | 0 | `$00` | `$7E:3800` | `$0200` | 0 | **whole 256-colour CGRAM** |
| `5` | 1 | `$2d` | `$7E:385A` | `$0004` | 45 | 2 colours |
| `10` | 2 | `$20` | `$7E:3840` | `$0020` | 32 | **sub-palette 2** (§3.3, and the view) |
| `15` | 3 | `$29` | `$7E:3852` | `$0006` | 41 | 3 colours |
| `20` | 4 | `$80` | `$7E:3900` | `$0020` | 128 | sub-palette 8 (UI icons, §3.2b) |
| `25` | 5 | `$e0` | `$7E:39A0` | `$0020` | 208 | 16 colours (**only record where CGADD*2 ≠ src−`$3800`**: `$e0` implies `$39C0`) |
| `30` | 6 | `$a0` | `$7E:3940` | `$0040` | 160 | creature sprites (§3.11) |
| `35` | 7 | `$a0` | `$7E:3940` | `$0080` | 160 | creature sprites, 64 colours |

The dispatcher `STZ $ca`s after servicing (file `0x00402c`), so **`$ca == 0`
is the resting state** — any code that raises `$23` bit 1 without setting
`$ca` triggers the full 512-byte upload. The boot-task `MVN` at
`$81:8062` (§3.5) that copies ROM file `0x127e4` → `$7E:3800` is therefore
the *initialiser* of this shadow, not a screen palette: 512 bytes = the
whole CGRAM image, and each `$ca` record patches a slice of it in place.

##### The chain — confirmed

```
$82:F842  per-region environment lookup   -> writes $094c
$82:867F  load sub-palette 2              -> group = floor($094c/2)
          copies 32 B from ROM $82:8764 + group*32  to  WRAM $7E:3840
          then $ca = 10 (or left 0) and $23 |= $02
$80:BF78  bit-1 block -> DMA to CGRAM colour 32
$03:E1CC  BG2 tilemap ramp, every entry $08F0+n  -> palette field = 2
PPU       BG2 tile 240-509 pixels index CGRAM 32-47
```

**Step 1 — the tilemap fixes the sub-palette. 270/270 entries, 0
deviations.** Emulating `$03:E1CC` (§3.14.9) exactly: every written word is
`$08F0 + n` for `n = 0..269`, so `palette = (word >> 10) & 7 == 2`,
`priority == 0`, `flipX == flipY == 0` for **all 270** entries (the ramp
tops out at `$09FD`, still below `$0C00` where the palette field would roll
to 3). Sub-palette 2 = CGRAM colours 32-47 = shadow bytes
`$7E:3840`-`$7E:385F` — which is exactly `$ca` record 2's source.

**Step 2 — `$82:F842` (file `0x017842`) is the per-region environment
lookup.** Byte-verified:

```
017842  8b              PHB
017843  a9 82 48 ab     LDA #$82; PHA; PLB          ; DBR = $82
017847  a9 00 eb        LDA #$00; XBA
01784a  ad 05 09        LDA $0905                   ; dungeon level (0-13)
01784d  0a aa           ASL; TAX
01784f  c2 20           REP #$20
017851  bd b1 f8        LDA $F8B1,X                 ; per-level list pointer
017854  38 e9 cd f8     SEC; SBC #$F8CD             ; rebase to table start
017858  a8              TAY
017859  a6 be           LDX $be                     ; region index
01785b  ad 08 09 38 ff 8e d7 80   LDA $0908; SEC; SBC $80D78E,X   ; y - regionY
017863  0a 0a 0a 0a     ASL x4
017867  85 42           STA $42
017869  ad 06 09 38 ff 90 d7 80   LDA $0906; SEC; SBC $80D790,X   ; x - regionX
017871  05 42 85 42     ORA $42; STA $42            ; key = (dy << 4) | dx
017875  8d 67 09        STA $0967
017878..017887          $43 = $0968 = (level << 4) | $c0
017888  bb              TYX
017889  c2 20           REP #$20
01788b  bd cd f8        LDA $F8CD,X                 ; record key
01788e  f0 1d           BEQ $F8AD                   ; 0 terminator -> done
017890  c5 42           CMP $42
017892  f0 05           BEQ $F899                   ; key match
017894  e8 e8 e8 80 f2  INX x3; BRA $F88B           ; 3-byte stride
017899  e2 20           SEP #$20
01789b  bd cf f8        LDA $F8CF,X                 ; record value
01789e  c9 50           CMP #$50
0178a0  90 08           BCC $F8AA
0178a2  8d 4c 09        STA $094c                   ; value >= $50 -> palette selector
0178a5  e8 e8 e8 80 df  INX x3; BRA $F889           ; keep scanning
0178aa  8d 19 0b        STA $0B19                   ; value < $50 -> other region attr
0178ad  e2 20 ab 6b     SEP #$20; PLB; RTL
```

| Structure | Location | Shape |
|---|---|---|
| Per-level list pointers | `$82:F8B1`, file `0x0178B1` | 14 × u16 CPU addresses (levels 0-13) |
| Region attribute records | `$82:F8CD`, file `0x0178CD` | 3-byte `[key u16][value u8]`, `key == 0` terminates each level's list |

Decoded whole: **221 records across 14 levels, 0 parse failures**, of which
172 are palette-setting (`value >= $50`).

> **Independently re-verified (follow-up session), one number corrected.**
> Per `verify-escalation-artifacts-not-just-claims.md`: a fresh Python
> parser (never the escalation's own script), re-deriving the pointer
> table and record layout from this section's prose only, reproduced the
> **221/221 total record count exactly**, the **12 distinct selector
> values exactly** (`$50,$52,$54,$56,$58,$5A,$5C,$5E,$60,$62,$66,$68`),
> their **level associations exactly** (e.g. group 40 -> levels
> 2,5,6,12,13), and the **per-selector record-count breakdown exactly**
> (14, 4, 10, 1, 1, 29, 23, 40, 46, 1, 2, 1 — matching the table below
> digit-for-digit). That breakdown's own sum is **172**, not the **141**
> figure this section's prose originally stated — a standalone number
> that was internally inconsistent with the escalation's own
> per-selector table sitting right next to it. Also independently
> re-verified byte-exact: the `$ca` table's 8-record/5-byte-stride
> structure and all values in the dispatch table above; group 40's raw
> palette bytes at file `0x10C64`; and the "index 0 and index 11 are
> `$0000` in all 12 groups" family signature. Corrected here; every other
> number in this section held up.

**Step 3 — `$82:867F` maps `$094c` to a palette group.** §3.3 already has
the arithmetic (`(value << 4) & $0FE0` = `floor(value/2) * 32`); this
section only corrects its *role*. Read together with `$82:F842`, `$094c`
is **not portrait-specific** — it is the general "which 16-colour group is
currently loaded into sub-palette 2" selector, and §3.3's own open note
("the selector variable at DP `$094c` was *not* traced to a confirmed live
write site … what game state feeds this selector is still open") is now
answered: `$82:F842`'s region table is the live writer during exploration.
§3.3's finding that `$094c = 0x50` appears as a constant at file `0x003b2a`
is likewise explained — `$50` is the *first* dungeon palette, not an
out-of-range portrait index.

##### The 12 dungeon palettes — confirmed

| `$094c` | group | file | levels using it | region records |
|---|---|---|---|---|
| `$50` | 40 | `0x10C64` | 2, 5, 6, 12, 13 | 14 |
| `$52` | 41 | `0x10C84` | 7, 8 | 4 |
| `$54` | 42 | `0x10CA4` | 12 | 10 |
| `$56` | 43 | `0x10CC4` | 12 | 1 |
| `$58` | 44 | `0x10CE4` | 10 | 1 |
| `$5A` | 45 | `0x10D04` | 3, 6 | 29 |
| `$5C` | 46 | `0x10D24` | 3, 6 | 23 |
| `$5E` | 47 | `0x10D44` | 4 | 40 |
| `$60` | 48 | `0x10D64` | 4 | 46 |
| `$62` | 49 | `0x10D84` | 4 | 1 |
| `$66` | 51 | `0x10DC4` | 9 | 2 |
| `$68` | 52 | `0x10DE4` | 12 | 1 |

All 12 values are **even** (12/12) — consistent with `group = floor(v/2)`,
which makes odd values redundant — and all map into the **contiguous block
groups 40-52**. This also retro-explains §3.2b's observation that "groups
45-52 share a fixed UI-chrome sub-palette at indices 8-12": that block *is*
the dungeon-environment family, and groups 46 and 51 are genuinely
double-used (sub-palette 2 for a dungeon region here, sub-palette 8 for the
UI icon bank in §3.2b).

Two further loads target sub-palette 2 outside the region table, both
**scene-specific, not general**: file `0x00825f` and `0x0089fe` both do
`LDY #$06A0; LDX #$0040; JSL $82869C` → **group 53** (file `0x10E04`,
unique in the table — no other group shares its indices 1-8), immediately
after forcing compose piece `$8216` (`STX $0850`, the §3.14.6 carved stone
portal). Group 53 is that fixed portal scene's palette.

##### Fade-out / fade-in — confirmed

The general screen-change sequence (6 sites, e.g. file `0x0016e7`) is:

```
0016e5  A5 23 29 40 F0 xx   wait until $23 bit 6 clear (previous view DMA serviced)
0016e7  A9 0A 85 CA         $ca = 10  (record 2 -> CGRAM 32-47 only)
0016EB  A0 00 00 A2 40 00   Y = 0 (group 0 = all black), X = $0040
0016F1  22 9C 86 82         JSL $82869C   -> blank sub-palette 2 (fade out)
0016F5  A9 06 85 8F         $8f = 6       (view CHR upload, first half)
0016F9  20 67 82            yield 1 frame
0016FC  A9 0C 20 FE 97      $8f = 12 via $00:97FE (second half) + $23 |= $40
001701  22 42 F8 82         JSL $82F842   -> new region -> $094c
001705  22 7F 86 82         JSL $82867F   -> load the region's group (fade in)
```

This is why group 0 (all-zero, §3.3's "black silhouette" group) shows up in
the X=`$0040` call-site census: it is the **blank** step, not a palette.

##### Verification — quantified

- **Tilemap palette field: 270/270 entries carry palette 2, 0 deviations**
  (emulation of `$03:E1CC` from raw bytes; every entry `$08F0+n`,
  `n = 0..269`, max `$09FD < $0C00`).
- **`$ca` stride: 16/16 literal `STA $ca` sites are multiples of 5**, and
  the 8-record table ends at file `0x00418a` with **zero gap** before the
  bit-6 table.
- **Shadow-buffer invariant: 7/8 `$ca` records satisfy
  `src == 0x3800 + CGADD*2` exactly** (record 5 is the single exception).
- **Region table: 221/221 records parse**, 172 palette-setting (corrected
  from an initial internally-inconsistent "141" — see the independent
  re-verification note above), **12/12 distinct selector values even and
  inside groups 40-52**.
- **Family signature, 12/12 groups, 0 deviations:** colour index 0 is
  `$0000` in all 12 dungeon groups (the BG transparent slot), and index 11
  is `$0000` in all 12 as well — an intentionally-dead slot, corroborated
  independently by the tile-pool census below, where index 11 accounts for
  only **0.27%** of the 652,608 pixels in the 10,197 distinct dungeon-art
  tiles (the lowest of any index bar 13-15). Group 53 (the portal scene)
  is *not* part of this family: its index 11 is `$1524`, one of several
  reasons it is unique in the whole 80-group table.
- **External ground truth — decisive.** Two independent real Super Famicom
  screenshots of the first-person view (an early-game castle interior,
  i.e. **level 2**, whose region list contains exactly one palette value:
  `$094c = $50` → **group 40**) were fetched and analysed. Restricting to
  **unblended** pixels only (centre of a fully flat 3×3 block in the
  800×600 upscale, which excludes every resampler blend), the view window
  at the derived rect `(56,24)`-`(199,143)` contains exactly **five**
  distinct BGR555 values — `$0421`, `$14A4`, `$2107`, `$0C62`, `$35AC` —
  and these are **precisely group 40's colour indices 1-5**:
  **3,349/3,349 pixels = 100.00% explained, 0 unexplained values**, across
  both screenshots. Group 53's ramp members (`$1CE6`, `$2949`, `$420F`)
  appear in **0** unblended pixels. Measured index-4 share (`$2107`,
  5.57% of the flat-run sample) also matches the whole-pool index-4 usage
  computed from the 10,197 distinct dungeon-art tiles referenced by the
  1893 library records (5.53%) to within 0.04 pp.
- **Window geometry corroborated by the same screenshots**: the visible
  view panel occupies the derived rect, independently confirming §3.14.9's
  cols 7-24 / rows 3-17 (144×120 px at `(56,24)`) — and `56 = (256−144)/2`,
  i.e. exactly horizontally centred.

##### Dead end recorded — `$82:DCD8` is a screen-flash effect, not a palette loader

File `0x015CD8` is the only code outside `$82:867F`/`$869C` that writes
sub-palette 2 (`STA $7E:3840,X` at file `0x015CF4`). It loads 16 colours
from a table at `$82:DD02` (file `0x015D02`, 32 B/record) indexed by WRAM
`$7E:3B10`. Its 6 records are **pure single-hue ramps** (red, blue,
magenta, green, cyan, yellow), and its single caller (file `0x0007a4`)
alternates it with `JSL $82867F` on odd/even frames of a `$0B6B` countdown
— a **damage/spell screen-flash**, restoring the region palette on the
even frames. Not a dungeon palette source.

#### 3.14.11 Browser walker v1 — bank-`$89` "wallValue table" index-1 confirmed, full dispatch still open

> **Superseded (this session): the full dispatch is now traced and the
> walker upgraded to a faithful v2 — see §3.14.12.** v1's "index 1 =
> generic wall" stand-in turned out to be the **wall value 1 (open
> doorway)** art word — the correct-placement observation held because
> words 1-3 share their placement rect; the real per-value mapping is
> `word index = code (+ variant offset via $80:DE4E)`. The `0x101`
> odd-sentinel reading is confirmed (it resolves to a degenerate record,
> effectively "draw nothing"). Everything below is kept as the historical
> v1 record.

Wires the confirmed backdrop (§3.14.6) + palette (§3.14.10) into the shared
`tools/walker/index.html` walker as a selectable "SNES" variant alongside
the existing Amiga renderer (`tools/walker/games.ts` `Wizardry6View`). New
files: `tools/wizardry6/snes/view-model.ts` (pure pose -> draw-ops model,
shared by Node and browser), `export-dungeon-view.ts` (asset export),
`render-through-dungeon.ts` (offline verification renderer),
`tools/walker/games-w6-snes.ts` (`GameView` + loader, wired into
`tools/walker/walker.ts` via a new `#variant` select — previously present
in `index.html` but unwired).

**New this session: the bank-`$89` per-depth/per-direction "wallValue
table" addresses §3.14.5 already cites are not just placement metadata —
they are literal tables of raw **compose-list words** (`resolveComposeWord`
in `decode-dungeon-composer.ts`, the same word format §3.14.3 already
confirmed), one entry per wallValue 0-15.** Confirmed by resolving all 15
tables' own **index-1** entry and finding every single one decodes to the
*exact* `(x,y,w,h)` placement §3.14.5's own table cites for that
direction/depth — **15/15, zero deviation** (`front0`-`front4`,
`left0`-`left4`, `right0`-`right4`). Index 0 is uniformly the literal value
`0x101` across all 15 tables — odd, so not a valid `[bit15 | byteOffset]`
compose word at all, distinct from the ordinary `0xFFFF` "table slot
unused" sentinel `parseLibrary` already handles — matching the raw 2-bit
wall sub-field's own `0 == open` convention (index 0 = "don't draw
anything for this direction").

This is a genuine new structural confirmation (table *shape*, and that
index 1 is always a real "this direction is blocked" wall piece), but it
does **not** close the dispatch: the mapping from a cell's actual raw
wallValue (0-15, after whatever `$80:DE1B`-style second-stage lookup
§3.14.7 left untraced) to which table index to use is still open — see
`docs/wizardry6/TODO.md` row `snes-dungeon-view-wall-dispatch`.

**v1 walker dispatch** (`view-model.ts`'s `resolveViewOps`, module doc
comment has the full rationale): always draw the confirmed backdrop
(`$C2` index 267); per depth 0-2 and per direction (front/left/right),
draw that direction/depth's table **index-1** entry whenever the raw 2-bit
wall sub-field is nonzero (a "some kind of wall is here" generic render,
not the real per-value art); override with the **confirmed** fixed door
piece (compose word `0x02E8`) whenever the depth-1-dead-ahead cell's raw
feature nibble is `6` (§3.14.7's already-disassembly-confirmed door
special case). The wall sub-field itself is read directly from the maze
table's absolute-direction bit layout (§3.14.8's confirmed
bits0-1/2-3/4-5/6-7 = +Y/+X/-Y/-X mapping) — no neighbour-cell lookup
needed, unlike the Amiga port's shared-edge scheme.

**Verified:**

- Placement oracle (`export-dungeon-view.ts`, run every export): all 9
  depth-0..2 front/left/right index-1 pieces resolved match §3.14.5's cited
  `(x,y,w,h)` exactly, 9/9 (the other 6 of the 15 total, depths 3-4, aren't
  used by this v1's 3-depth budget but were also checked ad hoc, 15/15).
- Offline render (`render-through-dungeon.ts`): real poses across levels 0,
  3, and 4 (different dominant palettes, 40/45/48) all produce coherent,
  legible dungeon views — real stone-wall/archway texture, correct
  per-level colour. A pose one cell short of a real level-4 door cell
  (`feature==6`, confirmed via `data/maze.json`) renders the confirmed door
  piece at the expected depth-1 floor position.
- Browser (`npm run dev` + Playwright, `tools/walker/index.html`): the
  `#variant` select becomes visible only for Wizardry 6, defaults to
  Amiga, and switching to SNES loads and renders without console errors;
  movement (WASD) and the level dropdown (14 levels) both work; switching
  back to Amiga uses the unmodified existing `Wizardry6View` path.
- A real densification bug was caught by a fresh unit-test pass before
  shipping (`tools/wizardry6/snes/__tests__/view-model.test.ts`): the
  region bounding-box math had `minY`/`maxY` swapped relative to the
  confirmed major-axis-reversal formula (`globalY = originY + (7 -
  major)`, so a region's *minimum* global Y is at `major==7`, not
  `major==0`), which silently shifted every cell 7 rows from where it
  should densify to and could drop a band of real cells for
  multi-region levels. Fixed before the offline/browser verification
  above (both re-run after the fix).

**Still open / approximate**, all documented in `view-model.ts`'s own
module comment and `docs/wizardry6/TODO.md`:

- The real wallValue -> table-index dispatch (values other than the
  representative index 1) — needs the `$80:DE1B`-style second-stage lookup
  fully traced, or a live-capture oracle.
- No lateral-column faces (Amiga's `wall-lat:{L1,L2,R1,R2}`) — §3.14.5 only
  gives 3 representative table addresses (front/left/right); the doc notes
  "a further ~30 tables cover the intermediate lateral columns" with no
  addresses recorded.
- No floor/ceiling continuation piece — the confirmed backdrop (§3.14.6)
  has a real transparent void in its own open-doorway/floor area (visually
  confirmed identical in both the pre-existing `dungeon-view-sample.png`
  reference render and this session's new renders), and no always-drawn
  floor/ceiling piece analogous to the Amiga port's `ceil:*`/`floor:*` lanes
  has been identified for SNES yet. The walker fills this with a plain
  black background rather than leaving it as raw transparency.
- Per-level palette is the **dominant** group by §3.14.10's own
  region-record count, not the true per-region live selection (which needs
  the party's in-region cell key resolved against the 221-record region
  table, not attempted this session for a static per-level asset).
- No automap/minimap for the SNES variant.

#### 3.14.12 The full view walk and wallValue dispatch — confirmed (this session)

Closes the `snes-dungeon-view-walker` row's core open item (the true
wallValue → art dispatch) **and**, jointly with the byte-identical Amiga
maze data, the cross-platform wall-value-semantics unknown
(`maze-plane-semantics` / `snes-maze-data-extractor`). Everything below is
disassembly-traced with a flag-aware 65816 disassembler (fresh
`dis65816.py`, self-tested byte-exact against §2.2's published RESET
trace) and verified end-to-end by a faithful Python re-implementation of
the whole walk whose renders are decisive (see "Verification" below).

##### The walk (`$80:C69F`, file `0x0469F`)

The 26-slot walk of §3.14.5/§3.14.7 is actually a **visibility-propagating
handler cascade** plus a second floor/ceiling pass:

- **Prologue** (`0x046a8`-`0x04756`): `$0e = $80:DB7F[level]` (the
  per-level default **variant** byte — see below), `$bb = $0e & 0x60`;
  `$8e = ((X ^ Y ^ facing) & 1) * 2` (the checkerboard parity, global
  coordinates); `$52/$54/$56/$68` = the four facing-rotated wall-field
  extractor entry points (window table at `0x04d28`; ahead reads the
  sub-field for compass `facing`, left `(facing+3)%4`, right `(facing+1)%4`,
  behind `(facing+2)%4`); `$58 = facing*52` (the `$80:DD4B` frustum table
  is **4 × 26 entries**, one block per facing — §3.14.7 documented only the
  facing-0 block; facing 1's block has a single authoring slip, slot 23 =
  `-90` where the rotation gives `-92`, the other 78 rotated entries are
  exact); the skip-flag array `$7E:3B00[1..26]` is initialised **all-ones**
  (= skip).
- **Slot 0** (`$00:C879`): evaluates the party's own cell's left/right/
  front edges against tables `$89:F356`/`$89:F6C6`/`$89:EB1A` (so `EB1A`,
  §3.14.5's "front depth 0", is really the *own-cell* front edge), enabling
  slots 1/2/3 when an edge is open (or see-through, below). A party cell
  whose feature byte is `>= 0xC0` increments `$c9` — a "darkness" marker
  that suppresses every subsequent compose append.
- **Slots 1-26** (dispatch `LDX $C829,Y; STX $00; JSR $CD07` =
  `JMP ($0000)`): each handler runs **only if its `$7E:3B00` flag was
  cleared** by a nearer slot. Three handler shapes (full catalog below):
  *side* (adjacent-column cells: one ahead-face eval), *front* (the
  dead-ahead chain: left-edge + right-edge + front-face evals, three
  tables), *lateral* (off-axis cells: ahead-face ("perpendicular") +
  receding-side evals, two tables). Handlers **enable** deeper slots by
  clearing their flags when the evaluated edge is open **or see-through**.
- **`$78` deferral**: front-face draws route through `$00:CC0F`, which
  (for codes with `$80:DE3D[code] != 0` — codes 0,1,2,4,5) **stores** the
  resolved piece word in `$78` instead of appending; the word is appended
  at the next **depth-group boundary** (the `$80:C85E` per-slot flush-flag
  table, nonzero at slots 2,3,5,8,12,18) so the front wall z-orders after
  that group's side edges. Codes with `DE3D == 0` (3, 6-15) append
  immediately.
- **Post-walk** (`0x047b2`-`0x04828`): if `$094d` set, the last appended
  word is overwritten with piece `0x02EC` (level-8-related, untraced);
  then the **floor/ceiling pass** (below) re-walks all 27 slots; then the
  catch-all backdrop piece **`0x834A`** is appended last (under §3.14.4's
  near-to-far first-wins painter, "appended last" = drawn behind
  everything). The `$8216` full-view portal piece the v1 walker used as a
  backdrop is *not* part of the normal walk — it is the `$0850`-forced
  scene piece (§3.14.10), **prepended** (frontmost) when a script sets it.

##### The evaluator (`$00:CD36`-`$00:CDEF`)

Per edge: extract the 2-bit wall value for the evaluated compass
direction; read the cell's feature byte; then:

```
code = wallValue                       ; 0-3
if (feature & 0x3f) != 0:
    if (feature & 0x0f) == 6:          ; the fixed-door feature
        if slot == 3: append 0x02E8    ; the §3.14.7 door piece
        code = wallValue               ; wall value still renders
    elif (feature >> 4) == evaluatedCompassDir and (feature & 0x0f) < 13:
        code = (feature & 0x0f) + 3    ; feature replaces the wall code
$42 = $80:DE1B[code]  (special: code 12 at slot < 6 -> 4)
$43 = $80:DE2C[code] & 0x7f            ; see-through flag (0x81 at code 6 also
                                       ;   fires sound/event $0139 = 0x85)
```

So the **combined code space is 0-15**: 0-3 = wall values, 4-15 = features
1-12 (+3). This is the SNES analog of the Amiga's `CODE+0x964e`
feature→code table, with a simpler `+3` mapping.

##### The resolver (`$00:CC72`) — the actual wallValue → art dispatch

Callers pass **`$0f = code*2`**. The resolver:

1. Computes a **far-side cell**: `X = slotCell + delta`, where `delta` is
   picked from the 6-word table at **`$80:D700`** (file `0x05700`, raw
   `-1,-24,+1,+24,-1,-24`) indexed `facing*2 + Y` with `Y ∈ {0,2,4}` — a
   facing-rotated (left, ahead, right) triple. Each eval passes the `Y`
   matching its own edge, so the far-side cell is **the cell across the
   evaluated edge**. (This corrects §3.14.7's earlier note that "`$80:D700`
   does not exist at that address" — the *frustum* table is indeed at
   `$DD4B`, but `$D700` is this real, separate delta-triple table.)
2. If the far cell's feature byte is `>= 0xC0` and `code == 2`: appends the
   record's word at byte offset `0x44` (a marked-cell extra piece).
3. **Per-facing override** (record bytes `0x4C|facing`): when the byte for
   the current facing is nonzero, code 10 (feature 7, the portcullis) uses
   index `0x84` and code 3 (closed door) uses `0x86`/`0x88` (by variant) —
   i.e. record words 33-37 hold **far-side/mirrored door and gate art**,
   selected when the same physical edge is viewed from its other side.
4. Final index: `idx = (code*2 + variantByte) & 0xFE`, then
   **`pieceWord = record[ $80:DE4E[idx/2] ]`** — `$80:DE4E` (file
   `0x05e4e`, 69 u16 entries) maps the combined index to a record byte
   offset. With variant 0 it is the identity (`word index = code`); higher
   variants shift into override word ranges with extensive sharing:

   | variant | codes 0-15 → record words |
   |---|---|
   | `0x00` | 0-15 (identity) |
   | `0x10` | 8-15 window (words 8-15) |
   | `0x20` | 0x10,0x11,0x12,3,0x13,0x14,0x21,7,8,9,10,11,0x15,0x16,0x17,15 |
   | `0x40` | 0x18,**1**,0x19,3,4,...,15 (walls/doors shared with variant 0) |
   | `0x60` | 0x1a-0x1d,4-11,0x1e-0x20,15 |
   | `0x80` | 0x21-0x25 (codes 0-4 only — the out-of-region default) |

   The **variant byte** (`$7E:4780`, one per cell) is therefore an
   **art-family selector** — castle (`0x00`), cave (`0x20`), forest
   (`0x40`), etc. — with door/feature art shared across families where the
   `DE4E` values coincide. Each bank-`$89` record is **39 words (0x4E
   bytes)** — exactly the §3.14.5 table spacing — plus the 4 override
   bytes at `0x4C`-`0x4F` (which overlap the next record's first word for
   tables that never use them).
5. The `$ccde` fork: if the *evaluated* cell's variant equals the level
   default `$0e`, the far-side cell's variant is used instead; otherwise
   the evaluated cell's own — an art-transition rule at variant borders.

**Second-stage draws**: after the main draw, if `$42 = DE1B[code] != 0`
(codes 3,6-9,11,12 → extra piece; codes 14,15 → `0x18`), the handler
draws again with `$0f = $42` (with `$42 == 4` replaced by `$6e = $8e*2`,
the parity), and for `$42 == 0x18` at slots < 6 a third draw with
`$0f = 4`. **This is how wall value 3 gets its two-piece render**: word 3
(the door leaf) plus — via `DE1B[3] = 2` → word 1 — the doorway frame.

**Parity alternation**: the front handlers' left/right-edge draws and the
lateral side draws substitute `code 2 → $8e` (0 or 2), so plain receding
walls alternate between record words 0 and 2 per cell parity — a
checkerboard texture variation. Side-adjacent handlers do *not*
substitute.

##### Wall-value semantics — CONFIRMED (closes the cross-platform unknown)

With the dispatch known, the art words for the front-wall table `$89:EC04`
(depth 1, variant 0) decode and render as:

| wall value | record word | render (group-40 palette) |
|---|---|---|
| 0 | 0 (`0x101`, odd = draw nothing) | open |
| 1 | 1 (`0x0080`) | **wall pierced by an open doorway** (stone frame, transparent opening) |
| 2 | 2 (`0x007e`) | **solid masonry wall** |
| 3 | 3 (`0x0088`) + deferred word 1 | **closed wooden door leaf** (planks, bands, handle) inside the word-1 doorway frame |

and `$80:DE2C` (see-through) is 0 for codes 1 and 3, nonzero for 2 —
doorways and closed doors keep the visibility recursion alive (the leaf
occludes via the painter), solid walls stop it. Feature words in the same
record: word 4 (feature 1) = an **arched opening**, word 5 (feature 2) = a
larger cave-mouth arch, word 6 (feature 3) = a **globe lamp**, word 10
(feature 7) = a **portcullis gate**, etc.

> **So the 2-bit wall values are: 0 = open, 1 = open doorway, 2 = solid
> wall, 3 = closed door.** The Amiga's `maze-levels.json` rendered guess
> ("1 = door, 3 = secret") is corrected: 3 is a *visible closed door*, not
> a secret; nothing in the wall planes encodes secret doors (on wall-2
> edges the feature codes and/or runtime wall mutation must carry that
> mechanic). Since the maze data is byte-identical across ports
> (§3.14.8), this transfers to the Amiga wall planes directly — and the
> Amiga's own dispatch structure matches: its codes 1/3 draw a shared
> doorframe piece pair with code 3 adding extra pieces + deferred-queue
> records (the leaf), and its occlusion updater `LAB_0538` fires only on
> `code==2 || code>=5`, the same see-through split.
> Supporting cross-tab (Amiga data, all 14 levels): feature 1 ("closed
> door" per the DOS trace — really the curtained-arch portal) sits on
> wall-value-**0** edges 102/102; features 3-5 and 7-12 sit on
> wall-value-**2** edges (wall decorations); neither ever sits on 1/3.

##### The floor/ceiling pass (`$00:CE4C`/`$00:CE4F`)

After the wall walk, all 27 slots are re-walked (all of them when the
party cell is unmarked — occluded slots' floors are clipped by the
already-drawn walls under the painter): per slot cell, a **ceiling kind**
`$3e` and **floor kind** `$40` are derived from the cell's feature byte
and variant: normal cells use `Yv = ((variant & 0x60) >> 2) | $8e` for the
ceiling and `Yv + 4` for the floor; the `0x0D` sentinel forces kinds
`0x10`/`0x20`; `0x0E` keeps the variant ceiling but floor `0x20`; `0x4E`
and `0x8E` select kind `0x24`; `0x8F` selects `0x10`/`0x26+parity`;
`(feature & 0xC0) == 0x40` marks a **stairs/pit** cell (floor kind
`0x1C`/`0x22` by the `$7E:DBC0` flag, plus event `$0139 |= 5`). Each kind
is a byte offset into **`$80:DED8`** (file `0x05ed8`, 21 pointers), each
pointing at a **27-word per-slot piece table** in bank `$89`
(`$89:FA36`-`$89:FE38`); the slot's word is appended for ceiling and
floor. **This is the SNES's floor/ceiling mechanism** — closing the "no
floor/ceiling continuation piece" walker gap — and it finally explains
the `0x0D` vs `0x0E` "empty" sentinels: they are **floor/ceiling style
selectors**.

##### Handler catalog (dispatch table `$80:C829`, slots 1-26)

Frustum (ahead, lateral) per §3.14.7; `en` = the deeper slot(s) a handler
enables. All table addresses bank `$89`.

| slot | (ahead,lat) | kind | tables | enables |
|---|---|---|---|---|
| 0 | (0,0) | own cell | L `F356`, R `F6C6`, front `EB1A` | 1, 2, 3 |
| 1 | (0,-1) | side L | `EB68` | 4 |
| 2 | (0,+1) | side R | `EBB6` | 5 |
| 3 | (1,0) | front | edges `F3A6`/`F716`, front `EC04` | 4, 5, 6 |
| 4 | (1,-1) | side L | `EC52` | 7 |
| 5 | (1,+1) | side R | `ECA0` | 8 |
| 6 | (2,0) | front | `F3F6`/`F766`, front `ECEE` | 7, 8, 9 |
| 7 | (2,-1) | lat L | perp `ED3C` (en 12), side `F446` (en 10) | |
| 8 | (2,+1) | lat R | perp `ED8A` (en 13), side `F7B6` (en 11) | |
| 9 | (3,0) | front | `F496`/`F806`, front `EE74` | 14, 12, 13 |
| 10 | (2,-2) | side L | `EDD8` | 15 |
| 11 | (2,+2) | side R | `EE26` | 17 |
| 12 | (3,-1) | lat L | perp `EEC2` (en 16), side `F4E6` (en 15) | |
| 13 | (3,+1) | lat R | perp `EF10` (en 18), side `F856` (en 17) | |
| 14 | (4,0) | front | `F586`/`F8F6`, front `F096` | 16, 18 |
| 15 | (3,-2) | lat L | perp `EF5E` (en 20), side `F536` (en 19) | |
| 16 | (4,-1) | lat L | perp `F0E4`, side `F5D6` (en 20) | |
| 17 | (3,+2) | lat R | perp `EFAC` (en 22), side `F8A6` (en 21) | |
| 18 | (4,+1) | lat R | perp `F21C`, side `F946` (en 22) | |
| 19 | (3,-3) | side L | `EFFA` | 23 |
| 20 | (4,-2) | lat L | perp `F132`, side `F626` | |
| 21 | (3,+3) | side R | `F048` | 25 |
| 22 | (4,+2) | lat R | perp `F26A`, side `F996` (en 25) | |
| 23 | (4,-3) | lat L | perp `F180`, side `F676` (en 24) | |
| 24 | (4,-4) | side L | `F1CE` | |
| 25 | (4,+3) | lat R | perp `F2B8`, side `F9E6` (en 26) | |
| 26 | (4,+4) | side R | `F306` | |

This resolves §3.14.5's "a further ~30 tables cover the intermediate
lateral columns" note with the complete address set. Geometry: a *side*
handler's ahead-face eval is the frontal wall segment of an adjacent-
column cell; a *front* handler's left/right-edge evals (the `F3xx`/`F7xx`/
`F8xx` tables) are the **receding** side walls of the dead-ahead chain —
mapping 1:1 onto the Amiga's `9b58` lateral columns and `LAB_0506`
perpendicular dispatcher respectively.

##### The variant byte's source (partially traced; approximation documented)

`$7E:4780` is seeded to `DB7F[level]` and overwritten per region by the
`$80:D25B` blit from a 64-byte pattern buffer (`$7E:49C0`) built at
`$80:D181` by unpacking 2-bit fields → `{0x00,0x20,0x40,0x60}` from 16-byte
rows of **`$80:DB9B`**, row selected via **`$80:DA2E`**`[regionAttr]`
(bit 7 set = pattern row `value & 0x7f`; clear = uniform fill with the
value), where `regionAttr` is the `< 0x50` value family of §3.14.10's own
region-attribute records (stored to `$0B19` — the same table that holds
the `>= 0x50` palette selectors), all gated by runtime mode flags
`$09F0`/`$09F1` not traced to closure. The walker approximates this as
one uniform variant per level (`DB7F`, with `0x80` → `0x40`); still-open
sub-item.

##### Verification

1. **Faithful Python re-implementation** (session scratchpad
   `truewalk.py`): implements the entire walk + §3.14.4 painter from this
   section's traces and renders real poses. **Decisive renders**: level 2
   castle — a plain corridor; a **closed wooden door** dead ahead (wall
   value 3); the same doorframe **open** (wall value 1) with the passage
   and floor continuing through it; level 0 — an outdoor **forest path**
   (variant `0x40` art: trees/hedges as walls) and a stone gatehouse with
   closed door viewed from its far side (the override mechanism); level 4
   — cave walls (variant `0x20`). Complete scenes with correct ceilings,
   floors, and depth recession throughout — categorically beyond the v1
   walker's output.
2. **Cross-implementation identity**: the committed TS port
   (`view-model.ts` v2) reproduces the Python oracle's compose-word lists
   **word-for-word on 7/7 test poses** across levels 0/2/4, facings
   0/1/2/3 (55-71 words per pose, zero deviations) — two independent
   implementations of the same disassembly, no shared code.
3. **Structural invariants** (exporter oracles, run on every export):
   all 4 facings' frustum blocks decompose to identical (ahead, lateral)
   pairs (104/104, with the one known ROM authoring slip at facing 1 slot
   23 documented and normalised); 9/9 wall-table word-1 placements match
   §3.14.5's cited rects; 1,557 distinct referenced compose words resolve
   to valid in-viewport pieces (3 non-drawable sentinels).
4. Golden-fixture unit test (`__tests__/view-model.test.ts`): the TS walk
   must reproduce the Python oracle's word list for the closed-door pose
   exactly (66/66); plus painter-order and seeding unit tests.

Implementation: `tools/wizardry6/snes/view-model.ts` (v2 walk + painter),
`export-dungeon-view.ts` (v2 data export: dispatch tables, all 44 art
records, 21 floor/ceiling tables, resolved pieces; pool atlas extended to
banks `$10`-`$1B`), `render-through-dungeon.ts`, browser wiring unchanged
(`tools/walker/games-w6-snes.ts` updated to the new API).

**Still open after this session** (tracked in `docs/wizardry6/TODO.md`):
true per-cell variant + per-region palette selection (the `$09F0`/`$0B19`
chain above); the `$7E:AC00` trigger-overlay draw pass (`$00:CE00`, runs
before each handler — scripted decorations, not modelled); the `$7E:DBC0`
stairs/pit flag array's writer; the `$094d`/`0x02EC` post-walk overwrite.

---

## 4. Text / font system

### 4.1 Encoding — confirmed for short game-term strings

Contrary to the initial assumption that this would need a fully custom
tile-indexed glyph system, **at least the monster-name table (§6.2) uses
standard single-byte half-width katakana** — CP932/JIS-X-0201 byte range
`0xA1`-`0xDF`, decodable with Python's stock `cp932` codec or (for a
dependency-free TypeScript port, see `tools/wizardry6/snes/decode-monster-names.ts`)
a flat 63-entry lookup table. Multi-word names use `0xA5` (`･`,
half-width middle dot) as a word separator. This was **confirmed** by
decoding 102 consecutive name-pairs with **zero garbage/undecodable
bytes**, every single one an unambiguous, grammatically-correct phonetic
transliteration of its paired English name (e.g. `GIANT RAT` →
`ｼﾞｬｲｱﾝﾄ･ﾗｯﾄ` = *jaianto ratto*; `PIRATE` → `ﾊﾟｲﾚｰﾂ` = *paireetsu*;
`HYDRA PLANT` → `ﾋﾄﾞﾗ･ﾌﾟﾗﾝﾄ` = *hidora puranto*) — see §6.2 for the full
list and record format.

Whether longer in-game text (dialogue, item descriptions) also uses
half-width katakana, switches to full double-byte Shift-JIS/CP932 kanji,
or uses a custom tile-index scheme for kanji specifically is **not yet
determined**. A brute-force scan for valid-looking double-byte CP932
sequences across the whole ROM (`sjis_scan2.py` in the session scratchpad)
found many candidate "kanji-shaped" runs, but manual inspection showed the
large majority are **false positives** — ordinary graphics/tilemap bytes
that happen to fall in valid SJIS lead/trail byte ranges (e.g. a
20-tile-wide run decoding to `丸舘丸舘丸舘...` repeating, clearly
tile-index data, not text). This approach is considered a dead end for
finding *dialogue* text without a confirmed reader/loader; see the
paths-tried table.

### 4.1a The full 8-bit text encoding — confirmed (2026-08-16)

Cracked via the monster-table genus headers (§6.2's "3rd record type"):
their non-ASCII payloads are **glyph indices into the 256-tile dialogue
font** (§3.8, file `0x04c653`) — i.e. the game's single-byte text
encoding IS the font-tile layout:

| Byte range | Meaning |
|---|---|
| `0x20`-`0x7E` | ASCII (glyph index = character code) |
| `0x86` | を |
| `0x87`-`0x8B` | ぁぃぅぇぉ (small vowels) |
| `0x8C`-`0x8E` | ゃゅょ |
| `0x8F` | っ |
| `0x91`-`0x9F` | あいうえお かきくけこ さしすせそ |
| `0xA1`-`0xDF` | standard JIS X 0201 half-width katakana (incl. `0xA5` ･ separator, `0xB0` ｰ, and `0xDE`/`0xDF` dakuten/handakuten as **trailing combining marks**, applying to hiragana too) |
| `0xE0`-`0xFD` | たちつてと なにぬねの はひふへほ まみむめも やゆよ らりるれろ わん |
| `0xA2` | doubles as an in-ASCII-name separator (e.g. `GUARDIAN·ROCK`) |

So the scheme is JIS X 0201 (ASCII + half-width katakana) **extended
with hiragana squeezed into the unused byte ranges** `0x86`-`0x9F` and
`0xE0`-`0xFD` — one byte = one 8x8 glyph everywhere. Derivation:
rendered the genus payloads' glyph sequences straight from the extracted
`sprites/font.png` and read them — 18/18 fully legible, each the
semantic Japanese translation of its paired English name (`VINE` →
つるくさ, `STINKING CORPSE` → くさいしたい, `GHOST` → ゆうれい, `NATIVE` →
げんじゅうみん, `UNDEAD PHARAOH` → ふしのファラオ, ...), then
cross-verified positionally (く=0x98/さ=0x9B/し=0x9C/す=0x9D from
independent words all landing in one gojūon run; た=0xE0 onward likewise;
the small-kana block read directly off the font sheet's tiles
`0x86`-`0x8F`). Implemented in `decode-monster-names.ts`'s
`decodeGameText` (dakuten-combining included); the extractor now also
emits all **79 genus headers** with decoded Japanese names
(`monster-names.json`'s `genusHeaders`), closing
`snes-monster-table-nonkana-field`.

This resolves the *byte→glyph* half of `snes-text-dialogue-encoding` for
all 8-bit text (names, menus). Still open there: the 16-bit token space
of the script system (§6.6) — presumably indices into the 16x16 kanji
font (§4.4) by an analogous convention, not yet traced.

### 4.2 Debug/internal English strings — confirmed present, extensive

Unexpectedly for a Japan-only release, the ROM carries a large amount of
plain-ASCII English text that appears to be internal/debug identifiers
carried over from development (or from a shared source database with the
DOS/Amiga versions), not display text:

- A `"DATA ERROR"` string + a `"0123456789ABCDEF"` hex-digit charset
  appear twice (file `0x7F64` and `0xB01C`, and a third similar hex table
  at `0xAA43`) — almost certainly a leftover QA/debug error screen, not
  gameplay-relevant.
- `"Game Studio Inc."` (the Japanese localization studio credited on
  superfamicom.org) is repeated **thousands of times** filling large
  unused ROM regions (e.g. file `0xD5120` onward, a 12,001-byte
  contiguous run) — a filler/watermark pattern, useful as a quick "this
  region is padding, not real data" signal for future passes, not content
  itself.
- The class-tier title table (§6.1) and the monster-name table (§6.2) are
  both substantially in plain ASCII.

### 4.3 Font tile graphics — UI icon bank confirmed; the real dialogue font is now also confirmed (see §3.8)

> **Correction/closure (this session): the dialogue font is found.** The
> "still open" framing this section previously ended on is resolved — a
> `re-codebreaker` escalation (researching the title-screen lead) found it
> as a side effect while tracing the same task-scheduler function that
> loads the main CGRAM snapshot (§3.5's correction): file `0x04c653`, 256
> tiles, 2bpp, **uncompressed**. Independently re-verified this session
> with a from-scratch render: the full bank composes to an unmistakably
> legible glyph set (digits, `A`-`Z`, hiragana, katakana, UI symbols) — see
> **§3.8** for the full write-up and `decode-opening-sequence.ts` for the
> extractor. This closes the `snes-font-tile-bank` open item. The
> glyph-to-character-code mapping (which byte value selects which tile) is
> still undecoded — see `snes-text-dialogue-encoding` in
> `docs/wizardry6/TODO.md`, unchanged/still open.
>
> The UI icon bank write-up below (this session's *previous* advance, now
> superseded as "the font") is left intact — it's a real, separately
> confirmed, useful asset (§3.2/§3.2b now has its full palette too), just
> not the dialogue font as originally hoped.

The tile *pixel format* question this item used to carry is resolved by
§3.1 (confirmed standard SNES 4bpp bitplane-interleaved 8x8 tiles) — this
narrows the remaining problem to *locating* the font bank specifically, not
figuring out how to decode it once found.

**This session's advance**: re-ran the same MVN-census technique that
cracked §3.2's portrait bank, filtered this time to *all* `dst=$7f`
occurrences (46 total across the ROM, not just the 3 already tied to
portraits) rather than only the ones already connected to the tile loader.
Two more `src=$85` hits stood out, both in the same one-time boot-init
routine as the confirmed portrait-bank MVNs (§2.2-adjacent, CPU bank `$01`/
mirror `$81`):

- File `0x008e42` (CPU `$01:8E42`): `MVN $7f,$85`, source X=`$ad57`, dest
  Y=`$1000`, size `0x400` (1024 bytes = 32 tiles). Source file offset:
  `0x2ad57` — **the exact byte immediately after the confirmed portrait
  directory's pool A** (§3.2), previously (wrongly) described as noise —
  see the correction note in §3.2.
- File `0x0080b9` (CPU `$01:80B9`): `MVN $7f,$85`, source X=`$c177`, dest
  Y=`$0da0`, size `0x1180` (4480 bytes = 140 tiles). Source file offset:
  `0x2c177`, further into the same gap region.

Rendering the whole `0x2ad57`-`0x2e000` span (405 tiles, the full gap
between the two confirmed portrait-directory pools) at 4bpp produces
**legible, coherent content**, not noise: a decorative gradient/border
strip, then individually recognisable UI icon tiles — unambiguous
half-width `E`/`S`/`W`/`N` compass letters (a dungeon-navigation facing
indicator, exactly the kind of thing a first-person dungeon crawler needs
on its status bar), digit-like `0`/`2` tiles, arrows, and small
item/action icons (a chest, boots/footprints). This is a real, ROM-sourced,
confirmed tile bank — but it's a **UI icon set, not an A-Z/kana text
font**: no alphabet or katakana/hiragana/kanji glyph shapes appear anywhere
in the 405-tile span.

**Connection to the `$88C9` VRAM-upload loop (§3.4) is partial, not
complete.** `$88C9`'s own caller (file `0x50830`-`0x508c6`, CPU
`$0A:8830`-area) invokes it 16 times with WRAM `$7F` source offsets
spanning `0x0000`-`0x0aa0` (in `0x154` steps) — drawing what is very likely
this same compass-letter UI, based on the two-pass forward/reverse call
order matching a "highlight current facing" redraw pattern. A second,
adjacent DMA-setup routine in the same bank (file `~0x507c0`-`0x5081x`)
transfers WRAM `$7f:0aa0`-`0x11a0`+ to VRAM directly (not through `$88C9`),
and *that* range does overlap the confirmed ROM-sourced block (`0x0da0`
onward is exactly the `0x0080b9` MVN's destination) — so **some** of this
UI icon bank is confirmed to reach VRAM through a traced DMA path. The
earlier part of the range (WRAM `$7f:0000`-`0x0aa0`, which `$88C9`'s first
several calls actually read) was **not** traced back to a ROM source this
session — it's presumably filled by a third loader not yet found, or by
one of the many other `dst=$7f` MVN sites this census surfaced but didn't
individually verify (43 more candidates beyond the 3 already tied to
portraits and the 2 found this session — see the source list in the
scratchpad probe; not exhaustively checked).

**The actual dialogue/menu text font remains unlocated.** Nothing in the
now-confirmed `0x2ad57`-`0x2e000` UI-icon bank reads as alphanumeric or
kana glyph shapes, so this does not close the text-encoding question in
§4.1/§4.3 — a full font (needed to render the confirmed half-width-katakana
monster names, §6.2, and whatever full dialogue text turns out to be, per
§4.1) is very likely a separate, larger bank elsewhere, not yet located.
Still open — see the paths-tried table.

### 4.4 Main kanji/kana font — confirmed by render (banks `$1C`-`$1D`)

File `0x0E0000`-`0x0F0000` (64 KB, banks `$1C`-`$1D`) is the game's **main
Japanese glyph bank**, distinct from the 256-tile 2bpp dialogue font at
`0x04C653` (§4.3) — that one is the small/ASCII-plus-kana set; this is the
full kanji/kana face.

- Glyphs are **16x16 pixels**, i.e. four 8x8 tiles each.
- Decoding the region as standard SNES 4bpp 8x8 tiles and laying them out
  32 tiles/row renders the glyphs legibly (session scratchpad
  `font_4bpp_zoom.png`); 2bpp and 1bpp interpretations both render broken
  (`font_2bpp.png`, `font_1bpp_col.png`), so 4bpp is the right depth.
- **Verification (render oracle):** the first ~40 glyphs read, in order, as
  the hiragana syllabary in standard *gojūon* order — あいうえお / かきくけこ /
  さしすせそ / たちつてと / なにぬねの. A font laid out in canonical syllabary
  order is a strong oracle: it means the glyph index is a direct, ordered
  function of the character code, which should make the open
  `snes-text-dialogue-encoding` question substantially easier.
- The exact glyph stride and the tile-order-within-glyph (row-major vs
  column-major 2x2) are **not yet pinned down** — the legible render came
  from a flat 8x8 tile grid, not a glyph-aware composer.

---

## 5. Audio (SPC700)

### 5.1 SPC upload handshake — confirmed

Byte-pattern census for the classic APU-I/O ports (`$2140`-`$2143`, the
main-CPU side of the SNES's SPC700 co-processor communication):
`LDA $2140` (8 hits), `STA $2140` (11 hits), `CMP $2140` (10 hits) —
**all 29 hits cluster tightly in a single ~1,417-byte span**, file
`0xF06EC`-`0xF0C75` (CPU `$1E:86EC`-`$1E:8C75`, mirror-equivalent to
`$9E:86EC`-`$9E:8C75`). Zero hits anywhere else in the 3 MB ROM. This is
the SPC700 driver-upload routine.

Disassembling the upload's data-transfer sub-loop (file `0xF0A4A`, CPU
`$1E:8A4A`/`$9E:8A4A`) shows the **textbook SNES IPL boot-ROM handshake**
byte-for-byte: `LDA #$BBAA` compared against a DP-relative echo, and
`LDA #$CC` (`STA` to a mailbox variable) — `$BBAA` is the SPC700 IPL
bootrom's documented "ready" acknowledgement value and `$CC` its
documented "start execution at this address" command byte. This is
independently-known, publicly-documented SNES hardware protocol, so this
finding is **confirmed** at high confidence even without further tracing.

### 5.2 Driver/sample source location — confirmed (start address only)

The upload's inner copy loop reads `LDA $9E8919,X` (file offset `0xF0919`,
CPU `$9E:8919` / mirror `$1E:8919`) — this is the ROM-side start address of
whatever blob gets shipped to the SPC700 (driver code + BRR-compressed
samples, typically bundled together for this era of SNES game). **Total
size still not determined.**

**Attempted this session**: disassembled the generic block-oriented SPC
upload routine at file `0xF0AB0` (CPU `$9E:8AB0`-area, called in a loop
from `0xF0A4A`) — it's a reusable multi-block loader: `LDY $0000,X` (block
size) / `INX INX` / `LDA $0000,X` (destination SPC address) / `INX INX`,
transfer `Y` bytes via the IPL handshake, loop for the next block, with
`size == 0` read as the terminator (`CPY #$0000; BEQ` to a final
acknowledge-code check). Parsing `0xF0919` onward under this exact
`[u16 size][u16 addr][size bytes]`-repeated model **desyncs almost
immediately** — the very first "block" claims a plausible-looking size
(2915 bytes), but by block 2 sizes balloon to 50-65K (larger than a whole
bank) and the parse runs off the end of the ROM within ~100 blocks. This
means either the field order/width inferred from the disassembly is wrong
(a bank byte or flag byte between fields? size and address swapped for
some blocks?), or `0xF0919` isn't actually the start of the first
*header*-bearing block (maybe the very first block's header is elsewhere,
or the format has a different leading structure before the repeating
part). Not resolved this session — see the paths-tried table.

> **Resolved (2026-08-16): the premise was wrong — `0xF0919` is not a
> block stream at all, and both this row's question and §5.4's missing
> sample directory close together. See §5.5.** The desync was structural:
> `$9E:8919` is the **song → module-set table** (37 songs × 5 module
> numbers, `0xFF` = unused — the first "size" 0x0b63 was really the
> module-number pair `63 0b` of song 0), read by the driver's
> song-request handler at file `0xF0740` (`LDA $9e8919,X`, X =
> song*5, comparing each row byte against the currently-resident set at
> `$0F00`-`$0F04` and uploading only the changed modules). The actual
> block streams live behind a separate 151-entry far-pointer table
> (§5.5); the SPC **driver** is module 150 (bootstrapped via the pointer
> at `$A0:81C2`, 8 blocks into low SPC RAM `$00A2`-`$04xx`, file
> `0x16EE88`-`0x16FCDF`, 3,671 B) plus module 149 (`#$95`, SPC
> `$2E00`/`$2300`, file `0x18DEE6`-`0x18EB95`, 3,247 B).

### 5.5 Sound-module directory — confirmed (151 modules + 37 songs; closes the BRR-directory and driver-size rows)

**The per-sample/per-module directory §5.4 couldn't find is a 151-entry
× 3-byte far-pointer table at `$A0:8000` (file `0x100000`):** each entry
`[u16 CPU addr][u8 bank]` points at a **0-terminated chain of
`[u16 size][u16 spcDestAddr][size payload bytes]` upload blocks** — the
exact structure `$1E:8AB0` transfers over the IPL handshake. Found by
reading the boot uploader's *sibling* entry `$1E:8AF8(A)` ("upload module
#A"): `X = A*3; LDA $A0:8000,X` (addr), `$A0:8002,X` (bank).

Verification (zero deviation):
- **All 151 modules' block chains parse and terminate cleanly** inside
  the ROM (0 failures), spanning file `0xF7000`-`0x18FFF3` — 622,540
  bytes, which is §5.4's "620 KB BRR region" almost exactly, and refines
  its start (bank `$1E`'s tail from `0xF7000`, not `0xF8000`).
- The table is **self-describing**: its own end (`0x100000 + 151*3 =
  0x1001C5`) equals the lowest module target inside bank `$A0` byte-exact
  (module 99 starts at `0x1001C5`).
- The song table's 37×5 rows all reference valid module numbers
  (`< 151`) or `0xFF`, and the table ends at `0xF09D2` exactly where
  driver code resumes.
- Boot cross-check: song 0's row is `63 0b ff ff 29` — exactly the three
  modules the RESET-path uploader loads by literal number
  (`$1E:8A52`-`$1E:8A6F`: `#$63`, `#$0B`, `#$29`), plus the
  separately-loaded `#$95` (module 149, driver data).

Block destinations even classify content: modules landing at low SPC RAM
(`< $0800`) are driver code/dispatch data (module 150); `$1200`-`$3400`
regions are music sequences/instrument tables; large single blocks are
BRR sample banks (e.g. module 99: one 0x6480-byte block at SPC `$3430`).

Extractor: `tools/wizardry6/snes/decode-spc-modules.ts` (oracle-guarded
on all three checks above) → `public/assets/wizardry6/snes/data/
spc-modules.json` (all 151 modules with file offsets/lengths/SPC block
maps + the 37-song table).

### 5.3 Reset-time call site — confirmed

RESET (§2.2, file `0x8184`) calls `JSL $9E8A4A` (file offset `0xF0A4A`)
exactly once, as its last piece of one-time init before entering the
NMI-driven idle loop. `0xF0A4A` falls **inside** the independently-found
`0xF06EC`-`0xF0C75` handshake cluster (§5.1) — two unrelated searches (a
reset-flow trace and a register-access census) converged on the same
routine, which is strong mutual confirmation for both findings.

Raw disassembly: `docs/wizardry6/snes/disasm/spc_upload_handshake.txt`
(file `0xF06EC` onward, r2 output, same §2.1 flag-width caveat applies to
anything past an 8-bit-immediate stretch).

### 5.4 BRR sample banks — confirmed (structural), banks `$1F`-`$31`

File `0x0F8000`-`0x190000` (**620 KB, 19.7% of the ROM**) is SPC700 **BRR
(Bit Rate Reduction) audio sample data**, sitting immediately after the SPC
driver (§5.2) and immediately before the spell-animation bank (§6.4).

BRR format: 9-byte blocks = 1 header byte + 8 data bytes; header =
`range<<4 | filter<<2 | loop<<1 | end`; `range > 12` is invalid; the `end`
bit terminates a sample.

**Verification (zero-deviation structural invariant).** Walking 9-byte
blocks from an aligned start and requiring `range <= 12` at every header,
a *random* byte stream continues with probability `13/16 * 1/2 = 0.406`,
i.e. an expected run of ~1.7 blocks. Observed runs in this region are
**341, 603, 842, 1059 and 444 blocks** at file `0x0F8003`, `0x188003`,
`0x150003`, `0x110021`, `0x130020` respectively, and every 9-aligned start
inside a sample converges on the *same* terminating `end` block (runs
decrease by exactly 1 per 9 bytes advanced) — the signature of a real BRR
stream. Control probes in known-code and known-graphics regions
(`0x020000`, `0x200007`, `0x280000`, `0x2F8000`) give runs of 7-16, i.e.
chance.

Region-level check: scanning every 4 KB block in the ROM for "does a
≥40-block valid BRR run start within the block's first 9 bytes",
**448 KB of the 620 KB span (72% of its blocks) is positive, versus 7
isolated 4 KB false positives across the other ~2.5 MB of ROM (0.3%)**.
The negative blocks inside the span are simply block interiors where no
sample boundary happens to fall in the first 9 bytes.

Decoding samples with the standard BRR filter set produces smooth,
audio-like waveforms (mean absolute first-difference / standard deviation
of 0.08-0.81, i.e. strongly band-limited, not noise). No per-sample
directory has been located yet — see the TODO row.

---

## 6. Game data tables

### 6.1 Class-tier title table — confirmed

File offset `0xB074`-`0xB3C3`: **98 back-to-back null-terminated ASCII
strings, no length prefix, no pointer table** — 14 groups of 7. Grouping
by 7 and reading the group order reproduces, **byte-for-byte, the exact
class order independently confirmed in the Amiga corpus**
(`docs/wizardry6/amiga/data-structure.md`: `FIG MAG PRI THI RAN ALC BAR
PSI VAL BIS LOR SAM MON NIN`), with each group's first (entry-level) title
matching Wizardry 6's well-known class rank-title system exactly:

| Class | Titles (rank 0 → 6) |
|---|---|
| FIG | JOURNEYMAN, WARRIOR, MARAUDER, GLADIATOR, SWORDSMAN, WARLORD, CONQUERER |
| MAG | MAGICIAN, CONJURER, WARLOCK, SORCERER, NECROMNCER, WIZARD, MAGUS |
| PRI | ACOLYTE, HEALER, CURATE, DRUID, HIGHPRIEST, PATRIARCH, SAINT |
| THI | ROGUE, TRICKSTER, HIWAYMAN, BUSHWACKER, PIRATE, MS.SHADOWS, GUILDMASTER |
| RAN | WOODSMAN, SCOUT, ARCHER, PATHFINDER, WEAPONEER, OUTRIDER, RANGERLORD |
| ALC | HERBALIST, PHYSICIAN, ADEPT, SHAMAN, EVOCATUR, MS.ELIXERS, ENCHANTER |
| BAR | MINSTREL, CANTOR, SONNETEER, TROUBADOR, POET, MS.LUTES, MUSE |
| PSI | PSYCHIC, SOOTHSAYER, VISIONIST, ILLUSIONIST, MYSTIC, ORACLE, PROPHET |
| VAL | LANCER, WARRIOR, CAVALIER, CHEVALIER, CHAMPION, HEROINE, OLYMPIAN |
| BIS | FRIAR, VICAR, CANON, MAGISTRATE, DIOCESAN, CARDINAL, PONTIFF |
| LOR | SQUIRE, GALLANT, KNIGHT, CHEVALIER, PALADIN, CRUSADER, MONARCH |
| SAM | BLADESMAN, SHUGENJA, HATAMOTO, DAISHOMASTER, DAIMYO, WARLORD, SHOGUN |
| MON | INITIATE, BROTHER, DISCIPLE, APOSTLE, MASTER, IMMACULATE, GRANDMASTER |
| NIN | GENIN, EXECUTIONER, ASSASSIN, CHUNIN, MASTER, JONIN, GRANDFATHER |

This is treated as **confirmed** on the same basis the Amiga doc uses for
its XP-table oracle: the table shape (14 groups of a round, fixed size),
the group *count*, and the group *order* all independently match a known
game fact with zero deviation. Extractor:
`tools/wizardry6/snes/decode-class-titles.ts`, output
`public/assets/wizardry6/snes/data/class-tier-titles.json`. The extractor
enforces the same oracle check at run time (compares each group's first
title against the expected roster and refuses to write output on any
mismatch) — run it any time as a regression check.

Immediately following (file `0xB3DD`-`0xB47A`): 11 more null-terminated
ASCII strings — `VORPAL BLADES, CLOUD OF FEAR, POISON DAGGER, PRISMIC
MISSILE, RAY OF ENFEEBLE, ENERGY DRAIN, CURSE OF MEDUSA, PHANTASMAL HAND,
NOXIOUS VAPORS, FIRE BOMB, KISS OF DEATH` — recognizable as monster
special-attack names from Wizardry 6's bestiary. **Rendered** confidence
only (plausible content, not traced to any code consumer this pass).
Extracted alongside the class titles in the same JSON file.

### 6.2 Monster name table — confirmed (encoding + 102 entries)

File offset `0x46328` onward: a long run of paired records —

```
[0x80][len][ASCII English name, len bytes]
[0x81][len][half-width katakana transliteration, len bytes]
```

A tolerant scan (resyncing on single-byte misalignment) decoded **102
consecutive pairs with zero garbage bytes**, spanning file
`0x46332`-`0x475C5` (~0x1300 bytes). Every single transliteration is an
unambiguous, grammatically-correct phonetic rendering of its paired
English name — e.g.:

| English | Katakana | Reading |
|---|---|---|
| GIANT RAT | ｼﾞｬｲｱﾝﾄ･ﾗｯﾄ | jaianto ratto |
| VAMPIRE BAT | ﾊﾞﾝﾊﾟｲｱ･ﾊﾞｯﾄ | banpaia batto |
| ZOMBIE | ｿﾞﾝﾋﾞ | zonbi |
| PIRATE | ﾊﾟｲﾚｰﾂ | paireetsu |
| WATER DRAGON | ｳｫｰﾀｰ･ﾄﾞﾗｺﾞﾝ | wootaa doragon |
| MIND FLAYER | ﾏｲﾝﾄﾞ･ﾌﾚｲﾔｰ | maindo fureiyaa |
| HYDRA PLANT | ﾋﾄﾞﾗ･ﾌﾟﾗﾝﾄ | hidora puranto |

(full 102-entry list in
`public/assets/wizardry6/snes/data/monster-names.json`). English names
substantially overlap with real Wizardry 6 monsters already documented in
the Amiga corpus's 250-monster bestiary (Amazulu tribe NPCs, dragons,
undead, giants, etc.), giving an independent content cross-check on top of
the encoding-level one.

This is a strong content-level analog to the Amiga port's
`CREDITS.PIC`-as-early-oracle role: it's the first fully legible,
independently-verifiable in-game text decoded on this platform.

A handful of records (observed: the genus-header entry `VINE` at file
`0x463A4`) don't fit the two-field pattern. Re-examined this session with a
direct hex read of the surrounding bytes (file `0x463a4`-`0x463d4`):

```
80 04 "VINE"                          record 1: tag 0x80 (English), len 4
80 04 E2 F9 98 9B                     record 2: tag 0x80 (English!), len 4, non-ASCII payload
80 0B "FUMING VINE"                   record 3: tag 0x80, len 11 (normal monster English name)
81 0C <12 bytes katakana>             record 4: tag 0x81 (translation of record 3)
80 0E "STRANGLER VINE"                record 5: tag 0x80, len 14
81 0D <13 bytes katakana>             record 6: tag 0x81 (translation of record 5)
```

**Correction to the original framing**: record 2 is tagged `0x80` (the
*English* tag), **not** `0x81` — it was never a katakana-translation field
with invalid bytes; it's a **third record type** that reuses the `0x80`
tag byte for non-text binary data. The structural position is now clear —
`[0x80 genus English name]` + `[0x80-tagged binary metadata]` sandwiched
between the genus header and the first real `[0x80 English]`/`[0x81
katakana]` monster-entry pair — confirming the "genus/category header"
hypothesis at the structural level, though the binary payload's semantic
meaning (icon/sprite-index? behaviour flags? colour?) is still unknown.

> **Resolved (2026-08-16, closes `snes-monster-table-nonkana-field`):**
> the "binary metadata" is the genus's **Japanese display name in the
> game's own 8-bit text encoding** (§4.1a — font-tile indices; hiragana
> live in custom ranges `0x86`-`0x9F`/`0xE0`-`0xFD`, which is exactly why
> both the ASCII and half-width-katakana validators rejected these
> payloads). A resync-tolerant census decodes **79 genus headers**, all
> legible and semantically matching their English pair (`VINE` →
> つるくさ, `CLOUD` → くも, `GIANT` → きょじん, ...). Regular monster
> entries use pure katakana transliterations (tag `0x81`); genus headers
> use real Japanese translations (tag `0x80` reused), often in hiragana —
> the encoding difference, not a different data kind, was the whole
> mystery. Extractor updated (`decode-monster-names.ts`,
> `genusHeaders` in `monster-names.json`).
Attempting to enumerate further instances by continuing a naive sequential
scan past this record **cascades into desync** (a wrong assumed length at
this one anomaly misaligns every subsequent tag/length read for the rest
of the table) — the existing tolerant/resyncing scanner behind the
102-pair result in §6.2 above correctly skips it, but a proper census of
*all* genus-header binary fields needs that same resync-on-error logic,
not a plain linear walk. Not attempted further this session — see the
paths-tried table (now at one *characterized* instance with a confirmed
structural role, up from one *uncharacterized* instance).

Extractor: `tools/wizardry6/snes/decode-monster-names.ts`, output
`public/assets/wizardry6/snes/data/monster-names.json`.

### 6.3 Other leads, not yet decoded

- The `0x46333` region continues past the 102 decoded pairs (last decoded
  entry `PHANTASM` at file `0x475C5`) toward a `"TEST CHARACTER"` string
  around file `0x475DA` — likely the tail end of this same table
  (possibly a QA/debug entry), not yet characterized.
- No classic Wizardry spell-name strings (`MAHALITO`, `KATINO`, `DUMAPIC`,
  etc. — the traditional Wizardry spell-name vocabulary, none of which are
  plain English words) were found anywhere in the ASCII string corpus —
  unlike class titles and monster names, spell names appear to have *no*
  retained English internal identifier, consistent with them being
  authored/localized directly in Japanese with no DOS-source-derived debug
  label.
- Item names, full monster stat records (HP, attacks, resistances — the
  Amiga corpus's `scenario.dbs` equivalent), and spell-effect tables were
  not searched for this pass beyond the incidental ASCII strings above.
  8,872 printable-ASCII strings ≥5 bytes were extracted corpus-wide
  (session scratchpad `all_strings.txt`) as a starting point for a
  follow-up categorization pass.
- `"FAT0SHVC"` debug tag (file `0x66C29`) — quick look only this session,
  per task scope. Immediately before the tag: 8 byte-pairs, each with a
  fixed second byte `0x01` and a varying first byte (`0x01, 0x09, 0x03,
  0x0b, 0x02, 0x0a, 0x05, 0x0d`) — no obvious meaning found in the time
  spent. Immediately after the tag: a `0x01` byte, then a run of ~30
  `0x03` bytes, then zero padding. Role still not determined; not pursued
  further.

### 6.4 Spell/combat animation bank — confirmed (was misidentified as dungeon/maze data)

> **Correction (this session): the previous "dungeon-corridor-art
> candidate" framing below is refuted.** A `re-codebreaker` escalation,
> asked to resolve this section's JSL/BRK inconsistency, found that this
> region is real, code-consumed, decodable data — but it's the game's
> **spell and combat special-effect animation bank**, not maze geometry or
> corridor wall art. There is no dungeon/maze-geometry lead in this ROM at
> all as of this session; the `snes-dungeon-maze-data` open item is
> **closed** (renamed/retargeted, see `docs/wizardry6/TODO.md`). The
> original material is kept below (collapsed) since it documents a genuine
> false-positive pattern worth remembering, but should not be treated as
> live evidence for dungeon art.
>
> **Independently re-verified this session** (not just trusted from the
> escalation report): re-implemented the master-directory parse, one
> record's frame-table parse, and the LZSS decoder from scratch and ran
> them directly against the ROM — see the verification bullets below.
>
> **Format — confirmed.** ROM banks `$32`-`$3F` (file `0x190000`-
> `0x1FFEF1`) hold a master directory + 139 variable-length records:
>
> - **Master directory**: file `0x190000`, 139 x `u16` LE record pointers
>   (CPU addresses within bank `$32`, unordered). `fileOffset = 0x190000 +
>   (word - 0x8000)`. Re-derived this session: minimum resolved pointer is
>   file `0x190116` — zero gap immediately after the 278-byte directory
>   itself, matching the escalation's own boundary claim exactly.
> - **Record** (variable length, back-to-back from file `0x190116`):
>   `lead` (1 byte, bit 7 selects mode) + graphics pointer (2-byte addr + 1
>   byte bank) + frame-table pointer (2-byte addr + 1 byte bank) + an
>   animation `sequence` (`u8` 1-based frame numbers, `0x00`-terminated).
>   **Mode A** (`lead` bit 7 clear, 115/139 records): frame table is an
>   array of `u16` LE pointers (count = `max(sequence)`), each pointing to
>   a frame entry `[x][y][w][h]` + `w*h` x `u16` LE SNES BG tilemap words
>   (tile number in the low 10 bits). Graphics are 4bpp. **Mode B** (`lead`
>   bit 7 set, 24/139 records): frame table is flat, no pointer array —
>   frame `k` is 9 raw `u8` tile indices at `frameTablePtr + k*9`, laid out
>   3x3/24x24px. Graphics are 2bpp. **Re-derived and hand-verified this
>   session**: record 0 (lead `0x06`, mode A) decodes to 9 frame-table
>   entries with byte-exact increasing offsets and small, in-range tile
>   numbers; record 23 (lead `0xc2`, mode B) decodes to 17 frames where
>   **every frame's 9 tile-index bytes are identical** (frame `k` -> tile
>   `k+1` uniformly) — a uniform-fill effect frame (e.g. a screen flash or
>   dither/dissolve step), not 9 independently-placed tiles. This matches
>   the escalation's own "expanding rings, sparkles, dither-dissolve
>   patterns" render description for mode B.
> - **Graphics**: `[u16 LE compressedSize][LZSS stream]` at the graphics
>   pointer, same codec as the opening sequence (§3.8, `$83:8000`, file
>   `0x18000` — see `tools/shared/snes-lzss.ts`). Record 0's blob (file
>   `0x1e559b`) decompresses to exactly 4160 bytes (130 tiles) — re-derived
>   this session with a from-scratch LZSS implementation, zero overrun.
>
> **Confirmed by render**: record 0's decompressed tile bank (this
> session's own render, session scratchpad, not committed) shows a
> coherent, organic, cloud/particle-like shape — not noise, not a
> repeating abstract pattern — consistent with a spell-effect sprite
> (fireball/burst/cloud). The escalation's own contact-sheet render of all
> 139 records (not independently reproduced in full this session, but
> corroborated by the record-0 spot check) reports unmistakable spell/
> combat art across the corpus: fireball ignite/burst/dissipate, lightning,
> skulls, a web, a tornado, a Medusa head, magic circles, star bursts,
> weapon swipes, gas clouds.
>
> **Root cause of the original "dungeon corridor art" misreading,
> resolved**: the byte-density scan below correctly found real structure
> (the `[tag][id]`-shaped bytes are genuine SNES BG tilemap words — the
> "tag" is actually the *high* byte of a `vhopppcc cccccccc` word, and
> `0x14`/`0x54`/`0x94`/`0xD4` are simply the four flip/priority
> combinations of one specific palette — not a maze-wall category code),
> but the semantic interpretation (dungeon geometry) was wrong, and the
> region's true bounds were both underestimated (`0x19fd70` vs. the real
> start `0x190000`) and overestimated (the "continues past `0x1ff6d4`"
> reading below was itself a second false positive — see the correction
> after the collapsed section).
>
> **The JSL/BRK inconsistency itself is also resolved**: it was never a
> real code reference at all. The 4 "identical `JSL` call sites" and their
> shared "target" were both artifacts of the same class of tilemap-word
> data being scanned as if it were code — a plain, well-formed `22 21 ba
> 3a` (`JSL $3aba21`) byte sequence really does appear at all 4 cited file
> offsets (re-verified by hand this session), but each sits inside *more*
> of the same dense tilemap-word data (confirmed by dumping ~200
> surrounding bytes at each site — no plausible surrounding instruction
> stream), not inside real disassemblable code. The true consumer
> (`$02:DFBB`, reading the master directory via `LDY $7ffe,X` with `DBR =
> $b2`) was invisible to *any* long-addressing-instruction census: the read
> is DBR-relative (no long/absolute address operand to find), and even its
> raw table-base operand (`$7ffe`) falls *below* `$8000` — i.e. this
> project's own "operand must be `>= 0x8000`" LoROM-validity filter (which
> cut the original 937 raw hits down to a "high-confidence" 31) would have
> silently discarded the one real call site twice over, by both operand
> value and addressing mode. Filed as a new pitfall,
> `indexed-table-base-below-valid-rom-window.md`.
>
> **Palette — CONFIRMED (2026-08-16, this session).** The answer was
> hiding in the format itself: **mode-A frames are BG tilemap words, and
> tilemap words carry their own per-cell palette field** (bits 10-12).
> There is no separate "spell-animation palette" to locate — each cell
> names its own BG sub-palette, and the colour source is the **boot CGRAM
> shadow's BG rows** (the `$7E:3800` shadow's ROM initialiser at file
> `0x127e4`, §3.5), which stay resident during combat. Evidence, three
> independent legs:
>
> 1. **Corpus census** — decoding the palette field of every mode-A
>    tilemap word across all 115 mode-A records (77,056 cells) gives
>    histogram `{0: 3720, 1: 5999, 3: 15234, 4: 11478, 5: 25594,
>    6: 888, 7: 14143}`. Sub-palettes are *deliberately* chosen per cell
>    (7 distinct values in active use), which is only meaningful if the
>    field is live — a "palette-agnostic, recoloured at upload" bank
>    would leave it constant.
> 2. **The designed hole** — sub-palette **2 is used by ZERO of 77,056
>    cells**. Row 2 is exactly the slot the dungeon-region palette swap
>    overwrites per-region (§3.14.10) — i.e. the artists avoided the one
>    BG row whose contents are unstable at combat time. A random or dead
>    field would not exhibit this precise avoidance.
> 3. **Decisive render** — compositing record 11's three largest mode-A
>    frames in colour, applying each cell's own palette field against the
>    boot-shadow BG rows, produces a coherent **gold-and-blue magic
>    casting circle** (concentric rings, radial spokes, blue gems)
>    dissolving across the three frames — unmistakable spell-cast art
>    with sane colour assignments (gold linework, blue accents, dark
>    ground), not the arbitrary recolouring a wrong palette source
>    yields.
>
> The `$ca=0x1e`/`0x23` candidate below is also now fully accounted for:
> disassembly at file `0x6dc0`-`0x6e5d` shows the two records load the
> **two combat monster groups' OBJ palettes** (X=`0x140` → OBJ rows 2-3
> for group A; X=`0x180` → CGRAM 192/OBJ rows 4-5 for group B) from the
> creature-palette staging buffer `$7e:3940` — creature sprites, not
> spell animation, exactly as the ruling-out below suspected.
>
> Mode-B (2bpp) frames have no tilemap words, so their palette remains
> tied to the unresolved blit-destination question (2bpp strongly
> suggests the mode-1 BG3 text/overlay layer, whose 4-colour sub-palettes
> also live in the boot shadow's first CGRAM rows — hypothesis).
> `decode-spell-animations.ts` now exports the 8 boot-shadow BG rows as
> `bgPalettes` in `spell-animations.json` so consumers can compose mode-A
> frames in true colour.
>
> **Follow-up session attempt (still open, one lead ruled out).** Censused
> the whole ROM for `STA $ca` (`85 ca`, the CGRAM-DMA record selector DP
> byte used by the confirmed portrait/UI-icon palette loads, §3.3/§3.2b):
> 21 hits total. Filtering to the ones with a resolvable immediate operand
> (`LDA #imm; STA $ca`, 17 of 21 — the other 4 land inside confirmed *data*
> banks, not code, and are byte-pattern coincidences, not real
> instructions) and decoding each against the confirmed 3-array CGRAM-DMA
> dispatch table (§3.3: `cgadd=data[0x4162+i]`, `src=data[0x4163+i]|
> data[0x4164+i]<<8`, `size=data[0x4165+i]|data[0x4166+i]<<8`) found one
> candidate not previously catalogued: `$ca=0x1e`/`0x23` → `CGADD=0xA0`
> (sub-palette 10), `src=$7e:3940`, `size=0x40`/`0x80`. **Ruled out as the
> spell-animation palette**: the three call sites found (file `0x006dec`,
> `0x006e4b`, `0x05f65e`) share a byte-identical ~16-instruction preceding
> code sequence, and `0x05f65e` sits *immediately after* the confirmed
> creature-sprite-bank consumer (§3.11, file `0x05F61E`-`0x05F650`) — this
> is almost certainly the **creature-sprite palette**, not spell
> animation's. No call site was found near the spell-animation master
> directory's own consumer (`$02:DFBB`, file `0x15fbb`) within a ±2KB
> window. Still open — see the TODO row.
>
> Extractor: `tools/wizardry6/snes/decode-spell-animations.ts`. Decodes and
> packs all 139 records' raw tiles (17,042 total) into one shared atlas
> (same pattern as `decode-ui-icons.ts`) plus structured frame data
> (`framesA`/`framesB`) as JSON, so a runtime consumer can compose actual
> animation frames later — same "tiles + compose-list, not pre-baked
> frames" convention the Amiga corpus's `mazedata.ega`/`decode-maze.ts`
> established. Output: `public/assets/wizardry6/snes/sprites/
> spell-animations.png` + `spell-animations.json` + `manifest.json`.
>
> **Still open** (see `docs/wizardry6/TODO.md`'s `snes-spell-anim-bank`
> row): the semantics of the `lead` byte's two derived fields (`$0857 =
> lead & 0x0f`, `$0858 = (lead>>2)+1`, confirmed read sites but not
> confirmed meaning); mode-B's per-target blit destination (sprite vs. BG
> layer — 2bpp graphics point at mode-1 BG3, hypothesis only); and the
> real dungeon/maze-geometry art question, which is **back to unsolved**
> now that this region is understood to be something else — no
> replacement lead exists yet. The palette question is **closed** (see
> the confirmed block above).

<details>
<summary>Original "dungeon/maze data candidate" writeup (superseded above, kept for history — the false-positive pattern here is worth remembering even though the semantic conclusion was wrong)</summary>

**This is the most significant new lead this session** for the
dungeon-corridor-art target, found via the "bottom-up MVN/DMA census
sweep" technique this task's brief suggested, but arrived at through a
*byte-periodicity* census rather than an MVN opcode census (the MVN
census itself, extended this session to a whole-ROM sweep filtered to any
`$7e`/`$7f`-vs-plausible-ROM-bank pair, is the source of the §3.5/§3.6/§3.7
findings above — this table-candidate region was found while chasing one
of that census's false-positive-looking hits, see below).

**How it was found**: a byte-density scan (fraction of even-position bytes
equal to `0x14` or `0x54` per 4KB block) across the whole ROM lit up
strongly (density 0.3-0.99, vs. ~0.01 baseline elsewhere) in a series of
**~18-32 discrete chunks** (sizes ranging roughly 100-4700 bytes) spanning
file `0x19fd70`-`0x1ff6d4` (ROM banks `$33`-`$3f`, ~380 KB of address space
though the dense chunks themselves total much less). Hex-dumping several
chunks by hand (e.g. file `0x1acf00`-`0x1ad100`) shows a clean,
consistent **2-byte record pattern**: byte pairs `[0x14 or 0x54][id]`,
where `id` is mostly `0x00` (read as "empty cell") interspersed with small
non-zero values that climb roughly monotonically within a chunk (observed
range in one chunk: `0x01`-`0x4f`) with occasional local repeats/backward
references (e.g. `...2a 2b 2c 00 00...` then later `...3c 2a 2b 2c 00...`
reusing IDs `0x2a`-`0x2c`) — a shape consistent with a **per-cell tile/
graphic-reference grid** (something renders each cell by looking up a
small "which wall/corridor piece goes here" ID, with ID reuse where
different cells share the same piece), analogous in spirit to the Amiga
corpus's `mazedata.ega` compose-list, though the exact analogy has not
been proven.

**A first attempt to render this as tile pixel data produced a classic
comb/striping artifact** (strong 1-pixel-wide vertical white streaks at
regular intervals when decoded as 4bpp tiles) — this is the expected
signature of feeding a periodic *non-pixel* 2-byte record structure into a
tile decoder, not evidence the region is "noise" or "wrong width"; it was
correctly read as a hint to stop treating it as pixel data and investigate
the periodicity as structure instead, which is what led to the record-shape
finding above.

**Cross-reference evidence (structural, not yet a full disassembly trace)**:
a whole-ROM byte-pattern census for long-addressing instructions (`LDA
long` `0xAF`, `LDA long,X` `0xBF`, `JSL` `0x22`) whose 24-bit operand
address — after normalizing the mirror-bank high bit and requiring the
16-bit address part to be `>= 0x8000` (i.e. a physically valid LoROM ROM
address; an earlier, cruder pass that skipped this check produced 937
raw hits, almost all spurious) — lands **exactly inside one of these
chunks' byte ranges produced 31 hits**, including one address
(`$3a:ba21`, file `0x1d3a21`) targeted identically by **4 separate `JSL`
call sites** at file `0x203ad9`/`0x2040ed`/`0x204705`/`0x204d19` (a byte-
identical ~24-byte code sequence repeated at all 4 sites, itself calling
several different targets in immediate succession, only one of which
lands in this candidate region). This is real, non-coincidental
cross-referencing — far above chance for 31 hits to land inside ~30-45 KB
of dense-chunk bytes out of a 3 MB ROM — but it does **not**, on its own,
settle *what kind* of structure this is: the specific byte at the `JSL`
target address (`0x1d3a21`) decodes as `0x00` (`BRK`), which is not a
plausible instruction to `JSL` into, so this specific reading is
**inconsistent with "these are call targets into small subroutines"** as
currently understood. Either (a) the call-site bytes were misextracted
(an alignment/operand-order mistake in this session's quick scan, not
re-verified against a byte-for-byte hand trace), or (b) the real
addressing/consumption model for this table is different from a plain
`JSL`-table (e.g. an indirect table of *data* addresses read by other
code, not `JSL`-jumped-to directly), or (c) some of the 31 cross-reference
hits are themselves false positives from unaligned scanning (expected at
some rate, per this project's established "raw byte scans without
instruction-boundary validation will hit some" convention) and the real
signal is a subset of them.

**Status: open, not confirmed.** This is reported as a well-evidenced
candidate, not a decoded format — no render was produced (there is no
known pixel-graphics consumer for this table; it may be a maze-geometry/
compose-list table that itself *references* a separate, still-unlocated
tile-graphics bank, exactly as Amiga's maze geometry and `mazedata.ega`
are two separate, cross-referencing pieces), and the one attempted
code-level confirmation (the repeated `JSL` call site) produced an
inconsistency rather than a clean confirmation. Recommended next step for
a future session: hand-disassemble the 4 identical caller sites
byte-by-byte (not via a quick unaligned scan) to nail down the true
addressing/consumption model before trusting any semantic reading of the
chunk contents.

</details>

### 6.5 View compose-piece libraries — confirmed (banks `$41`-`$42`)

> **Correction (dungeon-composer session).** This section was titled "UI
> tilemap compose-piece libraries" and read the payload words as "indices
> into CHR *already resident in VRAM*". Both readings were wrong, because
> the trace stopped at `0x01E2EB` — the midpoint of the routine, not its
> end. The code continues to `0x01E3B8`, and that tail shows (a) the words
> are **direct ROM tile-pool references** carrying their own bank field
> (`bits 10-13 → $90 + n`), not VRAM tile numbers, and (b) the copy into
> `$7E:4000` is only a per-piece *staging* step; the real destination is the
> 18x15 software bitmap at `$7E:5000`. These libraries are therefore not
> UI-specific — they are the single piece library for everything drawn in
> the first-person view window, dungeon geometry included. The window-frame
> runs cited below are real but are only one class of content in them.
> **Full spec: §3.14.** The layout table below is correct as far as it goes.

Two parallel libraries of **positioned cell blocks**, indexed by u16
address tables at file `0x208000` (CPU `$C1:8000`, 1263 entries) and
`0x210000` (`$C2:8000`, 630 non-null entries).

Piece record layout (confirmed by disassembly at `0x01E25A`-`0x01E2EB`):

| Offset | Size | Field | Notes |
|---|---|---|---|
| `+0x00` | 1 | `x` | destination column |
| `+0x01` | 1 | `y` | destination row |
| `+0x02` | 1 | `w` | width in tilemap entries |
| `+0x03` | 1 | `h` | height in tilemap entries |
| `+0x04` | 4 | *(optional)* | `0xFFFE` + u16 row-stride/start, or `0xFFFF` + u16 redirected data pointer |
| … | `w*h*2` | `data` | tilemap entries (u16 each) |

The consumer copies `w*h` words into `$7E:4000`, advancing the source by an
extra `$06` bytes per row (so a piece can be a sub-rectangle of a larger 2D
source). The dispatcher at `0x01E20B` picks the table by bit 15 of the
index word read from `$7E:421C` (set → `$C2`, clear → `$C1`), and
`0x01E242` is a **compose-list loop** that walks a list of piece indices.

**Verification:** all 1263 bank-`$41` records parse with `0 < w,h <= 64`
(1263/1263 valid, 0 rejects); bank `$42` gives 630/630 over its non-null
entries. Rendering the payloads shows classic window-frame runs (e.g. `8004
8001 0002 0002 … 8003 8005` — left corner, edge, repeated middle, right
corners) *and* dungeon wall/arch/floor pieces; see §3.14.6 for the
stronger corpus-wide invariant (1893 records, 0 viewport violations).

### 6.6 Script / message token banks — confirmed (banks `$43`-`$45`)

File `0x218000` (CPU `$C3:8000`) is a **605-entry array of 24-bit LoROM
pointers**, stride 3, monotonically increasing, self-describing (the first
pointer `$C3:8717` implies `(0x8717-0x8000)/3 = 605` entries).

Confirmed consumer at `0x00778B`-`0x0077D1` (CPU `$00:F78B`): index from
`$0820`, `X = index*3` (`ASL; CLC; ADC`), `LDA $C38000,X` → `$C6` and
`LDA $C38002,X` → `$C8`, then a `[$C6],Y` walk over **u16 tokens**
comparing against `0x8088`, `0x8089`, `0x808A`, `0x8091` — i.e. a 16-bit
token stream where values ≥ `0x8080` are control codes. Banks `$44`/`$45`
(`0x220000`, `0x228000`) contain the same shape of u16 streams with the
same recurring `0x0406`/`0x8082` markers. This is the game's
script/message system and is the most promising anchor for the open
`snes-text-dialogue-encoding` question (together with the gojūon-ordered
font at §4.4).

---

## Paths tried (open items)

| Item | Approach | Result | Why it stopped |
|---|---|---|---|
| Dungeon-view palette — independent re-verification + extraction | Follow-up session: re-derived the `$ca` table's 8-record/5-byte-stride structure and all its values from scratch (fresh Python, never the escalation's script); re-parsed `$82:F842`'s 14-level region-attribute table from raw bytes and independently reproduced its 221-record total, all 12 selector values, and their level associations exactly; re-checked group 40's raw palette bytes and the "index 0/11 always zero" family signature | **All core claims reproduced independently.** One caught error: the escalation's prose separately stated "141 palette-setting records", but its own per-selector breakdown table (which I reproduced digit-for-digit) sums to **172** — an internal inconsistency in the escalation's own report, corrected in §3.14.10. Promoted to the committed extractor: `decode-dungeon-composer.ts` now renders every piece and the decisive sample in real colour (group 40) and exports all 12 confirmed palette groups as `palettes/dungeon-region-*.json` — the composed decisive render (stone masonry, wood door, torch stands) is a strong additional structural oracle, matching the plausible-material-colour expectation decisively | Sixth clean escalation-verification pass in this corpus (see `verify-escalation-artifacts-not-just-claims.md`) — the fifth caught a wrong per-level claim in an otherwise-solid escalation; this one caught a wrong aggregate count sitting next to its own correct breakdown table |
| Wall sub-field value semantics (door vs. solid wall, values 1-3) | This session: checked whether the confirmed per-depth/per-lateral piece-selection tables (`$80:CC40`/`$80:CC72`, §3.14.5) might select a visually distinct door sprite for one specific `wallValue`, as a way to identify which value means "door" without a full disassembly trace of the table-index arithmetic | **Inconclusive, not pursued further.** The dispatch code (`$80:CC30`-area) turned out to need a nontrivial trace beyond what a quick check could resolve, and this project's §3.14.7 already flags "the exact final field-to-wallValue-index arithmetic downstream of this point was not re-traced to full closure" as a known residual gap from a prior session | Confirmed as a genuine cross-platform-shared unknown, not an SNES-only gap — the Amiga port's own wall values are equally unpinned (`maze-plane-semantics`). Per this session's explicit "don't over-invest if it dead-ends the same way" guidance, stopped after one bounded attempt rather than committing to the full trace |
| SNES-only feature-byte flag bits 6-7 | This session: censused all 24 whole-ROM `LDA $7E4540,X` raw-feature-byte reads (before the confirmed `AND #$3F` mask most consumers apply) for any bit-6/bit-7-isolating test distinct from the already-confirmed combined `>=0xC0` "top-bit marker" check | **Partial** — found one genuine isolated bit-6 test (file `0x004441`, `AND #$C0; CMP #$40`), but it's gated behind dungeon level `== 8` and an unidentified second flag, suggesting a level-8-specific scripted trigger, not a universal per-cell semantic. Bit 7 alone still has no reader | The census approach worked (found a real, previously-unknown consumer), but tracing the level-8 handler (file `0x0044A9`) and identifying `$0964`/`$094D` was out of scope for this session's bounded pass — left as a narrower, better-scoped lead for later |
| Graphics: tile/pixel decode | *Solved this session* — Blind 2bpp/4bpp tile render at 8 speculative offsets (pass 1, failed, see below); pass 2, traced the RESET-time resource-loader table through a 15-entry resource-type dispatcher (file `0x66a0e`) to a `MVN`-based ROM-bank-`$85`→WRAM-`$7F` copy primitive, then traced its source-address register back 2 instructions to a 60-slot directory table (file `0x105D1`) | Pass 1: no recognizable image at any offset. Pass 2: **confirmed** — 36 face portraits decoded, byte-exact 288-byte-stride directory invariant, unambiguous recognisable renders | Pass 1 failed because guessing offsets without a traced source pointer rarely hits tile data by chance. Pass 2 succeeded by finding the reader (the loader's own `MVN` call site) instead of guessing — see §3.2 |
| Graphics: palette | *Solved this session.* Pass 1: searched bank 2's loader code (file `0x10000`-`0x18000`) for `STA $2121`/`$2122`/`$420B` — zero hits, wrong place to look. Pass 2: byte-searched the whole ROM for `JSL $82825c` (the confirmed tile loader's own entry point) to find its 2 callers (file `0x321a`/`0x324a`), then searched the same caller region for `STA $ca` (dp) and found a sibling palette-load routine at file `0x1067f` | **Confirmed** — 32-byte (16-colour) per-pair CGRAM palette, source file `0x10764`, destination CGRAM colour 32 (sub-palette 2), verified both structurally (a `$ca` value census shows exactly 1 of 16 candidates produces a non-garbage CGRAM-DMA table record) and by render (all 36 portraits render coherent, face-plausible colour, not noise) — see §3.3 | Pass 1 failed because palette load is a *sibling* routine to the tile loader, not embedded in it — same lesson as §3.2's own solve (find the reader via its callers, don't re-scan the same code block for a different register pattern) |
| Graphics: compression | Considered running `ancient identify`; superseded once §3.2 confirmed the tile data is a **plain uncompressed** `MVN` copy from ROM bank `$85` | Not needed — no compression exists for this resource type | Resolved as N/A for the face-portrait bank specifically; other resource types (font, UI) not yet checked |
| Text: dialogue/full-kanji encoding | Whole-ROM scan for valid double-byte CP932 sequence runs (`sjis_scan2.py`) | Found many "kanji-shaped" runs, but manual check showed most are coincidental graphics/tilemap bytes, not text | No confirmed string-table boundary to anchor the scan; needs a traced text-print routine, not a blind byte-pattern scan. Not revisited this session — next candidate approach is tracing a text-print/VRAM-tilemap-write routine forward from a known consumer, analogous to how §3.2 was cracked for pixel data |
| Font tile bank | Pass 1 (prior session): blind-offset tile renders, failed. Pass 2 (prior session): traced `$88C9`'s WRAM `$7F` source but not further. Pass 3 (this session): re-ran the MVN census (same technique as §3.2) filtered to *all* `dst=$7f` hits (46 total, not just the 3 already tied to portraits); 2 more `src=$85` hits found (file `0x8e42`, `0x80b9`), both sourcing the `0x2ad57`-`0x2e000` gap region previously mis-labelled "noise" | **Partial**: found and rendered a real, confirmed, ROM-sourced 405-tile UI-icon bank (compass letters E/S/W/N, arrows, item icons) — corrects the §3.2 "noise" claim — and connected part of it (WRAM `$7f:0da0`+) to a traced VRAM DMA path. **Not** the dialogue-text font (no alphabet/kana shapes in this bank); `$88C9`'s primary WRAM range (`0x0000`-`0x0aa0`) still not traced to a ROM source; 43 of the 46 census hits not individually checked | The confirmed UI-icon bank is a real result but a different resource than "the font" — the actual text-glyph bank (needed for full dialogue, not just this icon set) is presumably a separate, larger bank not yet found. Next step: trace the text-print/tilemap-write consumer forward (same method already planned for the dialogue-encoding item) rather than more MVN-census guessing |
| Monster table: non-katakana second field (e.g. `VINE` at `0x463A4`) | This session: direct hex read of the surrounding 6 records (not just the 1 anomalous field) | **Structural role confirmed**: it's a 3rd record type (tag `0x80` reused for binary data, not a mistagged/corrupt katakana field), sandwiched between a genus English name and the genus's first real monster entry — genus-header hypothesis confirmed at the structural level. Payload semantics (icon index? flags?) still unknown | A naive sequential re-scan past this one anomaly to find more instances cascades into parser desync (wrong assumed length misaligns everything after); a proper census needs the same resync-on-error logic as the existing 102-pair scanner, not attempted this session |
| `0xFFFE`-redirect record shape's `startHi`/`strideLo` field | This session: byte-searched the whole ROM for the two unique 16-bit immediate marker comparisons (`CMP #$FFFE` / `CMP #$FFFF`, opcode `C9 xx xx`) instead of guessing — both came back as single whole-ROM hits, squarely inside the already-confirmed composer body, and disassembling the surrounding ~150 bytes (`$03:E25A`-`$03:E2EC`) gave the full compose-list-entry-resolution routine end to end | **Solved** — record `+6`'s word is `[strideLo][startHi]`: high byte seeds the initial `Y` cursor into the redirected cell array before the column loop, low byte is added to `Y` after each row on top of the `w*2` the column loop already consumed. Verified structurally (65/65 shared-`newPtr` groups self-consistent by shape) and by a decisive before/after cell-word comparison (old hardcoded-6 read: scrambled row-to-row values; corrected read: a clean repeating pattern). See §3.14.3 | A single targeted byte-pattern search for the actual comparison instructions (rather than re-reading prose or guessing constants) found the reader directly — the same "find the reader" method behind most of this project's other solves, just not yet applied to this one specific sub-field |
| SPC700 driver/sample blob size | Session 2: traced upload's copy-loop start address (`0xF0919`). Session 3: disassembled the generic multi-block SPC upload routine (file `0xF0AB0`) and modeled the block format as `[u16 size][u16 addr][size bytes]` repeated until `size==0`, parsed forward from `0xF0919` | Start confirmed both sessions. Session 3's block-format parse desyncs almost immediately (block sizes balloon into the tens of thousands within 2-3 blocks, runs off the end of the ROM) | Field order/width inferred from the disassembly doesn't hold up against the actual bytes — either the format has more fields than modeled, or `0xF0919` isn't the true first block header. Lowest priority per task order; not pursued further this session |
| NMI handler body past first ~20 instructions | Session 2: full flag-aware disassembly from NMI entry (file `0x193`) through to the tight `JSL $81E3DC` loop (file `0x253`), ~140 instructions, all flag-state-verified. Session 3: disassembled `$81E3DC` itself (file `0x00e3dc`) | Session 2 confirmed: joypad edge-detection, a `$0100`-`$0350` WRAM dispatch-table walk (`$8259`/`$8267`, `TCS`-based, semantics unresolved), then `JSL $81E3DC` in a tight self-loop. Session 3: **`$81E3DC` is a trivial 13-instruction, zero-branch leaf function** (reads/rewrites a 16-bit DP `$8a` value) — refutes the "real game-logic dispatch" hypothesis; it's a small reused primitive (another unrelated function immediately after it in ROM also calls it), not a big dispatcher | The `$81E3DC` sub-question is closed (it's not a dispatcher), but this *opens* a bigger one: where does per-frame game logic actually run, if not here and not in RESET's apparently-empty spin loop? Not investigated this session — candidates are an untraced IRQ handler, or polling logic inside the RESET spin loop that wasn't re-examined with DP `$8a` in mind |
| UI icon bank extractor | Session 4: wrote `decode-ui-icons.ts`, re-deriving the confirmed `0x2ad57`-`0x2e000` span from the portrait directory's own pool boundaries and rendering all 405 tiles greyscale | *Solved (extraction)* — committed extractor + atlas asset, oracle-guarded. **Not solved**: this bank's real in-game palette — a boot-init CGADD/CGDATA byte-pattern search around both source MVN sites found zero hits | The bank's ROM→WRAM copy has no adjacent palette-load sibling routine the way the portrait bank does (§3.3); would need a different trace (a generic per-frame CGRAM DMA dispatcher entry with a different `$ca` value, not yet identified) — not pursued further this session |
| Title screen / full-screen art | Session 4: (1) DMA-register census (`STA $420B`, 72 sites) cross-referenced against a naive "nearest preceding `LDA #imm16`" heuristic for the DMA size, looking for an outlier-large transfer. (2) Reviewed the newly-found boot-time full-CGRAM palette (§3.5) for a nearby accompanying tile-data load | (1) **False lead, refuted by hand-disassembly** — the 2 candidate ~35KB "hits" (file `0x50261`/`0x684f9`) turned out to be a table-driven, per-call variable-size DMA (the already-known bank-`$0A` `$88C9`-adjacent dispatcher, §3.4), not a real large fixed transfer; the heuristic matched an unrelated stray immediate nearby, not the true operand. (2) No accompanying tile load found adjacent to the boot palette | No top-down path exists yet (per-frame game-logic location is still unknown, `snes-nmi-main-loop`) and the one bottom-up census attempted produced a heuristic-driven false positive rather than a real lead. Next step needs either the main-loop question resolved first, or a more careful (table-lookup-aware) DMA-size census |
| Dungeon corridor art / maze data | Session 4: byte-density census (fraction of `0x14`/`0x54` at even byte offsets per 4KB block) across the whole ROM, refined to fine-grained (32-byte sliding window) cluster boundaries; cross-referenced with a whole-ROM long-addressing-instruction census (`LDA long`/`LDA long,X`/`JSL`) filtered to targets landing inside the found clusters | **Strong structural lead, not confirmed** — found ~18-32 discrete chunks (file `0x19fd70`-`0x1ff6d4`, ROM banks `$33`-`$3f`) of a clean 2-byte `[tag][id]` record pattern (tag `0x14`/`0x54`, id mostly `0x00`/"empty" with climbing small values and local reuse — compose-list-shaped); 31 long-addressing hits land inside these chunks after filtering out physically-invalid ROM addresses (down from 937 raw/unfiltered hits), including one target hit by 4 identical `JSL` call sites — but hand-checking that one target byte (`0x00`/`BRK`) is **inconsistent** with a clean "these are `JSL` targets" reading, so the addressing/consumption model is not actually nailed down | Cross-reference count (31, non-random) is real signal, but insufficient alone per this project's confirmation bar (need a render or a clean disassembly-confirmed consumer, neither achieved). The `BRK`-at-target inconsistency means either the call-site bytes were misextracted this session (not re-verified byte-by-byte) or the true addressing model differs from a plain jump table — needs a careful, non-heuristic disassembly pass on the 4 identical caller sites before the region's role can be asserted. See §6.4 |
| Full-body monster/character sprites | Session 4: (1) examined the 120 bytes immediately before the confirmed portrait directory for a second directory using the same encoding. (2) Re-disassembled the first ~20 bytes of all 15 handlers in the resource-type dispatch table (file `0x66a0e`) already implicated as a dead end for the portrait bank | (1) Different word range/shape (`0x30xx`-`0x39xx`, not bank-`$85`-CPU-address-shaped) — not a second directory of the same kind. (2) Re-confirmed: 14 of 15 handlers open with `JSR $eecb` or a close variant, consistent with the existing "input-polling subsystem" reading, not graphics | No second directory or dispatcher lead found by either check; left open rather than asserting non-existence, since neither check was an exhaustive ROM search — see §3.7 |
| `$88C9`'s WRAM `$7f:0000`-`0x0aa0` source | Session 4: hand-disassembled the boot-init `MVN` chain following the newly-found full-CGRAM-palette load (§3.5) forward, looking for what populates WRAM `$7f` before the confirmed UI-icon-bank MVN (`0x0080b9`, dest `$7f:0da0`) | **Narrowed one hop**: `$7f:06e0`-`0x0da0` (1728 bytes) is a WRAM-to-WRAM copy from `$7e:e000`, not a direct ROM load; `$7f:0000`-`0x06e0` is still completely unaccounted for (the full boot-time zero-clear of WRAM bank `$7f`, confirmed this session, means it's genuinely zero unless something writes it later). What fills `$7e:e000` itself was not found within the immediate boot-init byte range searched | A byte-pattern search for `LDX`/`LDY #$e000` in file `0x8000`-`0x8200` found only the one occurrence already used above — either an unlocated earlier/later part of the boot sequence writes `$7e:e000`, or (less likely) it's runtime/uninitialized state. Not pursued further this session; see §3.5 -- **closed session 5**: this is simply the LZSS decompressor's (`$83:8000`) output buffer, see §3.6's correction |
| UI icon bank palette | Session 5: byte-pattern census for `STA $ca` (`85 ca`) across the *whole* ROM (not just the boot-init span checked in session 4) — found 21 sites using several distinct literal `$ca` values (`0x0a`, `0x14`, `0x1e`, `0x23`, plus one computed value), not just the one (`0x0a`, portraits) already known | **Confirmed** — `$ca=0x14` (20) is a real, byte-verified UI-icon-bank palette record (2 call sites in the same bank-2 module as the portrait loader, direct entry into the palette-copy routine's body 4 bytes past its normal entry point, bypassing the selector prologue). Render confirms coherent, non-scrambled colour. See §3.2b | Session 4's census only checked `0x8000`-`0x9200` for CGADD/CGDATA writes near the two source `MVN` sites — the real palette load is a *sibling call site* elsewhere in the ROM entirely, same lesson as §3.3's own solve (find the reader via its callers, don't scan near the resource's own load site) |
| Title screen / full-screen art | Session 5: escalated to `re-codebreaker` after 2 distinct prior failed approaches (session 4's DMA-size heuristic census; this session's own palette-table exploration + MVN-size census, which found and *refuted* a 3072-byte candidate as non-pixel sparse-table data via a zero-byte-fraction/bit-density check, not tile art) | **Solved** — see §3.8. The escalation found the LZSS codec (`$83:8000`) and the full opening sequence (logo, copyright, backdrop+lightning, Mode 7, panorama); this session independently re-verified 3 screens + the font with from-scratch renders | Every prior approach assumed the confirmed banks' `MVN`/raw-DMA shape; the real resources are LZSS-compressed, invisible to that shape of census. See `renamed-magic-container.md`-adjacent lesson: an unfamiliar-looking region can still be a *custom* compressor, not just a mislabeled instance of an already-known one |
| Font tile bank | Session 5: the `re-codebreaker` escalation above found it as a side effect of tracing the task-scheduler function (`$81:801D`) that also does the main-screen CGRAM load | **Solved** — see §3.8/§4.3. 256-tile, 2bpp, uncompressed bank at file `0x04c653`; renders as a full legible glyph set (digits, A-Z, hiragana, katakana, symbols) | The four prior blind-offset/census approaches (sessions 2-4) never had a code-level anchor; this one came from tracing a *confirmed* function's full body rather than guessing offsets or censusing byte patterns |
| Dungeon corridor art / maze data | Session 5: escalated to `re-codebreaker` specifically to resolve the JSL/BRK inconsistency, after this session's own hand-verification of the 4 "identical `JSL` call site" bytes found they decode as a well-formed `JSL $3aba21` instruction, but with no plausible surrounding code (i.e. the "call site" itself is embedded in more of the same dense tilemap-word data, not real code) | **Region re-identified, not maze data**: the escalation traced the true consumer (`$02:DFBB`, `DBR`-relative `LDY $7ffe,X` read, invisible to any long-addressing-instruction census) and confirmed this is the spell/combat animation bank — see §6.4's correction. Independently re-verified this session (master directory + one record's frame table + LZSS decode, all re-derived from scratch). **The dungeon/maze-geometry art question is unsolved again** — no replacement lead exists | Two genuinely distinct approaches (this project's own census, then hand-verification) both failed to find a *maze* consumer for this region, for the good reason that it isn't maze data — escalation correctly identified the true consumer instead of forcing the original hypothesis. New pitfall filed: `indexed-table-base-below-valid-rom-window.md` (a `>= 0x8000` operand-validity filter, meant to cut census noise, silently discards a real `DBR`-relative table-base operand that legitimately sits below `$8000`) |
| Opening-sequence screens 4/5 (Mode 7, panorama) | Session 5: located by the escalation (byte-exact splits, confirmed palette-table cross-reference for the panorama) but not implemented in this session's extractor, given time budget | **Located, not extracted** — Mode 7 sequence at file `0x02112c` (253 8bpp tiles); panorama at files `0x023b2a`+`0x0272ff` (659 tiles, `240x15` column-major tilemap, confirmed via autocorrelation) | Both need composition logic (Mode 7's 8bpp/rotation-scaling semantics; the panorama's column-major tilemap walk) beyond this session's `[tilemap][chr]` 32x28/64x32 composer — deferred, see `snes-opening-screens-4-5` in `docs/wizardry6/TODO.md` |
| Full-body monster/character sprites | Session 5: no new dedicated check, but two more large graphics banks were fully characterized this session (spell animations, opening sequence) and neither contains full-body figure art | Still open, but two more resource families are now ruled out as hiding places (not exhaustive) | No new concrete lead to escalate on — see §3.7's update |
| Dungeon corridor art / maze data | Session 6 (`re-codebreaker`): abandoned the "find the LZSS call site / find the directory" framing and instead built a **whole-ROM interval-coverage map** — accounting for every byte of the 3 MB image rather than chasing one candidate region. This surfaced two large regions no prior session had flagged at all (banks `$0E`-`$1D`, 512 KB; banks `$40`-`$5F`, 1 MB), then a blind 4bpp tile render of the former | **Solved** — banks `$10`-`$19` (file `0x080000`-`0x0D0000`) are plain uncompressed 4bpp stone-masonry wall art with arched openings and perspective-scaled fragments, see §3.10. Also resolved as *not* the answer: Mode 7 (9 register writes, all inside the opening sequence), `0x05104b` (outdoor night landscape), `0x060000` (the "To Be Continued" ending screen), and banks `$40`-`$5F` (creature sprites, §3.11) | Every prior approach was shape-limited: three separate censuses (long-addressing operands, `JSL $838000` call sites, `MVN` source banks) all implicitly assumed the art was *reached by a statically traceable pointer*. This bank is raw, uncompressed, and referenced only through runtime-computed addresses, so it was invisible to all of them. The coverage map found it in one pass because it asks "what is unaccounted for" rather than "where does this pointer go" |
| Whole-ROM entropy census as a "what's left" tool | Session 5 flagged only banks `$20`-`$31` as unaccounted, from a per-bank Shannon-entropy + zero-fraction profile | **Misleading** — it identified the *highest-entropy* unexplained region (BRR audio, §5.4 — the least useful of the three) while missing 1.5 MB of *lower*-entropy unexplained region (banks `$0E`-`$1D` and `$40`-`$5F`), because low entropy reads as "probably already-known graphics" | Entropy ranks regions by how compressed they look, not by whether anything actually accounts for them. Superseded in session 6 by an explicit interval-coverage map built from confirmed findings' byte ranges, which is exhaustive by construction |
| BRR audio region | Session 6: 9-byte block-walk with a `range <= 12` header-validity test, plus a per-4KB-block positivity scan | **Confirmed** — banks `$1F`-`$31`, 620 KB; runs of 341-1059 valid blocks vs. a chance expectation of ~1.7, 72% of blocks positive in-region vs 0.3% out of it | Per-sample directory not located; not pursued (out of scope for the dungeon-art brief) |
| Creature-sprite bank (banks `$40`-`$5F`) | Session 6: found via the coverage map, then confirmed top-down by disassembling both consumers (`0x05F61E`, `0x0072FF`) that read `LDA $C08000,X` | **Confirmed** — 251-slot table → 100-record pool → `[u16 type][LZSS]` CHR + OAM frame lists; 100/100 decode clean, 84/100 satisfy `ptrB == ptrA+4+len` byte-exactly; renders are unambiguous creature art | Closes `snes-full-body-sprites`. Palette not identified (greyscale only); the `type` field's 5 values and `dest` word's exact VRAM semantics not decoded |
| Creature-sprite bank — palette, `dest` word, frame-entry format | Re-oracle verification session: independently re-verified all §3.11 structural claims from scratch, then traced consumer 1's post-decompress call `LDX #$0140; LDY $40; LDA #$40; JSL $8286A0` (file `0x05F651`) into the §3.2b shared palette-copy routine, cross-checked against the CGRAM-DMA dispatch record `$ca=30` (`CGADD=$A0/src=$7E:3940/size=0x40`, byte-exact), and resolved the frame-entry byte format by hypothesis-search under a render oracle after two wrong layouts (BG-tilemap-word reading; bit0-as-size reading) | **Solved** — `dest` is `palOfs` into the shared colour table at file `0x10764` (two BGR555 rows per creature → OBJ palettes 2-3); entries are `[attr][tile][x][y]` signed-pixel OBJ metasprites (attr: bit0 tile-bit-8, bit1 palette row, bit4 16x16, bit5/6 h/v-flip); composed colour renders are decisive (knight, jellyfish, reapers, demons — §3.11) | Remaining: `type` field's 5 values (dispatch traced to `0x75BF` jump table, per-type semantics open), frame-list header bytes 1-4 (`$D7/$DA/$DB/$DC`), extractor upgrade to composed colour poses |
| Dungeon-art compose/placement structure | Dungeon-composer session (`re-codebreaker`): (1) re-ran the whole-ROM long-addressing census with the `$90`-`$99` mirrors added to the filter, which the prior pass had omitted; (2) abandoned byte-pattern censusing and traced code instead — byte-searched for callers of the one confirmed bank-`$10` reference `$82:F810`, then disassembled each caller's surrounding routine with a flag-aware 65816 disassembler | (1) **Failed the same way as before** — 21,690 raw hits, 8,871 after an `addr >= $8000` validity filter, effectively all false positives from data bytes; confirms the census shape is structurally incapable of finding this consumer, mirrors or not. (2) **Solved** — one of the 3 callers (`0x01E237`) sits *inside* the already-known compose-list dispatcher, immediately linking it to the dungeon view; see §3.14 | The decisive move was noticing that §6.5's trace had stopped at `0x01E2EB`, which is the midpoint of the blit routine, not its end. Everything that identifies the mechanism — the tile-pool bank field, the `x*32 + rowTable[y]` placement, the occupancy test, the merge-behind path — lives in the 205 bytes *after* that address. The prior session's "the consumer copies `w*h` words into `$7E:4000`" was a true statement about a staging step mistaken for the whole routine; lesson filed as `trace-stopped-at-staging-buffer.md` |
| Dungeon-art compose/placement structure — independent re-verification + extraction | Follow-up session: hand-disassembled every cited address from raw ROM bytes (not the escalation's tooling); independently re-derived library `$C2`'s true table length (the `$C1` self-describing trick doesn't generalize, had to hand-walk the pointer stream to its breakdown point); wrote a fresh Python parser + 4bpp renderer from scratch (never opened the escalation's own scripts); promoted to a committed TypeScript extractor and diffed its output against the fresh Python render pixel-by-pixel | **All claims reproduced independently** — 1893/1893-record 0-violation invariant, decisive render (0/17,280 pixel mismatches against the committed extractor), and every disassembly citation including branch-target arithmetic. One item explicitly *not* re-derived and flagged as such: the `0xFFFE`-redirect record shape's exact stride/start bit semantics (134/1893 records) — implemented as a documented hypothesis (constant 6-byte row stride), not independently traced | Clean confirmation, no corrections needed to the escalation's core finding — see the `> **Independently re-verified**` block in §3.14.6 for the full breakdown. Committed: `tools/wizardry6/snes/decode-dungeon-composer.ts`, `public/assets/wizardry6/snes/sprites/dungeon-view-pieces.png`/`.json`, `public/assets/wizardry6/snes/screens/dungeon-view-sample.png`/`.json` |
| Maze cell format / frustum offset table | This session: disassembled `$80:C69F`'s full body from scratch (flag-aware `dis65816.py`), traced the 26-slot handler dispatch (`$80:C829`, corrected from the prior session's unbacked `$80:D700` citation), the facing-rotation field extractor (`$80:CD36`-`$80:CD68`), the `$7E:4540` feature/orientation decode, and the level-init/region-fill/scripted-trigger chain (`$80:D2D3`, `$80:D450`, `$80:D245`) | **Solved** — full cell-format and slot-selection mechanism confirmed by disassembly, decisively cross-checked by the frustum offset table (`$80:DD4B`) decomposing into a perfect 2/3/5/7/9-slot expanding-frustum pattern (26/26 slots, 0 deviation) matching the independently-confirmed 5-depth piece-table series one-for-one. See §3.14.7 | Genuine disassembly trace (not census/guessing) from a single confirmed entry point (`$80:C69F`, already known from §3.14.5) outward — the same "find the reader" method that cracked §3.14 itself |
| Bulk non-uniform wall-content source (which cells get *distinct*, not uniform-default, `$7E:4300` values) | This session, two structurally distinct searches: (1) exhaustive byte-pattern census for `STA $7E4300,X`/`STA $7E4540,X` (absolute-long-indexed) across the whole ROM — found only the 2 already-explained sites (uniform seed-fill, region default-fill). (2) Exhaustive search for `LDA/LDX/LDY #$4300`/`#$4540`/`#$AC00` (16-bit immediate DP-pointer setup, which would catch a `(dp),Y`-indirect bulk-copy loop instead) — found only the already-explained `$7E:AC00` per-level-trigger-list setup (`$80:D245`), which turned out to write only the *party's own current cell*, once per view-rebuild, not a bulk load | **Not found** — both searches are structurally exhaustive for their respective addressing-mode family (direct-indexed absolute-long, and DP-pointer-then-indirect), and both came back negative for anything beyond the mechanisms already documented in §3.14.7. Escalated to `re-codebreaker` (see below) | Two genuinely different addressing-mode censuses, both negative for concrete, checkable reasons — meets this project's escalation bar. See `snes-maze-wall-source` in `docs/wizardry6/TODO.md` |
| Bulk non-uniform wall-content source | `re-codebreaker` escalation: censused the **third** store family the two prior passes had both skipped — plain `STA abs,X` (opcode `9D`) with `DBR` set to `$7E`, i.e. `9D 00 43` / `9D 40 45`, rather than absolute-long (`9F`) or a DP-pointer indirect. One hit landed inside the address range the doc had labelled the `$7E:AC00` trigger scanner; disassembling it showed an 8×8 region blitter writing all three cell arrays. Followed its source (`$7E:9A00`/`$7E:9D00`) to the level loader `$8B:DE64`, then verified the whole chain against the Amiga port's `scenario.dbs` section 2 | **Solved** — 14-record, 1536-byte-stride maze table at file `0x030000` (`$86:8000`), plus its region-origin table (`$80:D78E`) and two quest-flag-conditional patch lists. Verified 99.40-99.75% across five independently-derived planes over 10,752 cells against the Amiga oracle, 167/168 region origins identical, five zero-deviation structural invariants, and a decisive 14-level map render. See §3.14.8 | The two prior censuses were exhaustive *within their addressing family* but the loader uses neither: it sets `DBR = $7E` once (`LDA #$7e; PHA; PLB`) and then uses ordinary 3-byte `STA abs,X`, so no `$7E` bank byte appears in any instruction and no `#$4300` immediate is ever loaded. Same shape as `indexed-table-base-below-valid-rom-window.md`: the operand carries no evidence of the bank. **Root cause of the negative, though, was a premise error, not a census gap** — the doc's §3.14.7 had the bulk loader's own address range recorded under the wrong bank (`$80:D245` for what is really `$82:D245`), so the prior session disassembled the answer and filed it as something else; see the correction block in §3.14.7 |
| Bulk non-uniform wall-content source — independent re-verification + extraction | Follow-up pass, same session: hand-disassembled the loader (`$8B:DE64`) and region blitter (`$80:D25B`) from raw ROM bytes with a fresh flag-aware disassembler run (not the escalation's tooling), confirming the `WRMPYA/WRMPYB` level×6-then-`XBA` "×256" trick byte-for-byte; wrote a from-scratch Python cross-checker against the Amiga oracle (never opened the escalation's own comparison script); promoted to a committed TypeScript extractor (`tools/wizardry6/snes/decode-maze.ts`) rendering all 14 levels as top-down maps | **Core finding fully reproduced independently** — wall sub-field agreement (99.40%/99.49%/99.76%/99.73%) and region-origin agreement (167/168) reproduced to the exact fraction; the major-axis-reversal placement was independently re-derived by testing both orientations and confirming the reversed one wins decisively (99.40% vs 64.21% unswapped). **One escalation claim caught and corrected**: "levels 0, 3 and 6 are 768/768 exact on the feature plane" does not reproduce — independent re-checking found only level 6 is exact; level 0 has 15 mismatches and level 3 has 2, and level 4 (95.96%, not flagged by the escalation at all) is actually the worst-agreeing level. The underlying qualitative finding (very high feature agreement once the SNES's own `0x0D`/`0x0E` "empty" sentinel convention, independently established earlier this same session in §3.14.7, is accounted for) still holds — only the specific per-level "which are exact" claim was wrong | Same discipline as the two prior escalation-verification passes in this corpus (a stale palette array; a table-length miscount) — re-derive from the specialist's prose with fresh code and cross-check against fresh renders, never trust the returned script or the summary numbers verbatim. Caught a real, checkable overstatement this time. Decisive independent oracle: the from-scratch extractor's own rendered maps (`public/assets/wizardry6/snes/screens/maze/maze-level00.png` etc.) show unmistakable, non-degenerate maze structure — connected rooms, corridors, symmetric chambers — inspected visually |
| Dungeon-view CGRAM palette | This session: replicated the confirmed `$ca`-selector CGRAM-DMA dispatch table (§3.3's `file 0x4162`/`0x4163`/`0x4165`) programmatically across **all 256** possible `$ca` values (previous sessions only checked 0-15, then the ~21 literal call sites found by whole-ROM `STA $ca` census), filtering for structurally sane `(CGADD, src, size)` triples | **No new dungeon-view-specific record found.** Only 4 sane triples exist in the whole 256-value space: `$ca=0x0a` (portraits, already confirmed §3.3), `$ca=0x14` (UI icons, already confirmed §3.2b), `$ca=0x1e`/`0x23` (creature-sprite family, already confirmed/ruled-out per the spell-anim-bank row above), and `$ca=0x19` (`CGADD=0xE0, src=$7E:39A0, size=0x20`) — structurally sane but **zero call sites** found anywhere in the ROM setting `$ca=0x19` (neither a literal `LDA #$19;STA $ca` nor any other `STA $ca` site's preceding code computes that value) | The dispatch-table sweep is exhaustive for this specific mechanism, so either the dungeon view reuses an already-loaded palette (no dedicated load of its own — plausible, since it may just inherit the main gameplay screen's CGRAM state) or it's loaded through a completely different, non-`$ca` mechanism not yet found. `$ca=0x19` is flagged as a dead/unused table entry, not a lead, given zero callers. Not escalated this session — lower priority per the task brief, and the search space for "no `$ca` dispatch at all" is unbounded compared to item 1's well-scoped remaining question |
| `$7E:5000` -> VRAM upload path | Session A: located and disassembled all 5 whole-ROM occurrences of `LDX #$5000` (the literal immediate named by an earlier session's "3-5 unexamined candidate sites") | **All 5 are false leads** (one clean-code site at file `0x001fd2`, four inside non-code data). Note the *reason* recorded for `0x001fd2` was also wrong — see the correction in §3.14.9; `$b0` is a VRAM word address, not a WRAM source | The immediate-value search shape was structurally incapable of solving this: the real source address never appears as an instruction immediate anywhere, only as a **data word in a parameter table** (`$80:C18C`). Two immediate forms were also never censused (`LDA #$5000`, `LDY #$5000`), but adding them would not have helped |
| `$7E:5000` -> VRAM upload path | Session B (`re-codebreaker`): abandoned value-searching entirely and read the composer's **exit path** byte-by-byte (brief option (b)) instead of its body — the last 12 bytes before `RTL` at `$03:E259`, which no prior summary had covered | **Solved on the first read.** `$03:E24D` does `LDA $23; ORA #$40; STA $23` — a dirty-flag request, not a copy. Following `$23` gave the whole 8-bit DMA-request-word dispatcher (file `0x003f78`), its bit-6 parameter table (`$80:C18A`), the BG2 tilemap installer (`$03:E1CC`), and the on-screen window geometry. 12 quantified invariants, 0 deviations — see §3.14.9 | Third instance in this project of `trace-stopped-at-staging-buffer.md`: the answer sat in bytes just past where an earlier prose summary stopped. Also a case of `negative-from-addressing-root-not-shapes.md` — two passes of "search for the address `$5000`" returned the same negative because the producer never *names* the destination; it raises a flag and a table names it. The generalizable move: when a routine's output buffer has no visible consumer, read the producer's **epilogue** for a flag/queue write before searching for the address anywhere else |
| Dungeon-view CGRAM palette | Session A: applied the `$81:801D` 512-byte boot snapshot (ROM `0x127e4`) directly as the view palette | **Unverified/wrong as applied** — but the premise was closer than it looked. `0x127e4` really is the CGRAM shadow's initialiser; the error was applying the *wrong 16 of its 256 colours*. The view uses sub-palette **2** (`0x127e4+0x40`), not sub-palette 0, and that slice is overwritten per region anyway | Nothing established *which* 16-colour slice of a 256-colour image the view indexes. The missing step was reading the tilemap entries' palette field — available all along in `$03:E1CC`'s `LDX #$08F0` |
| Dungeon-view CGRAM palette | Session B: swept all 256 `$ca` dispatch values against the table at file `0x004162` and filtered for structural sanity; found only the 4 known consumers plus one "sane but dead" entry (`$ca=0x19`) | **Negative, and the negative was an artefact.** The table is a **5-byte-stride record array**, so 251 of the 256 swept values were mid-record garbage and `$ca=0x19` (record 5) is a real record, not a dead one. More importantly the sweep could not have worked: the view's palette is loaded by `$82:867F` (which sets `$ca=10`, an *already-known* consumer) — the selector was never the unknown, the **group index feeding it** (`$094c`) was | Classic wrong-granularity census (`byte-scan-tag-byte-vs-wrong-stride.md`): scanning a stride-5 table at stride 1. But the deeper error was aiming at the wrong variable — `$ca` picks *where in CGRAM*, `$094c` picks *what colours*. Two passes both censused the destination selector and neither censused the source selector |
| Dungeon-view CGRAM palette | Session C (`re-codebreaker`): traced **forward** from the composer instead of censusing selectors — read the tilemap installer's literal `LDX #$08F0` to get the palette *field* (2), which named the exact CGRAM slice; then censused writers of that slice (`X=$0040` into `$7E:3800+X`) rather than of `$ca`; then traced the one unexplained selector (`$094c`) to its live writer | **Solved.** `$82:F842`'s 14-level, 3-byte-record region table (`$82:F8CD`) sets `$094c`; `$82:867F` loads group `floor($094c/2)`. 12 dungeon palettes, groups 40-52. Confirmed 100.00% (3,349/3,349 unblended pixels, 0 unexplained) against two real Super Famicom screenshots — see §3.14.10 | The unlock was reading a **literal immediate that was already transcribed in the doc** (§3.14.9 even printed `LDX #$08F0` and annotated it "palette 2") but whose implication — "the palette question is now just 'what is in CGRAM 32-47'" — had never been followed. Cheap lesson: when a doc records a constant whose *meaning* is noted but whose *consequence* is not, that consequence is often the open question's answer |

---

## Files

- Spec: `docs/wizardry6/snes/data-structure.md` (this file)
- Disassembly dumps: `docs/wizardry6/snes/disasm/reset_startup.txt`,
  `docs/wizardry6/snes/disasm/spc_upload_handshake.txt` (raw r2 output,
  **not** hand-corrected for the §2.1 flag-width issue past the first few
  dozen instructions in each — treat as a starting point, not ground
  truth)
- Shared decode primitives: `tools/shared/snes-ppu.ts` (SNES 4bpp/2bpp
  tile decode, BGR555 palette decode, tile-grid composition — ported from
  the `strike` project's module of the same name, independently
  re-confirmed here), `tools/shared/snes-lzss.ts` (new session 5 — the
  ROM's general-purpose LZSS decompressor, `$83:8000`, re-implemented from
  scratch and independently verified against 3 resources, see §3.8)
- Extractors: `tools/wizardry6/snes/decode-class-titles.ts`,
  `tools/wizardry6/snes/decode-monster-names.ts`,
  `tools/wizardry6/snes/decode-portrait-tiles.ts` (updated session 5 to
  render the confirmed CGRAM palette instead of greyscale, §3.3),
  `tools/wizardry6/snes/decode-ui-icons.ts` (updated session 5 to render
  the confirmed CGRAM palette instead of greyscale, §3.2b),
  `tools/wizardry6/snes/decode-opening-sequence.ts` (new session 5, §3.8 —
  logo/copyright/backdrop/lightning screens + the 256-glyph dialogue font),
  `tools/wizardry6/snes/decode-spell-animations.ts` (new session 5, §6.4 —
  139-record spell/combat animation bank, tiles + compose-list JSON),
  `tools/wizardry6/snes/decode-dungeon-composer.ts` (new, dungeon-composer
  follow-up session, §3.14 — the two view compose-piece libraries, 1893
  records, oracle-guarded on the 18x15 viewport-fit invariant; also emits
  the decisive single-piece full-view sample render)
- Assets: `public/assets/wizardry6/snes/data/class-tier-titles.json`,
  `public/assets/wizardry6/snes/data/monster-names.json`,
  `public/assets/wizardry6/snes/sprites/portraits.png` + `portraits.json`
  (full colour, real per-pair CGRAM palette, §3.3),
  `public/assets/wizardry6/snes/sprites/ui-icons.png` + `ui-icons.json`
  (full colour session 5, real CGRAM palette group 46, §3.2b),
  `public/assets/wizardry6/snes/screens/logo.png`, `copyright.png`,
  `title-backdrop.png`, `title-lightning.png` (new session 5, greyscale,
  §3.8), `public/assets/wizardry6/snes/sprites/font.png` + `font.json`
  (new session 5, 256-glyph bank, greyscale, §3.8),
  `public/assets/wizardry6/snes/sprites/spell-animations.png` +
  `spell-animations.json` (new session 5, 139-record/17,042-tile
  greyscale atlas + frame compose-list, §6.4),
  `public/assets/wizardry6/snes/sprites/dungeon-view-pieces.png` +
  `.json` (new, dungeon-composer follow-up session, §3.14 — 1893
  individually-addressable view compose-piece records, greyscale,
  unpaletted), `public/assets/wizardry6/snes/screens/dungeon-view-sample.png`
  + `.json` (new, same session — the single decisive full-viewport render),
  `manifest.json`; `tools/wizardry6/snes/decode-maze.ts` (new, bulk
  maze-table follow-up session, §3.14.8 — 14-level per-cell wall/feature
  decode + region-origin table, oracle-guarded on structural invariants,
  emits `public/assets/wizardry6/snes/data/maze.json` and 14 top-down map
  PNGs at `screens/maze/maze-levelNN.png`)
- Disassembly probes (session scratchpad, not committed, per the project's
  documented throwaway-probe convention): `dis65816.py`, a flag-aware
  (M/X-width-tracking) linear 65816 disassembler used for every citation in
  session 3's §3.3 trace, session 4's §3.5 boot-init trace, and session 5's
  independent re-verification of the `re-codebreaker` escalations' claims
  — re-derived fresh each session since scratchpad scripts are
  intentionally not committed, self-tested byte-exact against the
  published RESET disassembly (§2.2) before use each time; session 4 also
  used one-off census scripts (`mvn_census.py`, byte-density/cluster scans,
  a long-addressing-instruction filter) for §3.5-§6.4, also not committed.
  Two `re-codebreaker` escalations ran this session (title-screen-art;
  dungeon-maze-data JSL/BRK resolution) — their own scratch artifacts
  (LZSS/record decoders, contact-sheet renders) live in their respective
  fork scratchpads, not this session's; every claim promoted into this doc
  was independently re-derived and re-verified against the ROM by this
  session before being trusted, per
  `verify-escalation-artifacts-not-just-claims.md`.

No pipeline registration (`tools/shared/game-config.ts`,
`seer.config.ts`) was added this pass, per task scope — these extractors
are standalone scripts (`npx tsx <script> <path-to-sfc>`), not wired into
`extract-game-data.ts`/`build-assets.ts` yet.
