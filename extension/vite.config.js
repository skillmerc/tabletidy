// Builds the side panel + service worker (ES modules). The content script is built
// separately as a classic script (vite.content.config.js) because injected files
// cannot be ES modules. No remote code: firebase/ai is bundled.
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "src"),
  publicDir: resolve(import.meta.dirname, "public"),
  envDir: resolve(import.meta.dirname, "../web"), // web/.env.local holds the Firebase web config
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "chrome139",
    modulePreload: false,
    rollupOptions: {
      input: { sidepanel: resolve(import.meta.dirname, "src/sidepanel.html"), background: resolve(import.meta.dirname, "src/background.js") },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
