#!/usr/bin/env python3
"""Capstone listing of a `.OVR` overlay's code segment (loaded by `ovloader_` CODE+0x1C at CS:hdr[1] = 0xF48F), annotated with MM.RSM symbols.
Header (14 bytes, LE words): +0 magic 0xF2, +2 code load offset (0xF48F), +4 code size, +6 data load offset (0xC940), +8 data size, +10 bss size, +12 entry offset.
usage: lst_ovr.py FILE.OVR RSM_JSON [START END]   (CS offsets, hex)"""
import sys, json, struct, bisect, capstone
d = open(sys.argv[1], 'rb').read()
magic, cbase, csz, dbase, dsz, bss, entry = struct.unpack_from('<7H', d, 0)
syms = json.load(open(sys.argv[2]))
code = {o: n for n, t, o in syms if t == 2}
data = sorted((o, n) for n, t, o in syms if t == 3)
dk = [o for o, _ in data]
def dsym(v):
    if v >= dbase: return 'ovdata+%#x' % (v - dbase)
    i = bisect.bisect_right(dk, v) - 1
    if i < 0: return ''
    o, n = data[i]
    return n if v == o else '%s+%#x' % (n, v - o)
print('; magic %#x code@%#x size %#x data@%#x size %#x bss %#x entry %#x' % (magic, cbase, csz, dbase, dsz, bss, entry))
a = int(sys.argv[3], 16) if len(sys.argv) > 3 else cbase
b = int(sys.argv[4], 16) if len(sys.argv) > 4 else cbase + csz
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16); md.skipdata = True
import re
for i in md.disasm(d[14 + a - cbase: 14 + b - cbase], a):
    note = ''
    if i.mnemonic in ('call', 'jmp') and i.op_str.startswith('0x'):
        t = int(i.op_str, 16) & 0xffff
        note = code.get(t, 'ovl+%#x' % (t - cbase) if t >= cbase else '')
    else:
        m = re.search(r'\[(?:[a-z]{2} \+ )?(0x[0-9a-f]+)\]', i.op_str)
        if m: note = dsym(int(m.group(1), 16))
        else:
            m = re.search(r'(?:mov|cmp|lea|add|sub) [a-z]{2}, (0x[0-9a-f]{3,4})$', i.mnemonic + ' ' + i.op_str)
            if m and 0x60 <= int(m.group(1), 16) < 0xf000: note = '?' + dsym(int(m.group(1), 16))
    if i.address == entry: print('\n; --- entry ---')
    print('%05x  %-18s %-6s %-28s %s' % (i.address, i.bytes.hex(), i.mnemonic, i.op_str, ('; ' + note) if note else ''))
