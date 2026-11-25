"""PC-relative string xrefs: python3 strxref.py SEG TARGET_HEX  -> every `pea/lea/move.l #.. d16(pc)` instruction whose
effective address equals SEG:TARGET (extension word at i+2: 487A pea, 41FA..4FFA lea An,d16(pc)).  Also reports absolute
`.l` immediates equal to TARGET + the segment base is not attempted (code is PC-relative)."""
import sys, struct
from emu import load_exe
X = load_exe()
seg, tgt = sys.argv[1], int(sys.argv[2], 16)
blobs = {'root': X['root_code']}; blobs.update({str(k): v for k, v in X['ov'].items()})
b = blobs[seg]
for i in range(0, len(b) - 3, 2):
    w = struct.unpack_from('>H', b, i)[0]
    if w == 0x487a or (w & 0xf1ff) == 0x41fa:
        d = struct.unpack_from('>h', b, i + 2)[0]
        if i + 2 + d == tgt: print(seg, hex(i), 'pea' if w == 0x487a else 'lea')
