"""Shared helpers for the Black Crypt Windows-demo `crypt.exe` patchers.

Two jobs, both deliberately small:

1. **Assembler / disassembler round trip** (`assemble`, `disassemble`). The
   patchers embed their machine code as hex constants so they run with no
   toolchain, but those constants must come from a real assembler, never
   from hand encoding. `assemble()` re-derives bytes from source with GNU
   `as` + `ld` (`-Ttext=<origin>`, so every rel32/rel8 is resolved by the
   linker against the true load address), and `disassemble()` decodes bytes
   back with `objdump -b binary --adjust-vma`. Each patcher calls both from
   its self-check when the tools are on PATH and reports when they are not.

2. **PE section VirtualSize fix** (`fix_virtual_size`). Every patch cave in
   this project lies past its section's *declared* VirtualSize (`.text`
   declares `0x2ceb4` but caves run to `0x42df50`; `.rdata` declares
   `0x12da` but patch strings run to `0x42f621`). It works because Windows
   maps whole pages, but tooling hides the bytes. The fix sets VirtualSize to
   the section's (page-aligned) raw size. Values below are read from the real
   1995 demo build (`objdump -h`: `.text` VMA `0x401000` raw `0x2d000`;
   `.rdata` VMA `0x42e000` raw `0x2000`), and the helper refuses any header
   word that is neither the original nor the fixed value.
"""
from __future__ import annotations

import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

# section name -> (file offset of the VirtualSize dword in the section
# table, original declared VirtualSize, fixed VirtualSize = raw size).
# Section table starts at file+0x1d8 (PE header at 0xe0, optional header
# 0xe0 B); each 40-B entry holds VirtualSize at +8.
VIRTUAL_SIZE_FIX = {
    '.text': (0x1D8 + 8, 0x2CEB4, 0x2D000),
    '.rdata': (0x200 + 8, 0x12DA, 0x2000),
}


def fix_virtual_size(buf: bytearray, section: str) -> tuple[int, int]:
    """Set `section`'s VirtualSize to its raw size in-place. Idempotent:
    accepts a header already fixed by another patcher. Returns the (file
    offset, length) window it owns, for the caller's diff self-check."""
    off, orig, fixed = VIRTUAL_SIZE_FIX[section]
    name_off = off - 8
    name = bytes(buf[name_off:name_off + 8]).rstrip(b'\0').decode('ascii', 'replace')
    if name != section:
        raise ValueError(f'section table entry at file+{name_off:#x} is {name!r}, '
                         f'expected {section!r}')
    cur = struct.unpack_from('<I', buf, off)[0]
    if cur not in (orig, fixed):
        raise ValueError(f'{section} VirtualSize at file+{off:#x} is {cur:#x}; '
                         f'expected {orig:#x} (stock) or {fixed:#x} (fixed)')
    struct.pack_into('<I', buf, off, fixed)
    return off, 4


def check_virtual_size(data: bytes, section: str) -> None:
    off, _orig, fixed = VIRTUAL_SIZE_FIX[section]
    cur = struct.unpack_from('<I', data, off)[0]
    if cur != fixed:
        raise AssertionError(f'self-check failed: {section} VirtualSize is {cur:#x}, '
                             f'expected {fixed:#x}')


def have_toolchain() -> bool:
    return all(shutil.which(t) for t in ('as', 'ld', 'objcopy', 'objdump'))


def assemble(source: str, origin: int) -> bytes:
    """Assemble Intel-syntax 32-bit `source` linked at `origin` with GNU
    binutils and return the raw `.text` bytes."""
    with tempfile.TemporaryDirectory() as td:
        t = Path(td)
        (t / 'p.s').write_text('.intel_syntax noprefix\n.code32\n.text\n'
                               '.globl _start\n_start:\n' + source + '\n')
        subprocess.run(['as', '--32', '-o', str(t / 'p.o'), str(t / 'p.s')],
                       check=True, capture_output=True)
        subprocess.run(['ld', '-m', 'elf_i386', f'-Ttext={origin:#x}',
                        '-o', str(t / 'p.elf'), str(t / 'p.o')],
                       check=True, capture_output=True)
        subprocess.run(['objcopy', '-O', 'binary', '-j', '.text',
                        str(t / 'p.elf'), str(t / 'p.bin')],
                       check=True, capture_output=True)
        return (t / 'p.bin').read_bytes()


def disassemble(code: bytes, vma: int) -> list[tuple[int, str]]:
    """objdump `code` as raw i386 at `vma`; return [(addr, 'mnemonic ops')],
    whitespace-normalised."""
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / 'c.bin'
        p.write_bytes(code)
        out = subprocess.run(
            ['objdump', '-D', '-b', 'binary', '-m', 'i386', '-M', 'intel',
             f'--adjust-vma={vma:#x}', str(p)],
            check=True, capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) >= 3 and parts[0].strip().endswith(':'):
            try:
                addr = int(parts[0].strip()[:-1], 16)
            except ValueError:
                continue
            rows.append((addr, ' '.join(parts[2].split())))
    return rows


def verify_roundtrip(name: str, code: bytes, vma: int, source: str | None,
                     expected_insns: list[str]) -> str:
    """Re-assemble `source` at `vma` and require byte equality with `code`,
    then disassemble `code` and require the instruction list to equal
    `expected_insns`. Returns a one-line status. Raises AssertionError on a
    mismatch. Skips (with a status saying so) when binutils is absent."""
    if not have_toolchain():
        return f'{name}: round-trip SKIPPED (GNU as/ld/objcopy/objdump not on PATH)'
    if source is not None:
        got = assemble(source, vma)
        if got != code:
            raise AssertionError(f'{name}: re-assembled bytes {got.hex()} != '
                                 f'embedded {code.hex()}')
    insns = [t for _a, t in disassemble(code, vma)]
    if insns != expected_insns:
        raise AssertionError(f'{name}: disassembly {insns} != expected {expected_insns}')
    what = 're-assembled byte-exact and ' if source is not None else ''
    return (f'{name}: {what}disassembles ({len(code)} B) to the '
            f'{len(insns)} intended instructions')
