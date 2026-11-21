---
title: Data Tables
description: Wizardry 6 headers, databases, messages, monsters, items, XP and character records.
---

# Data Tables

Wizardry 6's data is not one monolithic database. The resource headers, message
tables, scenario sections, item/monster records and character files each have a
different reader. The Amiga work is the most complete field-level map; DOS/EGA
shares the major structures after its platform conversion; SNES has its own
native tables and text encoding.

## Amiga database map

| File | What is known |
|------|---------------|
| `misc.hdr` | 256-node Huffman tree; the executable's bit walker matches all 1,024 bytes. |
| `msg.hdr` / `msg.dbs` | Message index and 724 decoded messages. |
| `scenario.hdr` | Scenario resource index and trailing flags; most structure confirmed, some semantics remain. |
| `scenario.dbs` | Shared scenario sections, 14-level maze geometry, messages, monsters and compose-linked content. |
| `newgame.dbs` | New-game defaults and starting data; full field-level reader confirmed. |
| `pcfile.dbs` | Character records; core fields are named, with large unresolved spans still preserved raw. |
| `master.hdr` / `disk.hdr` | Disk/resource indexing and load-order metadata, structurally confirmed. |

The extracted site data includes headers, messages, item catalogues, monster
mapping, XP tables, NPC names and scenario section directories. These are
deliberately emitted as machine-readable JSON alongside the rendered atlases.

## Monster and item records

Monster records now have their three attack sub-records decoded field by field,
including damage, count/sides, status effects, range, hit chance and verb id.
The remaining bytes are isolated in the status page rather than being given
invented names. The item catalogue and its references are similarly extracted,
with unresolved fields retained as raw values.

## Cross-platform checks

The DOS/EGA data confirms the shared `.HDR`/`.DBS` family and adds the overlay
loader story: `wroot.exe` loads resident functionality and platform-specific
overlays such as `wmaze.ovr`. Its `.PIC` resources add block RLE but preserve
the underlying cel geometry. The SNES tables use a different encoding, with
confirmed class-tier titles, monster names, messages, maze records and a full
8-bit text encoding.
