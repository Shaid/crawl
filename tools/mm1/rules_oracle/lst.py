#!/usr/bin/env python3
"""Capstone 16-bit listing of the MM.EXE load image (image offset = file - 0x200; CS base = image 0,
DS base = image 0x107b0), annotated with MM.RSM symbols (decoded: record = [type][0x28][off16][name\\0],
type 2 = code offset in CS, type 3 = data offset in DS).
usage: lst.py IMG RSM_JSON START END  (hex image offsets)"""
import sys, json, re, bisect, capstone
img = open(sys.argv[1], 'rb').read()
syms = json.load(open(sys.argv[2]))
code = {o: n for n, t, o in syms if t == 2}
data = sorted((o, n) for n, t, o in syms if t == 3)
dkeys = [o for o, _ in data]
a, b = int(sys.argv[3], 16), int(sys.argv[4], 16)
def dsym(v):
    i = bisect.bisect_right(dkeys, v) - 1
    if i < 0: return ''
    o, n = data[i]
    return n if v == o else '%s+%#x' % (n, v - o)
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16)
md.detail = True
md.skipdata = True
for i in md.disasm(img[a:b], a):
    if i.address in code: print('\n%s:   ; %#x' % (code[i.address], i.address))
    note = ''
    if i.mnemonic in ('call', 'jmp') and i.op_str.startswith('0x'):
        t = int(i.op_str, 16) & 0xffff
        note = code.get(t, '')
    else:
        m = re.search(r'\[(?:[a-z]{2} \+ )?(0x[0-9a-f]+)\]', i.op_str)
        if m: note = dsym(int(m.group(1), 16))
        else:
            m = re.search(r'(?:mov|cmp|lea|add|sub) [a-z]{2}, (0x[0-9a-f]{2,4})$', i.mnemonic + ' ' + i.op_str)
            if m and 0x60 <= int(m.group(1), 16) < 0xc900: note = '?' + dsym(int(m.group(1), 16))
    print('%05x  %-18s %-6s %-28s %s' % (i.address, i.bytes.hex(), i.mnemonic, i.op_str, ('; ' + note) if note else ''))
