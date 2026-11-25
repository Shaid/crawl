#!/usr/bin/env python3
"""Static census of the 55 `.OVR` map-script overlays (see docs/mm1/dosega/game-rules.md section 6).
For each overlay: container header, the special-cell tables (count at data+0x32, cell offsets at +0x33, direction masks, handler code addresses),
and the vocabulary of MM.EXE routines each handler calls / jumps to (decoded from the 8086 code with capstone, symbols from MM.RSM).
usage: ovr_census.py DATA_DIR RSM_JSON OUT.json"""
import sys, os, json, struct, glob, collections, re, capstone

data_dir, rsm_path, out_path = sys.argv[1:4]
syms = json.load(open(rsm_path))
code = {o: n for n, t, o in syms if t == 2}
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16); md.skipdata = True; md.detail = True
OVR_CODE_BASE = 0xf48f

def handler_summary(code_bytes, base, start, limit=400):
    """linear walk from `start` through the overlay code (CS addresses): collect calls/jumps to MM.EXE routines until an unconditional exit"""
    calls, ovl_calls, strings = [], [], []
    off = start - base
    n = 0
    for i in md.disasm(code_bytes[off:off + 600], start):
        n += 1
        if n > limit: break
        if i.mnemonic in ('call', 'jmp') and i.op_str.startswith('0x'):
            t = int(i.op_str, 16) & 0xffff
            if t < base: calls.append(code.get(t, '%#x' % t))
            elif i.mnemonic == 'call': ovl_calls.append(t)
            if i.mnemonic == 'jmp' and t < base: break
        elif i.mnemonic == 'mov' and re.match(r'word ptr \[0x3bd4\], 0x[0-9a-f]+', i.op_str):
            strings.append(int(i.op_str.split(', ')[1], 16))
        if i.mnemonic == 'ret': break
    return calls, ovl_calls, strings

out, vocab = {}, collections.Counter()
for path in sorted(glob.glob(os.path.join(data_dir, '*.OVR'))):
    d = open(path, 'rb').read()
    magic, cbase, csz, dbase, dsz, bss, entry = struct.unpack_from('<7H', d, 0)
    assert magic == 0xf2 and cbase == OVR_CODE_BASE and 14 + csz + dsz == len(d), path
    cb, db = d[14:14 + csz], d[14 + csz:]
    N = db[0x32]
    offs, masks = list(db[0x33:0x33 + N]), list(db[0x33 + N:0x33 + 2 * N])
    hand = [struct.unpack_from('<H', db, 0x33 + 2 * N + 2 * i)[0] for i in range(N)]
    # the dispatcher the entry code installs in DS:0x134 (specaddr): `mov ax, imm; mov [0x134], ax` at the code start
    spec = struct.unpack_from('<H', cb, 1)[0] if cb[0] == 0xb8 else None
    rows = []
    for i in range(N):
        ok = cbase <= hand[i] < cbase + csz
        c, oc, st = handler_summary(cb, cbase, hand[i]) if ok else ([], [], [])
        for x in set(c): vocab[x] += 1
        rows.append({'cell': offs[i], 'mask': masks[i], 'handler': hand[i], 'inCode': ok, 'calls': c, 'ovlCalls': [hex(x) for x in oc], 'strings': [hex(x) for x in st]})
    out[os.path.basename(path)[:-4]] = {'entry': entry, 'codeSize': csz, 'dataSize': dsz, 'specaddr': spec, 'nSpecial': N, 'special': rows}
json.dump({'overlays': out, 'vocabulary': vocab.most_common()}, open(out_path, 'w'), indent=1)
bad = sum(1 for o in out.values() for r in o['special'] if not r['inCode'])
print(len(out), 'overlays,', sum(o['nSpecial'] for o in out.values()), 'special cells,', bad, 'handlers outside the code segment')
print(vocab.most_common(40))
