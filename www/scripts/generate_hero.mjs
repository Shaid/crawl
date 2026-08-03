// Composites the "Black Crypt" logo banner (bcdfr chunk 3, 320x44) onto the
// title screen (bcdfr chunk 2, 320x200) for the homepage hero image.
//
// No on-screen dest-position for this overlay is documented in the raw RE
// notes (docs/blackcrypt/amiga/data-structure.md describes bcdfr's four
// chunks as discrete screens shown in an intro sequence, not a confirmed
// single composited frame) -- this is a best-effort illustrative
// placement (bottom of frame, sitting just above the burned-in copyright
// text band), not a reproduction of a specific in-game screen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const spriteRoot = process.argv[2];
const output = process.argv[3];
if (!spriteRoot || !output) throw new Error('Missing asset root or output path');

const screenDir = join(spriteRoot, 'screens');
await sharp(join(screenDir, 'title.png'))
	.composite([{ input: readFileSync(join(screenDir, 'logo.png')), left: 0, top: 147 }])
	.png()
	.toFile(output);

console.log(`Generated hero composite: ${output}`);
