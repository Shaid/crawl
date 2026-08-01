/*
 * bcdft S_4/S_5 decompressor
 *
 * A minimal musashi-based 68k emulator that runs the S_4 decompression engine
 * from the Black Crypt bcdft overlay file directly, avoiding the need to
 * hand-translate the custom LZ77 + relocation algorithm.
 *
 * Memory layout (Amiga segment chain):
 *   BASE+0x00000: S_0 CODE (80 bytes, includes chain resolver at +0x3C)
 *   BASE+0x00054: S_1 BSS (166676 bytes) — decompression target
 *   BASE+0x28B6C: S_2 BSS (40808 bytes)  — decompression target
 *   BASE+0x32AE0: S_3 BSS (4 bytes)
 *   BASE+0x32AE8: S_4 CODE (496 bytes) — the decompression engine
 *   BASE+0x32CDC: S_5 DATA (84976 bytes) — compressed input
 *   BASE+0x4CCFC: S_6 BSS (18684 bytes)  — read buffer
 *
 * The chain resolver (A4 callback) navigates this segment list via BPTR
 * pointers stored at each chain word. D6 selects which hunk to resolve:
 *   D6=4 → S_5 data (compressed input)
 *   D6=5 → S_6 data (read buffer)
 *   D6=0 → S_1 data (pass 0 destination)
 *   D6=1 → S_2 data (pass 1 destination)
 *   D6=2 → S_3 data (pass 2 destination, 4 bytes — dummy)
 *
 * Build:
 *   git clone --depth 1 https://github.com/kstenerud/musashi.git
 *   cd musashi && gcc -I. -o m68kmake m68kmake.c && ./m68kmake . .
 *   gcc -I. -Isoftfloat -O2 -c m68kcpu.c m68kdasm.c m68kops.c softfloat/softfloat.c
 *   cd .. && gcc -Imusashi -Imusashi/softfloat -O2 -o bcdft_decompress emu.c \
 *       musashi/m68kcpu.o musashi/m68kdasm.o musashi/m68kops.o musashi/softfloat.o -lm
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

/* ── Memory ──────────────────────────────────────────────────────────── */
static unsigned char *mem;
static const unsigned int MEM_SIZE = 0x10000000;  /* 256 MB */

/* ── Segment layout ──────────────────────────────────────────────────── */
/* Each segment: 4 bytes chain word + data. BASE is the load address. */
#define BASE    0x80000

/* Segment sizes including the 4-byte chain prefix */
#define SZ_S0   84      /* 80  bytes code + 4 */
#define SZ_S1   166680  /* 166676 BSS + 4 */
#define SZ_S2   40812   /* 40808 BSS  + 4 */
#define SZ_S3   8       /* 4   BSS    + 4 */
#define SZ_S4   500     /* 496 code   + 4 */
#define SZ_S5   84980   /* 84976 data + 4 */
#define SZ_S6   18688   /* 18684 BSS  + 4 */

/* Chain word addresses (each hunk's BPTR lives here) */
#define C0  (BASE)
#define C1  (C0 + SZ_S0)
#define C2  (C1 + SZ_S1)
#define C3  (C2 + SZ_S2)
#define C4  (C3 + SZ_S3)
#define C5  (C4 + SZ_S4)
#define C6  (C5 + SZ_S5)

/* Data addresses (4 bytes after the chain word) */
#define D0  (C0 + 4)      /* S_0 CODE  – 80 bytes */
#define D1  (C1 + 4)      /* S_1 BSS   – 166676 bytes, decompression target pass 0 */
#define D2  (C2 + 4)      /* S_2 BSS   – 40808 bytes,  decompression target pass 1 */
#define D3  (C3 + 4)      /* S_3 BSS   – 4 bytes */
#define D4  (C4 + 4)      /* S_4 CODE  – 496 bytes, the decompression engine */
#define D5  (C5 + 4)      /* S_5 DATA  – 84976 bytes, compressed input */
#define D6  (C6 + 4)      /* S_6 BSS   – 18684 bytes, read buffer */

/* ── musashi memory callbacks ────────────────────────────────────────── */
unsigned int m68k_read_memory_8(unsigned int a) {
    return (a < MEM_SIZE) ? mem[a] : 0;
}
unsigned int m68k_read_memory_16(unsigned int a) {
    if (a + 1 < MEM_SIZE) return (mem[a] << 8) | mem[a + 1];
    return 0;
}
unsigned int m68k_read_memory_32(unsigned int a) {
    if (a + 3 < MEM_SIZE)
        return (mem[a] << 24) | (mem[a + 1] << 16) | (mem[a + 2] << 8) | mem[a + 3];
    return 0;
}
unsigned int m68k_read_immediate_16(unsigned int a)  { return m68k_read_memory_16(a); }
unsigned int m68k_read_immediate_32(unsigned int a)  { return m68k_read_memory_32(a); }
unsigned int m68k_read_pcrelative_8(unsigned int a)  { return m68k_read_memory_8(a); }
unsigned int m68k_read_pcrelative_16(unsigned int a) { return m68k_read_memory_16(a); }
unsigned int m68k_read_pcrelative_32(unsigned int a) { return m68k_read_memory_32(a); }
unsigned int m68k_read_disassembler_8(unsigned int a)  { return m68k_read_memory_8(a); }
unsigned int m68k_read_disassembler_16(unsigned int a) { return m68k_read_memory_16(a); }
unsigned int m68k_read_disassembler_32(unsigned int a){ return m68k_read_memory_32(a); }

void m68k_write_memory_8(unsigned int a, unsigned int v) {
    if (a < MEM_SIZE) mem[a] = v & 0xFF;
}
void m68k_write_memory_16(unsigned int a, unsigned int v) {
    if (a + 1 < MEM_SIZE) { mem[a] = (v >> 8) & 0xFF; mem[a + 1] = v & 0xFF; }
}
void m68k_write_memory_32(unsigned int a, unsigned int v) {
    if (a + 3 < MEM_SIZE) {
        mem[a]     = (v >> 24) & 0xFF;
        mem[a + 1] = (v >> 16) & 0xFF;
        mem[a + 2] = (v >> 8)  & 0xFF;
        mem[a + 3] = v & 0xFF;
    }
}
void m68k_write_memory_32_pd(unsigned int a, unsigned int v) { m68k_write_memory_32(a, v); }

/* Interrupt acknowledge — not used but required by musashi */
unsigned int m68k_int_ack_callback(int level) { return M68K_INT_ACK_AUTOVECTOR; }

/* ── main ────────────────────────────────────────────────────────────── */
int main(int argc, char **argv) {
    const char *path_s0 = (argc > 1) ? argv[1] : "/tmp/s0_code.bin";
    const char *path_s4 = (argc > 2) ? argv[2] : "/tmp/s4_code.bin";
    const char *path_s5 = (argc > 3) ? argv[3] : "/tmp/s5_data.bin";
    const char *path_out = (argc > 4) ? argv[4] : "/tmp/s1_output.bin";
    int verbose = (argc > 5) ? atoi(argv[5]) : 0;

    FILE *f;
    int i;

    mem = calloc(1, MEM_SIZE);
    if (!mem) { perror("calloc"); return 1; }

    /* ── Set up BPTR chain ── */
    /* Each chain word stores (next_chain_word >> 2) as the BPTR pointer.
     * The chain resolver walks N+1 steps from the first chain word. */
    unsigned int chains[7] = {C0, C1, C2, C3, C4, C5, C6};
    for (i = 0; i < 6; i++)
        m68k_write_memory_32(chains[i], chains[i + 1] / 4);
    m68k_write_memory_32(chains[6], 0);  /* end of chain */

    /* ── Load sections into memory ── */
    f = fopen(path_s0, "rb");
    if (f) { fread(mem + D0, 1, 80, f); fclose(f); }
    else { fprintf(stderr, "Warning: cannot open %s\n", path_s0); }

    f = fopen(path_s4, "rb");
    if (f) { fread(mem + D4, 1, 496, f); fclose(f); }
    else { fprintf(stderr, "Warning: cannot open %s\n", path_s4); }

    f = fopen(path_s5, "rb");
    size_t s5_read = 0;
    if (f) { s5_read = fread(mem + D5, 1, 84976, f); fclose(f); }
    else { fprintf(stderr, "Error: cannot open %s\n", path_s5); return 1; }

    if (verbose) {
        printf("Memory layout:\n");
        printf("  S_0 CODE:  0x%06x (80B)\n", D0);
        printf("  S_1 BSS:   0x%06x (%d B, output)\n", D1, 166676);
        printf("  S_2 BSS:   0x%06x (%d B, output)\n", D2, 40808);
        printf("  S_3 BSS:   0x%06x (4B)\n", D3);
        printf("  S_4 CODE:  0x%06x (496B, engine)\n", D4);
        printf("  S_5 DATA:  0x%06x (%zu B, input)\n", D5, s5_read);
        printf("  S_6 BSS:   0x%06x (18684B, read buffer)\n", D6);
        printf("  Chain res: 0x%06x (S0+0x3C)\n", D0 + 0x3C);
        fflush(stdout);
    }

    /* ── Initialize CPU ── */
    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);

    /* Register state at S_4 entry — set up by S_0 before JSR (S_3) falls
     * through to S_4:
     *   D6 = 3 (from MOVE.W #3, D6 in S_0)
     *   A4 = chain resolver function (S_0 + 0x3C)
     *   A1 = S_3 data (4 BSS bytes, executed then falls through to S_4)
     *   A7 = stack pointer */
    m68k_set_reg(M68K_REG_D6, 3);
    m68k_set_reg(M68K_REG_A4, D0 + 0x3C);    /* chain resolver at S0+0x3C */
    m68k_set_reg(M68K_REG_A7, 0x200000);       /* stack */
    m68k_set_reg(M68K_REG_PC, D4);             /* S_4 CODE entry */
    m68k_set_reg(M68K_REG_A1, D3);             /* S_3 data (4 BSS bytes) */

    if (verbose) printf("Emulating S_4…\n");

    /* Run until the engine leaves S_4 (it RTSes back into the S_0 stub).
     *
     * A fixed 20M-cycle budget is NOT enough: the engine needs ~25-30M cycles
     * to finish, and cutting it short silently truncates the output at
     * S_1+0x1FEE0 *and* skips the relocation-fixup pass, leaving every
     * absolute address in the decompressed code unrelocated.  That truncated
     * blob was the committed artifact for a long time — see the "bcdft
     * decompression was truncated" correction in
     * docs/blackcrypt/amiga/data-structure.md. */
    int cycles = 0;
    {
        int chunk;
        unsigned int pcv = D4;
        for (chunk = 0; chunk < 200; chunk++) {
            cycles += m68k_execute(10000000);
            pcv = m68k_get_reg(NULL, M68K_REG_PC);
            if (pcv < D4 || pcv > D4 + 600) break;   /* left the S_4 engine */
        }
        if (pcv >= D4 && pcv <= D4 + 600) {
            fprintf(stderr, "Error: S_4 still running after %d cycles — "
                            "output would be truncated.\n", cycles);
            return 1;
        }
    }

    if (verbose) printf("Executed %d cycles, final PC = 0x%x\n",
                        cycles, m68k_get_reg(NULL, M68K_REG_PC));

    /* ── Verify output ── */
    int nz = 0;
    for (i = 0; i < 166676; i++)
        if (mem[D1 + i]) nz++;

    if (verbose) printf("S_1 non-zero: %d / %d\n", nz, 166676);

    if (nz < 1000) {
        fprintf(stderr, "Error: decompression produced only %d non-zero bytes "
                        "(expected 100k+). Something is wrong.\n", nz);
        return 1;
    }

    /* ── Write output ── */
    f = fopen(path_out, "wb");
    if (!f) { perror("fopen output"); return 1; }
    fwrite(mem + D1, 1, 166676, f);
    fclose(f);

    if (verbose) printf("Wrote %d bytes to %s\n", 166676, path_out);

    /* ── Write S_2 as well ────────────────────────────────────────────────
     * S_2 is the game module's *small-data* segment: A4 = S_2 + 0x7FFE, so
     * every `x(A4)` global and every per-level table (including the 13-entry
     * dungeon-palette-index table at S_2+0x39E) lives here.  Without it the
     * S_1 disassembly has no readable globals at all. */
    {
        const char *path_out2 = (argc > 6) ? argv[6] : "/tmp/s2_output.bin";
        int nz2 = 0;
        for (i = 0; i < 40808; i++) if (mem[D2 + i]) nz2++;
        if (verbose) printf("S_2 non-zero: %d / %d\n", nz2, 40808);
        f = fopen(path_out2, "wb");
        if (f) {
            fwrite(mem + D2, 1, 40808, f);
            fclose(f);
            if (verbose) printf("Wrote %d bytes to %s\n", 40808, path_out2);
        } else {
            perror("fopen S_2 output");
        }
    }

    free(mem);
    return 0;
}
