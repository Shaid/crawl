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
			title: 'Crawl — Game Data Formats',
			favicon: '/favicon.png',
			description:
				'A curated status and data-format guide to a family of reverse-engineered classic dungeon crawlers.',
			customCss: ['./src/styles/fonts.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Shaid/crawl' },
			],
			sidebar,
		}),
		mdx(),
	],
});
