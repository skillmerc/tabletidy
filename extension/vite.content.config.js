import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: false,
    target: "chrome139",
    lib: { entry: resolve(import.meta.dirname, "src/content.js"), formats: ["iife"], name: "TabletidyContent", fileName: () => "content.js" },
  },
});
