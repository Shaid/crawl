# Eye of the Beholder item.dat Format

From ModdingWiki

*This article is a stub. This means there is known information that needs to be added to the page.*

## File Structure

```c
short int NumberOfItems;
struct Item {
    char unid;      /* Number of name string, if not identified */
    char id;        /* Number of name string if identified      */
    char bits;      /* Magic and so on                          */
                    /* 0x80 = Bit = GlowMagic                   */
                    /* 0x40 = Bit = IsIdentified                */
                    /* 0x20 = Bit = IsCursed                    */
                    /* 0x08 = Bit = Sucks damage points from    */
                    /*              target to attacker          */
    char pic;       /* Number of icon picture                   */
    char type;      /* Axe, Long Sword etc. see below           */
    char subpos;    /* Where the item lies at position          */
                    /* In Maze:                                 */
                    /*      0..3-> Bottom                       */
                    /*      4..7-> Wall (N,E,S,W)               */
                    /* For EotB I: 0..3-> Floor NW,NE,SW,SE     */
                    /*                8-> Compartment           */
                    /* If in inventory:                         */
                    /*      0..26-> Position in Inventory        */
    short int pos;  /* Position in maze x+y*32                  */
                    /* <= 0: Consumed                           */
    short int next; /* Number of next item in list (position)   */
    short int prev; /* Number of previous item in list (pos)    */
                    /* New: Single linked list                  */
    char level;     /* Level, where the item lies, <= no level  */
    char value;     /* The value of item, -1 if consumed        */
                    /* Kind of keys/potions/wands               */
} [NumberOfItems];

short int NumberOfItemName;
char ItemName[NumberOfItemName][35];
```

## Item Bits Field

```
0x80 = GlowMagic
0x40 = IsIdentified
0x20 = IsCursed
0x08 = Sucks damage points from target to attacker
```

## Item Type Correspondence

| Type | Name | Examples |
|------|------|----------|
| 0 | Axe | Drow Cleaver |
| 1 | Long Sword | Adamantite Long Sword |
| 2 | Short Sword | |
| 3 | Orb of Power | |
| 4 | ??? | |
| 5 | Dagger | Guinsoo, Backstabber |
| 6 | Potion | Dwarfen Healing Potion |
| 7 | Bow | |
| 8 | ??? | |
| 9 | Spear | |
| 10 | Halberd | |
| 11 | Mace | |
| 12 | Flail | (Geissel) |
| 13 | Staff | Staff |
| 14 | Sling | |
| 15 | Dart | Adamantite Dart |
| 16 | Arrow | |
| 17 | ??? | |
| 18 | Rock | Igneous Rock |
| 19 | ??? | |
| 20 | Chainmail | |
| 21 | Helmet | Dwarf Helmet |
| 22 | Leather armor | |
| 23 | ??? | |
| 24 | Plate Mail | |
| 25 | Scale Mail | |
| 26 | ??? | |
| 27 | Shield | |
| 28 | Lock Picks | |
| 29 | Spellbook | |
| 30 | Holy Symbol | Cleric Holy Symbol, Paladin Holy Symbol |
| 31 | Food | Iron Rations |
| 32 | Boots | Leather Boots |
| 33 | Bones | Dwarf Bones, Halfling Bones |
| 34 | Mage Scroll | Scroll |
| 35 | Cleric Scroll | Scroll |
| 36 | Text Scroll | Commission and Letter of Marquee |
| 37 | Stone | Stone Item (variants 1-7: Holy Symbol, Necklace, Orb, Dagger, Medaillon, Scepter, Ring) |
| 38 | Key | (variants 1-8: Silver, Gold, Dwarfen, Key, Skull, Drow, Jeweled, Ruby) |
| 39 | Potion | |
| 40 | Gem | |
| 41 | Robe | Fancy Robe |
| 42 | Ring of Protection +2 | |
| 43 | Bracers | |
| 44 | Necklace | Medaillon |
| 45 | ???? | |
| 46 | Medaillon | Luck Stone Medaillon (1) |
| 47 | Ring | |
| 48 | Wand | Wand of Slivias |
| 49 | Kenku Egg | |
| 50 | ??? | Usename 1 |
| 51-56 | Handspell Itemtypes | |
