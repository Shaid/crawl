#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "m68k.h"
#define MEM_SIZE 0x1000000
static unsigned char *mem;
unsigned int m68k_read_memory_8(unsigned int a){a&=0xffffff;return mem[a];}
unsigned int m68k_read_memory_16(unsigned int a){a&=0xffffff;return (mem[a]<<8)|mem[a+1];}
unsigned int m68k_read_memory_32(unsigned int a){a&=0xffffff;return (mem[a]<<24)|(mem[a+1]<<16)|(mem[a+2]<<8)|mem[a+3];}
unsigned int m68k_read_immediate_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_immediate_32(unsigned int a){return m68k_read_memory_32(a);}
unsigned int m68k_read_pcrelative_8(unsigned int a){return m68k_read_memory_8(a);}
unsigned int m68k_read_pcrelative_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_pcrelative_32(unsigned int a){return m68k_read_memory_32(a);}
unsigned int m68k_read_disassembler_8(unsigned int a){return m68k_read_memory_8(a);}
unsigned int m68k_read_disassembler_16(unsigned int a){return m68k_read_memory_16(a);}
unsigned int m68k_read_disassembler_32(unsigned int a){return m68k_read_memory_32(a);}
void m68k_write_memory_8(unsigned int a,unsigned int v){a&=0xffffff;mem[a]=v;}
void m68k_write_memory_16(unsigned int a,unsigned int v){a&=0xffffff;mem[a]=v>>8;mem[a+1]=v;}
void m68k_write_memory_32(unsigned int a,unsigned int v){a&=0xffffff;mem[a]=v>>24;mem[a+1]=v>>16;mem[a+2]=v>>8;mem[a+3]=v;}
void m68k_write_memory_32_pd(unsigned int a,unsigned int v){m68k_write_memory_32(a,v);}
unsigned int m68k_int_ack_callback(int l){return M68K_INT_ACK_AUTOVECTOR;}
#define BASE 0x10000
#define SRC  0x100000
#define DST  0x400000
#define HIST 0x0F0000
#define PAL  0x0E0000
#define STK  0x0D0000
#define RET  0x0C0000
int main(int argc,char**argv){
  mem=calloc(1,MEM_SIZE);
  FILE*f=fopen(argv[1],"rb");size_t n=fread(mem+BASE,1,0x80000,f);fclose(f);
  f=fopen(argv[2],"rb");size_t sn=fread(mem+SRC,1,0x200000,f);fclose(f);
  mem[RET]=0x4e;mem[RET+1]=0x72; /* STOP */ mem[RET+2]=0x27;mem[RET+3]=0x00;
  mem[0]=0;mem[1]=STK>>16;mem[2]=0;mem[3]=0; /* initial SSP */
  mem[4]=0;mem[5]=(BASE+4)>>16;mem[6]=(BASE+4)>>8;mem[7]=(BASE+4)&0xff;
  m68k_init();m68k_set_cpu_type(M68K_CPU_TYPE_68000);m68k_pulse_reset();
  m68k_set_reg(M68K_REG_SP,STK-4); m68k_write_memory_32(STK-4,RET);
  m68k_set_reg(M68K_REG_PC,BASE+4);
  m68k_set_reg(M68K_REG_A0,SRC);m68k_set_reg(M68K_REG_A1,DST);
  m68k_set_reg(M68K_REG_A2,HIST);m68k_set_reg(M68K_REG_D0,sn);m68k_set_reg(M68K_REG_D1,PAL);
  long cyc=0;
  while((m68k_get_reg(NULL,M68K_REG_PC)<RET||m68k_get_reg(NULL,M68K_REG_PC)>RET+4) && cyc<4000000000L){cyc+=m68k_execute(100000);}
  unsigned d0=m68k_get_reg(NULL,M68K_REG_D0);
  fprintf(stderr,"D0=%u cycles=%ld pc=%x\n",d0,cyc,m68k_get_reg(NULL,M68K_REG_PC));
  unsigned len = argc>4? strtoul(argv[4],0,0): d0;
  f=fopen(argv[3],"wb");fwrite(mem+DST,1,len,f);fclose(f);
  f=fopen("pal.bin","wb");fwrite(mem+PAL,1,128,f);fclose(f);
  return 0;}
