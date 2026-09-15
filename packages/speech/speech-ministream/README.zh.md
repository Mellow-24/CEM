# `@deepseek-ai/dsh-speech-ministream`

[English](README.md) | 中文

感知凭据的 MiniStream WebSocket [`ctx.speechSynthesis`](../speech-synthesis/README.md) Service Provider。它注册一个 scope 局部 profile，并把每个已接纳句子转换成一次 `preset_voice` 操作。二进制 MP3 帧到达后立即向下游传递，因此浏览器可以在合成完成前开始播放。

提供方把解析后的凭据放在服务端 `Authorization` 请求头中，端点 URL 不携带 token。每次操作使用新的不透明 client id 和 request id，要求二进制音频之前存在 `start`，至少收到一个音频帧后才能 `end`，并拒绝无关或格式错误的事件。调用方 signal 和 `timeoutMs` 会终止连接；收到 `start` 后仍未输出音频的生成会在 `firstAudioTimeoutMs` 到期时失败。提供方返回 429 容量状态时会报告 `PROVIDER_BUSY`。`maxEventBytes` 限制单个 WebSocket 帧，`maxOutputBytes` 限制已接收和排队的音频总量。

## Config

| 键 | 必填 | 含义 |
|---|---|---|
| `profile` | 是 | scope 局部合成 profile 名称。 |
| `endpoint` | 是 | 只包含一个 `{client_id}` 占位符的 WSS URL；测试可使用 loopback WS。 |
| `apiKeyEnv` | 否 | 凭据引用；默认为 `MINISTREAM_TTS_TOKEN`。 |
| `defaultLanguage`、`voicePresetKey` | 是 | 默认 BCP 47 语言和提供方预置音色。 |
| `voicePresetByLanguage` | 否 | 以主要 BCP 47 语言为键的预置音色覆盖。 |
| `generationMode` | 是 | 必须为 `preset_voice`。 |
| `maxGenerateLength`、`normalize` | 是 | 提供方生成与文本规范化参数。 |
| `timeoutMs` | 是 | 连接和完整流式响应的时限。 |
| `firstAudioTimeoutMs` | 是 | 等待首个非空 MP3 音频帧的时限。 |
| `maxInputChars`、`maxOutputBytes`、`maxEventBytes` | 是 | 输入、完整音频和单帧大小限制。 |
| `tlsRejectUnauthorized` | 否 | TLS 证书校验；默认为 `true`。 |

提供方发送 `buffer=off`，因为语音通话已经按顺序接纳完整句子。它公布 48 kHz 单声道 MP3，与 MiniStream 流式协议一致。

## Model Experience

无，因为提供方只把已提交文本转换为 MiniStream 合成请求，不修改模型上下文。

#### KV Cache effect

无；语音合成不发起 LLM 请求。

## Known Limitations and Deferred Work

- **每句一个连接** — 有序逐句播报为每个已接纳句子打开新的提供方连接；持久连接复用需要定义跨 HTTP 请求的所有权和清理策略。
- **仅预置音色** — 本提供方不支持随机音色或上传参考音频的生成模式。
- **不自动重试** — 传输、提供方、超时或格式错误会结束操作，因为重试可能重复产生计费音频。
