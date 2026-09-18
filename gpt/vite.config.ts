import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const alias = { "@": resolve(rootDir, "vendor/luna-navigation/src") };

function extensionEntry(name: string, input: string, emptyOutDir: boolean): UserConfig {
  return {
    resolve: { alias },
    publicDir: false,
    build: {
      outDir: "dist_chrome",
      emptyOutDir,
      sourcemap: false,
      minify: false,
      lib: {
        entry: input,
        name: `Yada${name[0].toUpperCase()}${name.slice(1)}`,
        formats: ["iife"],
        fileName: () => `${name}.js`
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    },
    plugins: name === "popup"
      ? [{
          name: "chatgpt-yada-extension-files",
          closeBundle() {
            const outDir = resolve(rootDir, "dist_chrome");
            mkdirSync(outDir, { recursive: true });
            cpSync(resolve(rootDir, "manifest.json"), resolve(outDir, "manifest.json"));
            cpSync(resolve(rootDir, "src/popup/popup.css"), resolve(outDir, "popup.css"));
            cpSync(resolve(rootDir, "src/popup/index.html"), resolve(outDir, "popup.html"));
            const notices = resolve(rootDir, "THIRD_PARTY_NOTICES.md");
            if (existsSync(notices)) cpSync(notices, resolve(outDir, "THIRD_PARTY_NOTICES.md"));
            const built = JSON.parse(readFileSync(resolve(outDir, "manifest.json"), "utf8")) as { version?: string };
            if (built.version !== "4.0.0") throw new Error(`dist manifest version is ${built.version}`);
          }
        }]
      : []
  };
}

export default defineConfig([
  extensionEntry("content", resolve(rootDir, "src/content.ts"), true),
  extensionEntry("background", resolve(rootDir, "src/background/serviceWorker.ts"), false),
  extensionEntry("popup", resolve(rootDir, "src/popup/popup.ts"), false)
]);
