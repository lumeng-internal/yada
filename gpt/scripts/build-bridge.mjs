import { build } from 'esbuild';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await build({
  entryPoints: [resolve(root, 'src/rail/virtualizerBridgePage.ts')],
  outfile: resolve(root, 'dist_chrome/features/virtualizer-bridge-page.js'),
  bundle: true, format: 'iife', target: 'chrome110',
  banner: { js: '/* Copyright (c) 2026 bujue3709. MIT; see ../THIRD_PARTY_NOTICES.md. */' }
});
