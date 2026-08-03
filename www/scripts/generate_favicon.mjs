import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const spriteDir = process.argv[2];
const output = process.argv[3];
if (!spriteDir || !output) throw new Error('Missing sprite directory or favicon output path');

const manifest = JSON.parse(readFileSync(join(spriteDir, 'items.json'), 'utf8'));
const ravenShield = manifest.frames[42];
if (ravenShield.name !== 'item042') throw new Error('Unexpected Raven Shield icon index');

await sharp(join(spriteDir, 'items.png'))
	.extract({
		left: ravenShield.x,
		top: ravenShield.y,
		width: ravenShield.w,
		height: ravenShield.h,
	})
	.resize(64, 64, { kernel: sharp.kernel.nearest })
	.png()
	.toFile(output);

console.log(`Generated Raven Shield favicon: ${output}`);
