"""Shared decode helpers for Westwood "Kyra"-engine games (EOB1, EOB2, Lands
of Lore — DOS/VGA ports).

Every routine here is ported from ScummVM's engines/kyra/ source (the
ground-truth oracle for this engine family; see
docs/eotb/dosvga/data-structure.md for the exact files/line numbers cited)
and verified against the real game files in this project. Keep new
Kyra-format decode logic here rather than re-deriving it inline in an
extractor script.
"""
