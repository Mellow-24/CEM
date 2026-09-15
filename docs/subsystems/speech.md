# Speech

English | [中文](speech.zh.md)

Speech is two optional capability seams around the durable text conversation. [`@deepseek-ai/dsh-speech-transcription`](../../packages/speech/speech-transcription) turns one complete recording into a final transcript. [`@deepseek-ai/dsh-speech-synthesis`](../../packages/speech/speech-synthesis) turns admitted text into a bounded encoded audio stream. Providers register in an agent preset's scope, so Host resolution enforces which Agent may use a profile; neither capability is an LLM content modality or part of the agent loop.

Sources: [`packages/speech/speech-transcription/src/types.ts`](../../packages/speech/speech-transcription/src/types.ts), [`packages/speech/speech-synthesis/src/types.ts`](../../packages/speech/speech-synthesis/src/types.ts)

## Transcription

`SpeechTranscriptionInput` carries encoded bytes and their normalized base media type. `SpeechTranscriptionProfile` advertises a scope-local profile id, accepted media types, the complete-recording byte limit, and the final transcript character limit. A `SpeechTranscriptionProvider` owns decoding and recognition; `ResolvedSpeechTranscription` closes over the selected registration and reapplies admission before calling it. Empty transcript text is valid and means no speech was recognized.

Complete recordings use `transcribe`; continuous recognition uses the separate optional `openRealtime` operation.

## Synthesis

`SpeechSynthesisProfile` advertises a scope-local profile id, the promised output media type, and input/output bounds. A provider returns `SpeechSynthesisOutput`: validated `SpeechAudioMetadata` plus a single-consumer `AsyncIterable<Uint8Array>`. The runtime rejects empty text, validates metadata, forwards cancellation, bounds aggregate emitted bytes, and rejects an empty stream.

The Consumer supplies admitted text. Manual Web playback extracts committed assistant text; calls validate logged live sentences by coordinates and prefix digest and start playback before generation finishes. Reasoning and tool blocks never enter synthesis.

`SpeechSynthesisInput.language` carries the Consumer-resolved BCP 47 reply language from that turn’s log. Providers map language and voice; Qwen-TTS frames PCM as browser WAV without downloading the completed audio file.

## Scope and selection

Both registries use the calling plugin context's scope layer. Resolution requires the exact live Agent registered by `ctx.agents`, merges the Agent-to-preset-to-global scope chain, and either selects an explicit profile or requires exactly one visible provider. Duplicate profile ids fail at registration. An unavailable or ambiguous profile fails before any provider I/O.

The optional [`speech-http`](../../packages/speech/speech-http) Service Provider resolves credential references per operation. The optional [`speech-dashscope`](../../packages/speech/speech-dashscope) Service Provider maps DashScope's nested request and bounded SSE audio events to synthesis. The optional [`speech-ministream`](../../packages/speech/speech-ministream) Service Provider validates MiniStream WebSocket lifecycle events and forwards bounded MP3 frames. The [`speech-web`](../../packages/speech/speech-web) Consumer exposes authority-checked profile, complete-recording upload, and progressive synthesis routes through Connection's raw Fetch registry. The browser UI keeps recordings temporary, sends only the final transcript through the ordinary composer, and plays synthesis as derived presentation.

Continuous calls use optional `openRealtime(event, signal)` on the resolved transcription registration. `SpeechRealtimeInput` accepts mono 16 kHz PCM16 and closes asynchronously; `SpeechRealtimeEvent` reports onset, partial text, final text, or error. The [voice UI](../../packages/client/ui-voice/README.md) opens a full-screen call, plays a preloaded fixed greeting without a model request, keeps capture active during playback, and screens recognized speech against duration, information content, sentence form, short-backchannel structure, and active-answer similarity before cancelling an audible answer. Final accepted transcripts follow ordinary Session admission; partial captions, ignored acknowledgements, and raw audio remain transient. The [Web Consumer](../../packages/speech/speech-web/README.md) owns authorization, browser policy advertisement, and bounded ordered PCM transport.

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
