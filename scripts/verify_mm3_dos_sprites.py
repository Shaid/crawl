#!/usr/bin/env python3
"""Whole-corpus verification of the MM3 (DOS/VGA) sprite scanline-RLE grammar.

Run from the repo root:  python3 scripts/verify_mm3_dos_sprites.py

Checks two independent zero-deviation structural invariants over every sprite
container in `MM3.CC`:

  1. Byte framing   — every scanline's opcode stream lands *exactly* on the
     declared lineLength, and every cell ends exactly at the next cell offset
     from the frame table (or at end-of-file for the last cell). This is the
     invariant the game's own decoder requires: its row loop terminates on
     `cmp si,bp / je` (`vga`+0x1DDC), an exact landing only.

  2. Pixel bound    — no scanline ever emits more pixels than the cell's
     declared width. (It may emit fewer: trailing transparent pixels are
     simply not encoded, and the non-mirrored blit path never even reads the
     width field.)

See `scripts/mm3lib/dos_sprite.py` for the grammar and its driver citations.
"""
from __future__ import annotations

import os
import struct
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mm3lib.dos_cc import parse, extract_entry, hash_filename  # noqa: E402
from mm3lib.dos_sprite import (  # noqa: E402
    _cell_offsets, cell_header, is_sprite_container, op_pixels, op_size,
)

REPO = os.path.abspath(os.path.join(HERE, '..'))
CC_PATH = os.path.join(REPO, 'data', 'mm3', 'dosvga', 'MM3.CC')
SPRITE_EXTS = ('.mon', '.fac', '.icn', '.vga', '.pic', '.out', '.til', '.sky', '.brd')


def load_names() -> dict[int, str]:
    names = {}
    try:
        with open(os.path.join(HERE, 'mm3lib', 'dos_filenames.txt'), encoding='latin-1') as fh:
            for line in fh:
                line = line.strip()
                if line:
                    names[hash_filename(line)] = line
    except OSError:
        pass
    return names


def audit(data: bytes) -> tuple[Counter, list[str]]:
    """Audit one sprite container. Returns (counters, problems)."""
    c = Counter()
    problems: list[str] = []
    n = struct.unpack_from('<H', data, 0)[0]
    offs = _cell_offsets(data, n)
    for i, off in enumerate(offs):
        end = offs[i + 1] if i + 1 < len(offs) else len(data)
        _xo, w, _yo, h = cell_header(data, off)
        p = off + 8
        c['cells'] += 1
        cell_ok = True
        for _y in range(h):
            if p + 2 > end:
                problems.append(f'cell 0x{off:X}: ran out of data at row {_y}')
                cell_ok = False
                break
            line_len = struct.unpack_from('<H', data, p)[0]
            if line_len == 0:
                c['blank_rows'] += 1
                p += 2
                continue
            line_end = p + 2 + line_len
            if line_end > end:
                problems.append(f'cell 0x{off:X}: lineLength {line_len} past cell end')
                cell_ok = False
                break
            q = p + 4
            px = struct.unpack_from('<H', data, p + 2)[0]
            while q < line_end:
                op = data[q]
                px += op_pixels(op)
                q += op_size(op)
            c['lines'] += 1
            if q == line_end:
                c['lines_exact'] += 1
            else:
                cell_ok = False
                problems.append(f'cell 0x{off:X} row {_y}: overran line end by {q - line_end}')
            if px <= w:
                c['lines_within_width'] += 1
            else:
                problems.append(f'cell 0x{off:X} row {_y}: {px} px > width {w}')
            p = line_end
        if cell_ok and p == end:
            c['cells_exact'] += 1
        elif cell_ok:
            problems.append(f'cell 0x{off:X}: ended at 0x{p:X}, expected 0x{end:X}')
    return c, problems


def main() -> int:
    data = open(CC_PATH, 'rb').read()
    entries, _ = parse(data)
    names = load_names()

    per_ext: dict[str, Counter] = defaultdict(Counter)
    all_problems: list[str] = []
    for e in entries:
        name = names.get(e.hash)
        if not name:
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in SPRITE_EXTS:
            continue
        payload, _kind = extract_entry(data, e)
        if payload is None:
            continue
        if not is_sprite_container(payload):
            per_ext[ext]['not_a_container'] += 1
            continue
        c, problems = audit(payload)
        per_ext[ext].update(c)
        per_ext[ext]['files'] += 1
        all_problems += [f'{name}: {p}' for p in problems]

    total = Counter()
    for c in per_ext.values():
        total.update(c)

    print(f'{"ext":6} {"files":>5} {"cells exact":>18} {"lines exact":>20} {"px <= width":>20}')
    for ext in sorted(per_ext):
        c = per_ext[ext]
        print(f'{ext:6} {c["files"]:5d} '
              f'{c["cells_exact"]:8d}/{c["cells"]:<9d} '
              f'{c["lines_exact"]:9d}/{c["lines"]:<10d} '
              f'{c["lines_within_width"]:9d}/{c["lines"]:<10d}')
    print(f'{"TOTAL":6} {total["files"]:5d} '
          f'{total["cells_exact"]:8d}/{total["cells"]:<9d} '
          f'{total["lines_exact"]:9d}/{total["lines"]:<10d} '
          f'{total["lines_within_width"]:9d}/{total["lines"]:<10d}')
    print(f'blank rows: {total["blank_rows"]}')

    if all_problems:
        print(f'\n{len(all_problems)} PROBLEMS:')
        for p in all_problems[:40]:
            print('  ', p)
        return 1
    print('\nOK: zero deviation on both invariants.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
