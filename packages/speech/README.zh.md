# speech/：语音能力家族

[English](README.md) | 中文

本家族提供感知 scope 的完整录音转写和流式合成能力、可选 HTTP 和 WebSocket 提供方，以及仅 loopback Web Consumer。

| 包 | 职责 | ctx key |
|---|---|---|
| [`speech-transcription/`](speech-transcription/README.md) | 最终转写和 profile 权限的 Service Definition | `ctx.speechTranscription` |
| [`speech-synthesis/`](speech-synthesis/README.md) | 有界流式合成和 profile 权限的 Service Definition | `ctx.speechSynthesis` |
| [`speech-http/`](speech-http/README.md) | 可选感知凭据的 HTTP Service Provider | 注册到两项语音服务 |
| [`speech-dashscope/`](speech-dashscope/README.md) | DashScope HTTP SSE 合成 Service Provider | 注册到 `ctx.speechSynthesis` |
| [`speech-ministream/`](speech-ministream/README.md) | MiniStream WebSocket 合成 Service Provider | 注册到 `ctx.speechSynthesis` |
| [`speech-web/`](speech-web/README.md) | 提供受信 profile、转写和合成 route 的 Host Consumer | 注册到 `ctx.connection.fetch` |

语音保持在 LLM message 和 stream vocabulary 之外：Consumer 通过普通 Agent inbox 提交已接受转写文本，合成则读取已提交 assistant 消息。
