/*
 * MM3 (Amiga) LZ decompressor oracle harness.
 *
 * Runs the game's own decompression routine (CODE hunk payload 0x55C4 of
 * `Might&MagicIII`) under musashi and dumps its output, so the Python port
 * (scripts/mm3lib/amiga_cc.py::lz_decompress) can be verified byte-exact
 * against the game's own code.
 *
 * Routine calling convention (SAS/C): decompress(inBuf, outBuf), args on the
 * stack — inBuf at 8(a6), outBuf at 0xC(a6) after the routine's own
 * `link a6,#-0x1012`. inBuf points at the full .cc entry: u32@+0 = size-8,
 * u32@+4 = decompressed size, stream at +8.
 *
 * Layout notes (all offsets into the *routine*, which lives at 0x1000 here):
 *   0x55C4: link a6,#-0x1012; movem.l d0-d7/a0-a4,-(a7)
 *   0x55CC: lea -0x1012(a6),a2   ; ring base
 *   0x55D0: move.l #0x20202020,d1; move.l #0xFD,d0; 254x4xmove.l + 3x + 1x.w
 *           -> pre-fills ring indices 0x000..0xFED (4078 of 4096 bytes)
 *   0x55F2: movea.l 0xC(a6),a1   ; outBuf
 *   0x55F6: movea.l 8(a6),a0     ; inBuf
 *   0x55FA: move.l 4(a0),d0      ; decompressed size
 *   0x55FE: addq.l #8,a0         ; stream
 *   0x5600: move.l #0xFEE,d1     ; ring write cursor
 *   0x560C: main loop (flag bitstream, LSB first)
 *   0x5634: match decode: {lo,hi}: dist = ((hi&0xF0)<<4 | lo) & 0xFFF,
 *           len = (hi&0x0F)+3; reads ring[(dist+k)&0xFFF], writes ring[d1]
 *   0x5672: movem.l (a7)+; unlk a6; rts
 *
 * The ring is addressed with sign-extended .w indices: (a2,d1.w) with d1 in
 * 0x800..0xFFF points *below* a2 (into the caller's stack region), which is
 * why the routine's own pre-fill covers only 0x000..0xFED — the last 18
 * indices (0xFEE..0xFFF) plus the whole negative half are caller-stack
 * garbage, and the routine's saved registers live at a2-0x30..a2-0x12.
 * The harness therefore pre-fills [a2-0x800, a2+0x800) with 0x20 (matching
 * the Python port's full-0x20 ring) and sets every CPU register to
 * 0x20202020, so the saved-regs region [a2-0x30, a2-0x12) also reads 0x20.
 *
 * Build: bash tools/mm3_lz_harness/build.sh
 *   (or manually from tools/bcdft_decompress/:
 *    gcc -I. -Imusashi -Imusashi/softfloat -O2 -o /tmp/mm3_lz_emu \
 *        ../mm3_lz_harness/emu_lz.c \
 *        musashi/m68kcpu.o musashi/m68kdasm.o musashi/m68kops.o musashi/softfloat.o -lm)
 *
 * Usage: mm3_lz_emu <entry.bin> <out.bin> [code0.bin]
 *
 * Verification: 552/552 LZ entries across the 8 shipped .cc files decode
 * byte-exact against the Python port (see docs/mm3/amiga/data-structure.md
 * "LZ77 — confirmed").
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

static unsigned char *mem;
#define MEM_SIZE 0x10000000

#define ROUTINE  0x1000        /* the decompressor, copied from code0+0x55C4 */
#define INBUF    0x20000       /* the .cc entry (8-byte header + stream)   */
#define OUTBUF   0x40000       /* decompressed output                      */
#define MAXOUT   0x80000       /* 512 KB cap (largest entry = 208,919 B)   */
#define STACK    0x800000

unsigned int m68k_read_memory_8(unsigned int a)  { return (a < MEM_SIZE) ? mem[a] : 0; }
unsigned int m68k_read_memory_16(unsigned int a) { return (a + 1 < MEM_SIZE) ? (mem[a] << 8) | mem[a + 1] : 0; }
unsigned int m68k_read_memory_32(unsigned int a) { if (a + 3 < MEM_SIZE) return (mem[a] << 24) | (mem[a+1] << 16) | (mem[a+2] << 8) | mem[a+3]; return 0; }
unsigned int m68k_read_immediate_16(unsigned int a)  { return m68k_read_memory_16(a); }
unsigned int m68k_read_immediate_32(unsigned int a)  { return m68k_read_memory_32(a); }
unsigned int m68k_read_pcrelative_8(unsigned int a)  { return m68k_read_memory_8(a); }
unsigned int m68k_read_pcrelative_16(unsigned int a) { return m68k_read_memory_16(a); }
unsigned int m68k_read_pcrelative_32(unsigned int a) { return m68k_read_memory_32(a); }
unsigned int m68k_read_disassembler_8(unsigned int a)  { return m68k_read_memory_8(a); }
unsigned int m68k_read_disassembler_16(unsigned int a) { return m68k_read_memory_16(a); }
unsigned int m68k_read_disassembler_32(unsigned int a) { return m68k_read_memory_32(a); }

void m68k_write_memory_16(unsigned int a, unsigned int v) { if (a + 1 < MEM_SIZE) { mem[a] = (v >> 8) & 0xFF; mem[a+1] = v & 0xFF; } }
void m68k_write_memory_32(unsigned int a, unsigned int v) { if (a + 3 < MEM_SIZE) { mem[a]=(v>>24)&0xFF; mem[a+1]=(v>>16)&0xFF; mem[a+2]=(v>>8)&0xFF; mem[a+3]=v&0xFF; } }
void m68k_write_memory_32_pd(unsigned int a, unsigned int v) { m68k_write_memory_32(a, v); }
unsigned int m68k_int_ack_callback(int level) { (void)level; return M68K_INT_ACK_AUTOVECTOR; }

static unsigned int last_out_write = 0;
void m68k_write_memory_8(unsigned int a, unsigned int v) {
    if (a < MEM_SIZE) { mem[a] = v & 0xFF; if (a >= OUTBUF && a < OUTBUF + MAXOUT && v) last_out_write = a; }
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <entry.bin> <out.bin>\n", argv[0]); return 1; }
    FILE *f;
    mem = calloc(1, MEM_SIZE);
    if (!mem) { perror("calloc"); return 1; }

    /* load the game's root CODE hunk (argv[3] = extracted code0 path) and
     * copy the decompressor (0x55C4 + 0x200) */
    const char *code0_path = argc > 3 ? argv[3] : "/tmp/opencode/mm3amiga/code0.bin";
    f = fopen(code0_path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", code0_path); return 1; }
    fseek(f, 0, SEEK_END); long code_len = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *code = malloc(code_len);
    fread(code, 1, code_len, f); fclose(f);
    long rout_off = 0x55C4;
    memcpy(mem + ROUTINE, code + rout_off, code_len - rout_off > 0x200 ? 0x200 : code_len - rout_off);
    free(code);

    /* load the .cc entry into INBUF */
    f = fopen(argv[1], "rb");
    if (!f) { fprintf(stderr, "cannot open entry\n"); return 1; }
    fseek(f, 0, SEEK_END); long in_len = ftell(f); fseek(f, 0, SEEK_SET);
    size_t rd = fread(mem + INBUF, 1, in_len, f); fclose(f);
    if (rd < 8) { fprintf(stderr, "entry too small\n"); return 1; }

    /* Ring addressing is (a2, dX.w) with dX a sign-extended 12-bit index:
     * indices 0x000..0x7FF address [a2, a2+0x800) (routine pre-fills these
     * itself with 0x20), indices 0x800..0xFFF address [a2-0x800, a2) — the
     * caller-stack region below the frame, which the routine never fills.
     * a2 = a6-0x1012 with a6 = SP at `link` = STACK-0x10, so the negative
     * half is [STACK-0x1822, STACK-0x1022). Pre-fill exactly that range
     * with the init byte so unwritten negative-half slots read 0x20, like
     * the Python port's full-0x20 ring. (Indices 0xFCC..0xFFF overlap the
     * routine's saved-registers block; those get the register values we set
     * below, low byte 0x20, also matching.) */
    for (unsigned int a = STACK - 0x1822; a < STACK - 0x1022; a++) mem[a] = 0x20;
    unsigned int decsize =
        (mem[INBUF+4] << 24) | (mem[INBUF+5] << 16) | (mem[INBUF+6] << 8) | mem[INBUF+7];
    if (decsize > MAXOUT) { fprintf(stderr, "declared size %u too large\n", decsize); return 1; }

    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);
    /* Set every register to 0x20202020 so the routine's SAVED-REGISTERS region
     * (which the sign-extended ring reads/writes at indices 0xFCC..0xFFF)
     * starts as 0x20, matching the Python port's ring initialisation. */
    m68k_set_reg(M68K_REG_D0, 0x20202020); m68k_set_reg(M68K_REG_D1, 0x20202020);
    m68k_set_reg(M68K_REG_D2, 0x20202020); m68k_set_reg(M68K_REG_D3, 0x20202020);
    m68k_set_reg(M68K_REG_D4, 0x20202020); m68k_set_reg(M68K_REG_D5, 0x20202020);
    m68k_set_reg(M68K_REG_D6, 0x20202020); m68k_set_reg(M68K_REG_D7, 0x20202020);
    m68k_set_reg(M68K_REG_A0, 0x20202020); m68k_set_reg(M68K_REG_A1, 0x20202020);
    m68k_set_reg(M68K_REG_A2, 0x20202020); m68k_set_reg(M68K_REG_A3, 0x20202020);
    m68k_set_reg(M68K_REG_A4, 0x20202020); m68k_set_reg(M68K_REG_A6, 0x20202020);
    m68k_set_reg(M68K_REG_A7, STACK);

    /* Stub caller: push OUTBUF, push INBUF, jsr ROUTINE, then spin on a
     * `bra *` loop at the jsr's return address (0x112). The routine's rts
     * lands on 0x112 and the harness detects it as "returned". (A plain
     * `rts` here would pop INBUF as the next PC and walk zeroed memory,
     * which is what the old 18-byte-copy-into-a-16-byte-array stub did.) */
    unsigned char stub[20];
    stub[0] = 0x2F; stub[1] = 0x3C;                    /* move.l #imm,-(sp) */
    memcpy(stub + 2, (unsigned char[4]){ (OUTBUF >> 24) & 0xFF, (OUTBUF >> 16) & 0xFF, (OUTBUF >> 8) & 0xFF, OUTBUF & 0xFF }, 4);
    stub[6] = 0x2F; stub[7] = 0x3C;
    memcpy(stub + 8, (unsigned char[4]){ (INBUF >> 24) & 0xFF, (INBUF >> 16) & 0xFF, (INBUF >> 8) & 0xFF, INBUF & 0xFF }, 4);
    stub[12] = 0x4E; stub[13] = 0xB9;                  /* jsr abs.l */
    memcpy(stub + 14, (unsigned char[4]){ (ROUTINE >> 24) & 0xFF, (ROUTINE >> 16) & 0xFF, (ROUTINE >> 8) & 0xFF, ROUTINE & 0xFF }, 4);
    stub[18] = 0x60; stub[19] = 0xFE;                  /* bra *  (spin) */
    memcpy(mem + 0x100, stub, 20);

    m68k_set_reg(M68K_REG_PC, 0x100);

    int cycles = 0;
    unsigned int pcv = 0x100;
    for (int chunk = 0; chunk < 2000; chunk++) {
        cycles += m68k_execute(5000000);
        pcv = m68k_get_reg(NULL, M68K_REG_PC);
        /* returned to the stub (0x112) or jumped out of both ranges */
        if (pcv == 0x112 || pcv < 0x1000 || pcv > 0x1200) break;
    }

    f = fopen(argv[2], "wb");
    fwrite(mem + OUTBUF, 1, decsize, f);
    fclose(f);

    if (pcv != 0x112) {
        fprintf(stderr, "routine did not return (PC=0x%x after %d cycles)\n", pcv, cycles);
        return 1;
    }

    /* count non-zero bytes actually written to the output buffer */
    unsigned int nz = 0;
    for (unsigned int i = 0; i < decsize; i++) if (mem[OUTBUF + i]) nz++;
    fprintf(stderr, "decoded %u bytes in %d cycles; non-zero written: %u; last write @0x%x; final PC=0x%x\n",
            decsize, cycles, nz, last_out_write, m68k_get_reg(NULL, M68K_REG_PC));
    return 0;
}
