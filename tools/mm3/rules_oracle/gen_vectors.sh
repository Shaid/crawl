#!/bin/bash
# Regenerate all MM3 rules vectors. Full sets -> generated/ (gitignored); small committed subsets -> vectors/.
# Needs a venv with unicorn+capstone:  python3 -m venv .venv && .venv/bin/pip install unicorn capstone   (or set MM3_PY)
set -e
cd "$(dirname "$0")"
PY=${MM3_PY:-$( [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3 )}
mkdir -p generated vectors
# unit:count:subset-size
for spec in rng:4000:60 bracket:600:60 level:2000:40 age:2000:40 condmod:3000:80 equip:4000:80 getstat:4000:80 maxhp:3000:60 ac:3000:50 maxsp:3000:60 xpnext:3000:60 check:2000:40 save:4000:80 dmgchar:3000:80 monattack:4000:120 weapon:3000:60 partyhit:4000:80 element:2000:50 dmghit:2000:40 meleeround:3000:60 xpsplit:2000:50 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules.py $unit generated/$unit.json --n $n
  $PY rules.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
# pass 2 units (rules2.py): monster turn, turn order, damage to a monster, item generator, spell cast gate
for spec in monturn:3000:60 initiative:3000:50 mondmg:3000:60 item:3000:40 castpay:3000:60 castrefund:3000:30 castblock:3000:40 spellsp:3000:40 spellprice:3000:40 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules2.py $unit generated/$unit.json --n $n
  $PY rules2.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
