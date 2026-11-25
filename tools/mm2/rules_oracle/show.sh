#!/bin/bash
# show.sh HEXADDR [N]  -- print N listing lines from the resolved MM2 listing at CODE+HEXADDR
A=$(printf "%05x" $((16#$1))); N=${2:-40}
F=/home/ctemplet/Development/crawl/data/mm2/amiga/mm2.res.asm
L=$(grep -n -m1 ";$A:" $F | cut -d: -f1)
[ -z "$L" ] && { echo "no line for $A"; exit 1; }
sed -n "${L},$((L+N))p" $F
