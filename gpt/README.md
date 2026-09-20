# ChatGPT Yada

ChatGPT Yada 4.0.1 是一个轻量 Chrome MV3 扩展。它通过补齐 ChatGPT 自己的历史加载，恢复并保留官方长对话 Prompt Navigator，同时不移动读者的当前位置。

Yada 不再绘制右侧导航条，也没有导航预览、绿色模式点或代理跳转。页面工具栏只有：`Pro 额度三环 | 复制全部 | 提示词`。

## 功能

- **官方导航恢复**：MAIN-world hook 只观察当前对话的历史 GET；首批 `num_turns` 至少为 100，后续只临时暴露 ChatGPT 自己的 pagination sentinel。Yada 不滚动、不 reload、不生成 fallback 导航。
- **阅读位置保护**：保存可见消息身份和 viewport offset；漂移超过 8px、用户操作、streaming、隐藏页面或布局变化都会立即停止本轮 hydration。
- **复制全部**：导出当前活动分支 Markdown 和真实时间戳。
- **提示词**：本地收藏、编辑、删除与复制；支持本地拖拽排序，顺序自动保存。新增放顶部，编辑不改变顺序。
- **Pro 额度**：首次同步最近 7 天历史；此后当前聊天实时记账，每 10 分钟仅在数据变旧时后台校准。后台刷新不会清空已有额度。沿用 Vibe Bar 规则与 `model_limits`，这是本地估算，不是 OpenAI 官方余额。
- **同一份额度数据**：页面三环、浏览器 Action 图标和 popup 都读取同一个 `QuotaSnapshot`。

message / messageId 深链保持原样，Yada 不介入 hydration。若完整历史加载后 ChatGPT 仍不提供官方 Navigator，Yada 会停止，不绘制替代品。

## 安装测试包

需要已登录 ChatGPT 的 Chrome 或 Edge。

1. 加载 `gpt/dist_chrome`，或解压 `ChatGPT-Yada-v4.0.1-official-only-UNVERIFIED.zip` 后加载其中的 `dist_chrome`。
2. 刷新 ChatGPT 标签页。

该包是手工验收包，不是正式 Release。Mac mini 不执行产品测试；MacBook Edge 与真实 100～200 轮对话的验收状态见 `QA.md`。

## 隐私与边界

MAIN-world bridge 只传递 conversation id、消息 id、角色、cursor 和必要拓扑统计，不传正文。`chrome.storage.local` 只保存提示词、额度事件元数据和额度历史缓存；不保存提问/回复正文、Cookie、Token、Authorization 或完整 API payload。不接入外部服务。

## 本地工程验证

```bash
npm ci
npm test
npm run build
npm run verify:gate
git diff --check
npm run package
```

旧 4.0.0 测试包保留，新的 4.0.1 包不覆盖旧包。打包会检查 package、lockfile、两份 manifest 与 ZIP 版本一致。

不运行 Mac mini 浏览器验收、GitHub Actions、PR 或 Release。

## 许可证

`gpt/` 使用 AGPL-3.0-only。额度核心移植自 Vibe Bar；AI-MarkDone 的少量官方 Navigator DOM 识别结构按 MIT 合规复用。GPT Navigator Helper 仅作为无许可证的行为参考，没有复制源码。详见 `NOTICE.md` 与 `THIRD_PARTY_NOTICES.md`。
