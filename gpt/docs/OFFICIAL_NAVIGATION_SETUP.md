# 官方导航安装说明

3.0.1 已补上同一对话继续新增消息后的预览刷新。正式进入 main 前，仍需 MacBook 使用 GPT Navigator Helper 原版完成真实长对话验收。

ChatGPT Yada 3.0 不再维护第二套跳转系统。完整轮次跳转、页面滚动和最终定位由 ChatGPT 官方导航负责。刷新后能否出现完整官方导航，由 ChatGPT 页面和单独安装的 GPT Navigator Helper 决定。

GPT Navigator Helper 独立安装，没有被打包进 Yada。Yada 没有复制它的源码、字体或资源。需要 Chrome / Edge 152 或更高。

## Yada 负责

- 复制全部
- 真实时间戳
- 提示词库
- 官方导航悬停预览，包括同一对话继续新增消息后的预览数据刷新

没有安装 GPT Navigator Helper 时，复制、时间戳和提示词仍须正常。只是官方导航出现前没有导航预览。

## GPT Navigator Helper 负责

- 页面刷新后自动加载更早记录
- 帮助 ChatGPT 官方导航完整出现
- 不创建第二条导航

首选安装方式是 Chrome 应用商店：

https://chromewebstore.google.com/detail/gpt-navigator-helper/bpbajpcoifjncefjgbnnafkcgmjdcdli

源码和问题反馈入口：

https://github.com/sssstf0rest/GPT-Navigator-Helper

该仓库目前没有明确源码许可证。只安装原版扩展，不要把它的源码拷进 Yada。

## MacBook 安装步骤

1. 安装或更新 ChatGPT Yada 3.0.1。需要 Chrome / Edge 152 或更高。
2. 从 Chrome 应用商店单独安装原版 GPT Navigator Helper。
3. 禁用其他 ChatGPT 时间线或导航插件。
4. 打开长对话后停在底部直接刷新。
5. 不要手动往上滚，等待辅助插件加载更早记录。
6. 官方导航出现后，直接点击官方刻度跳转。
7. 鼠标放在官方刻度上时，由 Yada 显示 Harson / ChatGPT / 时间预览。
8. 同一对话继续发送新消息后，再悬停新增刻度，确认预览已更新到新轮次。

## 18 轮真实验收

1. 打开一篇约 18 轮的真实对话，停在底部刷新。
2. 等待官方导航出现。不要用 Yada 寻找第二条导航。
3. 点击官方刻度，确认 ChatGPT 自己完成跳转。
4. 灰色圆点只预览 Harson；绿色圆点预览 Harson + ChatGPT。
5. 复制全部应包含完整活动分支、附件占位和逐条真实时间。
6. 提示词新增、编辑、删除、SVG 复制仍可用。
7. 在同一对话再发送一轮，不刷新页面，悬停新增官方刻度应出现「第 19 轮」预览。

## 100+ 轮真实验收

1. 打开一篇 100 轮以上的真实对话，停在底部刷新。
2. 等待 GPT Navigator Helper 加载更早记录，直到官方导航完整出现。
3. 点击靠前和靠后的官方刻度，确认跳转仍由官方导航完成。
4. 悬停官方刻度时，Yada 只显示对应轮次预览，不滚动页面、不点击按钮。
5. 两条提问正文相同时，预览仍应按官方按钮序号区分，不能串到另一轮。
6. 官方导航尚未出现时，页面不应报错，也不应出现 Yada 自己的导航条。
7. 同一对话继续新增消息后，新刻度悬停预览应更新；已能映射的旧刻度不应反复请求。
