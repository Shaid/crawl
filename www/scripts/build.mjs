// Build helper for the Black Crypt docs site.
//
// Two jobs:
//   1. Copy the repo's extracted assets (public/assets/blackcrypt) into this
//      site's public/ so the site is self-contained and images render.
//   2. Generate the Starlight sidebar (generated/sidebar.mjs) from the curated
//      page manifest (src/content/docs/blackcrypt/_sidebar.json).
//
// Locally, extracted assets are copied from the repo's public/assets directory.
// In CI, the committed www/public build assets are reused instead. Run with:
//   node scripts/build.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');

const ASSET_SRC = join(repo, 'public', 'assets', 'blackcrypt');
const ASSET_DST = join(root, 'public', 'assets', 'blackcrypt');
const MANIFEST = join(root, 'src', 'content', 'docs', 'blackcrypt', '_sidebar.json');
const OUT_DIR = join(root, 'generated');
const OUT_SIDEBAR = join(OUT_DIR, 'sidebar.mjs');

// --- 1. Copy assets ---------------------------------------------------------
mkdirSync(join(root, 'public', 'assets'), { recursive: true });
if (existsSync(ASSET_SRC)) {
	rmSync(ASSET_DST, { recursive: true, force: true });
	cpSync(ASSET_SRC, ASSET_DST, { recursive: true });
	console.log(`Copied assets: ${ASSET_SRC} -> ${ASSET_DST}`);
} else if (existsSync(ASSET_DST)) {
	console.log(`Using committed site assets in ${ASSET_DST}`);
} else {
	throw new Error(`Missing extracted assets and committed site assets: ${ASSET_SRC}`);
}

// Reuse the committed browser fonts in CI. Regenerate them locally only when
// either artifact is absent, so the deployment does not need Python/fontTools.
const fontDir = join(root, 'public', 'fonts');
const fontFiles = ['black-crypt-big.ttf', 'black-crypt-big.woff2'];
if (fontFiles.every((file) => existsSync(join(fontDir, file)))) {
	console.log(`Using committed webfonts in ${fontDir}`);
} else {
	const fontResult = spawnSync(
		'python3',
		[
			join(root, 'scripts', 'generate_pixel_font.py'),
			'--source-root',
			repo,
			'--output',
			fontDir,
		],
		{ stdio: 'inherit' },
	);
	if (fontResult.status !== 0) throw new Error('Could not generate the Black Crypt webfont');
}

const textureDir = join(ASSET_DST, 'amiga', 'textures');
// At least one variant per tileset (bcdfx/bcdfz get 5: fountain, door,
// plaque, alcove, empty; bcdfy's smaller sub-image set only supports
// door + empty) -- "every variant" isn't a fixed list since availability
// depends on which decoration sub-images that tileset actually ships.
const hasAnyTileView = (name) =>
	existsSync(join(textureDir, `dungeon-${name}-view-empty.png`));
if (existsSync(join(textureDir, 'dungeon-bcdfx.json'))) {
	const tilesetResult = spawnSync(
		'node',
		[join(root, 'scripts', 'generate_tileset_views.mjs'), textureDir],
		{ stdio: 'inherit' },
	);
	if (tilesetResult.status !== 0) throw new Error('Could not generate composited tileset views');
} else if (['bcdfx', 'bcdfy', 'bcdfz'].every(hasAnyTileView)) {
	console.log(`Using committed composited tileset views in ${textureDir}`);
} else {
	throw new Error(`Missing tileset source and committed views: ${textureDir}`);
}

const faviconPath = join(root, 'public', 'favicon.png');
const itemSpriteDir = join(ASSET_DST, 'amiga', 'sprites');
if (existsSync(join(itemSpriteDir, 'items.json'))) {
	const faviconResult = spawnSync(
		'node',
		[join(root, 'scripts', 'generate_favicon.mjs'), itemSpriteDir, faviconPath],
		{ stdio: 'inherit' },
	);
	if (faviconResult.status !== 0) throw new Error('Could not generate the Raven Shield favicon');
} else if (existsSync(faviconPath)) {
	console.log(`Using committed favicon: ${faviconPath}`);
} else {
	throw new Error(`Missing item sprites and committed favicon: ${itemSpriteDir}`);
}

const heroPath = join(root, 'public', 'hero-title.png');
const screenDir = join(ASSET_DST, 'amiga', 'screens');
if (existsSync(join(screenDir, 'title.png')) && existsSync(join(screenDir, 'logo.png'))) {
	const heroResult = spawnSync(
		'node',
		[join(root, 'scripts', 'generate_hero.mjs'), join(ASSET_DST, 'amiga'), heroPath],
		{ stdio: 'inherit' },
	);
	if (heroResult.status !== 0) throw new Error('Could not generate the homepage hero composite');
} else if (existsSync(heroPath)) {
	console.log(`Using committed hero composite: ${heroPath}`);
} else {
	throw new Error(`Missing title/logo screens and committed hero composite: ${screenDir}`);
}

// --- 2. Generate sidebar ----------------------------------------------------

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const toSidebar = (entry) => {
	if (entry.items) {
		return {
			label: entry.label,
			items: entry.items.map(toSidebar),
		};
	}
	return { label: entry.label, slug: entry.slug };
};

const sidebar = manifest.map(toSidebar);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
	OUT_SIDEBAR,
	`// Generated by scripts/build.mjs — do not edit by hand.\n` +
		`// Source manifest: src/content/docs/blackcrypt/_sidebar.json\n` +
		`export const sidebar = ${JSON.stringify(sidebar, null, 2)};\n`,
);
console.log(`[sidebar] wrote ${OUT_SIDEBAR} (${sidebar.length} top-level groups)`);
