# Eye of the Beholder Maze Format

From ModdingWiki

This page describes the maze format in Eye of the Beholder, which are saved in .MAZ files.

The 2D-View is calculated by a map of the "view-cone" for each view direction. The tile-sides which point towards the players direction plus the left/right sides depending on the side of the cones center are used.

Generally all new calculated positions are clamped using binary AND. Example: [New Position] & 0x3FF. This creates a wraparound effect which is used in EOB1 for the Spider-Level for a long hallway which extends the maximum 32 Tiles in the Y-Direction.

The same format is used in Lands of Lore but compressed with LCW compression, and using the file extension .CMZ.

## Maze Header

| Data Type | Description |
|-----------|-------------|
| INT16 | Width of map (Just information, hardcoded in EOB1 + EOB2) |
| INT16 | Height of map (Just information, hardcoded in EOB1 + EOB2) |
| INT16 | Size of Tile in CHAR (Just information, hardcoded in EOB1 + EOB2) |
| CHAR[1024][4] | Map data with tile-sides NORTH, EAST, SOUTH, WEST |

## Tile Side Values (0..24+)

The information about the tile sides can be overwritten by info coming from level INF-Files.

Values 0..24 are reserved for:

- 0: No Wall
- 1, 2: Fixed walls with no decoration
- 3 - 7: Door type one with button (For all tilesides: State from "closed" to "open")
- 8 - 12: Door type one without button
- 13 - 17: Door type two with button
- 18 - 22: Door type two without button
- 23: Stair up
- 24: Stair down
- 25: Doorpole type 1
- 27: Bottom pit
- 28: Door pole type 2
- 30: Pidgeon hole in wall
- 31: Stuck door Type 1 (can be forced open)
- 32: Stuck door Type 2 (can be forced open)
- 45: Teleport (Animated stars)

## S_TILESIDE Structure

| Data Type | Description |
|-----------|-------------|
| CHAR | Number of wall graphics: 0=None, 1=Solid wall type 1, 2=Solid wall type 2, 3=Doorway, 4=Stair up, 5=Stair down, 6=Magic doorway (triggered by stone item. Trigger item picture is hidden by decoration) |
| CHAR | Number of decoration on this wall (can be at bottom or ceiling, too) |
| CHAR | Standard-Event to trigger if clicked on this wall |
| CHAR | Info-Bits (Which kind of thing can pass...) |

### Standard Event Codes

```
EVENT_DEC_NONE        0
EVENT_DEC_DOORKNOB    1
EVENT_DEC_DOORFORCE   2
EVENT_DEC_DOORPRY     3
EVENT_DEC_STAIRUP     4
EVENT_DEC_STAIRDOWN   5
EVENT_DEC_HANDLEON    6
EVENT_DEC_HANDLEOFF   7
EVENT_DEC_KEYHOLE     8
EVENT_DEC_KEYSTUCK    9
EVENT_DEC_PIDGEONHOLE 10
EVENT_DEC_MESSAGE     11
EVENT_DEC_BOTTOMHOLE  12
```

### Info-Bits (Passability)

```
MAZE_FSIDE_PASSBIG      0x01  (Player and big thrown items e.g. sword)
MAZE_FSIDE_PASSSMALL    0x02  (Small thrown items e.g. stone -- for grate doors)
MAZE_FSIDE_PASSMONSTER  0x04
MAZE_FSIDE_ISDOOR       0x08
MAZE_FSIDE_DOORISOPEN   0x10
MAZE_FSIDE_DOORISCLOSED 0x20
MAZE_FSIDE_HASDOORKNOB  0x40
MAZE_FSIDE_ONLYDEC      0x80
```
