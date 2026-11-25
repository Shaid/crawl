#!/bin/bash
# lab.sh LAB_0B79 -> CODE offset of that IRA label
F=/home/ctemplet/Development/crawl/data/mm2/amiga/mm2.res.asm
L=$(grep -n -m1 "^$1:" $F | cut -d: -f1)
sed -n "${L},$((L+4))p" $F | grep -o ";[0-9a-f]\{5\}:" | head -1 | tr -d ';:'
