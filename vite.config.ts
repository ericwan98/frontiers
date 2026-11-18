import { defineConfig } from "vite";

// Relative asset paths, so the build works under GitHub Pages' /frontiers/ as well as at a root.
export default defineConfig({ base: "./" });
