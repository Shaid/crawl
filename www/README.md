# Crawl documentation site

This Astro/Starlight site is the curated public face of the Crawl reverse-
engineering repository. The home page presents all ten documented game
projects; Black Crypt and Wizardry 6 have the two full format guides, while the
other projects currently expose calibrated status pages.

## Development

Run from this directory:

```sh
npm install
npm run dev
npm run build
```

The build helper copies Black Crypt's extracted assets and a curated set of
Wizardry 6 screens/atlases, generates the sidebar, and then runs Astro's static
build. The full extraction trees remain in the repository's ignored
`public/assets/` directory; the committed `www/public/assets/` files are the
small deployment fallback.

## Content layout

- `src/content/docs/index.mdx` — project landing page and game cards.
- `src/content/docs/status/` — all-games status board.
- `src/content/docs/blackcrypt/` — full Black Crypt guide and galleries.
- `src/content/docs/wizardry6/` — full Wizardry 6 guide, assets and open work.
- `src/content/docs/<game>/` — status-first pages for the other curated games.
- `src/content/docs/_sidebar.json` — global status/Wizardry 6 navigation.
- `src/content/docs/blackcrypt/_sidebar.json` — Black Crypt's detailed nav.

The raw `docs/<game>/` notes are the source of truth when a concise site page
and an exhaustive research note differ.
