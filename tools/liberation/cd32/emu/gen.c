/* Liberation: Captive II (CD32) -- world-generator + view-composer oracle.
 *
 * Runs the game's own code under musashi (no Amiga emulator): the four HUNK
 * executables `captiveII`, `PlotGen`, `CityGen` (and `BuildingGen`, loaded but
 * not called yet) are relocated into one flat 16 MB address space, AmigaOS is
 * replaced by a tiny exec/dos stub (AllocMem, OpenLibrary, Open/Read/Lock/
 * Examine for PlotGen's PGE/DTE/CTE.TXT), and each routine is called with the
 * register/param-block shape captiveII uses:
 *
 *   PlotGen  entry hunk+2, A0 = 'MM' block (world, flag), A1 = captiveII +0x3365E
 *            (captiveII +0x22C46 call shape)
 *   +0x22AAC captiveII param-block setup (A5+0x1D7A: grid, tables, callbacks)
 *   CityGen  entry hunk+2, A0 = A5+0x1D7A (captiveII +0x22BBA call shape)
 *   +0x36A0E city wall set (VGM number) for (world, zone)
 *   +0x36A68 city wall CMAP selection -> (32302,A5)
 *
 * Optional view mode (LIB_VIEWS="x,y,z,f;..."): loads WallNN.VGM, builds the
 * bank tables with +0x25208, runs +0x27F8E (5x5x3 window fill) and the slot
 * walk + CPU blitters from +0x255FA up to +0x256BA, with the vector-object
 * handlers skipped (LIB_NOOBJ, default on), and writes the 75-byte window plus
 * the 6 x 2400-byte planar 192x100 view per pose.
 *
 * usage: gen <game-data-dir> <world> <zone> <out.bin>
 * out.bin: grid 0x3000 | param block 1200 | u16 wall | u32 cmap(captiveII CODE offset)
 *
 * captiveII offsets are CODE-hunk-relative (file offset = 0x2C + value), as in
 * docs/liberation/cd32/data-structure.md.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <dirent.h>
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

#define CAP   0x010000   /* captiveII hunk 0 (CODE); hunk 1 (BSS) = A5 */
#define PG    0x200000
#define CG    0x240000
#define BG    0x280000
#define GRID  0x300000   /* (1986,A5): 0x3000 grid + tables */
#define PLOT  0x320000   /* (8816,A5): plot buffer, 16 KB */
#define VGM   0x500000
#define VTAB  0x560000
#define VIEW  0x580000
#define HEAP  0x600000
#define EXEC  0x009000   /* LVO slots below each base */
#define DOS   0x00B000
#define OTHER 0x00D000
#define STK   0x0F0000
#define RET   0x0F8000
static unsigned heap=HEAP, capA5;
static const char *datadir;
static FILE *fh[16];
#define R(r) m68k_get_reg(NULL,r)
#define W(r,v) m68k_set_reg(r,v)
static unsigned rd32(unsigned a){return m68k_read_memory_32(a);}
static void wr32(unsigned a,unsigned v){m68k_write_memory_32(a,v);}
static void wr16(unsigned a,unsigned v){m68k_write_memory_16(a,v);}
static void cstr(unsigned a,char*o,int n){int i=0;while(i<n-1&&mem[a+i]){o[i]=mem[a+i];i++;}o[i]=0;}

/* case-insensitive open of <datadir>/<name after ':'> */
static FILE *openci(const char*b){
  char p[1024];FILE*f=0;DIR*d=opendir(datadir);struct dirent*e;
  while(d&&(e=readdir(d))){if(!strcasecmp(e->d_name,b)){snprintf(p,sizeof p,"%s/%s",datadir,e->d_name);f=fopen(p,"rb");break;}}
  if(d)closedir(d);return f;}
static FILE *openname(unsigned a){char n[256];cstr(a,n,256);char*c=strchr(n,':');return openci(c?c+1:n);}

/* HUNK loader: lay hunks back to back from `base` (8-aligned), apply RELOC32. Returns hunk bases. */
static int loadhunks(const char*name,unsigned base,unsigned*bases){
  FILE*f=openci(name);if(!f){fprintf(stderr,"missing %s\n",name);exit(1);}
  fseek(f,0,SEEK_END);long n=ftell(f);fseek(f,0,SEEK_SET);unsigned char*d=malloc(n);fread(d,1,n,f);fclose(f);
  long p=0;
#define U() (p+=4,(unsigned)(d[p-4]<<24|d[p-3]<<16|d[p-2]<<8|d[p-1]))
  if(U()!=0x3f3||U()!=0){fprintf(stderr,"%s: not a HUNK exe\n",name);exit(1);}
  U();unsigned first=U(),last=U();int nh=last-first+1;unsigned b=base;
  for(int i=0;i<nh;i++){unsigned s=U()&0x3fffffff;bases[i]=b;b+=s*4;b=(b+7)&~7u;}
  int h=-1;
  while(p<n){unsigned t=U()&0x3fffffff;
    if(t==0x3e9||t==0x3ea){h++;unsigned c=U();memcpy(mem+bases[h],d+p,c*4);p+=c*4;}
    else if(t==0x3eb){h++;U();}
    else if(t==0x3ec){for(;;){unsigned c=U();if(!c)break;unsigned th=U();for(unsigned i=0;i<c;i++){unsigned o=U();unsigned a=bases[h]+o;wr32(a,rd32(a)+bases[th]);}}}
    else if(t==0x3f2){}
    else {fprintf(stderr,"%s: hunk tag %x\n",name,t);exit(1);}}
  free(d);return nh;
#undef U
}

static int lvo(unsigned pc){
  unsigned base;
  if(pc<EXEC&&pc>=EXEC-0x1000)base=EXEC; else if(pc<DOS&&pc>=DOS-0x1000)base=DOS;
  else if(pc<OTHER&&pc>=OTHER-0x1000)base=OTHER; else return 0;
  int off=(int)pc-(int)base;unsigned d0=R(M68K_REG_D0),d1=R(M68K_REG_D1),d2=R(M68K_REG_D2),d3=R(M68K_REG_D3),a1=R(M68K_REG_A1);
  if(base==EXEC){
    if(off==-198){unsigned n=(d0+7)&~7u;unsigned p=heap;heap+=n+8;memset(mem+p,0,n);W(M68K_REG_D0,p);}
    else if(off==-210||off==-414||off==-132||off==-138){}
    else if(off==-552||off==-408){char n[64];cstr(a1,n,64);W(M68K_REG_D0,strcmp(n,"dos.library")?OTHER:DOS);}
    else {fprintf(stderr,"unhandled exec LVO %d\n",off);exit(2);}
  } else if(base==DOS){
    if(off==-30||off==-84){int i;for(i=1;i<16&&fh[i];i++);FILE*f=openname(d1);if(!f)W(M68K_REG_D0,0);else{fh[i]=f;W(M68K_REG_D0,(off==-84?0x100:0)+i);}}
    else if(off==-36||off==-90){unsigned k=d1&0xff;if(k<16&&fh[k]){fclose(fh[k]);fh[k]=0;}}
    else if(off==-42){size_t n=fread(mem+d2,1,d3,fh[d1]);W(M68K_REG_D0,n);}
    else if(off==-102){FILE*f=fh[d1&0xff];long c=ftell(f);fseek(f,0,SEEK_END);long s=ftell(f);fseek(f,c,SEEK_SET);memset(mem+d2,0,260);wr32(d2+4,(unsigned)-3);wr32(d2+124,s);W(M68K_REG_D0,1);}
    else if(off==-126){W(M68K_REG_D0,0);}
    else {fprintf(stderr,"unhandled dos LVO %d\n",off);exit(2);}
  } else {fprintf(stderr,"unhandled library LVO %d\n",off);exit(2);}
  unsigned sp=R(M68K_REG_SP);W(M68K_REG_PC,rd32(sp));W(M68K_REG_SP,sp+4);return 1;
}
static unsigned stopat; static int noobj=1; static FILE*blog;
static void rts(void){unsigned sp=R(M68K_REG_SP);W(M68K_REG_PC,rd32(sp));W(M68K_REG_SP,sp+4);}
static void call(unsigned pc){
  unsigned sp0=R(M68K_REG_SP)-4;wr32(sp0,RET);W(M68K_REG_SP,sp0);W(M68K_REG_PC,pc);
  long n=0;
  for(;;){unsigned p=R(M68K_REG_PC);if(p==RET)break;
    if(stopat&&p==stopat){W(M68K_REG_SP,sp0+4);break;}
    if(lvo(p))continue;
    if(blog&&p==CAP+0x259F8){unsigned a2=R(M68K_REG_A2);fprintf(blog,"%02x%02x%02x%02x d5=%d\n",mem[a2],mem[a2+1],mem[a2+2],mem[a2+3],(signed char)R(M68K_REG_D5));}
    if(noobj&&p==CAP+0x256B6){W(M68K_REG_PC,CAP+0x25698);continue;} /* skip (2012) vector-object handler */
    if(noobj&&p==CAP+0x27C5C){rts();continue;}                       /* skip type 1/2 door/sign objects */
    if(p<0x1000){fprintf(stderr,"wild PC %x\n",p);exit(3);}
    m68k_execute(1);if(++n>300000000L){fprintf(stderr,"timeout\n");exit(4);}}
}
int main(int argc,char**argv){
  if(argc<5){fprintf(stderr,"usage: gen <data-dir> <world> <zone> <out.bin>\n");return 1;}
  mem=calloc(1,MEM_SIZE);datadir=argv[1];
  unsigned hb[8];
  loadhunks("captiveII",CAP,hb);capA5=hb[1];
  loadhunks("PlotGen",PG,hb);loadhunks("CityGen",CG,hb);loadhunks("BuildingGen",BG,hb);
  int world=atoi(argv[2]),zone=atoi(argv[3]);
  if(getenv("LIB_OBJ"))noobj=0;
  wr32(4,EXEC);wr32(0,STK);
  m68k_init();m68k_set_cpu_type(M68K_CPU_TYPE_68020);m68k_pulse_reset();
  W(M68K_REG_SP,STK);
  unsigned A5=capA5;
  /* game-record fields captiveII +0x12E6 unpacks: world, zone, flag word */
  wr16(A5+7546,world&0x3fff);wr16(A5+7548,zone&15);wr16(A5+7550,0);
  wr32(A5+1986,GRID);wr32(A5+8816,PLOT);
  /* PlotGen */
  wr16(PLOT,0x4d4d);wr16(PLOT+2,world&0x3fff);wr16(PLOT+4,0);
  W(M68K_REG_A0,PLOT);W(M68K_REG_A1,CAP+0x3365E);W(M68K_REG_D0,0);W(M68K_REG_A5,A5);call(PG+2);
  /* param block */
  W(M68K_REG_A5,A5);call(CAP+0x22AAC);
  wr16(A5+7546+1066,0xffff); /* (8612,A5) start cell: none -> CityGen picks */
  wr16(A5+7546+1072,0xffff); /* cache key: force regeneration */
  wr16(A5+7546+1074,0);
  /* CityGen */
  W(M68K_REG_A0,A5+7546);W(M68K_REG_A5,A5);call(CG+2);
  /* city wall set and its CMAP */
  W(M68K_REG_A5,A5);call(CAP+0x36A0E);int wall=R(M68K_REG_D0)&0xff;
  W(M68K_REG_D0,wall);W(M68K_REG_A5,A5);call(CAP+0x36A68);unsigned cmap=rd32(A5+32302)-CAP;
  FILE*o=fopen(argv[4],"wb");
  fwrite(mem+GRID,1,0x3000,o);fwrite(mem+A5+7546,1,1200,o);
  unsigned char t[6]={wall>>8,wall,cmap>>24,cmap>>16,cmap>>8,cmap};fwrite(t,1,6,o);fclose(o);
  fprintf(stderr,"world %d zone %d: wall %d cmap +%x\n",world,zone,wall,cmap);

  const char*views=getenv("LIB_VIEWS");
  if(views){
    wr16(A5+2016,1);wr32(A5+2008,CAP+0x27BBA);wr32(A5+2012,CAP+0x26C16);wr32(A5+2004,GRID); /* +0x22B6E */
    W(M68K_REG_A5,A5);call(CAP+0x22B3E);
    W(M68K_REG_A5,A5);call(CAP+0x252AA);
    char vp[64];snprintf(vp,sizeof vp,"Wall%02d.VGM",wall);FILE*vf=openci(vp);fread(mem+VGM,1,0x40000,vf);fclose(vf);
    unsigned bank[4]={VGM,VGM+0xA226,VGM+0xA226+0xEC0A,VGM+0xA226+0xEC0A+28858};
    for(int b=0;b<4;b++){unsigned s=A5+1542+10*b;wr32(s,bank[b]);wr32(s+4,VTAB+b*0x400);wr16(s+8,0xffff); /* fast RAM -> CPU blitters */
      W(M68K_REG_A4,s);W(M68K_REG_A5,A5);call(CAP+0x25208);}
    wr32(A5+1198,VIEW);
    FILE*vo=fopen(getenv("LIB_VIEWOUT"),"wb");if(getenv("LIB_BLITLOG"))blog=fopen(getenv("LIB_BLITLOG"),"w");
    char*buf=strdup(views);
    for(char*tk=strtok(buf,";");tk;tk=strtok(0,";")){
      int x,y,z,f;sscanf(tk,"%d,%d,%d,%d",&x,&y,&z,&f);
      memset(mem+VIEW,0,0x3840);
      W(M68K_REG_A5,A5);call(CAP+0x1D6D4);         /* city backdrop copy (DATA AmSp) */
      wr16(A5+1584,x);wr16(A5+1586,y);wr16(A5+1588,z);W(M68K_REG_A5,A5);call(CAP+0x2528E);
      wr16(A5+1928,f&3);
      W(M68K_REG_A5,A5);call(CAP+0x27F8E);
      fwrite(mem+A5+566,1,75,vo);
      stopat=CAP+0x256BA;W(M68K_REG_A5,A5);call(CAP+0x255FA);stopat=0;
      fwrite(mem+VIEW,1,0x3840,vo);
    }
    fclose(vo);
  }
  return 0;}
