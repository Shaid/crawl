// Composite the dungeon tilesets' sub-images into first-person viewport
// mockups, using the confirmed on-screen dest-position table from
// docs/blackcrypt/amiga/data-structure.md ("3D Viewport Compositing" /
// "Screenshot corroboration") and empirical alignment against real
// screenshots (data/default-2.png, default-4.png, default_45.png, cropped
// at the confirmed viewport rect (38,20)-208x140).
//
// Draw order matters: the game's own DrawViewport is a painter's-algorithm
// queue (farthest square drawn first, nearest last, so near geometry
// correctly occludes far). The previous version of this script composited
// front-to-back, which let distant, smaller wall pieces paint over the
// near, larger ones -- that was the root cause of the garbled output, not
// just wrong coordinates.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const textureDir = process.argv[2];
if (!textureDir) throw new Error('Missing texture directory');

const CANVAS = { width: 208, height: 140 };

// Confirmed: front-wall lateral -1/0/+1 -> dest x 0/16/192 (depth 0),
// 0/48/160 (depth 1), 0/64/144 (depth 2); side-wall left lands at
// x = 0/16/48/64 per depth, right at 192/160/144/128 (mirror about the
// 208px centre). Y per depth is anchored on the one doc-confirmed point --
// "the depth-1 doorway frame's own screen origin (64, 9)" -- for depth 1,
// and empirically fit (minimum pixel-diff against the reference crops
// among plausible candidates) for depths 0 and 2; depth 3 extrapolates the
// same progression. This is an illustration, not a byte-exact render --
// treat these Y values as "looks right", not RE ground truth.
const DEPTH_Y = [5, 9, 22, 30];

// Back-to-front layer order: ceiling/floor as the base plate, then each
// depth from farthest (3) to nearest (0), then the centrepiece last so it
// sits on top of everything behind it.
function baseLayers() {
	return [
		{ name: 'ceiling', x: 0, y: 0 },
		{ name: 'floor', x: 0, y: 72 },
	];
}

const WALL_X = [
	[0, 16, 192],
	[0, 48, 160],
	[0, 64, 144],
];

// Side-wall recession only, no front-facing wall -- an open corridor, the
// composition every representative screenshot actually shows (a wall
// immediately ahead only happens facing a dead end one square out, which
// makes for a much less interesting illustration: it's one huge flat
// texture with almost nothing else visible). See data/default-4.png and
// data/default_45.png (cropped at the confirmed viewport rect) for the
// reference this composition is matched against.
function sideLayers(depth) {
	const y = DEPTH_Y[depth];
	const sideX = [
		[0, 192],
		[16, 160],
		[48, 144],
		[64, 128],
	][depth];
	return [
		{ name: `sidewall-depth${depth}-near`, x: sideX[0], y: depth === 0 ? 0 : y },
		{ name: `sidewall-depth${depth}-far`, x: sideX[1], y: depth === 0 ? 0 : y },
	];
}

// The terminating back wall the corridor appears to end at (depth 1) --
// the backdrop the centrepiece decoration sits in front of.
function backWall(depth) {
	const y = DEPTH_Y[depth];
	const [left, face, right] = WALL_X[depth];
	return [
		{ name: `wall${depth}-left`, x: left, y },
		{ name: `wall${depth}-face`, x: face, y },
		{ name: `wall${depth}-right`, x: right, y },
	];
}

// Centrepiece variants -- what's visible at the far end of the corridor
// (depth 1's face slot). Each names the sub-images to draw last, in order.
const CENTERPIECES = {
	empty: [],
	fountain: [
		{ name: 'panel-top', x: 64, y: 9 },
		{ name: 'fountain', x: 64, y: 38 },
	],
	door: [
		{ name: 'doorway-1b', x: 64, y: 9 },
		{ name: 'doorway-1a', x: 16, y: 9 },
		{ name: 'doorway-1c', x: 144, y: 9 },
		{ name: 'door-type0-1', x: 64, y: 9 },
	],
	plaque: [{ name: 'plaque-a', x: 56, y: 12 }],
	alcove: [{ name: 'alcove-a', x: 48, y: 12 }],
};

async function buildComposite(atlas, frames, layerNames) {
	const composites = [];
	for (const { name, x, y } of layerNames) {
		const frame = frames.get(name);
		if (!frame) continue;
		composites.push({
			input: await sharp(atlas)
				.extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h })
				.png()
				.toBuffer(),
			left: x,
			top: y,
		});
	}
	return sharp({ create: { ...CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
		.composite(composites)
		.png()
		.toBuffer();
}

for (const tileset of ['bcdfx', 'bcdfy', 'bcdfz']) {
	const manifestPath = join(textureDir, `dungeon-${tileset}.json`);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const atlas = join(textureDir, `dungeon-${tileset}.png`);
	const frames = new Map(manifest.frames.map((frame) => [frame.name, frame]));

	const corridor = [
		...baseLayers(),
		...sideLayers(3),
		...sideLayers(2),
		...backWall(1),
		...sideLayers(1),
		...sideLayers(0),
	];

	let written = 0;
	for (const [variant, centerpiece] of Object.entries(CENTERPIECES)) {
		// Skip variants whose centrepiece art doesn't exist in this tileset
		// (e.g. bcdfy has a smaller sub-image set).
		if (centerpiece.length && !centerpiece.every(({ name }) => frames.has(name))) continue;
		const buffer = await buildComposite(atlas, frames, [...corridor, ...centerpiece]);
		await sharp(buffer).toFile(join(textureDir, `dungeon-${tileset}-view-${variant}.png`));
		written++;
	}
	console.log(`[tileset-views] ${tileset}: wrote ${written} variant(s)`);
}
