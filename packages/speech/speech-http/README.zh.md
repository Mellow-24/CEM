# @deepseek-ai/dsh-speech-http

[English](README.md) | 中文

[`ctx.speechTranscription`](../speech-transcription/README.md) 和 [`ctx.speechSynthesis`](../speech-synthesis/README.md) 的可选 HTTP Service Provider。缺少 `transcription` 或 `synthesis` config section 时，不会为该能力注册提供方。

## HTTP contracts

转写提供方用录音的基础 `Content-Type` POST 已准入录音字节，并接受成功的 `application/json` 对象 `{ "text": string, "language"?: string }`。它在 fatal UTF-8 解码和 JSON 解析前限制编码响应字节。合成提供方 POST 包含所配文本字段和非机密静态 body 字段的 JSON，并要求成功的流式 body，其基础 `Content-Type` 等于 profile 配置的 `mediaType`。

两项操作都使用 `redirect: 'error'`，因此携带凭据的请求绝不会跟随 endpoint redirect。`apiKeyEnv` 是一个 credential reference，在每次请求前立即通过 `ctx.credentials` 解析；该值只会进入所配 header，且从不被接受为字面 plugin config。引用值缺失时会拒绝该操作。每个 endpoint 必需的 `timeoutMs` 与调用方 signal 组合，因此设置和流式读取不会无限等待。

## Config

| Section/key | 启用时必需 | 含义 |
|---|---|---|
| `transcription.profile`, `synthesis.profile` | 是 | Scope-local 注册名称。 |
| `transcription.url`, `synthesis.url` | 是 | 不含内嵌凭据的绝对 HTTP(S) 操作 URL。 |
| `apiKeyEnv` | 否 | Credential reference；省略时允许不需要 key 的 endpoint。 |
| `apiKeyHeader`, `apiKeyPrefix` | 否 | 凭据 header 和前缀；默认为 `authorization` 和 `Bearer `。 |
| `timeoutMs` | 是 | Node timer 范围内的正 provider request deadline。 |
| `transcription.mediaTypes` | 是 | 接受的录音基础媒体类型。 |
| `transcription.maxBytes`, `maxTranscriptChars` | 是 | 完整录音和返回转写上限。 |
| `transcription.maxResponseBytes` | 是 | 在 UTF-8 解码和解析前强制的编码 endpoint JSON 上限。 |
| `synthesis.mediaType` | 是 | 所需响应基础媒体类型。响应缺失 `Content-Type` 会失败。 |
| `synthesis.maxInputChars`, `maxOutputBytes` | 是 | 完整文本和编码流上限。 |
| `synthesis.textField` | 否 | JSON 文本字段；默认为 `text`。 |
| `synthesis.body` | 否 | 静态非机密字符串、数字或布尔字段；它不得定义 `textField`。 |

## Qwen ASR

设置 `transcription.protocol: qwen-asr` 和非空的 `transcription.model`（如 `qwen3-asr-flash`），即可使用 Qwen 的 chat-completions ASR 接口。提供方将完整录音编码为 Base64 data URL，放入 `input_audio`，设置 `stream: false` 并开启逆文本归一化。响应必须包含以 `stop` 完成且 `message.content` 为字符串的选择项；部分或格式错误的结果会失败。凭据、取消和 JSON 响应大小限制保持相同。省略 `protocol` 时使用 `raw`。

使用 Qwen3-ASR-Flash 时，完整 Base64 请求须小于服务的 10 MB 限制；澳门客服预设将原始录音限制为 6 MiB。配置的浏览器格式为 WebM、Ogg 和 WAV。参见 [Qwen ASR 官方参考](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference)。

## Qwen 流式识别

可选 `transcription.realtime` 在完整录音识别之外注册 Qwen WebSocket 识别。配置 `url`、`model`、服务端 VAD 的 `silenceMs` 与 `threshold`、`maxDurationMs` 和 `maxBufferedBytes`。凭据保留在 Host。建立连接使用端点超时；响应与转写限制适用于每条事件。收到 `session.updated` 后才视为就绪；取消会关闭连接，畸形事件或队列超限会终止通话。

## Model Experience

None, as 这些提供方把语音服务操作转换为 HTTP，从不组装或修改模型请求。

#### KV Cache effect

无；转写保持为 Consumer 拥有的草稿，合成则读取已提交文本。

## Known Limitations and Deferred Work

- **每项操作一种规范化协议** — 除显式 raw 与 Qwen ASR 协议之外的 endpoint，包括 multipart 转写、WebSocket 流或非 JSON 合成请求 需要同级提供方包或显式协议扩展。
- **没有自动重试** — HTTP、传输或超时失败会结束该操作；部署策略拥有对其 endpoint 安全的任何重试。
