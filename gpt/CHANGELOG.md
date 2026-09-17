# Changelog

## v3.0.0 - 2026-09-17

- 版本类型：MAJOR
- 变更说明：把对话跳转交给 ChatGPT 官方导航，Yada 只保留复制、时间戳、提示词和官方导航悬停预览。
- 构建产物：ChatGPT-Yada-v3.0.0-dist_chrome.zip

## v2.2.2 - 2026-09-17

- 版本类型：PATCH
- 变更说明：收紧原生历史分页事务、官方导航接管、会话级取消上限和刷新恢复。
- 构建产物：ChatGPT-Yada-v2.2.2-dist_chrome.zip

## v2.2.1 - 2026-09-17

- 版本类型：PATCH
- 变更说明：修复刷新后只显示局部骨架导航；完整 API 决定刻度，原生历史分页补齐未加载轮次。
- 构建产物：ChatGPT-Yada-v2.2.1-dist_chrome.zip

## v2.2.0 - 2026-09-17

- 版本类型：MINOR
- 变更说明：官方会话骨架导航替换；官方导航即时让位；Harson 与本地轮次时间预览；提示词 SVG icon-only 复制管理。
- 构建产物：ChatGPT-Yada-v2.2.0-dist_chrome.zip

## v2.1.1 - 2026-09-17

- 版本类型：PATCH
- 变更说明：修复绿色双区块预览；移植独立提示词弹窗、稳定虚拟列表跳转及官方导航自动避让
- 构建产物：ChatGPT-Yada-v2.1.1-dist_chrome.zip

## v2.1.0 - 2026-09-17

- 版本类型：MINOR
- 变更说明：新增真实消息时间戳、单宿主对话导航与本地提示词库；保留 API-first 完整活动分支复制。
- 构建产物：ChatGPT-Yada-v2.1.0-dist_chrome.zip

## v2.0.0 - 2026-08-17

- 版本类型：MAJOR
- 变更说明：收敛为仅复制全部的单一职责扩展，移除导航、选择复制、圆标预览切换及相关交互。
- 构建产物：ChatGPT-Yada-v2.0.0-dist_chrome.zip

## v1.1.7 - 2026-06-03

- 版本类型：PATCH
- 变更说明：exclude composer drafts from turns
- 修复 ChatGPT 底部 composer/input 草稿被 DOM fallback 误采集成 turn 的问题；草稿文字、未发送图片/文件预览不会生成 rail marker、hover preview、selected-copy 内容或 turn count。
- 新增 `conversationAudit` debug 字段，用于查看 raw DOM candidate、composer skip、final turn 和 composer leak warning。
- 构建产物：GPTyada-v1.1.7-dist_chrome.zip

## v1.1.6 - 2026-06-03

- 版本类型：PATCH
- 变更说明：fix single rail hover gradient
- 修正 v1.1.5 的 active-only / sparse-only 误解：默认 marker 保持同轴灰色可见，hover 在同一 `.marks` 层和同一 `.mark-bar` 上应用距离渐变。
- 构建产物：GPTyada-v1.1.6-dist_chrome.zip

## v1.1.5 - 2026-06-02

- 版本类型：PATCH
- 变更说明：reduce default rail visual noise
- 构建产物：ChatGPT-Yada-v1.1.5-dist_chrome.zip

## v1.1.4 - 2026-06-02

- 版本类型：PATCH
- 变更说明：fix activity panel duplicate rail
- 构建产物：ChatGPT-Yada-v1.1.4-dist_chrome.zip

## v1.1.3 - 2026-06-01

- 版本类型：PATCH
- 变更说明：fix rail visual layer overlap and separate lasso hit zone
- 构建产物：ChatGPT-Yada-v1.1.3-dist_chrome.zip

## v1.1.2 - 2026-05-21

- 版本类型：PATCH
- 变更说明：rail active 全局轮次映射与 lasso 起始区域修复。
- 构建产物：ChatGPT-Yada-v1.1.2-dist_chrome.zip

## v1.1.1 - 2026-05-20

- 版本类型：PATCH
- 变更说明：真实 Chrome 验收后的 rail jump / hit-test / lasso 可靠性修复。
- 构建产物：ChatGPT-Yada-v1.1.1-dist_chrome.zip

## v1.1.0 - 2026-05-20

- 版本类型：MINOR
- 变更说明：新增完整 release 自动化能力。
- 构建产物：ChatGPT-Yada-v1.1.0-dist_chrome.zip
