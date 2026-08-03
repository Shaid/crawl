import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const textureDir = process.argv[2];
if (!textureDir) throw new Error('Missing texture directory');

const definitions = [
	['ceiling', 0, 0],
	['floor', 0, 72],
	['sidewall-depth0-near', 0, 0],
	['sidewall-depth0-far', 192, 0],
	['sidewall-depth1-near', 16, 0],
	['sidewall-depth1-far', 160, 0],
	['sidewall-depth2-near', 48, 0],
	['sidewall-depth2-far', 144, 0],
	['sidewall-depth3-near', 64, 0],
	['sidewall-depth3-far', 128, 0],
	['wall0-left', 0, 5],
	['wall0-face', 16, 5],
	['wall0-right', 192, 5],
	['wall1-left', 0, 18],
	['wall1-face', 48, 18],
	['wall1-right', 160, 18],
	['wall2-left', 0, 23],
	['wall2-face', 64, 23],
	['wall2-right', 144, 23],
	['panel-top', 64, 9],
	['fountain', 64, 38],
];

for (const tileset of ['bcdfx', 'bcdfy', 'bcdfz']) {
	const manifest = JSON.parse(readFileSync(join(textureDir, `dungeon-${tileset}.json`), 'utf8'));
	const atlas = join(textureDir, `dungeon-${tileset}.png`);
	const frames = new Map(manifest.frames.map((frame) => [frame.name, frame]));
	const composites = [];

	for (const [name, left, top] of definitions) {
		const frame = frames.get(name);
		if (!frame) continue;
		composites.push({
			input: await sharp(atlas).extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h }).png().toBuffer(),
			left,
			top,
		});
	}

	await sharp({
		create: { width: 208, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
	})
		.composite(composites)
		.png()
		.toFile(join(textureDir, `dungeon-${tileset}-view.png`));
}
