# ChatGPT Yada 验收

## 本轮工程门禁

```bash
cd gpt
npm run build
npm run verify:gate
git diff --check
```

检查 build metafile、旧符号、manifest 的 `document_start` MAIN hook、无额外权限，以及 `claude/` / `gemini/` 未改变。

本轮明确不运行 Mac mini ChatGPT 产品测试、candidate、Playwright、自动长对话、自动模型调用、PR、CI 或 Release。因此工程构建成功不等于真实导航或额度体验通过。

```text
MAC_MINI_PRODUCT_TEST = NOT_RUN_BY_DESIGN
MACBOOK_MANUAL_ACCEPTANCE = PENDING
```

## MacBook 手工验收

导航：

1. 在 Edge 加载固定 `dist_chrome`，打开真实 100～200 轮对话。
2. 右侧只能有 ChatGPT 官方 Navigator；无 Yada Rail、绿色点或第二套刻度。
3. 打开和等待 hydration 时，当前阅读位置不得自行上下移动。
4. 官方 prompt 数应完整；依次测试第一轮、中间轮、最后一轮，以及最后 → 第一 → 中间 → 最后。
5. 滚动、点击、按键或输入期间，hydration 必须立即让权。

额度：

1. 顶栏显示 20px 三环；同步中应明确显示正在补齐历史，而不是孤立 `?`。
2. 同步完成后显示本地“预计剩余”。
3. 点击三环应出现约 312px 的完整详情卡，不得被 Header 裁成白条。
4. Escape、外部点击、route change 均可关闭详情。

验收前不要生成正式 `ChatGPT-Yada-v4.0.0-dist_chrome.zip`。
