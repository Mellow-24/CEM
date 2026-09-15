# 语音

[English](speech.md) | 中文

语音是在持久文本对话周围拆开的两项可选能力 seam。[`@deepseek-ai/dsh-speech-transcription`](../../packages/speech/speech-transcription) 把一份完整录音转换成最终 transcript（文本记录）。[`@deepseek-ai/dsh-speech-synthesis`](../../packages/speech/speech-synthesis) 把获准文本转换成有界编码音频流。提供方注册在 agent 预设的作用域内，因此 Host 解析会执行哪个 Agent 可以使用某个 profile；两项能力都不是 LLM 内容模态，也不属于 agent loop（智能体循环）。

源码：[`packages/speech/speech-transcription/src/types.ts`](../../packages/speech/speech-transcription/src/types.ts)、[`packages/speech/speech-synthesis/src/types.ts`](../../packages/speech/speech-synthesis/src/types.ts)

## 转写

`SpeechTranscriptionInput` 携带编码字节与规范化的基础媒体类型。`SpeechTranscriptionProfile` 公布作用域内 profile id、接受的媒体类型、完整录音字节上限与最终 transcript 字符上限。`SpeechTranscriptionProvider` 拥有解码与识别；`ResolvedSpeechTranscription` 闭包捕获所选注册，并在调用前重新执行准入。空 transcript 文本合法，表示没有识别到语音。

完整录音使用 `transcribe`；连续识别使用独立的可选 `openRealtime` 操作。

## 合成

`SpeechSynthesisProfile` 公布作用域内 profile id、承诺的输出媒体类型与输入／输出上限。提供方返回 `SpeechSynthesisOutput`：已校验的 `SpeechAudioMetadata` 与单消费方 `AsyncIterable<Uint8Array>`。运行时拒绝空文本、校验元数据、传递取消、限制发出的聚合字节，并拒绝空流。

Consumer 提供获准文本。Web Consumer 的手动播放提取已提交 assistant 消息的文本；通话通过坐标与前缀哈希校验日志中的实时句子，在生成结束前开始播报。推理块与工具块绝不进入合成。

`SpeechSynthesisInput.language` 携带 Consumer 从该轮日志确定的 BCP 47 回复语言；提供方映射语言和音色。Qwen-TTS 的 PCM 输出以 WAV 流交给浏览器，且不下载完整音频文件。

## 作用域与选择

两个注册表都使用调用插件上下文的作用域层。解析要求 `ctx.agents` 注册的精确实时 Agent，合并 Agent 到预设再到全局的作用域链，并选择显式 profile，或要求恰好只有一个可见提供方。重复 profile id 在注册时失败。不可用或有歧义的 profile 会在任何提供方 I/O 前失败。

可选 [`speech-http`](../../packages/speech/speech-http) Service Provider 在每项操作中解析凭据引用。可选 [`speech-dashscope`](../../packages/speech/speech-dashscope) Service Provider 把 DashScope 的嵌套请求与有界 SSE（Server-Sent Events）音频事件映射到合成能力。可选 [`speech-ministream`](../../packages/speech/speech-ministream) Service Provider 校验 MiniStream WebSocket 生命周期事件并转发有界 MP3 音频帧。[`speech-web`](../../packages/speech/speech-web) Consumer 通过 Connection 的 raw Fetch 注册表暴露经过访问地址检查的 profile、完整录音上传与渐进合成路由。浏览器 UI 让录音保持临时，只把最终 transcript 通过普通输入框发送，并把合成音频作为派生展示播放。

连续通话使用已解析转写注册上的可选 `openRealtime(event, signal)`。`SpeechRealtimeInput` 接收单声道 16 kHz PCM16 并异步关闭；`SpeechRealtimeEvent` 报告开口、临时文字、最终文字或错误。[语音 UI](../../packages/client/ui-voice/README.md)打开全屏通话，播放预加载的固定欢迎语，不产生模型请求，在播报时持续收音，并结合持续时间、信息内容、句式、短附和结构及与当前回答的相似度筛选识别文字，再决定是否取消正在播报的回答。已接受的最终转写通过普通 Session 提交；临时字幕、被忽略的附和及原始音频不持久化。[Web Consumer](../../packages/speech/speech-web/README.md)负责授权、公布浏览器策略，以及有大小限制且按顺序发送的 PCM 传输。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspeechsynthesis--speechsynthesisruntime"></a>

### `ctx.speechSynthesis` — `SpeechSynthesisRuntime`

Scoped synthesis provider registry and streaming runtime.

```ts cordis-catalog
/**
 * Register a provider in the calling context's scope layer.
 * @param provider - borrowed provider and its public profile metadata.
 * @returns exact effect disposer removing this registration.
 */
registerProvider(provider: SpeechSynthesisProvider): () => void

/**
 * Resolve one profile visible to an exact live agent.
 * @param agent - exact live agent whose scope chain supplies permission.
 * @param profile - explicit profile, or omission when exactly one is visible.
 * @returns registration-bound operation and detached profile metadata.
 */
resolve(agent: Agent, profile?: string): ResolvedSpeechSynthesis

/**
 * Read public metadata for one profile visible to an exact live agent.
 * @param agent - exact live agent whose scope chain supplies permission.
 * @param profile - explicit profile, or omission when exactly one is visible.
 * @returns detached immutable profile metadata.
 */
profile(agent: Agent, profile?: string): SpeechSynthesisProfile
```

Types: [Agent](core.md)

Source: [`packages/speech/speech-synthesis/src/index.ts:62`](../../packages/speech/speech-synthesis/src/index.ts)

<a id="ctxspeechtranscription--speechtranscriptionruntime"></a>

### `ctx.speechTranscription` — `SpeechTranscriptionRuntime`

Scoped transcription provider registry and execution runtime.

```ts cordis-catalog
/**
 * Register a provider in the calling context's scope layer.
 * @param provider - borrowed provider and its public profile metadata.
 * @returns exact effect disposer removing this registration.
 */
registerProvider(provider: SpeechTranscriptionProvider): () => void

/**
 * Resolve one profile visible to an exact live agent.
 * @param agent - exact live agent whose scope chain supplies permission.
 * @param profile - explicit profile, or omission when exactly one is visible.
 * @returns registration-bound operation and detached profile metadata.
 */
resolve(agent: Agent, profile?: string): ResolvedSpeechTranscription

/**
 * Read public metadata for one profile visible to an exact live agent.
 * @param agent - exact live agent whose scope chain supplies permission.
 * @param profile - explicit profile, or omission when exactly one is visible.
 * @returns detached immutable profile metadata.
 */
profile(agent: Agent, profile?: string): SpeechTranscriptionProfile
```

Types: [Agent](core.md)

Source: [`packages/speech/speech-transcription/src/index.ts:62`](../../packages/speech/speech-transcription/src/index.ts)
<!-- END GENERATED cordis-surface -->
