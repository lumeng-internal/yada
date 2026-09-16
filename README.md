# Yada 扩展合集

三个独立项目，共用一个仓库，各自保留版本、代码和使用方式。

| 项目 | 版本 | 开发目录 | 浏览器加载目录 |
| --- | --- | --- | --- |
| ChatGPT Yada | 2.0.0 | `gpt/` | `gpt/dist_chrome/` |
| Gemini Yada | 1.6.0 | `gemini/` | `gemini/` |
| Claude Yada | 1.1.1 | `claude/` | `claude/dist_chrome/` |

## 安装

在 Chrome 或 Edge 的扩展管理页打开开发者模式，选择“加载已解压的扩展程序”，分别选择表中的浏览器加载目录。

## 开发

- GPT：在 `gpt/` 执行 `npm ci`、`npm run verify:copy`、`npm run build`。
- Gemini：原生 JavaScript/CSS 扩展，无需构建。
- Claude：在 `claude/` 执行 `corepack yarn@1.22.22 install --frozen-lockfile`、`corepack yarn@1.22.22 build:chrome`。
- 各项目的 README 和 AGENTS.md 保留原说明；其中旧本地绝对路径代表导入前的位置，当前开发目录以本页为准。

## 本次导入

导入日期：2026-09-16。收录本机当前文件，包括 GPT 尚未提交的 2.0.0 修改；Gemini 来自 Documents 中的 1.6.0 完整扩展，Claude 来自主项目 1.1.1。

本次仅整理归档，不修改扩展功能，不升级版本。保留已有构建和当前版本安装包；未重新进行浏览器功能验收。

未收录依赖目录、原 Git 历史、隔离 worktree、只读参考项目、运行报告、编辑器设置和旧版本压缩包。`IMPORT_CHECKSUMS.json` 记录所有导入文件的 SHA-256，导入时已逐文件与来源比对。
