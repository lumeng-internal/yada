# Test Checklist: v2.0.0

## Automated gates

- [x] `npm run verify:copy` validates active-branch selection, image placeholders, multiline assistant output, exclusion of an inactive branch, final newline, and Clipboard API writing.
- [x] `npm run build` passes TypeScript strict checking and the Vite production build.
- [x] `dist_chrome/` contains only `manifest.json` and `content.js`.
- [x] The built runtime contains no navigation rail, selective-copy, preview-mode dot, or lasso behavior.
- [x] `dist_chrome/manifest.json` contains no `storage` permission.

## Runtime acceptance

- [x] Edge reports ChatGPT Yada version `2.0.0` after reloading the unpacked extension.
- [x] A saved ChatGPT conversation shows exactly one Yada control: `复制全部`.
- [x] No right-side navigation marks are present.
- [x] No round preview-mode toggle is present.
- [x] No selective-copy control or menu is present.
- [x] Clicking `复制全部` writes Markdown beginning with `# User`.
- [x] The copied Markdown includes both User and ChatGPT sections from the current active branch.
- [ ] Switching to another saved conversation keeps the single button working.
- [ ] A non-conversation ChatGPT page does not show the button.

## Boundary

- [x] `reference/` was not modified.
