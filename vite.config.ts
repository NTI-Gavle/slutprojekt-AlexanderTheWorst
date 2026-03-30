import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from "path";
import { config } from 'dotenv';

config({ quiet: true, path: ".env" })

console.log("RUNNNINGGGG")

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    resolve: {
            alias: {
                "@": path.resolve("./src/components")
            }
    },
});
