#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"

static unsigned char *mem;
static const unsigned int MEM_SIZE = 0x10000000;
#define CODE_BASE  0x70BD6u
#define CODE_LEN   454u
#define SRC_ADDR   0x80000u
#define DST_ADDR   0x90000u
#define STACK      0xF0000u

unsigned int m68k_read_memory_8(unsigned int a)  { return (a < MEM_SIZE) ? mem[a] : 0; }
unsigned int m68k_read_memory_16(unsigned int a) { if (a+1<MEM_SIZE) return (mem[a]<<8)|mem[a+1]; return 0; }
unsigned int m68k_read_memory_32(unsigned int a) { if (a+3<MEM_SIZE) return (mem[a]<<24)|(mem[a+1]<<16)|(mem[a+2]<<8)|mem[a+3]; return 0; }
unsigned int m68k_read_immediate_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_immediate_32(unsigned int a){return m68k_read_memory_32(a);}
unsigned int m68k_read_pcrelative_8(unsigned int a){return m68k_read_memory_8(a);}
unsigned int m68k_read_pcrelative_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_pcrelative_32(unsigned int a){return m68k_read_memory_32(a);}
unsigned int m68k_read_disassembler_8(unsigned int a){return m68k_read_memory_8(a);}
unsigned int m68k_read_disassembler_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_disassembler_32(unsigned int a){return m68k_read_memory_32(a);}

static int tracing = 0;
void m68k_write_memory_8(unsigned int a, unsigned int v) {
    if (a < MEM_SIZE) mem[a] = v & 0xFF;
    if (tracing && a >= DST_ADDR && a < DST_ADDR + 40) {
        unsigned int pc = m68k_get_reg(NULL, M68K_REG_PC);
        if (pc >= 0x70d00u) {
            const char *kind = (pc==0x70d88u||pc==0x70d96u) ? "RUN" :
                               (pc==0x70d6eu) ? "TRI" : "LIT";
            fprintf(stderr, "%s dest+%u=%02x a1=0x%x a0=0x%x\n",
                    kind, a-DST_ADDR, v&0xFF,
                    m68k_get_reg(NULL,M68K_REG_A1), m68k_get_reg(NULL,M68K_REG_A0));
        }
    }
}
void m68k_write_memory_16(unsigned int a, unsigned int v) { if(a+1<MEM_SIZE){mem[a]=(v>>8)&0xFF;mem[a+1]=v&0xFF;} }
void m68k_write_memory_32(unsigned int a, unsigned int v) { if(a+3<MEM_SIZE){mem[a]=(v>>24)&0xFF;mem[a+1]=(v>>16)&0xFF;mem[a+2]=(v>>8)&0xFF;mem[a+3]=v&0xFF;} }
void m68k_write_memory_32_pd(unsigned int a, unsigned int v){m68k_write_memory_32(a,v);}
unsigned int m68k_int_ack_callback(int level){return M68K_INT_ACK_AUTOVECTOR;}

int main(int argc, char **argv) {
    const char *path_code = argc>1?argv[1]:"/tmp/sotb3_decrunch_code.bin";
    const char *path_src  = argc>2?argv[2]:"/tmp/sotb3_src.bin";
    const char *path_out  = argc>3?argv[3]:"/tmp/sotb3_final.bin";
    tracing = (argc>4) ? atoi(argv[4]) : 0;
    FILE *f;
    mem = calloc(1, MEM_SIZE);
    f=fopen(path_code,"rb"); fread(mem+CODE_BASE,1,CODE_LEN,f); fclose(f);
    f=fopen(path_src,"rb"); fread(mem+SRC_ADDR,1,1<<20,f); fclose(f);
    m68k_write_memory_32(STACK, 0xFFFFFFFFu);
    m68k_init();
    m68k_set_cpu_type(M68K_CPU_TYPE_68000);
    m68k_set_reg(M68K_REG_A0, SRC_ADDR);
    m68k_set_reg(M68K_REG_A1, DST_ADDR);
    m68k_set_reg(M68K_REG_A6, 0x12345678);
    m68k_set_reg(M68K_REG_A7, STACK);
    m68k_set_reg(M68K_REG_PC, CODE_BASE);
    int cycles=0; unsigned int pcv=CODE_BASE; int i;
    for (i=0;i<60000000;i++){
        cycles += m68k_execute(1);
        pcv = m68k_get_reg(NULL, M68K_REG_PC);
        if (pcv==0xFFFFFFFFu) break;
        if (pcv<CODE_BASE || pcv>CODE_BASE+CODE_LEN) break;
    }
    fprintf(stderr,"cycles=%d pc=0x%x a0=0x%x a1=0x%x\n",cycles,pcv,
            m68k_get_reg(NULL,M68K_REG_A0),m68k_get_reg(NULL,M68K_REG_A1));
    unsigned int off = m68k_read_memory_32(DST_ADDR) >> 8;
    unsigned int fin = (m68k_read_memory_8(DST_ADDR+off-4)<<16)|(m68k_read_memory_8(DST_ADDR+off-5)<<8)|m68k_read_memory_8(DST_ADDR+off-6);
    fprintf(stderr,"off=%u size=%u\n",off,fin);
    f=fopen(path_out,"wb"); fwrite(mem+DST_ADDR,1,25000,f); fclose(f);
    free(mem); return 0;
}
