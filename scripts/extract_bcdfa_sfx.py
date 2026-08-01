#!/usr/bin/env python3
"""Extract Black Crypt's Amiga BCSPEED effect sound bank from bcdfa.

The 28,846 bytes between the paperdoll RLE stream's end (bcdfa+0x6F4D) and
the BCSPEED.GFK RLE stream's start (bcdfa+0xDFFB) are **not** compressed —
they are a raw signed 8-bit PCM sound bank, tiled with zero gap by 10 unique
samples (see `bclib.bcdfa.SFX_RECORDS`). This is the BCSPEED spell/projectile
effect sound bank, paired with the GFK animation frames and the PRG scripts
elsewhere in the same file.

This *retracts* the earlier "336-byte raw movement/delta table" reading of
`bcdfa+0xDEAB`-`0xDFFB`: that span is just the tail of the last sample here,
not a separate structure — see docs/blackcrypt/amiga/data-structure.md.

Ground truth: all 10 samples are byte-identical (Amiga byte XOR 0x80) to 14
of the DOS `clipper.clp` archive's 22 `type=4` sound entries; the other 8 are
the already-documented bcdfb/c/f/j/m monster sound bank samples.

Output:
    audio/bcspeed-sfx-<NN>.raw   10 raw signed-8-bit PCM samples
    data/bcspeed-sfx.json        offsets, sizes, matching DOS entry indices
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfa_path = amiga / 'bcdfa'
    if not bcdfa_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return

    raw = bcdfa_path.read_bytes()
    audio_dir = bclib.asset_dir('audio')

    manifest = []
    total = 0
    for n, dos_entries, pcm in bclib.sfx_samples(raw):
        name = f'bcspeed-sfx-{n:02d}'
        (audio_dir / f'{name}.raw').write_bytes(pcm)
        off, size, _ = bclib.SFX_RECORDS[n]
        manifest.append({
            'index': n, 'file': f'audio/{name}.raw',
            'bcdfaOffset': off, 'bytes': size,
            'format': 'pcm_s8',
            'dosClipperEntries': list(dos_entries),
        })
        total += size

    bclib.write_json(bclib.asset_dir('data') / 'bcspeed-sfx.json', {
        'bankStart': bclib.SFX_BANK_START,
        'bankEnd': bclib.SFX_BANK_END,
        'samples': manifest,
    }, pretty=True)

    print(f'  audio/bcspeed-sfx-*.raw: {len(manifest)} samples, {total} B total '
          f'(bank {bclib.SFX_BANK_START:#x}-{bclib.SFX_BANK_END:#x})')


if __name__ == '__main__':
    main()
