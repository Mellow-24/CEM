# Macau customer-service voice calls

English | [中文](README.zh.md)

Both `macau-customer-service` and `macau-customer-service-wiki` support the Web composer's voice-call button. Their knowledge retrieval and reply-language settings remain the same as text conversations.

While a call is connected, both presets answer as a telephone agent: direct conclusion first, plain spoken sentences in one paragraph without Markdown or citation markers, and two or three short sentences by default. Knowledge answers select at most the two or three facts most relevant to the question. A long procedure starts with the caller's immediate next action and offers to continue. The normal text composer retains its reading-oriented format; the Wiki preset still includes evidence citations there.

Auto uses only Macau Cantonese and English for both text and calls. A decisively English question receives English text and English TTS; Mandarin, Cantonese, Portuguese, unsupported, and ambiguous direct input receives Traditional-Chinese Macau Cantonese text and Cantonese TTS. Internal tool continuations preserve the language selected for that customer turn. An explicit language selection still takes priority for operator and compatibility workflows.
## Start

Set `DASHSCOPE_API_KEY` and `MACAU_MINISTREAM_TTS_TOKEN` in the server environment or root `.env`, then restart the Web application and open either customer-service preset. No key belongs in browser code. The Web profile uses the same DashScope credential for Qwen3.7 Plus conversations, Qwen3.7 text embeddings, Qwen3 reranking, recognition, and fallback synthesis.

```sh
pnpm dsh --profile web
```

Select the telephone button beside the microphone to enter the full-screen call and grant microphone permission. A prepared greeting plays on click while the microphone connects. Wait for the greeting to finish, then speak naturally: captions retain completed segments, nearby continued speech stays in one submitted question, and meaningful questions or corrections interrupt playback after intent screening. Brief acknowledgements and likely speaker echo do not stop the answer. Select **End call** to return to the conversation. Questions and answers remain in history after reload; the fixed greeting is not a model message. Audio recordings are not saved.

## Speech configuration

| Environment variable | Meaning |
|---|---|
| `DASHSCOPE_API_KEY` | Server-side Alibaba Cloud Model Studio credential. |
| `DSH_MACAU_EMBEDDING_BASE_URL` / `DSH_MACAU_EMBEDDING_MODEL` | Optional online embedding endpoint and model overrides. |
| `DSH_MACAU_RERANKER_URL` / `DSH_MACAU_RERANKER_MODEL` | Optional online reranker endpoint and model overrides. |
| `DSH_MACAU_ASR_REALTIME_URL` | Optional Qwen realtime WebSocket endpoint; defaults to the Beijing legacy endpoint. |
| `DSH_MACAU_ASR_URL` | Optional full Qwen chat-completions endpoint; defaults to the Beijing legacy endpoint. |
| `MACAU_MINISTREAM_TTS_TOKEN` | Server-side company MiniStream trial token. |
| `DSH_MACAU_TTS_REALTIME_URL` | Optional MiniStream WebSocket URL; defaults to the company trial endpoint. |
| `DSH_MACAU_TTS_FALLBACK_URL` | Optional Qwen3-TTS SSE URL; defaults to the Beijing DashScope endpoint. |

Customer replies use non-thinking `qwen3.7-flash` through the preset-local request route; AI quality inspection retains `qwen3.7-plus`. The Web deployment keeps the deterministic first-prompt history title and disables the concurrent title-model call. RAG still uses `qwen3.7-text-embedding` followed by `qwen3-rerank`; candidate counts, thresholds, and result ordering are unchanged, and an embedding model or endpoint change invalidates and rebuilds the disposable vector cache. Calls use `qwen3-asr-flash-realtime` for recognition and prefer the company MiniStream WebSocket for progressive 48 kHz MP3 synthesis. `generationMode` is `preset_voice`; automatic customer replies use the fine-tuned Cantonese `mailinlin` voice or English `en_jennifer` voice. MiniStream must emit its first audio frame within five seconds. A timeout, capacity rejection, or other failure before playback retries the sentence with streaming Qwen3-TTS, using Kiki for Cantonese and Jennifer for English. The fallback remains selected for the rest of that call. The prepared Cantonese greeting uses the `mailinlin` voice. Mandarin and Portuguese voices remain available only for an explicit compatibility selection.

## Deployment and limits

The greeting is “你好，我係澳電智能客服，請問有咩可以幫到你？” and follows any explicit language selection. Calls play at 1.15× speed with pitch preservation; configure `call.playbackRate` in the Web bundle to adjust it.

Calls require a modern browser with AudioWorklet support, such as Chromium. Qwen server VAD uses `threshold: 0.75` to reject more background noise and `silenceMs: 250` for faster turn completion. During audible answers, the browser treats recognized speech as an interruption candidate: meaningful partial text must persist for 420 ms, while a complete meaningful turn interrupts immediately. Short passive acknowledgements and text with at least six normalized characters that closely resembles the current answer are discarded as likely non-turn speech or echo. The decision also considers information length, character diversity, and question or correction form; it is not an interruption-word allowlist. After accepted final text, the browser keeps an 850 ms `call.utteranceMergeMs` grace period; resumed speech cancels that handoff and the completed segments are joined with newlines before one Session submission. The nominal post-speech handoff is about 1.1 seconds after recognized silence begins. Browser echo cancellation and noise suppression remain enabled, while automatic gain control is disabled so low-level ambient sound is not raised before server VAD. Maximum call duration is one hour. Speaker volume and environmental noise can still affect recognition and interruptions. Call audio plays at 1.15× with pitch preservation. Answers play sentence by sentence during generation, with a 160-character maximum sentence buffer. Once the current sentence is audible, the browser prepares at most one next sentence so most synthesis startup overlaps current playback without opening an unbounded set of realtime requests. Layout newlines do not create separate TTS requests, and call captions do not expose internal safety splits. Generated reply text appears immediately and remains visible if TTS is delayed or fails; audio playback updates the call phase independently. Retrieval and first-sentence generation still add latency. The Host adds the configured telephone-response instructions as durable runtime context while the realtime connection is active and clears them on the next model step after hangup. Both customer-service presets set `response-language.verifyOutput: false`, retaining language instructions and selection while disabling whole-answer buffering and correction retries. Recognition errors stop the call; a synthesis failure after both providers keeps recognition available and leaves submitted text visible.

For remote browsers, use HTTPS and an access-controlled deployment. Speech defaults to loopback-only access; configure `speech-web.authority: trusted-host` only together with Connection's trusted authorities and deployment access control. See [speech-web configuration](../../../../../packages/speech/speech-web/README.md). The allowlist is not a user login or tenant-isolation mechanism.
