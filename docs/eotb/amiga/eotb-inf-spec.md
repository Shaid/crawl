# Eye of the Beholder Maze Information Format (.INF)

From ModdingWiki

*This article is a stub. This means there is known information that needs to be added to the page.*

.dro files are used in localized versions such as the spanish one. .dro files are non-compressed .inf files. .elo files are used in some localized versions such as the german one. .elo files are non-compressed .inf files without header.

**General:** Each maze consist of a .maz file and an accompanying .inf file. This document describes the .inf file and how it relates to the .maz files. The .inf files are standard CPS files. However the german and spanish versions are uncompressed. This document assumes that you've depacked the .inf files using for instance uncps.exe.

## Header

### Monster Structure

```c
struct Monster
{
    unsigned char  index;
    unsigned char  levelType;
    unsigned short pos;
    unsigned char  subpos;
    unsigned char  direction;
    unsigned char  type;
    unsigned char  picture;
    unsigned char  phase;
    unsigned char  pause;
    unsigned short weapon;
    unsigned short pocket_item;
}
```

Position gives the x and y values. It's lower 5 bits are the y coordinate value and the next 5 bits are the x coordinate value:
```c
x_pos = (pos >> 5) & 0x1F;
y_pos = pos & 0x1F;
```

### INF Structure

```c
struct Inf
{
    unsigned short triggersOffset;
    char           mazeName[12];
    char           vmpVcnName[12];
    char           paletteName[12];
    unsigned char  unknown[9];
    unsigned char  monster1CompressionMethod;
    unsigned char  monster1Name[12];
    unsigned char  monster2CompressionMethod;
    unsigned char  monster2Name[12];
    unsigned char  unknown[5];
    Monster        monsters[30];
    unsigned short nbrDecCommands;
    DecCommand     commands[nbrDecCommands];
}
```

## Decoration Data

After the header comes the decoration data. It's loaded as a command sequence. The first unsigned short determines number of commands to execute. After that follows the first command code. Each command code is one byte.

### Decoration Command Codes

**0xec** (Load overlay image picture + overlay image rectangle data)
- graphics data name, 12 bytes containing a null terminated string. Points to a .cps file containing wall graphics data.
- rectangles data name, 12 bytes containing a null terminated string. Points to a .dat file containing rectangular data that point into the graphics data.

**0xfb** (Define wall mapping)

```c
struct WallMapping
{
   unsigned char wallMappingIndex; /* This is the index used by the .maz file. */
   unsigned char wallType; /* Index to what backdrop wall type that is being used. */
   unsigned char decorationID; /* Index to an optional overlay decoration image in
                                  the DecorationData.decorations array in the
                                  .dat files. */
   unsigned char unknownFlags1;
   unsigned char unknownFlags2;
};
```

## Event Data

After the decoration data comes a sequence of event data. It's also loaded as a command sequence. Each command code is one byte.

### Event Command Codes

| Code | Name | Description |
|------|------|-------------|
| 0xff | Set wall | Change maze wall configuration |
| 0xfe | Change wall | Modify existing wall state |
| 0xfd | Open door | |
| 0xfc | Close door | |
| 0xfb | Create monster | Spawn a monster |
| 0xfa | Teleport | |
| 0xf9 | Steal small item | |
| 0xf8 | Message | Display text message |
| 0xf7 | Set flag | |
| 0xf6 | Sound | Play a sound effect |
| 0xf5 | Clear flag | |
| 0xf4 | Heal | |
| 0xf3 | Damage | |
| 0xf2 | Jump | |
| 0xf1 | End code | |
| 0xf0 | Return | |
| 0xef | Call | |
| 0xee | Conditions | |
| 0xed | Item consume | |
| 0xec | Change level | |
| 0xeb | Give experience | |
| 0xea | New item | |
| 0xe9 | Launcher | |
| 0xe8 | Turn | |
| 0xe7 | Identify all items | |
| 0xe6 | Encounters | |
| 0xe5 | Wait | |
| 0xe4 | Update screen | |
| 0xe3 | Text menu | |
| 0xe2 | Special window pictures | |

### Key Command Details

**0xff (Set wall)**
```c
unsigned char subcode=nextUnsignedChar();
switch (subcode)
{
   case 0xf7: // Set complete maze block (all four walls)
      unsigned short position=nextUnsignedShort();
      unsigned char wallMappingIndex=nextUnsignedChar();
      for (int i=0; i<4; i++)
         maze[position][i]=wallMappingIndex;
   break;
 
   case 0xe9: // Change one wall
      unsigned short position=nextUnsignedShort();
      unsigned char wallMappingIndex=nextUnsignedChar();
      unsigned char direction=nextUnsignedChar();
      maze[position][direction]=wallMappingIndex;
   break;
 
   case 0xed: // Turn party
      Party.facing = nextUnsignedChar();
};
```

**0xfe (Change wall)**
```c
unsigned char subcode=nextUnsignedChar();
switch (subcode)
{
   case 0xf7: // Flip four sides
      unsigned short position=nextUnsignedShort();
      unsigned char sourceWallMappingIndex=nextUnsignedChar();
      unsigned char destinationWallMappingIndex=nextUnsignedChar();
      for (int i=0; i<4; i++)
      {
         if (maze[position][i] == sourceWallMappingIndex)
            maze[position][i] = destinationWallMappingIndex;
      }
   break;
 
   case 0xe9: // Change one wall
      unsigned short position=nextUnsignedShort();
      unsigned char direction=nextUnsignedChar();
      unsigned char sourceWallMappingIndex=nextUnsignedChar();
      unsigned char destinationWallMappingIndex=nextUnsignedChar();
      if (maze[position][direction] == sourceWallMappingIndex)
         maze[position][direction] = destinationWallMappingIndex;
   break;
 
   case 0xea: // Unknown
      unsigned short unknown=nextUnsignedShort();
   break;
};
```

**0xfb (Monster Creation)**
```c
char MoNo;
char MoTime;
short int position;
char subpos;
char facing;
char type;
char pic;
char phase;
char pause;
short int weapon; /* Item Number */
short int pocket; /* Dropped on Monster killed */
```

**0xf6 (Sound)** - EOB1 full version:
```c
char SoundId;
short int position;
```

**0xf6 (Sound)** - EOB1 demo version:
```c
char SoundId;
```

## Eye of the Beholder 2 .INF Format

The .inf file structure and data is somewhat different from its predecessor.

All offsets here are 16bit. All strings are null terminated c-strings. Filenames have usually 13 byte (8 letters + dot + 3 letters + null).

There are different data blocks:

```
Beginning of .inf file:
#x0000 offset to block_B
#x0002 block_A
 
block_A:
{
   subblocks belong to different sublevels:
   sub_block_A1:
   {
      #x0000 offset (relative to start of block_A) to sub_block_A2
      #x0002 control byte, when = #xEC then this block follows:
      #x0003:
      {
         #x0000: maze file name string usually "levelx.maz"; length: 13 byte
         #x000D: file name string without extension: used to load .vmp .pal; length: 13 byte
         #x001A: usually 0xFF, if not then the next 13 byte are again a string
                 without extension and used to load .pal
      }
      next: file name string without extension for sound file .adl or .snd
            -> depends on game configuration; length: 13 byte
      next: 2 bytes -> each may have the value #xEC or #xEA
      more to follow here (monster and decoration data)
   }
} end of block_A
 
block_B:
{
   #x0000 offset to block_C after the scripting data
   #x0002 control byte, if #xEC then:
   {
      (control byte | data byte) sequence;
      first control byte = #xFF is already next data structure
   }
   here follows: 30*monster data structure, each with length 30 byte
   after that: scripting data block:
   {
      #x0000 offset (relative to scripting data block) of the first string
      next: events
      next: strings
   }
} end of block_B
 
block_C:
{
   #x0000 number of special blocks which follow; these link maze
          fields to scripting data and contain flags; each 6 bytes long
   #x0002 maze special 1
   #x0008 maze special 2
   #x000E maze special 3
   ...
} end of block_C
```

### Maze Special Block Structure

```c
{
   uint16: number of block in maze (0...1023)
   uint16: flag
   uint16: offset to scripting data (relative to scripting data block)
}
```

### EOB2 Data Structures

```c
struct sMonsterType
{
    u8 idx;
    u8 unk0;
    u8 THAC0;
    u8 unk1;
    sDice HPDice;
    u8 numberOfAttacks;
    sDice attackDice[3];
    unsigned short specialAttackFlag;
    unsigned short AbilitiesFlag;
    unsigned short unk2;
    unsigned short EXPGain;
    u8 size;
    u8 attackSound;
    u8 moveSound;
    u8 unk3;
    // optional
        bool isAttack2;
        u8 distantAttack;
        u8 MaxAttkCnt;
        u8 attackList[4];
    u8 turnUndead;
    u8 unk4;
    u8 unk5[3];
};

struct sMonster
{
    u8 MoNo;
    u8 MoTime;
    short position;
    u8 subpos;
    u8 facing;
    u8 type;
    u8 pic;
    u8 phase;
    u8 pause;
    short weapon; /* Item Number */
    short pocket; /* Dropped on Monster killed */
};

struct sWallMapping
{
    u8 idx;
    u8 WallType;
    u8 DecorationID;
    u8 FileIndex;      // index number in DecorationFNames
    u8 unk0;
    u8 unk1;
};

struct sDecorationFName
{
    char GFXName[13];
    char DECName[13];
};

struct sRectangle
{
    short x;
    short y;
    short w;
    short h;
};

struct sDoorInfo
{
    u8 cmd;
    u8 idx;
    u8 typ;
    u8 knob;
    char GFXfile[13];
    sRectangle doorRect[3];
    sRectangle buttionRect[2];
    u8 buttonPos[2][2];
};
```
