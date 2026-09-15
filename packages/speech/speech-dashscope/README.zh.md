# `@deepseek-ai/dsh-speech-dashscope`

[English](README.md) | 中文

[`ctx.speechSynthesis`](../speech-synthesis/README.md) 的 DashScope Qwen-Audio-TTS HTTP SSE（Server-Sent Events）Service Provider。它在挂载预设的 scope 中注册一个 profile，因此语音 runtime 继续拥有 Agent 授权、文本准入、已解码输出上限与提供方选择。

## HTTP SSE 协议

提供方使用 DashScope 的嵌套 `model` 与 `input` 字段发送一份完整文本请求，在每项操作前即时解析已配置的凭据引用，设置 `X-DashScope-SSE: enable`，并拒绝重定向。它只接受成功的 `text/event-stream` 响应。`sentence-synthesis` 事件按到达顺序贡献严格、规范的 Base64 音频分片；只有先收到音频，再收到终止 `finish_reason: "stop"` 事件，响应才成功。提供方错误字段、畸形事件、被截断的最终事件以及缺少 `stop` 的 EOF 都会失败，且不暴露响应正文。

增量解析执行严格 UTF-8 解码，并同时限制完整编码响应和一个正在等待空行分隔符的事件。已解码音频在分配前按提供方剩余限额检查，并由语音 runtime 再检查一次。调用方信号与已配置超时覆盖凭据查找、请求设置与响应消费。

默认端点是 DashScope 仍支持的北京旧端点。部署使用业务空间专属 HTTPS URL 时，可设置 `endpoint`；回放测试与本地适配器可使用 loopback HTTP。参见[官方 HTTP API 参考](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api)。

## Config

| 配置键 | 必需 | 含义 |
|---|---|---|
| `profile` | 是 | scope 内的合成 profile 名。 |
| `model` | 是 | Qwen-Audio-TTS 模型 id。 |
| `voice` | 是 | DashScope 系统、复刻或设计音色 id。 |
| `format` | 是 | `mp3`、`wav` 或 `opus`；提供方派生 `audio/mpeg`、`audio/wav` 或 `audio/ogg`。 |
| `maxResponseBytes`, `maxEventBytes` | 是 | 完整编码 SSE 与待完成事件字节上限。 |
| `endpoint` | 否 | HTTPS 操作 URL，本地适配器也可使用 loopback HTTP；默认为北京旧 SpeechSynthesizer 端点。 |
| `apiKeyEnv` | 否 | 凭据引用；默认为 `DASHSCOPE_API_KEY`。 |
| `timeoutMs` | 否 | 设置与流超时；默认为 120000。 |
| `maxInputChars`, `maxOutputBytes` | 否 | profile 文本和已解码音频上限；默认为 4000 与 20 MiB。 |
| `sampleRate` | 否 | 一个提供方支持的采样率：8000、16000、22050、24000、44100 或 48000 Hz。 |
| `volume` | 否 | 0 至 100 的整数。 |
| `rate`, `pitch` | 否 | 0.5 至 2.0 的提供方控制值。 |
| `languageHints` | 否 | 存在时恰好一个提供方支持的语言代码。 |
| `instruction` | 否 | 非空的方言、情感或表达指令。 |
| `enableAigcTag` | 否 | DashScope 是否嵌入它支持的生成内容标记。 |

`protocol: qwen-tts` 使用 Qwen3-TTS 的多模态生成地址，读取 SSE 中的 24 kHz 单声道 PCM16，添加 WAV 头后逐块播放，不下载完整音频 URL。此协议要求显式 `endpoint`、`format: wav`、`sampleRate: 24000` 和不超过 600 的 `maxInputChars`。`defaultLanguage` 指定缺省 BCP 47 语言，`voiceByLanguage` 按主要语言代码选择音色；粤语由粤语音色表达，Qwen 的语言参数仍为 `Chinese`。不支持 SpeechSynthesizer 专用的语速、音高、指令或标签配置。参见 [Qwen-TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)。

## Model Experience

None, as 该提供方把获准文本转换为 DashScope 合成请求，且绝不改变模型上下文。

#### KV Cache effect

无；合成发生在 assistant 消息提交之后，不发起 LLM 请求。

## Known Limitations and Deferred Work

- **完整文本 HTTP 输入** — 每个请求接收一句获准文本或一条消息；WebSocket 连接复用不在此协议中。
- **浏览器编码格式** — 提供方暴露 MP3、WAV 与 Opus。Qwen-TTS 的 PCM 包装为 WAV 后供浏览器播放。
- **不自动重试** — 任何 HTTP、提供方、超时或流失败都会结束操作；另一次请求可能产生费用，因此重试由部署策略拥有。
