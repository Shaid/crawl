#!/usr/bin/env python3
"""
Extract S_0 CODE, S_4 CODE, and S_5 DATA from the bcdft Amiga executable.
These are fed to the musashi-based 68k emulator for decompression.

Usage:
    python3 extract_sections.py <bcdft_path> <s0_output> <s4_output> <s5_output>
"""
import sys

def extract(path, s0_out, s4_out, s5_out):
    with open(path, 'rb') as f:
        data = f.read()

    pos = 0
    hunk_num = 0
    s0 = s4 = s5 = None

    while pos < len(data) - 4:
        tag = int.from_bytes(data[pos:pos+4], 'big')
        if tag == 0x3E9:  # HUNK_CODE
            lw = int.from_bytes(data[pos+4:pos+8], 'big')
            payload = data[pos+8:pos+8+lw*4]
            if hunk_num == 0:
                s0 = payload
            elif hunk_num == 4:
                s4 = payload
            pos += 8 + lw * 4
            hunk_num += 1
        elif tag == 0x3EA:  # HUNK_DATA
            lw = int.from_bytes(data[pos+4:pos+8], 'big')
            payload = data[pos+8:pos+8+lw*4]
            if hunk_num == 5:
                s5 = payload
            pos += 8 + lw * 4
            hunk_num += 1
        elif tag in (0x3E9,):  # HUNK_CODE (continued from above)
            lw = int.from_bytes(data[pos+4:pos+8], 'big')
            pos += 8 + lw * 4
            hunk_num += 1
        elif tag == 0x3EB:  # HUNK_BSS
            pos += 8
            hunk_num += 1
        elif tag in (0x3EC, 0x3F2, 0x3F3, 0x3E7):
            pos += 4
        else:
            pos += 4

    if not all([s0, s4, s5]):
        raise ValueError(f"Missing sections: s0={s0 is not None} s4={s4 is not None} s5={s5 is not None}")

    with open(s0_out, 'wb') as f:
        f.write(s0)
    with open(s4_out, 'wb') as f:
        f.write(s4)
    with open(s5_out, 'wb') as f:
        f.write(s5)

    print(f"S_0 CODE: {len(s0)} bytes -> {s0_out}")
    print(f"S_4 CODE: {len(s4)} bytes -> {s4_out}")
    print(f"S_5 DATA: {len(s5)} bytes -> {s5_out}")

if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    extract(*sys.argv[1:5])
