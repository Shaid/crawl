// Build helper for the Crawl multi-game docs site.
//
// Two jobs:
//   1. Copy the repo's extracted assets (public/assets/blackcrypt) into this
//      site's public/ so the site is self-contained and images render.
//   2. Generate the Starlight sidebar (generated/sidebar.mjs) from the project
//      status manifest plus Black Crypt's detailed page manifest.
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
const W6_ASSET_SRC = join(repo, 'public', 'assets', 'wizardry6');
const W6_ASSET_DST = join(root, 'public', 'assets', 'wizardry6');
const W6_SITE_FILES = [
	'amiga/screens/titlepag.png',
	'amiga/screens/dragonsc.png',
	'amiga/screens/graveyrd.png',
	'amiga/maps/mazedata-indexed.png',
	'amiga/maps/through-dungeon-16-10-f0.png',
	'amiga/maps/through-dungeon-30-4-f0.png',
	'amiga/maps/maze-level07.png',
	'amiga/sprites/monsters.png',
	'amiga/sprites/wport1.png',
	'snes/screens/title-backdrop.png',
	'snes/screens/dungeon-view-sample.png',
	'snes/screens/logo.png',
	'snes/sprites/portraits.png',
	'snes/sprites/spell-animations.png',
	'snes/sprites/ui-icons.png',
	'snes/sprites/creature-sprites.png',
];
// The status pages use one representative title/title-adjacent screen per
// project. Keep this list deliberately small; the game's full extracted asset
// tree remains outside the site bundle unless a page actually uses it.
const TITLE_SITE_FILES = [
	['mm1', 'dosega/screens/title-0.png'],
	['mm2', 'amiga/textures/intro.png'],
	['mm3', 'amiga/screens/intro.cc_e1.png'],
	['eotb', 'dosvga/screens/title-v.png'],
	['eotb2', 'dosvga/screens/intro.png'],
	['eotb3', 'dosvga/screens/chargen.png'],
	['dungeonhack', 'dosvga/screens/hack-Main_Screen.png'],
	['landsoflore', 'dosvga/screens/title.png'],
	// Overview-page images for the 2026-11-21 Amiga titles (only these two
	// have published assets yet).
	['zombi', 'amiga/screens/present.png'],
	['zombi', 'amiga/screens/screen.png'],
	['zombi', 'amiga/screens/victoire.png'],
	['zombi', 'amiga/sprites/lieux.png'],
	['zombi', 'amiga/sprites/z.png'],
	['zombi', 'amiga/sprites/objet.png'],
	['abandonedplaces2', 'amiga/sprites/wl_00.png'],
	['abandonedplaces2', 'amiga/sprites/fl_00.png'],
	['abandonedplaces2', 'amiga/sprites/gt_03.png'],
	['abandonedplaces2', 'amiga/sprites/strd_03.png'],
	['abandonedplaces2', 'amiga/sprites/mon_10.png'],
	['abandonedplaces2', 'amiga/sprites/mon_00.png'],
];
const PROJECT_MANIFEST = join(root, 'src', 'content', 'docs', '_sidebar.json');
const BLACKCRYPT_MANIFEST = join(root, 'src', 'content', 'docs', 'blackcrypt', '_sidebar.json');
const OUT_DIR = join(root, 'generated');
const OUT_SIDEBAR = join(OUT_DIR, 'sidebar.mjs');

// --- 1. Copy assets ---------------------------------------------------------
mkdirSync(join(root, 'public', 'assets'), { recursive: true });
// Whether this run has the repo's own live, gitignored extracted assets
// available (a real local dev checkout) as opposed to only the committed
// CI-fallback mirror. Steps below that need something ASSET_SRC provides but
// ASSET_DST's committed mirror doesn't -- like @seer-project/dungeon, a local
// sibling-repo `file:` dependency that only resolves on a machine with
// ../../seer checked out -- must gate on this, not on a committed file's
// mere presence in ASSET_DST (which is always true once that file has ever
// been committed as a CI fallback, defeating the "are we actually able to
// regenerate this" check it was meant to be).
const hasLiveAssetSrc = existsSync(ASSET_SRC);
if (hasLiveAssetSrc) {
	rmSync(ASSET_DST, { recursive: true, force: true });
	cpSync(ASSET_SRC, ASSET_DST, { recursive: true });
	console.log(`Copied assets: ${ASSET_SRC} -> ${ASSET_DST}`);
} else if (existsSync(ASSET_DST)) {
	console.log(`Using committed site assets in ${ASSET_DST}`);
} else {
	throw new Error(`Missing extracted assets and committed site assets: ${ASSET_SRC}`);
}

// Wizardry 6 has its own full documentation section. Keep the same local
// source / committed fallback behaviour as Black Crypt, but copy only the
// curated images used by these pages rather than the whole 37 MB asset tree.
const hasLiveW6Assets = existsSync(W6_ASSET_SRC);
const w6SourceRoot = hasLiveW6Assets ? W6_ASSET_SRC : W6_ASSET_DST;
if (!existsSync(w6SourceRoot)) {
	throw new Error(`Missing extracted assets and committed site assets: ${W6_ASSET_SRC}`);
}
if (hasLiveW6Assets) rmSync(W6_ASSET_DST, { recursive: true, force: true });
for (const file of W6_SITE_FILES) {
	const source = join(w6SourceRoot, file);
	const destination = join(W6_ASSET_DST, file);
	if (!existsSync(source)) throw new Error(`Missing Wizardry 6 site asset: ${source}`);
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination);
}
console.log(`Copied ${W6_SITE_FILES.length} curated Wizardry 6 assets into ${W6_ASSET_DST}`);

for (const [game, file] of TITLE_SITE_FILES) {
	const source = join(repo, 'public', 'assets', game, file);
	const destination = join(root, 'public', 'assets', game, file);
	if (existsSync(source)) {
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(source, destination);
	} else if (!existsSync(destination)) {
		throw new Error(`Missing title asset for ${game}: ${source}`);
	}
}
console.log(`Copied ${TITLE_SITE_FILES.length} curated status-page title assets`);

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
const dungeonDataDir = join(ASSET_DST, 'amiga', 'dungeon');
// A tileset has *some* real walker-rendered views once its manifest exists
// (scripts/render_dungeon_views.ts writes dungeon-<name>-views.json
// alongside the PNGs) -- which views/variants a tileset gets isn't a fixed
// list, since it depends on which M4/M5 props that tileset's own map data
// and art actually have (e.g. bcdfy has no plaque/alcove art at all).
const hasViewManifest = (name) =>
	existsSync(join(textureDir, `dungeon-${name}-views.json`));
// Regeneration needs @seer-project/dungeon (a local sibling-repo `file:` dependency,
// see hasLiveAssetSrc's comment above) -- only ever attempt it on a real
// local dev checkout, never just because dungeon/levels.json exists in
// ASSET_DST (it's committed there as the CI fallback's own source data, so
// its presence alone says nothing about whether @seer-project/dungeon is resolvable
// here). This is exactly the false-positive that broke CI: levels.json is
// committed for the *fallback* branch to read, not as a "please regenerate"
// signal.
if (hasLiveAssetSrc && existsSync(join(dungeonDataDir, 'levels.json'))) {
	const dungeonViewsResult = spawnSync(
		'node',
		[join(root, 'scripts', 'render_dungeon_views.ts'), textureDir],
		{ stdio: 'inherit' },
	);
	if (dungeonViewsResult.status !== 0) throw new Error('Could not render real dungeon views');
} else if (['bcdfx', 'bcdfy', 'bcdfz'].every(hasViewManifest)) {
	console.log(`Using committed real dungeon views in ${textureDir}`);
} else {
	throw new Error(`Missing dungeon walker source data and committed views: ${dungeonDataDir}`);
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

const manifest = [
	...JSON.parse(readFileSync(BLACKCRYPT_MANIFEST, 'utf8')),
	...JSON.parse(readFileSync(PROJECT_MANIFEST, 'utf8')),
];

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
	`// Source manifests: src/content/docs/_sidebar.json + blackcrypt/_sidebar.json\n` +
		`export const sidebar = ${JSON.stringify(sidebar, null, 2)};\n`,
);
console.log(`[sidebar] wrote ${OUT_SIDEBAR} (${sidebar.length} top-level groups)`);
