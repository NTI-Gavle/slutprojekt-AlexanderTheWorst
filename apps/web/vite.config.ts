import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		fs: {
			allow: ['../..'] // allow access to monorepo root
		},
		host: "0.0.0.0",
        allowedHosts: ["app-game.backman.lol"]
	}
});
