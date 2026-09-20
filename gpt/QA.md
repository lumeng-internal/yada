# ChatGPT Yada 4.0.2 验收

## 本轮工程门禁

```bash
cd gpt
npm test
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

1. 在 Edge 加载固定 `dist_chrome`，打开短对话：官方 Navigator 应正常出现。
2. 打开之前 4.0.1 无 Navigator 的真实长对话。不滚动页面，保持 idle；预期 Yada 自动准备历史后官方 Navigator 出现。
3. 右侧只能有 ChatGPT 官方 Navigator；无 Yada Rail、绿色点或第二套刻度。
4. 自动准备期间正文不能自行明显上下跳。
5. 依次点第一轮、中间轮、最后一轮，以及最后 → 第一 → 中间 → 最后。
6. 准备期间滚轮/点击/按键：Yada 立即让权；停止操作、idle 后，在 recovery budget 内自动继续。

额度：

1. 顶栏显示 20px 三环；首次同步中明确显示“正在首次同步最近 7 天 ChatGPT 历史…”。
2. 同步完成后显示本地“预计剩余”。
3. 点击三环应出现约 312px 的完整详情卡，不得被 Header 裁成白条。
4. Escape、外部点击、route change 均可关闭详情。
5. 完整同步后立即 reload，不应再次进入“正在补齐”，数字继续显示。
6. 保持页面打开超过 10 分钟，旧额度持续显示，后台静默校准；hidden 暂停、visible 时过期才校准。
7. 刷新失败不隐藏预计剩余；显示上次完整同步时间与最近失败提示。手动刷新忽略 10 分钟 TTL。

提示词：

1. 旧 v1 升级后首次视觉顺序保持；拖动 header 六点手柄排序，正文仍可选中。
2. 关闭/重新打开面板、刷新 ChatGPT、重开浏览器后顺序保持。
3. 编辑不改变排序；新增放顶部；删除保留其余顺序；复制不影响顺序。
4. 列表较长时检查官方 AutoScroll；无缩放、旋转或彩色动画。

复制全部：

1. 复制当前活动分支 Markdown 与真实时间戳仍正常。

验收前不要生成正式 `ChatGPT-Yada-v4.0.2-dist_chrome.zip`。

## 2026-09-20 工程结果

- 基线：`e71a843d3fd6ca076fcb1c9157ae8b7111445f3b`，分支 `rebuild/gpt-yada-v4-official-only`。
- `npm test`：12 文件、111 测试全部通过。新增 short/120/280-turn fixtures、older expansion、prepare lease、stalled recovery、unlinked、count-mismatch readiness 与用户中断合同。
- `npm run build`、`npm run verify:gate`、`git diff --check`：PASS。
- `npm run package`：PASS；ZIP 与 dist 全文件 SHA-256 映射一致，`distMatchesZip=true`。
- package / lock / source manifest / dist manifest / ZIP：统一 `4.0.2`。
- 新包：`ChatGPT-Yada-v4.0.2-official-only-UNVERIFIED.zip`。
- 新包 SHA256：`c1b8feb2992d7f8f9313444e472bc610f0d9205d953e2724f451fa1a5aff429d`。
- 旧 `ChatGPT-Yada-v4.0.1-official-only-UNVERIFIED.zip` 保留；SHA256 `05c6b40796bfedd3544a7218273108a2dcbf6e6ecb812560124ec469212f0d3f`。
- 旧 `ChatGPT-Yada-v4.0.0-official-only-UNVERIFIED.zip` 保留；SHA256 `43129ca43086fc5a161527a6c6abbf98ba6abf2f7675a2fb3a71b194f3b6941d`。
- 生产 Navigator 仍只有 `native-navigator-main.js` + isolated `content.js`；无 Luna、旧 Rail、preview、stable-slot、official proxy 或 fallback navigator。
- Quota、Prompt Sorting、ConversationSync、Copy All：未改变。
- `HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA` / `NOT_USED_BY_POLICY`，未运行；不将其记为 PASS 或 FAILURE。
- PR / CI / Release / ECS / RDS / OSS：未执行。Mac mini 产品测试按设计不运行，MacBook 手工验收仍为 PENDING。
