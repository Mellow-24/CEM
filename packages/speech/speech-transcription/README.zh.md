# @deepseek-ai/dsh-speech-transcription

[English](README.md) | 中文

完整录音与流式语音转写的 Service Definition。`ctx.speechTranscription` 拥有感知 scope 的提供方注册、profile 选择、录音准入、取消与最终转写校验；提供方拥有解码和语音识别，Consumer 决定返回文本是保留为草稿还是成为用户输入。

## Service API

| 成员 | 语义 |
|---|---|
| `registerProvider(provider)` | 在调用 Context 的全局或精确 scope 层中注册 `provider.profile`，并返回其 effect disposer。同一层内重名会失败。 |
| `profile(agent, profile?)` | 返回沿精确 live Agent scope 链可见的 profile 脱离限额。只有可见 profile 恰好为一个时才可省略。 |
| `resolve(agent, profile?)` | 返回同一公开 profile，以及绑定注册的 `transcribe(input, signal)` 操作。 |

由 preset 挂载的提供方属于该 standing scope。加入其下的 Agent 继承该 profile；无关 Agent 不可见。更近的 scope 可遮蔽同名全局 profile。解析会拒绝过期 Agent 实例、不可用的显式 profile 以及有歧义的隐式选择。

每个 profile 声明接受的基础音频媒体类型、`maxBytes` 和 `maxTranscriptChars`。runtime 在执行提供方之前拒绝空录音、超限录音与不支持的媒体类型，传递必需的 `AbortSignal`，然后在返回前拒绝格式错误或超限的提供方转写。

提供方可额外暴露 `openRealtime(event, signal)`。就绪后的输入接收单声道 16 kHz PCM16，并提供异步关闭操作。事件区分开口、可替换的临时文字、最终转写和终止错误。仅具有该操作的注册公布 `realtime: true`；提供方验证线上事件并管理传输限制。

## Model Experience

None, as 此服务把转写文本返回给 Consumer，从不将其插入模型请求。

#### KV Cache effect

无；通过 Agent inbox 提交已接受文本的 Consumer 拥有后续仅追加的用户消息影响。

## Known Limitations and Deferred Work

- **不保留音频** — 此服务既不存储录音字节，也不添加音频 content block 或 Session event。
