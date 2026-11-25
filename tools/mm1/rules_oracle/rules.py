#!/usr/bin/env python3
"""MM1 rules vector generators.  Usage: rules.py UNIT OUT.json [--n N] [--seed S]
Big sets go to tools/mm1/rules_oracle/generated/ (gitignored); `subset IN OUT.gz --n N` writes a small committed subset.
Unit generators live in units_*.py (register with @unit)."""
from common import *
import units_chargen, units_train, units_combat
for _m in ('units_effects', 'units_spells', 'units_after', 'units_world', 'units_ovr', 'units_shops'):
    try: __import__(_m)
    except ModuleNotFoundError: pass
if __name__ == '__main__': main(U)
