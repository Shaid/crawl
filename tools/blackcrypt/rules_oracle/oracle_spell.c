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
static unsigned r32x(uint32_t a){ return m68k_read_memory_32(a); }
static unsigned r8(uint32_t a){ return m68k_read_memory_8(a); }

/* S_1 offsets of routines we keep real (everything else called by absolute
 * JSR is stubbed to RTS). */
static const uint32_t KEEP[] = {
  0x268BA, 0x268CC, 0x26854,     /* rand8(n), rand16(n), byte generator */
  0x0BDE8,                       /* weapon stats lookup (called as $8BE40) */
  0x0B308,                       /* monsters-in-front lookup ($8B360)  */
  0x002B4,                       /* step position by facing */
  0x17D2A, 0x1451E,              /* level-up check, player melee (the routines under test) */
  0x1FF7A, 0x1FF90, 0x268A6, 0x98A8, 0x96E8, 0x97F0, 0x7ED0, 0xAAFC, 0x9D28, 0x8B2, 0x17686, 0x17EEA,  /* raw byte rand; monster death/XP, behaviour VM, monster attack, tick, DamageCharacter, AdjustVitals */
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
        if(!keep(off) && !(off>=0x4000 && off<0x8000) && off<0x28000) w16(t,0x4E75); /* >= 0x28000: C runtime helpers (mul/div) stay real */
      }
    }
  }
}


/* ---- call hooks: when PC reaches a hooked S_1 offset the routine is skipped
 * (return value D0 = hook_ret) and its first stack words are logged. ---- */
#define MAXHOOK 128
#define MAXLOG 4096
static uint32_t hook_off[MAXHOOK]; static int hook_ret[MAXHOOK]; static int nhook=0;
typedef struct { uint32_t off; uint16_t w[8]; uint32_t l0; uint32_t d[4]; } LogEnt;
static LogEnt logv[MAXLOG]; static int nlog=0;
static void hooks_clear(void){ nhook=0; nlog=0; }
static void hook_add(uint32_t off,int ret){ hook_off[nhook]=off; hook_ret[nhook]=ret; nhook++; }
static int hook_hit(uint32_t pc){
  for(int i=0;i<nhook;i++) if(pc==S1_BASE+hook_off[i]){
    uint32_t sp=m68k_get_reg(NULL,M68K_REG_A7);
    if(nlog<MAXLOG){ LogEnt*e=&logv[nlog++]; e->off=hook_off[i]; for(int k=0;k<8;k++) e->w[k]=m68k_read_memory_16(sp+4+2*k); e->l0=m68k_read_memory_32(sp+4); e->d[0]=m68k_get_reg(NULL,M68K_REG_D0); e->d[1]=m68k_get_reg(NULL,M68K_REG_D1); e->d[2]=m68k_get_reg(NULL,M68K_REG_D2); e->d[3]=m68k_get_reg(NULL,M68K_REG_D3); }
    m68k_set_reg(M68K_REG_D0,(uint32_t)hook_ret[i]);
    m68k_set_reg(M68K_REG_PC,m68k_read_memory_32(sp));
    m68k_set_reg(M68K_REG_A7,sp+4);
    return 1;
  }
  return 0;
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
    if(nhook && hook_hit(m68k_get_reg(NULL,M68K_REG_PC))) { steps++; continue; }
    if(getenv("TRACE")) fprintf(stderr,"%05x a0=%x d0=%x\n",m68k_get_reg(NULL,M68K_REG_PC)-S1_BASE,m68k_get_reg(NULL,M68K_REG_A0),m68k_get_reg(NULL,M68K_REG_D0));
    m68k_execute(1); if(getenv("TRACE")) fprintf(stderr,"  -> pc=%x a0=%x\n",m68k_get_reg(NULL,M68K_REG_PC),m68k_get_reg(NULL,M68K_REG_A0)); if(++steps>2000000){ fprintf(stderr,"runaway at off %x\n",off); break; }
  }
  return steps;
}

static int parse_line(const char*line,char*sh,int*v,int max){
  char buf[512]; strncpy(buf,line,511); buf[511]=0; char*sp; char*t=strtok_r(buf," \t\r\n",&sp); if(!t) return -1;
  strncpy(sh,t,31); sh[31]=0; int n=0;
  while((t=strtok_r(NULL," \t\r\n",&sp))&&n<max) v[n++]=(int)strtol(t,NULL,0);
  return n;
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

  } else if(!strcmp(mode,"mmelee")){
    /* Monster-vs-party melee through the real 9D28 (monster act), melee-only monsters.
       in: seed gfx b2 b3 b6 maxhp px py mx my facing pos op flag f0 f1 f2 f3 hp0..hp3 ac0..ac3 s0b
       out: ret outflag S.b0F S.b0A ndmg [char dmg]* nsched seedAfter */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int v[40];
      int n=parse_line(line,sh,v,40);
      if(n!=26) continue;
      int gfx=v[0],b2=v[1],b3=v[2],b6=v[3],maxhp=v[4],px=v[5],py=v[6],mx=v[7],my=v[8],facing=v[9],pos=v[10],op=v[11],flag=v[12];
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned q; sscanf(sh+2*i,"%2x",&q); s[i]=q; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      hooks_clear(); hook_add(0x17686,0); hook_add(0x5EA,0); hook_add(0x8388,0); hook_add(0x825C,0);
      w16(A4V+0x1740,py); w16(A4V+0x1742,px); w16(A4V+0x1744,facing);
      for(int i=0;i<4;i++){ w16(A4V+0x1E74+2*i,v[13+i]); w16(CH(i)+0x4E,v[17+i]); w8(CH(i)+0x62,v[21+i]); }
      int P=1,S=2;
      w16(OB(P),gfx); w8(OB(P)+2,b2); w8(OB(P)+3,b3); w8(OB(P)+6,b6); w16(OB(P)+8,50); w16(OB(P)+0x10,S);
      w16(OB(S)+8,maxhp); w8(OB(S)+0xB,pos); w8(OB(S)+0x13,0); w8(OB(S)+0xF,(gfx==0x80B9)?v[25]:1);
      uint32_t X=0x2F0100,Y=0x2F0102,OUT=0x2F0104; w16(X,mx); w16(Y,my); w16(OUT,0xAAAA);
      /* push (right to left): flag(word), &out(long), op(word), &y(long), &x(long), mon(word) */
      int sz[6]={2,4,2,4,4,2}; uint32_t vv[6]={(uint32_t)flag,OUT,(uint32_t)op,Y,X,(uint32_t)P};
      run_call(0x9D28,6,sz,vv);
      unsigned char sa[6]; get_seed(sa);
      printf("mmelee %s : %d %d %d %d",sh,(int)(int16_t)m68k_get_reg(NULL,M68K_REG_D0),r16(OUT),r8(OB(S)+0xF),r8(OB(S)+0xA));
      int nd=0,ns=0; for(int i=0;i<nlog;i++){ if(logv[i].off==0x17686) nd++; if(logv[i].off==0x5EA) ns++; }
      printf(" %d",nd); for(int i=0;i<nlog;i++) if(logv[i].off==0x17686) printf(" %u %u",logv[i].w[0],logv[i].w[1]);
      printf(" %d %02x%02x%02x%02x%02x%02x\n",ns,sa[0],sa[1],sa[2],sa[3],sa[4],sa[5]);
    }
  } else if(!strcmp(mode,"xp")){
    /* Monster-death XP award: the real 7ED0 with a minimal world.
       in: seed rec1b2 rec2w6 rec2w8 hp0..hp3 xp0..xp3 ; out: xp after for each char + seed */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int b2,w6,mh,hp[4]; unsigned xp[4];
      if(sscanf(line,"%31s %d %d %d %d %d %d %d %u %u %u %u",sh,&b2,&w6,&mh,&hp[0],&hp[1],&hp[2],&hp[3],&xp[0],&xp[1],&xp[2],&xp[3])!=12) continue;
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned q; sscanf(sh+2*i,"%2x",&q); s[i]=q; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      hooks_clear(); hook_add(0x17D2A,0); hook_add(0xB25A,0); hook_add(0x2D46,0); hook_add(0xB614,0); hook_add(0x4AE,0); hook_add(0xFE,0); hook_add(0x8388,0);
      for(int i=0;i<4;i++){ w16(CH(i)+0x4E,hp[i]); w32(CH(i)+0xA0,xp[i]); w8(CH(i)+0x5E,1); }
      int P=3,S=4;
      w16(OB(P),0x80B3); w8(OB(P)+2,b2); w16(OB(P)+8,0); w16(OB(P)+0x10,S);
      w16(OB(S)+6,w6); w16(OB(S)+8,mh);
      /* 7ED0(mon, x, y): push y, x, mon */
      int sz[3]={2,2,2}; uint32_t vv[3]={5,5,(uint32_t)P};
      run_call(0x7ED0,3,sz,vv);
      unsigned char sa[6]; get_seed(sa);
      printf("xp %s : %u %u %u %u %02x%02x%02x%02x%02x%02x\n",sh,r32x(CH(0)+0xA0),r32x(CH(1)+0xA0),r32x(CH(2)+0xA0),r32x(CH(3)+0xA0),sa[0],sa[1],sa[2],sa[3],sa[4],sa[5]);
    }

  } else if(!strcmp(mode,"tick")){
    /* Tick handler 8B2, party-vitals sections only (event list empty).
       in: seed tick resting hazard b1752 light hold then 4 x (hp maxhp level food water poison disease regen b86 state)
       out: hp0..3 light hold nlog then (off w0 w1 w2 w3)* */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int v[64]; int n=parse_line(line,sh,v,64);
      if(n!=6+40) continue;
      unsigned char sd[6]; for(int i=0;i<6;i++){ unsigned q; sscanf(sh+2*i,"%2x",&q); sd[i]=q; }
      memcpy(mem,snap,MEM_SIZE); set_seed(sd);
      hooks_clear(); hook_add(0x17686,0); hook_add(0x17EEA,0); hook_add(0x5EA,0); hook_add(0xB614,0);
      w16(A4V+0x174E,1); w32(A4V+0x1750,(uint32_t)v[0]-1u); w16(A4V+0x1746,v[1]);
      w16(A4V+0x1754,v[4]); w16(A4V+0x1756,v[5]);
      uint32_t cell=A4V-0x37CA+(5<<8)+(5<<2); w16(A4V+0x1740,5); w16(A4V+0x1742,5); w32(cell,v[2]?0x80000000u:0);
      for(int i=0;i<4;i++){ const int*c=&v[6+10*i]; uint32_t ch=CH(i);
        w16(ch+0x4E,c[0]); w16(ch+0x50,c[1]); w8(ch+0x5E,c[2]); w16(ch+0x52,c[3]); w16(ch+0x54,c[4]); w8(ch+0x9A,c[5]); w8(ch+0x97,c[6]); w8(ch+0x6D,c[7]); w8(ch+0x86,c[8]);
        w16(A4V+0x19F8+2*i,i); w8(A4V+0x1A07+i,c[9]); }
      run_call(0x8B2,0,NULL,NULL);
      printf("tick %s %d : %d %d %d %d %u %u %d",sh,(int)r32x(A4V+0x1750),r16s(CH(0)+0x4E),r16s(CH(1)+0x4E),r16s(CH(2)+0x4E),r16s(CH(3)+0x4E),r16(A4V+0x1754),r16(A4V+0x1756),nlog);
      for(int i=0;i<nlog;i++) printf(" | %x %u %u %u %u",logv[i].off,logv[i].w[0],logv[i].w[1],logv[i].w[2],logv[i].w[3]);
      printf("\n");
    }

  } else if(!strcmp(mode,"spec")){
    /* Monster special attack 98A8, bits 0xE (disease) / 0xF (poison).
       in: seed bit dir pos facing maxhp form0..3 hp0..3 resist0..3 shield0..3 prot0..3 con0..3
       out: dmg list [char dmg kind], poison0..3 disease0..3 sched seed */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int v[64]; int n=parse_line(line,sh,v,64); if(n!=29) continue;
      unsigned char sd[6]; for(int i=0;i<6;i++){ unsigned q; sscanf(sh+2*i,"%2x",&q); sd[i]=q; }
      memcpy(mem,snap,MEM_SIZE); set_seed(sd);
      hooks_clear(); hook_add(0x17686,0); hook_add(0x5EA,0); hook_add(0x8388,0); hook_add(0x825C,0);
      int bit=v[0],dir=v[1],pos=v[2],facing=v[3],maxhp=v[4];
      w16(A4V+0x1744,facing);
      for(int i=0;i<4;i++){ w16(A4V+0x1E74+2*i,v[5+i]); w16(CH(i)+0x4E,v[9+i]); w8(CH(i)+0x69,v[13+i]); w8(CH(i)+0x83,v[17+i]);
        w8(CH(i)+0x88,v[21+i]); w8(CH(i)+0x8B,v[21+i]); w8(CH(i)+0x67,v[25+i]); }
      int P=1,S=2; w16(OB(P),0x80B3); w16(OB(P)+0x10,S); w16(OB(S)+8,maxhp); w8(OB(S)+0xB,pos);
      int sz[5]={1,2,2,2,2}; uint32_t vv[5]={(uint32_t)dir,(uint32_t)bit,5,5,(uint32_t)P};
      run_call(0x98A8,5,sz,vv);
      unsigned char sa[6]; get_seed(sa);
      int nd=0,ns=0; for(int i=0;i<nlog;i++){ if(logv[i].off==0x17686) nd++; if(logv[i].off==0x5EA) ns++; }
      printf("spec %s : %d",sh,nd); for(int i=0;i<nlog;i++) if(logv[i].off==0x17686) printf(" %u %u %u",logv[i].w[0],logv[i].w[1],logv[i].w[2]);
      printf(" p %u %u %u %u d %u %u %u %u s %d %02x%02x%02x%02x%02x%02x\n",r8(CH(0)+0x9A),r8(CH(1)+0x9A),r8(CH(2)+0x9A),r8(CH(3)+0x9A),r8(CH(0)+0x97),r8(CH(1)+0x97),r8(CH(2)+0x97),r8(CH(3)+0x97),ns,sa[0],sa[1],sa[2],sa[3],sa[4],sa[5]);
    }
  } else if(!strcmp(mode,"ai")){
    /* Behaviour VM AAFC. in: seed type pc speedb5 hp maxhp b3 w0C b7 gfx px py x y rc vars(8) s11 s12 f1E8E
       out: pc delay-event... see printf */
    while(fgets(line,sizeof line,stdin)){
      char sh[32]; int v[32];
      int n=parse_line(line,sh,v,32);
      if(n<25) continue;
      unsigned char s[6]; for(int i=0;i<6;i++){ unsigned q; sscanf(sh+2*i,"%2x",&q); s[i]=q; }
      memcpy(mem,snap,MEM_SIZE); set_seed(s);
      /* NOTE: the S_2 script pointer table holds values 0x80 below the real addresses; fixed here */
      for(int i=0;i<12;i++){ uint32_t a=A4V-0x6EB4+4*i; w32(a,m68k_read_memory_32(a)+0x80); }
      hooks_clear();
      uint32_t H[]={0xA664,0x9D28,0x940C,0x9626,0x8D7E,0x866C,0x937A,0x9116,0x825C,0x8388,0xA906,0x1F3A8,0x5EA,0};
      for(int i=0;H[i];i++) hook_add(H[i],v[12]);
      hook_add(0xA82C,-1000); /* sentinel: A82C stays real, remove below */
      nhook--; /* keep A82C real */
      int type=v[0],pc=v[1],sp=v[2],hp=v[3],mhp=v[4],b3=v[5],w0c=v[6],b7=v[7],gfx=v[8],px=v[9],py=v[10],x=v[11];
      int y=v[13];
      int P=1,S=2;
      w16(A4V+0x1742,px); w16(A4V+0x1740,py); w32(A4V+0x1750,1000); w8(A4V+0x1E8E,v[24]); w8(A4V+0x1E8F,0);
      w16(OB(P),gfx); w8(OB(P)+3,b3); w8(OB(P)+5,sp); w8(OB(P)+7,b7); w16(OB(P)+8,hp); w16(OB(P)+0xC,w0c); w16(OB(P)+0xE,type); w16(OB(P)+0x10,S);
      w16(OB(S)+4,pc); w16(OB(S)+8,mhp); w8(OB(S)+0xB,4); w8(OB(S)+0x13,0);
      for(int i=0;i<8;i++) w8(OB(S)+0xF+i,v[14+i]);
      w8(OB(S)+0x11,v[22]); w8(OB(S)+0x12,v[23]);
      uint32_t sc=m68k_read_memory_32(A4V-0x6EB4+4*type);
      int sz[3]={2,2,2}; uint32_t vv[3]={(uint32_t)y,(uint32_t)x,(uint32_t)P};
      unsigned long steps=run_call(0xAAFC,3,sz,vv);
      unsigned char sa[6]; get_seed(sa);
      printf("ai %s : %u %d %d %d %u",sh,r16(OB(S)+4),r16s(OB(P)+8),r16s(OB(S)+8),(int)r16(OB(P)),r8(OB(P)+7));
      printf(" %u %u %u %u",r16(OB(P)+0xE),r8(OB(S)+0xE),r8(OB(S)+0x11),r8(OB(S)+0x12));
      printf(" v"); for(int i=0;i<8;i++) printf(" %u",r8(OB(S)+0xF+i));
      printf(" sc %u %u steps %lu\n",r8(sc),r16(sc+4),steps);
      printf("log %d",nlog); for(int i=0;i<nlog;i++){ printf(" |%x",logv[i].off); for(int k=0;k<8;k++) printf(",%u",logv[i].w[k]); }
      printf(" | seed %02x%02x%02x%02x%02x%02x\n",sa[0],sa[1],sa[2],sa[3],sa[4],sa[5]);
    }
  } else if(!strcmp(mode,"period")){
    /* Input-library idle period: SetIdlePeriod (S_1 +0x1FF7A, d0 = units of 1/60 s) then Reload (+0x1FF90).
       in: vblankHz d0 ; out: reload byte (+0x151), countdown after reload (+0x150)  */
    while(fgets(line,sizeof line,stdin)){
      int hz,d0; if(sscanf(line,"%d %d",&hz,&d0)!=2) continue;
      memcpy(mem,snap,MEM_SIZE);
      uint32_t lib=0x2F1000; w32(S1_BASE+0x2099E,lib);   /* library base pointer cell (a0 = (pc-rel)) */
      w16(lib+0x154,hz);
      m68k_set_reg(M68K_REG_D0,(uint32_t)d0);
      run_call(0x1FF7A,0,NULL,NULL);
      unsigned reload=r8(lib+0x151);
      run_call(0x1FF90,0,NULL,NULL);
      printf("period %d %d : %u %u (cell %x hz %u)\n",hz,d0,reload,r8(lib+0x150),r32x(S1_BASE+0x2099E),r16(lib+0x154));
    }

  } else if(!strcmp(mode,"script")){
    /* generic: tokens  S seed | H off ret | b/w/l addr val (poke) | C off n sz val.. | r8/r16/r16s/r32 addr (peek, after C) ; ';' ends tokens
       addr is absolute. Output: peeks, then log (off w0 w1 w2 w3 l0), then seed. */
    static char big[1<<16];
    while(fgets(big,sizeof big,stdin)){
      char*sp; char*t=strtok_r(big," \t\r\n",&sp); if(!t) continue;
      memcpy(mem,snap,MEM_SIZE); hooks_clear();
      unsigned char sd[6]={0}; 
      uint32_t coff=0; int cn=0; int csz[16]; uint32_t cval[16]; int called=0;
      char peekk[256][8]; uint32_t peeka[256]; int np=0;
      /* first pass: apply pokes/hooks */
      do{
        if(!strcmp(t,"S")){ char*h=strtok_r(NULL," \t\r\n",&sp); for(int i=0;i<6;i++){unsigned q; sscanf(h+2*i,"%2x",&q); sd[i]=q;} set_seed(sd); }
        else if(!strcmp(t,"H")){ uint32_t o=strtoul(strtok_r(NULL," \t\r\n",&sp),0,0); int r=(int)strtol(strtok_r(NULL," \t\r\n",&sp),0,0); hook_add(o,r); }
        else if(!strcmp(t,"b")||!strcmp(t,"w")||!strcmp(t,"l")){ uint32_t a=strtoul(strtok_r(NULL," \t\r\n",&sp),0,0); long v=strtol(strtok_r(NULL," \t\r\n",&sp),0,0);
          if(t[0]=='b') w8(a,v); else if(t[0]=='w') w16(a,v); else w32(a,(uint32_t)v); }
        else if(!strcmp(t,"C")){ coff=strtoul(strtok_r(NULL," \t\r\n",&sp),0,0); cn=atoi(strtok_r(NULL," \t\r\n",&sp));
          for(int i=0;i<cn;i++){ csz[i]=atoi(strtok_r(NULL," \t\r\n",&sp)); cval[i]=(uint32_t)strtol(strtok_r(NULL," \t\r\n",&sp),0,0);} called=1; }
        else if(t[0]=='r'){ strncpy(peekk[np],t,7); peekk[np][7]=0; peeka[np]=strtoul(strtok_r(NULL," \t\r\n",&sp),0,0); np++; }
      } while((t=strtok_r(NULL," \t\r\n",&sp)));
      static unsigned char before[0x10000]; uint32_t dlo=A4V-0x8000u, dn=0xA000u;
      memcpy(before,mem+dlo,dn);
      if(called) run_call(coff,cn,csz,cval);
      printf("script :");
      for(int i=0;i<np;i++){ const char*k=peekk[i]; long v;
        if(!strcmp(k,"r8")) v=r8(peeka[i]); else if(!strcmp(k,"r8s")) v=(int8_t)r8(peeka[i]); else if(!strcmp(k,"r16")) v=r16(peeka[i]); else if(!strcmp(k,"r16s")) v=r16s(peeka[i]); else v=(int32_t)r32x(peeka[i]);
        printf(" %ld",v); }
      printf(" | %d",nlog);
      for(int i=0;i<nlog;i++) printf(" %x,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u",logv[i].off,logv[i].w[0],logv[i].w[1],logv[i].w[2],logv[i].w[3],logv[i].w[4],logv[i].w[5],logv[i].w[6],logv[i].w[7],logv[i].d[1],logv[i].d[2],logv[i].d[3]);
      unsigned char sa[6]; get_seed(sa); printf(" | %02x%02x%02x%02x%02x%02x D0 %d |",sa[0],sa[1],sa[2],sa[3],sa[4],sa[5],(int)(int16_t)m68k_get_reg(NULL,M68K_REG_D0));
      for(uint32_t i=0;i<dn;i++) if(before[i]!=mem[dlo+i]) printf(" %x:%x",i,mem[dlo+i]);   /* offset from A4-0x8000 */
      printf("\n");
    }
  } else { fprintf(stderr,"unknown mode\n"); return 2; }
  return 0;
}
