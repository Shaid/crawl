#!/bin/bash
# Regenerate all MM2 rules vectors. Full sets -> generated/ (gitignored); small committed subsets -> vectors/.
# Needs a venv with unicorn:  python3 -m venv .venv && .venv/bin/pip install unicorn   (or set MM2_PY)
set -e
cd "$(dirname "$0")"
PY=${MM2_PY:-$( [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3 )}
mkdir -p generated vectors
# unit:count:subset-size[:flags]
for spec in rng:4000:60 monunpack:600:60:--synthetic bonus:256:256 melee:3000:60 luck:3000:60 dmgchar:3000:80 pmelee:3000:80 monspecial:2000:50 killreward:2000:60 partystrength:1000:40 mspelldmg:2000:40 sync:100:20 spelllevel:3000:80 xpaward:1500:50 train:3000:80 rest:2000:60 spellcost:3000:80 encgroup:3000:60 moninit:1500:40 battleover:1500:60 encpick:3000:50 encbudget:2000:60 encgen:1500:40 charflee:2000:50 round:2000:60 driver:2000:150 mondeath:2000:80 mondamage:2000:80 questkill:2000:60 resolve:2000:60 tgtranged:2000:80 tgtmelee:2000:80 monturn:2000:100 setcond:4000:60 monspecial2:3000:100 spellgate:3000:80 equip:3000:60 unequip:3000:60 ac:3000:40 lootitem:3000:60 treasure:3000:60 xpneed:3000:80 traincost:3000:60 "$@"; do
  IFS=: read unit n sub flags <<<"$spec"
  $PY rules.py $unit generated/$unit.json --n $n
  $PY rules.py subset generated/$unit.json vectors/$unit.json.gz --n $sub $flags
done
# pass 3 (spells and items): rules4.py units  unit:count:subset-size
for spec in castdisp:0:206 anywhere:2000:40 dicedmg:2000:50 maxtargets:2000:40 castroute:2000:60 partyeffect:2000:60 cbspell:3000:150 ncspell:3000:150 monspell:2000:150 itemuse:2000:120 "$@"; do
  IFS=: read unit n sub flags <<<"$spec"
  $PY rules4.py $unit generated/$unit.json --n ${n:-2000}
  $PY rules4.py subset generated/$unit.json vectors/$unit.json.gz --n $sub $flags
done
