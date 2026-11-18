"""Run: python3 scripts/eotb3lib/test_itemdat.py  (needs data/eotb3/dosvga/CHARGEN/ITEMTYPE.DAT)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eotb3lib.itemdat import load_itemtype_dat

blob = Path("data/eotb3/dosvga/CHARGEN/ITEMTYPE.DAT").read_bytes()
d = load_itemtype_dat(blob)
t = d["types"]
assert d["count"] == 64 and 2 + 64 * 16 == len(blob)
# Record 0 (file offset 2): 1d8/1d10 one-hand weapon, classes 0x39.
assert (t[0]["armorClass"], t[0]["allowedClasses"], t[0]["requiredHands"]) == (0, 0x39, 1)
assert (t[0]["dmgNumDiceS"], t[0]["dmgNumPipsS"], t[0]["dmgNumDiceL"], t[0]["dmgNumPipsL"]) == (1, 8, 1, 10)
# The old "trailer 0x0004" is the last record's extraProperties.
assert t[-1]["extraProperties"] == 4
# Null control: decoding from offset 0 (the old framing) must NOT give these values.
bad = blob[0:2]  # old reading: record 0 starts at offset 0 -> first u16 would be the count, 64
assert int.from_bytes(bad, "little") == 64 != t[0]["invFlags"]
# ITEMTYPE.DAT is byte-identical to EOB2's file.
eob2 = Path("data/eotb2/dosvga/ITEMTYPE.DAT")
if eob2.exists():
    assert eob2.read_bytes() == blob
print("itemdat ok")
