/*
 * Trace the JR decrunch by logging every source byte read and dest byte written.
 * We patch the read/write callbacks for the relevant memory regions.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

static unsigned char *mem;
static const unsigned int MEM_SIZE = 0x10000000;

#define JR_BASE     0x00010000
#define PARAM_BLOCK 0x00020000
#define SRC_BUF     0x00030000
#define DST_BUF     0x00100000
#define STACK_ADDR  0x00800000

static int verbose = 0;
static FILE *trace_fp = NULL;

/* Source and dest tracking */
static unsigned int src_start, src_len;
static unsigned int dst_start, dst_len;

/* Counters */
static int total_ops = 0;
static int literal_bytes = 0;
static int match_ops = 0;
static int match_bytes = 0;

unsigned int m68k_read_memory_8(unsigned int a) {
    /* Log source reads */
    if (a >= SRC_BUF && a < SRC_BUF + src_len + 8 && trace_fp) {
        int offset = a - SRC_BUF;
        fprintf(trace_fp, "R %d 0x%02x <- src[%d]\n", total_ops++, mem[a], offset);
    }
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
        /* Log dest writes */
        if (a >= DST_BUF && a < DST_BUF + dst_len && trace_fp) {
            int offset = a - DST_BUF;
            fprintf(trace_fp, "W %d 0x%02x -> dst[%d]\n", total_ops++, v, offset);
        }
        mem[a] = v & 0xFF;
    }
}
void m68k_write_memory_16(unsigned int a, unsigned int v) {
    if (a + 1 < MEM_SIZE) { 
        if (a >= DST_BUF && a < DST_BUF + dst_len && trace_fp) {
            int offset = a - DST_BUF;
            fprintf(trace_fp, "W16 %d 0x%04x -> dst[%d]\n", total_ops++, v, offset);
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

static void put32(unsigned int a, unsigned int v) {
    m68k_write_memory_32(a, v);
}

int main(int argc, char **argv) {
    const char *path_jr   = (argc > 1) ? argv[1] : "xfd_User/Libs/xfd/JR";
    const char *path_comp = (argc > 2) ? argv[2] : "../../data/explore/Epic1MB/data/NEUTRON.3D";
    const char *path_out  = (argc > 3) ? argv[3] : "/tmp/jr_traced.bin";
    const char *path_trace = (argc > 4) ? argv[4] : "/tmp/jr_trace.txt";
    verbose = 1;

    FILE *f;
    int i;

    mem = calloc(1, MEM_SIZE);
    if (!mem) { perror("calloc"); return 1; }

    /* Load JR slave */
    f = fopen(path_jr, "rb");
    if (!f) { fprintf(stderr, "Error: cannot open %s\n", path_jr); return 1; }
    fseek(f, 0, SEEK_END);
    long jr_size = ftell(f);
    fseek(f, 0, SEEK_SET);
    fread(mem + JR_BASE, 1, jr_size, f);
    fclose(f);
    printf("JR slave: %ld bytes\n", jr_size);

    /* Load compressed file */
    f = fopen(path_comp, "rb");
    if (!f) { fprintf(stderr, "Error: cannot open %s\n", path_comp); return 1; }
    fseek(f, 0, SEEK_END);
    long comp_size = ftell(f);
    fseek(f, 0, SEEK_SET);
    fread(mem + SRC_BUF, 1, comp_size, f);
    fclose(f);

    unsigned int uncomp_size = m68k_read_memory_32(SRC_BUF + 4);
    printf("Compressed: %ld bytes -> Uncompressed: %u bytes\n", comp_size, uncomp_size);

    src_start = SRC_BUF;
    src_len = comp_size;
    dst_start = DST_BUF;
    dst_len = uncomp_size;

    /* Set up param block */
    put32(PARAM_BLOCK + 0x00, SRC_BUF);
    put32(PARAM_BLOCK + 0x04, comp_size);
    put32(PARAM_BLOCK + 0x10, 0);
    put32(PARAM_BLOCK + 0x14, DST_BUF);
    put32(PARAM_BLOCK + 0x20, uncomp_size);
    put32(PARAM_BLOCK + 0x3C, DST_BUF);

    /* Set up return */
    unsigned int ret_addr = JR_BASE + 0x1F0;
    m68k_write_memory_16(ret_addr, 0x4E75);
    m68k_write_memory_16(0x0000, 0x60FE); /* BRA * */

    /* Open trace file */
    trace_fp = fopen(path_trace, "w");
    if (!trace_fp) { perror("fopen trace"); return 1; }

    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);

    unsigned int sp = STACK_ADDR;
    sp -= 4;
    m68k_write_memory_32(sp, ret_addr);
    m68k_set_reg(M68K_REG_A0, PARAM_BLOCK);
    m68k_set_reg(M68K_REG_A7, sp);
    m68k_set_reg(M68K_REG_PC, JR_BASE + 0xAC);

    printf("Emulating...\n");
    int cycles = m68k_execute(2000000);
    printf("Executed %d cycles, final PC = 0x%x\n", cycles, 
           m68k_get_reg(NULL, M68K_REG_PC));

    fclose(trace_fp);

    /* Check results */
    int nz = 0;
    for (i = 0; i < (int)uncomp_size; i++)
        if (mem[DST_BUF + i]) nz++;
    printf("Non-zero: %d / %u\n", nz, uncomp_size);

    unsigned int d0 = m68k_get_reg(NULL, M68K_REG_D0);
    printf("D0 = %u, Error = %u\n", d0, 
           m68k_read_memory_16(PARAM_BLOCK + 0x12));

    /* Write output */
    f = fopen(path_out, "wb");
    if (!f) { perror("fopen output"); return 1; }
    fwrite(mem + DST_BUF, 1, uncomp_size, f);
    fclose(f);
    printf("Wrote %u bytes to %s\n", uncomp_size, path_out);
    printf("Trace written to %s\n", path_trace);

    free(mem);
    return 0;
}
