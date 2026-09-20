# ChatGPT Yada 4.0.3 验收

## 本轮工程门禁

```bash
cd gpt
npm test
npm run build
npm run verify:gate
git diff --check
npm prune --dry-run
npm audit --omit=dev
```

检查 build metafile、旧符号、manifest 的 `document_start` MAIN hook、无额外权限，以及 `claude/` / `gemini/` 未改变。

本轮明确不运行 Mac mini ChatGPT 产品测试、candidate、Playwright、自动长对话、自动模型调用、PR、CI 或 Release。因此工程构建成功不等于真实 10～15 标签体验通过。

```text
MAC_MINI_PRODUCT_TEST = NOT_RUN_BY_DESIGN
MACBOOK_15_TAB_ACCEPTANCE = PENDING
```

## MacBook 手工验收

15 标签性能：

1. 更新至 4.0.3。
2. 打开 10～15 个 GPT。
3. 刷新一个长对话，确认 Navigator 正常出现。
4. Navigator 出现后继续正常工作、滚动、输入，确认无感。
5. 让 3 个标签同时生成回答，当前操作标签仍然顺畅。
6. 快速切换多个标签 3～5 分钟，之后确认「上次完整同步」最终可以回到最近时间。
7. 打开三环，确认新 UI：健康状态只有三组预计剩余和上次完整同步，没有「本地估算」或「历史同步完整」。
8. 提示词 / 复制全部回归。

导航：

1. 在 Edge 加载固定 `dist_chrome`，打开短对话：官方 Navigator 应正常出现。
2. 打开之前无 Navigator 的真实长对话。不滚动页面，保持 idle；预期 Yada 自动准备历史后官方 Navigator 出现，随后休眠。
3. 右侧只能有 ChatGPT 官方 Navigator；无 Yada Rail、绿色点或第二套刻度。
4. 自动准备期间正文不能自行明显上下跳。
5. 依次点第一轮、中间轮、最后一轮，以及最后 → 第一 → 中间 → 最后。
6. 准备期间滚轮/点击/按键：Yada 立即让权；停止操作、idle 后，在 recovery budget 内自动继续。

额度：

1. 顶栏显示 20px 三环；首次同步中明确显示“正在首次同步最近 7 天 ChatGPT 历史…”。
2. 同步完成后显示本地“预计剩余”。
3. 点击三环应出现约 312px 的精简详情卡，不得被 Header 裁成白条。
4. Escape、外部点击、route change 均可关闭详情。
5. 完整同步后立即 reload，不应再次进入“正在补齐”，数字继续显示。
6. 保持页面打开超过 10 分钟，旧额度持续显示，后台静默校准；hidden 不启动新的完整扫描，已开始的扫描可完成。
7. 刷新失败不隐藏预计剩余；显示上次完整同步时间与最近失败提示。手动刷新忽略 10 分钟 TTL。

提示词：

1. 未点击前不创建提示词面板。
2. 旧 v1 升级后首次视觉顺序保持；拖动 header 六点手柄排序，正文仍可选中。
3. 关闭/重新打开面板、刷新 ChatGPT、重开浏览器后顺序保持。
4. 编辑不改变排序；新增放顶部；删除保留其余顺序；复制不影响顺序。

复制全部：

1. 复制当前活动分支 Markdown 与真实时间戳仍正常。

验收前不要生成正式 `ChatGPT-Yada-v4.0.3-dist_chrome.zip`。
