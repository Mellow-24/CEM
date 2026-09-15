# @deepseek-ai/dsh-speech-synthesis

[English](README.md) | 中文

流式语音合成的 Service Definition。`ctx.speechSynthesis` 拥有感知 scope 的提供方注册、profile 选择、文本与输出字节准入、取消、媒体元数据校验以及有序 `Uint8Array` 交付。

## Service API

| 成员 | 语义 |
|---|---|
| `registerProvider(provider)` | 在调用 Context 的全局或精确 scope 层中注册 `provider.profile`，并返回其 effect disposer。 |
| `profile(agent, profile?)` | 返回可见的 `mediaType`、`maxInputChars` 和 `maxOutputBytes`；省略时要求可见 profile 恰好为一个。 |
| `resolve(agent, profile?)` | 返回 profile 元数据，以及绑定注册的 `synthesize(input, signal)` 操作。 |

限定 preset scope 的注册仅对 scope 链继承该 preset 的 Agent 可见。解析需要精确 live Agent，以及可用且无歧义的 profile。

runtime 在提供方设置前拒绝空文本或超限文本。它在返回流之前校验响应元数据，在消费期间检查每个 chunk，并在交付超过所配完整输出上限的字节前以 `AUDIO_TOO_LARGE` 停止。Consumer 必须持续消费或用所给 signal 取消；该流是仅可单次消费的借用提供方输出。

`SpeechSynthesisInput` 包含文本及可选的 BCP 47 回复语言。Consumer 从授权对话日志确定语言，提供方映射其支持的音色与语言参数。

## Model Experience

None, as 合成仅向人类渲染 Consumer 获准的 assistant 文本，从不改变模型输入或输出。

#### KV Cache effect

无；合成读取获准文本，不会改变 Session 历史。

## Known Limitations and Deferred Work

- **每次操作一个编码流** — profile 承诺一种固定媒体类型；格式协商需要独立 profile；语言音色映射由提供方配置。
- **没有持久音频产物** — chunk 是临时的，也没有 Session event 允许刷新后重放。
