import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist_chrome",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        content: resolve(rootDir, "src/content.ts")
      },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
