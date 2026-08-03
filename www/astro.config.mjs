// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import { sidebar } from './generated/sidebar.mjs';

// https://astro.build/config
export default defineConfig({
	site: "https://crawl.shaid.net",
	integrations: [
		starlight({
			title: 'Black Crypt — Data Formats',
			favicon: '/favicon.png',
			description:
				'A human-readable guide to the internal data formats of Black Crypt (1992, Raven Software / Electronic Arts).',
			customCss: ['./src/styles/fonts.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/anomalyco/opencode' },
			],
			sidebar,
		}),
		mdx(),
	],
});
