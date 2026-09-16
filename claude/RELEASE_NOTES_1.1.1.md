# Claude Yada 1.1.1

## Changed

- 将当前活动对话的 Token 估算移动到 Claude 顶部操作栏、Copy 控件之前。
- 顶部操作栏暂时不可用时，复用同一个 Counter 元素回退到输入框 Usage 行。
- 增加 Header 重建、单实例和窄窗口响应式保护。

## Unchanged

- Token 提取、`o200k_base` Tokenizer、缓存和 Conversation API 数据流保持不变。
- API-first Copy All、5 小时额度和周额度保持不变。
