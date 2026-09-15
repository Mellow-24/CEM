# @deepseek-ai/dsh-client-ui-response-language

[English](README.md) | 中文

为 agent 预设提供 [`@deepseek-ai/dsh-response-language`](../../context/response-language/README.md) 的会话渲染回复语言选择器。浏览器端占用现有会话作用域 `conversation.input.right` 列表 slot，位置紧邻发送时控件之前；Node 端是空的 roster plugin。

组件读取 Host 计算的 `responseLanguage` projection。Projection 缺失或 `available: false` 时不渲染，因此挂载一个客服预设不会在无关会话中暴露选择器。触发器显示持久 `currentValue`；Auto 最近检测到的语言永远不会取代 `Auto` 标签。固定语言使用自称，Auto 跟随 Web UI locale。

选择菜单项会通过 Commands Remote 执行 `/response-language <value>`。控件会把待处理选择限制为单次调用，在推送 projection 确认前保持禁用；命令或传输失败时恢复投影值，并显示本地化 Toast。会话已移除或 composer 处于提交阶段时，菜单会关闭并禁用。

## Model Experience

选择器通过 `/response-language` 命令间接影响模型：[ `@deepseek-ai/dsh-response-language`](../../context/response-language/README.md) 拥有持久事件和模型可见策略，本 package 只渲染 Host 状态并发送用户也可直接输入的内容。

#### KV Cache effect

选择器本身不增加模型 token。成功变更可能在下一次请求中改变 Host package 的策略 section；打开、关闭菜单或失败不会影响请求。

## Known Limitations and Deferred Work

- **仅默认 composer** — 待处理的完整 composer 交互会暂时替换 InputBar 及其语言控件。
- **没有账户级默认值** — 首个偏好使用预设的 `auto`；本阶段不提供面向未来会话的 General 设置行。
