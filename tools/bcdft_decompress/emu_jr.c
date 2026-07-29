/*
 * JR XFD slave emulator — runs the JR decruncher via musashi.
 *
 * Calling convention (reverse-engineered from the 68k slave):
 *   A0 → parameter block:
 *        [0x00] : pointer to compressed data (full JR file, 8-byte header)
 *        [0x20] : uncompressed size (32-bit)
 *        [0x3C] : pointer to destination buffer
 *   A6/SP → stack
 *
 * The decrunch function at JR_BASE+0xAC:
 *   movem.l d2/a2-a5, -(a7)        ; save regs
 *   movea.l a0, a5                  ; a5 = param block
 *   movea.l $3c(a5), a1             ; a1 = dest buffer
 *   movea.l (a5), a0                ; a0 = source (JR file incl. header)
 *   movea.l a1, a3                  ; a3 = dest start
 *   adda.l $20(a5), a3              ; a3 = dest + size = end
 *   ... reads 8 bytes (header), then depacks ...
 *
 * Build:
 *   cd tools/bcdft_decompress
 *   gcc -Imusashi -Imusashi/softfloat -O2 -o emu_jr emu_jr.c \
 *       musashi/m68kcpu.o musashi/m68kdasm.o musashi/m68kops.o musashi/softfloat.o -lm
 *
 * Usage:
 *   ./emu_jr [JR_FILE] [COMPRESSED_FILE] [OUTPUT_FILE] [VERBOSE]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

/* ── Memory ──────────────────────────────────────────────────────────── */
static unsigned char *mem;
static const unsigned int MEM_SIZE = 0x10000000;  /* 256 MB */

/* Addresses */
#define JR_BASE     0x00010000   /* JR slave code loaded here */
#define PARAM_BLOCK 0x00020000   /* parameter block for decrunch */
#define SRC_BUF     0x00030000   /* compressed JR file loaded here */
#define DST_BUF     0x00100000   /* decompression target (big) */
#define STACK_ADDR  0x00800000   /* stack pointer */

/* ── Instrumentation ─────────────────────────────────────────────────── */
static int trace_mode = 0;
static int verbose = 0;
static int detected_error_addr = 0;  /* PC where error was written */
static int detected_error_value = 0; /* error value written */

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
    if (a < MEM_SIZE) {
        /* Watch for error write to xfdbi_Error at PARAM_BLOCK+0x12 */
        if (a == PARAM_BLOCK + 0x12 && !detected_error_addr) {
            detected_error_addr = m68k_get_reg(NULL, M68K_REG_PC);
            detected_error_value = v;
            if (verbose) fprintf(stderr, "[INSTRUMENT] ERROR WRITE: PC=0x%06x val=%u (0x%02x)\n",
                                 detected_error_addr, v, v);
        }
        mem[a] = v & 0xFF;
    }
}
void m68k_write_memory_16(unsigned int a, unsigned int v) {
    if (a + 1 < MEM_SIZE) { 
        /* Watch for error write as 16-bit */
        if (a == PARAM_BLOCK + 0x12 && !detected_error_addr) {
            detected_error_addr = m68k_get_reg(NULL, M68K_REG_PC);
            detected_error_value = v;
            if (verbose) fprintf(stderr, "[INSTRUMENT] ERROR WRITE (16-bit): PC=0x%06x val=%u\n",
                                 detected_error_addr, v);
        }
        mem[a] = (v >> 8) & 0xFF; mem[a + 1] = v & 0xFF; 
    }
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
unsigned int m68k_int_ack_callback(int level) { return M68K_INT_ACK_AUTOVECTOR; }

/* ── Helpers ─────────────────────────────────────────────────────────── */
static void put32(unsigned int a, unsigned int v) {
    m68k_write_memory_32(a, v);
}

/* ── main ────────────────────────────────────────────────────────────── */
int main(int argc, char **argv) {
    const char *path_jr     = (argc > 1) ? argv[1] : "xfd_User/Libs/xfd/JR";
    const char *path_comp   = (argc > 2) ? argv[2] : "../../data/explore/Epic1MB/data/NEUTRON.3D";
    const char *path_out    = (argc > 3) ? argv[3] : "/tmp/jr_decompressed.bin";
    verbose = (argc > 4) ? atoi(argv[4]) : 1;

    FILE *f;
    int i;

    mem = calloc(1, MEM_SIZE);
    if (!mem) { perror("calloc"); return 1; }

    /* ── Load JR slave binary ── */
    f = fopen(path_jr, "rb");
    if (!f) { fprintf(stderr, "Error: cannot open %s\n", path_jr); return 1; }
    fseek(f, 0, SEEK_END);
    long jr_size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fread(mem + JR_BASE, 1, jr_size, f) != (size_t)jr_size) {
        fprintf(stderr, "Error: short read of %s\n", path_jr);
        fclose(f);
        return 1;
    }
    fclose(f);
    if (verbose) printf("JR slave: %ld bytes at 0x%06x\n", jr_size, JR_BASE);

    /* ── Load compressed JR file ── */
    f = fopen(path_comp, "rb");
    if (!f) { fprintf(stderr, "Error: cannot open %s\n", path_comp); return 1; }
    fseek(f, 0, SEEK_END);
    long comp_size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fread(mem + SRC_BUF, 1, comp_size, f) != (size_t)comp_size) {
        fprintf(stderr, "Error: short read of %s\n", path_comp);
        fclose(f);
        return 1;
    }
    fclose(f);

    /* Read uncompressed size from JR header (bytes 4-7) */
    unsigned int uncomp_size = m68k_read_memory_32(SRC_BUF + 4);
    if (verbose) printf("Compressed: %ld bytes -> Uncompressed: %u bytes\n", comp_size, uncomp_size);

    if (uncomp_size == 0 || uncomp_size > 0x100000) {
        fprintf(stderr, "Error: bad uncompressed size %u\n", uncomp_size);
        return 1;
    }

    /* ── Set up parameter block ──
     * xfdBufferInfo structure (from xfdmaster.i):
     *   +0x00: xfdbi_SourceBuffer   (APTR)  - pointer to compressed data
     *   +0x04: xfdbi_SourceBufLen   (ULONG) - length of source buffer
     *   +0x08: xfdbi_PackerInfo     (APTR)  - packer-specific info
     *   +0x0C: xfdbi_PackerInfoSize (ULONG) - size of packer info
     *   +0x10: xfdbi_PackerFlags    (ULONG) - packer flags
     *   +0x12: xfdbi_Error          (UWORD) - error code
     *   +0x14: xfdbi_TargetBuffer   (APTR)  - ??? (some versions)
     *   +0x20: xfdbi_TargetBufSaveLen (ULONG) - target buffer length (uncompressed size)
     *   +0x3C: xfdbi_UserTargetBuf  (APTR)  - user-supplied target buffer
     */
    put32(PARAM_BLOCK + 0x00, SRC_BUF);       /* source ptr → JR file */
    put32(PARAM_BLOCK + 0x04, comp_size);      /* source buffer length */
    put32(PARAM_BLOCK + 0x10, 0);              /* packer flags = 0 */
    put32(PARAM_BLOCK + 0x14, DST_BUF);        /* target buffer */
    put32(PARAM_BLOCK + 0x20, uncomp_size);    /* target buffer save len */
    put32(PARAM_BLOCK + 0x3C, DST_BUF);        /* user target buffer */

    if (verbose) {
        printf("Parameter block at 0x%06x:\n", PARAM_BLOCK);
        printf("  [0x00] src       = 0x%06x\n", SRC_BUF);
        printf("  [0x04] src_len   = %lu\n", comp_size);
        printf("  [0x10] flags     = 0\n");
        printf("  [0x14] tgt       = 0x%06x\n", DST_BUF);
        printf("  [0x20] dst_size  = %u\n", uncomp_size);
        printf("  [0x3C] user_dst  = 0x%06x\n", DST_BUF);
    }

    /* ── Set up a clean exit mechanism ──
     * Put a HALT or infinite loop at address 0 so wild jumps don't
     * pollute results, and a clean return trampoline. */
    /* Write RTS at a safe area */
    unsigned int ret_addr = JR_BASE + 0x1F0;  /* safe area after code */
    m68k_write_memory_16(ret_addr, 0x4E75);   /* RTS instruction */

    /* Write infinite loop (BRA *) at address 0 */
    m68k_write_memory_16(0x0000, 0x60FE);     /* BRA * */

    /* ── Initialize CPU ── */
    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);

    /* Push a return address onto the stack */
    unsigned int sp = STACK_ADDR;
    sp -= 4;
    m68k_write_memory_32(sp, ret_addr);        /* push return address */

    m68k_set_reg(M68K_REG_A0, PARAM_BLOCK);    /* a0 = param block */
    m68k_set_reg(M68K_REG_A7, sp);             /* stack with return addr */
    m68k_set_reg(M68K_REG_PC, JR_BASE + 0xAC); /* decrunch entry */

    if (verbose) printf("Emulating JR decrunch…\n");

    /* Run up to 2M cycles (should finish in <50k for small files) */
    int cycles = m68k_execute(50000000);

    unsigned int final_pc = m68k_get_reg(NULL, M68K_REG_PC);
    if (verbose) printf("Executed %d cycles, final PC = 0x%x\n", cycles, final_pc);

    /* ── Check for error ── */
    if (detected_error_addr) {
        printf("ERROR DETECTED: PC=0x%06x wrote error=%d to xfdbi_Error\n",
               detected_error_addr, detected_error_value);
    }

    /* Check D0 return value */
    unsigned int d0 = m68k_get_reg(NULL, M68K_REG_D0);
    printf("D0 (return value) = 0x%08x (%u)\n", d0, d0);

    /* Check xfdbi_Error field */
    unsigned int error_field = m68k_read_memory_16(PARAM_BLOCK + 0x12);
    printf("xfdbi_Error at 0x%04x = %u (0x%04x)\n", PARAM_BLOCK + 0x12, error_field, error_field);

    /* Check A1 (dest ptr) and A3 (end) */
    unsigned int a1 = m68k_get_reg(NULL, M68K_REG_A1);
    unsigned int a3 = m68k_get_reg(NULL, M68K_REG_A3);
    printf("A1 (dest ptr) = 0x%06x, A3 (end) = 0x%06x, written=%u bytes\n",
           a1, a3, a1 - DST_BUF);

    /* ── Verify output ── */
    int nz = 0;
    for (i = 0; i < (int)uncomp_size; i++)
        if (mem[DST_BUF + i]) nz++;

    if (verbose) printf("Output non-zero bytes: %d / %u\n", nz, uncomp_size);

    /* ── Quick analysis: show first non-zero bytes ── */
    if (verbose && nz > 0) {
        printf("First 40 non-zero bytes as int16s:\n");
        int cnt = 0;
        for (i = 0; i < (int)uncomp_size && cnt < 20; i += 2) {
            int val = (mem[DST_BUF + i] << 8) | mem[DST_BUF + i + 1];
            if (val != 0) {
                printf("  [%4d] = %6d (0x%04x)\n", i, (short)val, val & 0xFFFF);
                cnt++;
            }
        }
    }

    /* ── Write output ── */
    f = fopen(path_out, "wb");
    if (!f) { perror("fopen output"); return 1; }
    fwrite(mem + DST_BUF, 1, uncomp_size, f);
    fclose(f);

    if (verbose) printf("Wrote %u bytes to %s\n", uncomp_size, path_out);

    free(mem);
    return 0;
}
