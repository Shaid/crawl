"""PC-relative call xrefs: python3 xrefpc.py SEG TARGET_HEX  (SEG root|1..8) -> every JSR/BSR (d16,PC / bsr.w / bsr.b) in any
segment (same-segment targets only) and jump-table entries whose overlay stub points at SEG:TARGET."""
import sys, struct
from emu import load_exe, jt_target
X = load_exe()
seg, tgt = sys.argv[1], int(sys.argv[2], 16)
blobs = {'root': X['root_code']}; blobs.update({str(k): v for k, v in X['ov'].items()})
b = blobs[seg]
for i in range(0, len(b) - 3, 2):
    w = b[i:i+2]
    if w == b'\x4e\xba' or w == b'\x4e\xfa' or w == b'\x61\x00' or w == b'\x60\x00':
        d = struct.unpack_from('>h', b, i+2)[0]
        if i + 2 + d == tgt: print(seg, hex(i), {b'\x4e\xba': 'jsr', b'\x4e\xfa': 'jmp', b'\x61\x00': 'bsr', b'\x60\x00': 'bra'}[w])
    elif w[0] == 0x61 and w[1] not in (0, 0xff):
        d = struct.unpack('b', w[1:2])[0]
        if i + 2 + d == tgt: print(seg, hex(i), 'bsr.b')
