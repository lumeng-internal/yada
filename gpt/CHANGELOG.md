# Changelog

## v4.0.0 - 2026-09-18

- 版本类型：MAJOR
- 变更说明：从 3.0.1 干净基线重建。Yada 自己拥有完整长对话导航；ConversationRepository 成为唯一数据源；新增本地 Pro 额度账本、三环图标和 popup。网页顶部工具栏内嵌 Pro 额度三环，与浏览器 Action 三环共用同一 QuotaSnapshot。3.1.1 native bootstrap 路线被真实 100+ 对话否决，不再进入本版本。
- 构建产物：ChatGPT-Yada-v4.0.0-dist_chrome.zip

## v3.0.1 - 2026-09-17

- 版本类型：PATCH
- 变更说明：同一对话继续新增消息后刷新官方导航预览数据；请求合并防抖，失败后仅在悬停未映射刻度时重试。
- 构建产物：ChatGPT-Yada-v3.0.1-dist_chrome.zip

## v3.0.0 - 2026-09-17

- 版本类型：MAJOR
- 变更说明：把对话跳转交给 ChatGPT 官方导航，Yada 只保留复制、时间戳、提示词和官方导航悬停预览。
- 构建产物：ChatGPT-Yada-v3.0.0-dist_chrome.zip
