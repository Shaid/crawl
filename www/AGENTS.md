## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Build & asset wiring

This site is a curated, human-readable companion to the repo's Black Crypt
reverse-engineering notes. Two things are **generated**, never edited by hand:

- `public/assets/blackcrypt/` — copied from the repo's `public/assets/blackcrypt`
  by `scripts/build.mjs`, so the site is self-contained.
- `public/fonts/` — generated from the extracted `font-big` bitmap atlas by
  `scripts/generate_pixel_font.py`.
- `generated/sidebar.mjs` — the Starlight sidebar, generated from
  `src/content/docs/blackcrypt/_sidebar.json`.

`npm run dev` and `npm run build` run `scripts/build.mjs` first, so assets,
fonts and the sidebar stay in sync automatically. Run it manually with
`node scripts/build.mjs`.

### Editing the site

- **Curated pages** live in `src/content/docs/blackcrypt/`. They summarise the
  raw notes in `docs/blackcrypt/` (the source of truth). When a page disagrees
  with the raw notes, the raw notes win.
- **Sidebar order/labels**: edit `src/content/docs/blackcrypt/_sidebar.json`,
  then re-run the build script. Slugs are the content file paths under
  `src/content/docs/` (the home page's slug is `blackcrypt`, not
  `blackcrypt/index`).
- **Images**: reference the copied assets by URL path, e.g.
  `/assets/blackcrypt/amiga/screens/title.png`. Re-run the build script after
  the repo's `public/assets` changes.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
