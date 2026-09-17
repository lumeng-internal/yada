# ChatGPT Yada v2.2.0

本轮按 Owner 指定以 MINOR 发布：官方会话骨架替换导航架构，并将提示词库改为纯图标复制管理。范围仅 gpt/，基线 a4bc0c56908df1e2643e1adb76c897f119891df2。

## 实现结果

- 官方骨架决定导航轮数、顺序、当前轮和目标位置；API 仅补充预览正文与时间，复制全部和完整会话读取保留原实现。API 等待或失败不影响骨架导航。
- 官方按钮原生 click 优先；否则按 turnContainerId 重新查询并滚动。长距离直接跳、短距离 rAF 缓动，200/600/1200/2000ms 校正，用户输入/路由切换取消。删除 React 私有对象扫描、virtualizer bridge、构建脚本和公开资源。
- 全页面官方 TOC 检测和独立即时 Observer；可见时隐藏、清预览、取消跳转，消失后复用同一 host/marks layer。结构未变时保留刻度节点。
- Harson / ChatGPT 为绿色粗体，各自 2/5 行预览；轮次右侧为 User 自己的本地时间，缺失不伪造。
- 独立 body Shadow DOM 提示词面板；无搜索/底部统计，卡片仅 SVG 复制/编辑/删除控件。完整正文复制后保持打开、短暂对勾；删除 composer 插入模块。v1 存储与原 ID/createdAt 保留；面板自然高度，长列表独立滚动。
- 移植来源和 MIT 许可已按实际生产代码更新；不复制上游其他文件。

## 本地验证与发布记录

2026-09-17：verify:copy、verify:features（13 组浏览器验收）、严格 TypeScript/生产构建及 diff 检查通过。五处版本为 2.2.0，ZIP/dist 三个文件逐字节一致，MIT 声明随包附带；详细清单见 TEST_CHECKLIST。测试模拟 API/storage，DOM 使用官方骨架结构，不构造 React 私有对象。MacBook 真实页面仍需复验，未标记为通过。

固定命令：`npm run verify:copy`、`npm run verify:features`、`npm run build`、`git diff --check`。产物：`dist_chrome/`、`ChatGPT-Yada-v2.2.0-dist_chrome.zip`，发布时核对五处版本和 ZIP/dist 逐文件一致。

按本轮明确授权创建单个提交 `feat(gpt): replace navigation with official conversation skeleton`，fetch/rebase 后普通 push main；最终 SHA 以 Git main 和本任务交付记录为准。无 PR、force push 或远端工作流调用。

HOSTED_CI = DISABLED_BY_OWNER_NO_QUOTA（NOT_USED_BY_POLICY），不是 PASS。Claude/Gemini 保持基线不变。

ZIP SHA-256：`6e8618244c2e8c1ad31467e5009757fe08215b5b7b3548b364453425e1c4c67b`。
