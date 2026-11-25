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
  savechar:1000:40 savemons:1000:40 setcondi:600:30 resist:1500:60 monresma:1000:40 monbon:9000:120 "$@"; do
  IFS=: read unit n sub <<<"$spec"
  $PY rules.py $unit generated/$unit.json --n $n 2>&1 | grep -v Warning
  $PY rules.py subset generated/$unit.json vectors/$unit.json.gz --n $sub
done
