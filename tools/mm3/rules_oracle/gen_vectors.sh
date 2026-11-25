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
for spec in monturn:3000:60 initiative:3000:50 mondmg:3000:60 item:3000:40 castpay:3000:60 castrefund:3000:30 castblock:3000:40 spellsp:3000:40 spellprice:3000:40 levelthr:3000:40 shortfall:3000:40 pay:3000:60 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules2.py $unit generated/$unit.json --n $n
  $PY rules2.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
# pass 3 units (rules3.py): cast command + 75 spell handlers, combat spell engine, spell vs monster, battle round loop, clock / time passing
for spec in cast:6000:150 engine:600:60 spellhit:3000:300 wipecheck:3000:40 roundover:3000:40 alldown:3000:40 compact:3000:40 roundloop:2500:60 interest:1000:30 clock:2000:60 timepasses:2000:50 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules3.py $unit generated/$unit.json --n $n
  $PY rules3.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
# pass 4 units (rules4.py): rest, item prices, training hall (eligibility + level-up block), trap damage, thievery, per-step tick
for spec in rest:3000:50 itemprice:3000:80 itemprice2:1500:30 trainelig:2000:20 levelup:2500:40 trapdmg:3000:80 thievery:3000:30 steptick:200:10 runcmd:2000:40 loader:150:6 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules4.py $unit generated/$unit.json --n $n
  $PY rules4.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
# pass 5 units (rules5.py): character creation (class requirements, roll, record build), map event / lock executor, OV7 shop flows
for spec in classreq:1500:20 rollstats:1500:20 cbuild:1500:40 event:2500:60 shopop:3000:60 mondmgfull:3000:40 enchant:2000:40 volley:2500:50 breakweapons:1000:30 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules5.py $unit generated/$unit.json --n $n
  $PY rules5.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
# pass 6 units (rules6.py): party skill check
for spec in skillcheck:3000:120 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules6.py $unit generated/$unit.json --n $n
  $PY rules6.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
