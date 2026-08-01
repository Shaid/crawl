#!/usr/bin/env python3
"""Extract Black Crypt's Amiga BCSPEED.EFF effect particle-emitter scripts.

bcdfa's container-directory entry 6 (file offset 0x15F8D, stored **raw**, not
RLE-compressed, 20,195 bytes) is the third BCSPEED bank: 95 effect scripts
that tie the already-extracted `.GFK` sprite frames (`sprites/bcspeed.*`) to
the already-decoded `.PRG` movement scripts (`bclib.prg_records`). Each
script is a sequence of "ticks" (groups); each tick spawns up to 20 particles,
each carrying a GFK sprite index/frame, a PRG movement-script index, and a
spawn position.

This was a genuinely hard sub-problem — every render sweep (opaque/masked, 22
widths) produced pure noise, because it isn't pixel data at all. Cracked via
a `re-codebreaker` escalation (disassembly trace of `InitBcspeedTables` and
`PlayEffect` in decompressed bcdft S_1), then **independently re-verified
from scratch** in the orchestrating session before being promoted here: a
fresh r2 disassembly matched the escalation's transcription instruction for
instruction, a from-scratch blind parser (written without looking at the
escalation's own probe script) reproduces the in-executable 95-entry
section-offset table byte-exact and closes the byte count with zero
remainder, and the DOS `clipper.clp` archive's own catalogue names this exact
payload `"Speed Effects"` (entry 225) with byte-identical content — confirmed
against this project's own `extract_clipper.parse_clp`, not the escalation's
code.

See `bclib/bcdfa.py`'s `eff_scripts`/`eff_table_offsets` for the decoder and
docs/blackcrypt/amiga/data-structure.md's "bcdfa — BCSPEED.EFF" for the full
disassembly, verification table, and semantic checks (mirror-pair spawn
symmetry, spawn-vs-travel-direction correlation).

This is a **data-only** extractor (no rendering): the escalation deliberately
left simulating PRG particle motion out of scope, and a static render of only
each tick's spawn positions would misrepresent effects whose visual body
comes from particle travel — see data-structure.md's "Render" row. Consumers
that want pixels should composite `sprites/bcspeed.*` frames (looked up by
`gfkRecord`/`gfkFrame`) at the recorded spawn position and then step each
particle's own `prgOffset` script, exactly as `PlayEffect` does.

Output:
    public/assets/blackcrypt/amiga/data/bcspeed-effects.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    s1_path = bclib.cache_dir('blackcrypt') / 'bcdft_decompressed.bin'

    if not bcdfa_path.exists():
        print(f'No bcdfa at {bcdfa_path} — nothing to do')
        return

    raw = bcdfa_path.read_bytes()

    effects = []
    total_records = 0
    for i, offset, last_group_index, frame_delay, groups in bclib.eff_scripts(raw):
        effects.append({
            'index': i,
            'bankOffset': offset,
            'lastGroupIndex': last_group_index,
            'groupCount': last_group_index + 1,
            'frameDelay': frame_delay,
            'groups': [
                [
                    {'gfkRecord': gfk_record, 'gfkFrame': gfk_frame,
                     'prgOffset': prg_offset, 'x': x, 'y': y}
                    for gfk_record, gfk_frame, prg_offset, x, y in group
                ]
                for group in groups
            ],
        })
        total_records += sum(len(g) for g in groups)

    if not effects:
        print('  no EFF sections decoded')
        return

    # Integrity cross-check against the in-executable section-offset table,
    # when the decompressed bcdft S_1 image is available (optional — the
    # format is self-describing and does not require it to parse).
    table_match = None
    if s1_path.exists():
        s1 = s1_path.read_bytes()
        table = bclib.eff_table_offsets(s1)
        parsed_starts = [e['bankOffset'] for e in effects]
        table_match = sum(1 for a, b in zip(table, parsed_starts) if a == b)

    bclib.write_json(bclib.asset_dir('data') / 'bcspeed-effects.json', {
        'source': 'bcdfa container-directory entry 6 (file offset 0x%05X, raw)' % bclib.EFF_STREAM,
        'bankBytes': bclib.EFF_BANK_BYTES,
        'note': ('gfkRecord/gfkFrame index sprites/bcspeed.* (see gfk_records); '
                 'prgOffset is a raw byte offset into the 34-record PRG table '
                 '(prg_records), already pre-multiplied by 4 in the data — do '
                 'not shift it again. x/y are spawn positions in the 208x140 '
                 'viewport, PRG steps the particle from there.'),
        'effects': effects,
    }, pretty=True)

    print(f'  data/bcspeed-effects: {len(effects)} effects, {total_records} '
          f'particle records ({bclib.EFF_BANK_BYTES} B source)')
    if table_match is not None:
        print(f'  section-offset table cross-check: {table_match}/{len(effects)} '
              f'match the in-executable table at bcdft S_1 +0x{bclib.EFF_TABLE:05X}')


if __name__ == '__main__':
    main()
