#!/bin/bash
# Regenerate all MM1 rules vectors. Full sets -> generated/ (gitignored); small committed subsets -> vectors/.
# Needs a venv with unicorn+capstone (reuse ../../mm2/rules_oracle/.venv, or set MM1_PY)
set -e
cd "$(dirname "$0")"
PY=${MM1_PY:-$(realpath ../../mm2/rules_oracle/.venv/bin/python)}
mkdir -p generated vectors
# unit:count:subset-size
for spec in random:2000:80 rollstat:800:30 raceadj:600:40 pclass:600:30 setspell:600:40 hpbonus:1000:50 createcommit:600:20 resetac:1500:50 \
  xpthr:1500:60 xpcmp:1500:60 traingold:1000:40 levelup:1500:60 \
  rolldmg:1500:60 attackp:2000:80 monhit:1500:50 apdmch:1500:60 apdmmon:1500:60 setinit:600:40 \
  savechar:1000:40 savemons:1000:40 setcondi:600:30 resist:1500:60 monresma:1000:40 monbon:9000:120 cast:2500:300 treas:600:50 treitem:800:60 divide:600:40 resout:300:20 victory:600:50 encgen:1200:80 regenmon:800:60 monadv:800:60 flee:800:40 roundend:800:60 monpick:800:60 ability:1500:100 qcast:2500:250 use:1500:120 useitem:1500:120 surprise:2500:150 rest:1500:100 okrest:1500:100 step:3000:150 pool:2500:150 door:2500:150 ovdisp:300:50 ovcell:150:60 scrkey:100:20 cellload:600:40 food:200:30 blacks:200:40 temple:200:40 tavern:200:40 training:200:40 trapfx:300:40 chest:3000:80 chesttrap:300:40 equip:3000:80 remove:1500:60 trade:1500:60 discard:600:40 poption:600:40 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules.py $unit generated/$unit.json --n $n 2>&1 | grep -v Warning
  case $unit in ovdisp|ovcell|scrkey|cellload|food|blacks|temple|tavern|training|trapfx|chest|chesttrap|equip|remove|trade|discard|poption) EX=--exact;; *) EX=;; esac
  $PY rules.py subset generated/$unit.json vectors/$unit.json.gz --n $sub $EX
done
