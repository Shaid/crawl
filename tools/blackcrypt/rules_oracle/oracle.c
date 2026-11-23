/*
 * Black Crypt (Amiga) rules oracle: runs the game's OWN 68k routines from the
 * decompressed bcdft S_1/S_2 images inside a musashi CPU core (no OS, no
 * custom chips). Single routines only; every external UI/blitter/text call
 * is patched to an immediate RTS so only pure rules code executes.
 *
 * Memory map (same as tools/bcdft_decompress/emu.c):
 *   S_1 at 0x80058 (166,676 B), S_2 at 0xA8BF0 (40,808 B), A4 = S_2 + 0x7FFE.
 *   S_1 absolute address = 0x80058 + (S_1 offset).
 *
 * Usage:  oracle <s1.bin> <s2.bin> <mode> < input   (see modes in main)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "m68k.h"

static unsigned char *mem;
#define MEM_SIZE 0x400000
#define S1_BASE 0x80058u
#define S2_BASE 0xA8BF0u
#define A4V (S2_BASE + 0x7FFEu)
#define RET_SENTINEL 0x1000u
#define STACK_TOP 0x300000u

unsigned int m68k_read_memory_8(unsigned int a){ return a<MEM_SIZE?mem[a]:0; }
unsigned int m68k_read_memory_16(unsigned int a){ return a+1<MEM_SIZE?(mem[a]<<8)|mem[a+1]:0; }
unsigned int m68k_read_memory_32(unsigned int a){ return a+3<MEM_SIZE?((unsigned)mem[a]<<24)|(mem[a+1]<<16)|(mem[a+2]<<8)|mem[a+3]:0; }
unsigned int m68k_read_immediate_16(unsigned int a){ return m68k_read_memory_16(a); }
unsigned int m68k_read_immediate_32(unsigned int a){ return m68k_read_memory_32(a); }
unsigned int m68k_read_pcrelative_8(unsigned int a){ return m68k_read_memory_8(a); }
unsigned int m68k_read_pcrelative_16(unsigned int a){ return m68k_read_memory_16(a); }
unsigned int m68k_read_pcrelative_32(unsigned int a){ return m68k_read_memory_32(a); }
unsigned int m68k_read_disassembler_8(unsigned int a){ return m68k_read_memory_8(a); }
unsigned int m68k_read_disassembler_16(unsigned int a){ return m68k_read_memory_16(a); }
unsigned int m68k_read_disassembler_32(unsigned int a){ return m68k_read_memory_32(a); }
void m68k_write_memory_8(unsigned int a, unsigned int v){ if(a<MEM_SIZE) mem[a]=v; }
void m68k_write_memory_16(unsigned int a, unsigned int v){ if(a+1<MEM_SIZE){mem[a]=v>>8;mem[a+1]=v;} }
void m68k_write_memory_32(unsigned int a, unsigned int v){ if(a+3<MEM_SIZE){mem[a]=v>>24;mem[a+1]=v>>16;mem[a+2]=v>>8;mem[a+3]=v;} }
void m68k_write_memory_32_pd(unsigned int a, unsigned int v){ m68k_write_memory_32(a,v); }
unsigned int m68k_int_ack_callback(int l){ (void)l; return M68K_INT_ACK_AUTOVECTOR; }

static void w16(uint32_t a, int v){ m68k_write_memory_16(a, (unsigned)v & 0xffff); }
static void w8(uint32_t a, int v){ m68k_write_memory_8(a, (unsigned)v & 0xff); }
static void w32(uint32_t a, uint32_t v){ m68k_write_memory_32(a, v); }
static int r16s(uint32_t a){ return (int16_t)m68k_read_memory_16(a); }
static unsigned r16(uint32_t a){ return m68k_read_memory_16(a); }
static unsigned r8(uint32_t a){ return m68k_read_memory_8(a); }

/* S_1 offsets of routines we keep real (everything else called by absolute
 * JSR is stubbed to RTS). */
static const uint32_t KEEP[] = {
  0x268BA, 0x268CC, 0x26854,     /* rand8(n), rand16(n), byte generator */
  0x0BDE8,                       /* weapon stats lookup (called as $8BE40) */
  0x0B308,                       /* monsters-in-front lookup ($8B360)  */
  0x002B4,                       /* step position by facing */
  0x17D2A, 0x1451E,              /* level-up check, player melee (the routines under test) */
  0
};
static int keep(uint32_t off){ for(int i=0;KEEP[i];i++) if(KEEP[i]==off) return 1; return 0; }

/* Patch every absolute JSR/JMP target (4EB9/4EF9 xxxxxxxx) that falls inside
 * S_1 to a bare RTS, except routines we want real. */
static void stub_externals(size_t s1len){
  for(size_t i=0;i+6<=s1len;i+=2){
    uint32_t a=S1_BASE+i;
    unsigned op=r16(a);
    if(op==0x4EB9||op==0x4EF9){
      uint32_t t=m68k_read_memory_32(a+2);
      if(t>=S1_BASE && t<S1_BASE+s1len){
        uint32_t off=t-S1_BASE;
        if(!keep(off)) w16(t,0x4E75);
      }
    }
  }
}

/* call routine at S_1 offset `off` with args (each: size 2 = word, 4 = long,
 * 1 = byte) pushed so arg[0] is the FIRST pushed (C order, i.e. rightmost). */
static unsigned long run_call(uint32_t off, int n, const int *sz, const uint32_t *v){
  uint32_t sp=STACK_TOP;
  for(int i=0;i<n;i++){
    if(sz[i]==4){ sp-=4; w32(sp,v[i]); }
    else if(sz[i]==2){ sp-=2; w16(sp,v[i]); }
    else { sp-=2; w8(sp,v[i]); }          /* byte push = high byte of a word slot */
  }
  sp-=4; w32(sp,RET_SENTINEL);
  m68k_set_reg(M68K_REG_A7,sp);
  m68k_set_reg(M68K_REG_A4,A4V);
  m68k_set_reg(M68K_REG_PC,S1_BASE+off);
  unsigned long steps=0;
  while(m68k_get_reg(NULL,M68K_REG_PC)!=RET_SENTINEL){
    m68k_execute(1); if(++steps>2000000){ fprintf(stderr,"runaway at off %x\n",off); break; }
  }
  return steps;
}

static uint32_t CH(int i){ return A4V+0x1758+0xA8*i; }
static uint32_t OB(int u){ return A4V-0x6E7A+0x14*u; }
static void set_seed(const unsigned char s[6]){ for(int i=0;i<6;i++) w8(S1_BASE+0x26882+i,s[i]); }
static void get_seed(unsigned char s[6]){ for(int i=0;i<6;i++) s[i]=r8(S1_BASE+0x26882+i); }

int main(int argc,char**argv){
  if(argc<4){ fprintf(stderr,"usage: oracle s1.bin s2.bin mode < input\n"); return 2; }
  mem=calloc(1,MEM_SIZE);
  FILE*f=fopen(argv[1],"rb"); if(!f){perror("s1");return 1;}
  size_t s1len=fread(mem+S1_BASE,1,0x30000,f); fclose(f);
  f=fopen(argv[2],"rb"); if(!f){perror("s2");return 1;}
  fread(mem+S2_BASE,1,0xA000,f); fclose(f);
  m68k_init(); m68k_set_cpu_type(M68K_CPU_TYPE_68000);
  w16(RET_SENTINEL,0x4E71);
  stub_externals(s1len);
  const char*mode=argv[3];
  char line[512];
  /* snapshot the clean memory image so each case starts identical */
  unsigned char *snap=malloc(MEM_SIZE); memcpy(snap,mem,MEM_SIZE);

  if(!strcmp(mode,"rng")){
    /* in: "seed(12 hex) kind n count"  kind 8 = rand8(n) 16 = rand16(n) 0 = raw byte */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int kind,n,cnt;
      if(sscanf(line,"%31s %d %d %d",sh,&kind,&n,&cnt)!=4) continue;
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned v; sscanf(sh+2*i,"%2x",&v); s[i]=v; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      printf("rng %s %d %d %d :",sh,kind,n,cnt);
      for(int k=0;k<cnt;k++){
        int sz[1]={2}; uint32_t v[1]={(uint32_t)n};
        run_call(kind==8?0x268BA:kind==16?0x268CC:0x26854,kind?1:0,sz,v);
        unsigned d0=m68k_get_reg(NULL,M68K_REG_D0);
        printf(" %u",kind==0?(d0&0xff):(d0&0xffff));
      }
      printf("\n");
    }
  } else if(!strcmp(mode,"levelup")){
    /* in: "seed xp(hex) level con" ; char 0; prints newLevel hp maxhp  (start hp=max=20) */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; unsigned xp; int lvl,con,hp;
      if(sscanf(line,"%31s %x %d %d %d",sh,&xp,&lvl,&con,&hp)!=5) continue;
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned v; sscanf(sh+2*i,"%2x",&v); s[i]=v; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      uint32_t c=CH(0);
      w8(c+0x5e,lvl); w8(c+0x67,con); w32(c+0xa0,xp); w16(c+0x4e,hp); w16(c+0x50,hp);
      w16(A4V+0x174a,0); /* screen mode 0: no redraw branches matter (stubbed anyway) */
      int sz[1]={2}; uint32_t v[1]={0};
      run_call(0x17D2A,1,sz,v);
      printf("levelup %s %x %d %d %d : %u %d %d\n",sh,xp,lvl,con,hp,r8(c+0x5e),r16s(c+0x4e),r16s(c+0x50));
    }
  } else if(!strcmp(mode,"weapon")){
    /* in: "class level gfx extra item monword" ; prints a2 a3 a6 (BDE8) for char 0; monster record 9 has word0 = monword */
    while(fgets(line,sizeof line,stdin)){
      int cls,lvl,gfx,extra,item,monw;
      if(sscanf(line,"%d %d %d %d %d %i",&cls,&lvl,&gfx,&extra,&item,&monw)!=6) continue;
      memcpy(mem,snap,MEM_SIZE); w16(OB(9),monw);
      uint32_t c=CH(0); w16(c+0,cls); w8(c+0x5e,lvl);
      if(item){ w16(OB(item)+0,gfx); w16(OB(item)+0xC,extra); }
      uint32_t out=0x2F0000; w16(out,0xEEEE); w16(out+2,0xEEEE); w16(out+4,0xEEEE);
      int sz[6]={4,4,4,2,2,2}; uint32_t v[6]={out+4,out+2,out,(uint32_t)item,0,9};
      /* BDE8 frame: 8(a5) mon,0xA(a5) char,0xC(a5) item,0xE a2 ptr,0x12 a3 ptr,0x16 a6 ptr */
      run_call(0xBDE8,6,sz,v);
      printf("weapon %d %d %d %d %d 0x%x : %d %d %d\n",cls,lvl,gfx,extra,item,monw,r16s(out),r16s(out+2),r16s(out+4));
    }
  } else if(!strcmp(mode,"melee")){
    /* in: seed lvl str hit6c monHit monHP cls gfx extra hand ; one party member (char 0) vs
       one centre-square monster directly ahead. prints: monHP_after (hp delta) */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int lvl,str,b6c,monHit,monHP,cls,gfx,extra,item;
      if(sscanf(line,"%31s %d %d %d %d %d %d %d %d %d",sh,&lvl,&str,&b6c,&monHit,&monHP,&cls,&gfx,&extra,&item)!=10) continue;
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned v; sscanf(sh+2*i,"%2x",&v); s[i]=v; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      uint32_t c=CH(0); w16(c+0,cls); w8(c+0x5e,lvl); w8(c+0x64,str); w8(c+0x6c,b6c); w16(c+0x4e,50);w16(c+0x50,50);
      /* party at row 5 col 5 facing 0 (front = row 6) */
      w16(A4V+0x1740,5); w16(A4V+0x1742,5); w16(A4V+0x1744,0); w16(A4V+0x1e2e,0);
      uint32_t cell=A4V-0x37CA+(6<<8)+(5<<2); w32(cell,0x1u);
      int mon=1, sec=2;
      w16(OB(mon),0x80B3); w8(OB(mon)+2,monHit); w16(OB(mon)+8,monHP); w16(OB(mon)+0x10,sec); w16(OB(mon)+0x14-0x14,0x80B3);
      w16(OB(sec),0); w8(OB(sec)+0xB,4);   /* position 4 = centre: both targets */
      w16(OB(mon)+0xE,0);
      if(item){ w16(OB(item),gfx); w16(OB(item)+0xC,extra); }
      int sz[5]={2,2,2,1,2}; /* a3 delay, side(0xE), then pushed: a3,8(a5)->0xE ... see FUN_13768 call */
      /* callee frame: 8 = item, 0xA = char, 0xC(byte) = hand slot, 0xE = side, 0x10 = delay */
      int sz2[5]={2,2,1,2,2}; uint32_t v2[5]={5,0,0,0,(uint32_t)item};
      /* push order: delay(0x10), side(0xE), hand(0xC byte), char(0xA), item(8) */
      sz2[0]=2; v2[0]=5; sz2[1]=2; v2[1]=0; sz2[2]=1; v2[2]=0; sz2[3]=2; v2[3]=0; sz2[4]=2; v2[4]=item;
      (void)sz;
      run_call(0x1451E,5,sz2,v2);
      printf("melee %s %d %d %d %d %d %d %d %d %d : %d\n",sh,lvl,str,b6c,monHit,monHP,cls,gfx,extra,item,r16s(OB(mon)+8));
    }
  } else { fprintf(stderr,"unknown mode\n"); return 2; }
  return 0;
}
