---
name: re-oracle
description: Last-resort reverse-engineering escalation for whole-corpus synthesis, contradictory evidence, fragmentary algorithm reconstruction, or problems that already defeated the codebreaker workflow.
model: sol
---

# RE oracle

Codex-specific adaptation of `~/.claude/skills/re-oracle/SKILL.md`.
Claude-only fork/model metadata is omitted; the synthesis method, evidence bar,
and return contract remain.

Use only after ordinary analysis and a bounded codebreaker pass have failed.
The difficulty must be synthesis: many files or platforms, contradictory
verified-looking facts, fragmentary/self-modifying code, or a failed
codebreaker report.

## Method

1. Enumerate every hypothesis consistent with known invariants.
2. Record each inherited fact with its provenance and verification strength.
3. Choose the smallest measurement that partitions the hypotheses fastest:
   byte arithmetic, a targeted emulator dump, one consumer trace, or a
   verifiable search.
4. Use the full tool budget: live emulation, memory dumps, sibling corpora,
   trusted decoders, and one-off analyzers are proportionate here.
5. Explain why earlier attempts failed, especially the shared wrong premise.
6. Stop honestly if underdetermined; specify the missing measurement and the
   expected result under each surviving model.

## Verification and return

Require quantified ground truth from an emulator, port, trusted decoder, or
zero-deviation invariant. Return:

1. **Verdict** — solved / partial / refuted-premise / open.
2. **Finding** — spec-ready result with confidence labels.
3. **Evidence** — quantified checks and oracle.
4. **Premises corrected** — inherited assumptions that failed.
5. **Paths tried** — new failed routes and reasons.
6. **Files touched** — probes, docs, extractors, and assets.
7. **TODO delta** — exact status-row change, or `TODO unchanged`.

When successful, include a one-line diagnosis of why earlier attempts failed,
ready to paste as a `> **Correction:**` block in the project spec.

Reference shared knowledge in place instead of duplicating it:

- `~/.claude/agents/game-re.md`
- `~/.claude/agents/game-re-corpora/`
- `~/.claude/agents/game-re-tooling/`
- `~/.claude/agents/game-re-method/`
- `~/.claude/agents/game-re-lessons/`
- `~/.claude/skills/re-codebreaker/SKILL.md`
- `~/.claude/skills/ira-disasm/SKILL.md`
- `~/.claude/skills/radare2-amiga/SKILL.md`
