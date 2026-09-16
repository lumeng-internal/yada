# ChatGPT Yada v2.1.0

本次在 2.0.0 API-first 基线上增加独立消息真实时间戳、单宿主对话导航与本地提示词库。按 MINOR 发布到 2.1.0，保留 MV3 + Vite + TypeScript，无新增生产依赖。

复制仍从会话 API 的 current_node 回溯完整活动分支；消息时间使用 Unix 秒传递，Markdown 以浏览器本地时区输出。DOM 仅用于锚点与输入操作，不作为复制或总轮数的数据源。

导航按 API 生成全部刻度，观察真实内部滚动容器与主内容区；同一 host 处理布局变化。跳转有有限重试、取消、重扫、二次对齐和失败恢复，模糊匹配不冒充成功。摘要预览与模式偏好保持轻量。

提示词存储于 chrome.storage.local。面板只提供新增、搜索、编辑、删除和填入输入框，纯文本渲染，保留草稿及有效光标，不自动发送。

验证：复制脚本、10 组本机 Chrome fixture、严格 TypeScript 与生产构建。详细覆盖与真实登录页面尚未验证项见 TEST_CHECKLIST.md。未将模拟存储/API 测试表述为真实账号验收。

产物：dist_chrome/ 与 ChatGPT-Yada-v2.1.0-dist_chrome.zip。本地提交；不 push、不建 PR、不运行远程工作流。只修改 gpt/，Claude/Gemini 参考文件不变。
