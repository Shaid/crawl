/*
 * MM3 (Amiga) sprite draw routine oracle harness.
 *
 * Runs the game's own sprite draw routine (root CODE hunk 0x24DE of
 * `Might&MagicIII`) under musashi, with a real sprite buffer (e.g.
 * archer.mon from the .cc container) loaded into memory, and dumps:
 *   - the intermediate buffer at 0x40000 (RLE-decoded word stream +
 *     mode-1/2/3 expanded output — the ground truth for the cell-body
 *     format),
 *   - the five destination "plane" buffers at 0x50000+ (the final
 *     blitted result, for the blit geometry).
 *
 * Routine calling convention (from the display-list consumer at root
 * CODE 0x23BA..0x2462): a0 = sprite buffer pointer, d0 = animation
 * frame index; the list consumer has already set the scratch globals
 * 0x1446/0x1448 (dest x/y), 0x143C (flags byte), 0x143D (flags byte 2).
 *
 * Globals used by the routine (all DATA-hunk-relative, base = 0x20000):
 *   0x6572.l  destination buffer pointer (intermediate + blit source)
 *   0x1438.l  pointer to plane table: [u16 widthmod?][pad][5 plane ptrs]
 *   0x1430.l  scratch (plane loop pointer)
 *   0x1486    cache flag (0 = always re-decode)
 *   0x3d08    error flag
 *   ... 0x143c-0x1482 scratch fields, all zeroed initially
 *
 * Blitter registers at 0xdff000 are plain memory here; the wait loops
 * (btst #14, 0xdff002) exit immediately when bit 14 of 0xdff002 is 0.
 *
 * Build: bash tools/mm3_sprite_harness/build.sh
 *   gcc -I. -Imusashi -Imusashi/softfloat -O2 -o /tmp/mm3_sprite_emu \
 *       emu_sprite.c musashi/m68kcpu.o musashi/m68kdasm.o \
 *       musashi/m68kops.o musashi/softfloat.o -lm
 *
 * Usage: mm3_sprite_emu <sprite.bin> <frame> <out_prefix> <code0.bin> <data.bin>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

static unsigned char *mem;
#define MEM_SIZE 0x10000000

#define CODE_BASE 0x00000        /* root CODE hunk loaded at 0 */
#define DATA_BASE 0x20000        /* root DATA hunk loaded at 0x20000 */
#define ROUTINE   0x24DE         /* the sprite draw routine */
#define SPRBUF    0x60000        /* the sprite file buffer */
#define DESTBUF   0x40000        /* 0x6572.l -> intermediate buffer */
#define PLANETAB  0x30000        /* 0x1438.l -> plane table */
#define PLANEPTR  0x50000        /* 5 dest plane buffers */
#define STACK     0x800000

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

void m68k_write_memory_8(unsigned int a, unsigned int v) { if (a < MEM_SIZE) mem[a] = v & 0xFF; }

/* ---- raw hunk reloc walker ---- */
static void load_code_with_relocs(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *buf = malloc(n);
    fread(buf, 1, n, f); fclose(f);

    /* walk: skip HUNK_HEADER, then read CODE payload, then RELOC32 blocks.
       The file passed here is the *whole executable*; we only need the root
       CODE hunk (first segment). */
    unsigned int p = 0;
    unsigned int tag;
    #define RD32() ( (buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3] )
    tag = RD32() & 0x3FFFFFFF; p += 4;
    if (tag != 0x3F3) { fprintf(stderr, "no HUNK_HEADER (%#x)\n", tag); exit(1); }
    unsigned int nlibs = RD32(); p += 4;
    for (unsigned int i = 0; i < nlibs; i++) { unsigned int nl = RD32(); p += 4 + 4*nl; }
    unsigned int tablesize = RD32(); p += 4;
    unsigned int first = RD32(); p += 4;
    unsigned int last = RD32(); p += 4;
    unsigned int nh = last - first + 1;
    p += 4*nh;
    /* now expect HUNK_CODE */
    tag = RD32() & 0x3FFFFFFF; p += 4;
    if (tag != 0x3E9) { fprintf(stderr, "no HUNK_CODE (%#x)\n", tag); exit(1); }
    unsigned int csize = RD32() & 0x3FFFFFFF; p += 4;
    unsigned int payload = p;
    fprintf(stderr, "CODE payload at file %#x size %#x\n", payload, csize*4);
    memcpy(mem + CODE_BASE, buf + payload, csize*4);
    p += csize*4;
    /* reloc blocks: HUNK_RELOC32 tag 0x3EC, groups {count, target, offs}, until count==0 */
    while (p + 4 <= n) {
        tag = RD32() & 0x3FFFFFFF; p += 4;
        if (tag == 0x3EC) {
            for (;;) {
                unsigned int cnt = RD32(); p += 4;
                if (cnt == 0) break;
                unsigned int th = RD32(); p += 4;
                unsigned long base = (th == 1) ? DATA_BASE : (th == 0 ? CODE_BASE : 0);
                for (unsigned int k = 0; k < cnt; k++) {
                    unsigned int off = RD32(); p += 4;
                    unsigned int a = CODE_BASE + off;
                    unsigned int v = (mem[a]<<24)|(mem[a+1]<<16)|(mem[a+2]<<8)|mem[a+3];
                    v += base;
                    mem[a]=(v>>24)&0xFF; mem[a+1]=(v>>16)&0xFF; mem[a+2]=(v>>8)&0xFF; mem[a+3]=v&0xFF;
                }
            }
        } else if (tag == 0x3F2) { break; }  /* HUNK_END */
        else { fprintf(stderr, "reloc walk: tag %#x\n", tag); break; }
    }
    free(buf);
}

static void load_file(unsigned int addr, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    fread(mem + addr, 1, n, f); fclose(f);
}

int main(int argc, char **argv) {
    if (argc < 6) { fprintf(stderr, "usage: %s <sprite.bin> <frame> <out_prefix> <exe> <data.bin>\n", argv[0]); return 1; }
    const char *sprite = argv[1];
    int frame = atoi(argv[2]);
    char prefix[256]; snprintf(prefix, sizeof(prefix), "%s", argv[3]);
    const char *exe = argv[4];
    const char *datapath = argv[5];

    mem = calloc(1, MEM_SIZE);
    if (!mem) { perror("calloc"); return 1; }

    load_code_with_relocs(exe);          /* CODE at 0, relocs patched */
    load_file(DATA_BASE, datapath);      /* DATA at 0x20000 */
    load_file(SPRBUF, sprite);           /* sprite buffer */

    /* scratch globals */
    mem[0x21438] = (PLANETAB >> 24) & 0xFF; mem[0x21439] = (PLANETAB>>16)&0xFF;
    mem[0x2143A] = (PLANETAB>>8)&0xFF;  mem[0x2143B] = PLANETAB & 0xFF;
    mem[0x26572] = (DESTBUF >> 24) & 0xFF; mem[0x26573] = (DESTBUF>>16)&0xFF;
    mem[0x26574] = (DESTBUF>>8)&0xFF;   mem[0x26575] = DESTBUF & 0xFF;
    /* 0x143c = flags byte (0x03 = monster/mode-3), 0x143d = 0x80 */
    mem[0x2143C] = 0x03;
    mem[0x2143D] = 0x80;
    /* dest x/y */
    mem[0x21446] = 0; mem[0x21447] = 10;
    mem[0x21448] = 0; mem[0x21449] = 10;
    /* 0x1486 = 0 (no cache), 0x3d08 = 0 */

    /* plane table at PLANETAB: [u16 word][u16][u32 pad?][5 ptrs] */
    /* the routine reads word[0] (0x2c0e) and after +8 walks 5 longwords
       (0x2ec0). We set word[0] = 320, word[1] = 320, then 6 longwords:
       plane 0..4 buffers. */
    mem[PLANETAB]   = 0x01; mem[PLANETAB+1] = 0x40;   /* 320 */
    mem[PLANETAB+2] = 0x01; mem[PLANETAB+3] = 0x40;   /* 320 */
    for (int i = 0; i < 6; i++) {
        unsigned int pa = PLANEPTR + 0x1000*i;
        mem[PLANETAB+8+4*i]   = (pa>>24)&0xFF; mem[PLANETAB+9+4*i]  = (pa>>16)&0xFF;
        mem[PLANETAB+10+4*i]  = (pa>>8)&0xFF;  mem[PLANETAB+11+4*i] = pa&0xFF;
    }

    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);
    m68k_set_reg(M68K_REG_D0, frame);
    m68k_set_reg(M68K_REG_A0, SPRBUF);
    m68k_set_reg(M68K_REG_A7, STACK);

    /* stub: jsr ROUTINE; bra * */
    unsigned char stub[10];
    stub[0] = 0x4E; stub[1] = 0xB9;
    stub[2] = (ROUTINE>>24)&0xFF; stub[3] = (ROUTINE>>16)&0xFF;
    stub[4] = (ROUTINE>>8)&0xFF;  stub[5] = ROUTINE&0xFF;
    stub[6] = 0x60; stub[7] = 0xFE;
    memcpy(mem + 0x100, stub, 8);
    m68k_set_reg(M68K_REG_PC, 0x100);

    int cycles = 0;
    unsigned int pcv = 0x100;
    int logged = 0;
    for (int chunk = 0; chunk < 400000; chunk++) {
        cycles += m68k_execute(20000);
        pcv = m68k_get_reg(NULL, M68K_REG_PC);
        /* log any PC in the mode-3 region */
        if (pcv >= 0x2A60 && pcv <= 0x2B80) {
            if (logged < 120) {
                unsigned int a0 = m68k_get_reg(NULL, M68K_REG_A0);
                fprintf(stderr, "pc=%#x a0=%#x data=%02x%02x%02x%02x%02x%02x%02x%02x\n",
                        pcv, a0, mem[a0], mem[a0+1], mem[a0+2], mem[a0+3],
                        mem[a0+4], mem[a0+5], mem[a0+6], mem[a0+7]);
            }
            logged++;
        } else if (pcv >= 0x2A60 && pcv <= 0x2B80 && logged == 0) {
            fprintf(stderr, "entered mode3 region at PC=%#x\n", pcv);
        }
        if (pcv == 0x106 || pcv < 0x24DE || pcv > 0x3100) break;
    }
    fprintf(stderr, "returned to stub (PC=%#x) after %d cycles\n", pcv, cycles);

    char path[512];
    snprintf(path, sizeof(path), "%s.dest.bin", prefix);
    FILE *f = fopen(path, "wb"); fwrite(mem + DESTBUF, 1, 0x10000, f); fclose(f);
    snprintf(path, sizeof(path), "%s.planes.bin", prefix);
    f = fopen(path, "wb"); fwrite(mem + PLANEPTR, 1, 0x8000, f); fclose(f);
    snprintf(path, sizeof(path), "%s.state.txt", prefix);
    f = fopen(path, "w");
    fprintf(f, "PC=%#x cycles=%d\n", pcv, cycles);
    fprintf(f, "0x143e=%#x 0x1440=%#x 0x1442=%#x 0x1444=%#x\n",
        (mem[0x2143E]<<8)|mem[0x2143F], (mem[0x21440]<<8)|mem[0x21441],
        (mem[0x21442]<<8)|mem[0x21443], (mem[0x21444]<<8)|mem[0x21445]);
    fprintf(f, "0x1462=%#x 0x1464=%#x 0x1466=%#x\n",
        (mem[0x21462]<<8)|mem[0x21463], (mem[0x21464]<<8)|mem[0x21465],
        (mem[0x21466]<<24)|(mem[0x21467]<<16)|(mem[0x21468]<<8)|mem[0x21469]);
    fprintf(f, "0x144a=%#x 0x144c=%#x 0x144e=%#x 0x1450=%#x\n",
        (mem[0x2144A]<<8)|mem[0x2144B], (mem[0x2144C]<<8)|mem[0x2144D],
        (mem[0x2144E]<<8)|mem[0x2144F], (mem[0x21450]<<8)|mem[0x21451]);
    fprintf(f, "0x145c=%#x 0x147e=%#x 0x1480=%#x\n",
        (mem[0x2145C]<<8)|mem[0x2145D], (mem[0x2147E]<<8)|mem[0x2147F],
        (mem[0x21480]<<8)|mem[0x21481]);
    fprintf(f, "blitter regs: BLTCON0=%#x BLTCON1=%#x BLTSIZE=%#x\n",
        (mem[0xdff040]<<8)|mem[0xdff041], (mem[0xdff042]<<8)|mem[0xdff043],
        (mem[0xdff066]<<8)|mem[0xdff067]);
    fprintf(f, "BLTAPT=%#x BLTBPT=%#x BLTCPT=%#x BLTDPT=%#x\n",
        (mem[0xdff048]<<24)|(mem[0xdff049]<<16)|(mem[0xdff04A]<<8)|mem[0xdff04B],
        (mem[0xdff04C]<<24)|(mem[0xdff04D]<<16)|(mem[0xdff04E]<<8)|mem[0xdff04F],
        (mem[0xdff050]<<24)|(mem[0xdff051]<<16)|(mem[0xdff052]<<8)|mem[0xdff053],
        (mem[0xdff054]<<24)|(mem[0xdff055]<<16)|(mem[0xdff056]<<8)|mem[0xdff057]);
    fprintf(f, "0x3d08=%#x\n", (mem[0x23d08]<<24)|(mem[0x23d09]<<16)|(mem[0x23d0A]<<8)|mem[0x23d0B]);
    fclose(f);
    return 0;
}
