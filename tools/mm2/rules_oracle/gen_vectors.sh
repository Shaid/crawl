#!/bin/bash
# Regenerate all MM2 rules vectors. Full sets -> generated/ (gitignored); small committed subsets -> vectors/.
# Needs a venv with unicorn:  python3 -m venv .venv && .venv/bin/pip install unicorn   (or set MM2_PY)
set -e
cd "$(dirname "$0")"
PY=${MM2_PY:-$( [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3 )}
mkdir -p generated vectors
# unit:count:subset-size[:flags]
for spec in rng:4000:60 monunpack:600:60:--synthetic bonus:256:256 melee:3000:60 luck:3000:60 dmgchar:3000:80 pmelee:3000:80 monspecial:2000:50 killreward:2000:60 partystrength:1000:40 mspelldmg:2000:40 sync:100:20 spelllevel:3000:80 xpaward:1500:50 "$@"; do
  IFS=: read unit n sub flags <<<"$spec"
  $PY rules.py $unit generated/$unit.json --n $n
  $PY rules.py subset generated/$unit.json vectors/$unit.json.gz --n $sub $flags
done
