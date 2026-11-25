#!/usr/bin/env python3
"""Footprint audit (MM3, pass 6): which harnessed unit READS which monster-side state, from the recorded input footprints
(`init` = every byte read before written).  Closes the 'absent' list (surprise, flee/morale, monster spells, call for help) from the dynamic side:
if the whole turn pipeline (monster turn, round loop, volley, run command, turn order, monster attack) never reads a monster's current HP, a
resistance/spell table or a 'spell set', no flee/morale/spell decision can exist inside it.
Usage: audit_monster_reads.py   (uses generated/*.json when present, else the committed vectors/*.json.gz)"""
import glob, gzip, json, os
A4 = 0x200000 + 0x7FFE
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, 'vectors/montables.json')))
FIELDS = {'slot id u16[10] A4+0x173A': (0x173A, 20), 'slot HP u16[10] A4+0x1492': (0x1492, 20), 'slot status u16[10] A4+0x188E': (0x188E, 20),
          'ranged list A4+0x1F4E': (0x1F4E, 36)}
for k, v in T.items(): FIELDS['Mon' + k + ' table'] = (v['a4disp'], v['width'] * 90)
def vecs(n):
    f = os.path.join(HERE, 'generated', n + '.json')
    if os.path.exists(f): return json.load(open(f))
    return json.load(gzip.open(os.path.join(HERE, 'vectors', n + '.json.gz')))
names = sorted(set(os.path.basename(f).split('.')[0] for f in glob.glob(os.path.join(HERE, 'vectors', '*.json.gz'))))
reads = {k: [] for k in FIELDS}
for n in names:
    rd = set()
    for x in vecs(n):
        for a in x['init']: rd.add(int(a) - A4)
    for k, (lo, ln) in FIELDS.items():
        if any(lo <= a < lo + ln for a in rd): reads[k].append(n)
for k in FIELDS: print('%-34s %s' % (k, ' '.join(reads[k]) or '(no harnessed routine reads it)'))
