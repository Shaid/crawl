## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Build & asset wiring

This site is a curated, human-readable companion to the repo's multi-game
reverse-engineering notes. Black Crypt and Wizardry 6 have full documentation
sections; the other curated projects have status-first pages. Three things are
**generated**, never edited by hand:

- `public/assets/blackcrypt/` — copied from the repo's `public/assets/blackcrypt`
  by `scripts/build.mjs`, so the site is self-contained.
- `public/assets/wizardry6/` — the curated screen/atlas subset copied from the
  repo's Wizardry 6 extraction tree by `scripts/build.mjs`.
- `public/fonts/` — committed WOFF2/TTF outputs generated from the extracted
  `font-big` bitmap atlas. `scripts/build.mjs` only regenerates them when an
  artifact is missing, so CI does not need Python/fontTools.
- `generated/sidebar.mjs` — the Starlight sidebar, generated from the global
  project manifest and Black Crypt's detailed manifest.

`npm run dev` and `npm run build` run `scripts/build.mjs` first, so assets,
fonts and the sidebar stay in sync automatically. Run it manually with
`node scripts/build.mjs`.

### Editing the site

- **Curated pages** live under `src/content/docs/`. Black Crypt and Wizardry 6
  summarise `docs/blackcrypt/` and `docs/wizardry6/`; the status-first game
  pages point to each project's raw notes as the source of truth.
- **Sidebar order/labels**: edit `src/content/docs/_sidebar.json` for the
  project sections or `src/content/docs/blackcrypt/_sidebar.json` for the
  Black Crypt reference section, then re-run the build script.
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
