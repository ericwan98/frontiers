import { defineConfig } from "vite";

// Relative asset paths, so the build works under GitHub Pages' /frontiers/ as well as at a root.
// The Paris streets data is one 1.8 MB chunk, loaded only when that mode starts.
export default defineConfig({ base: "./", build: { chunkSizeWarningLimit: 2000 } });
