# `@deepseek-ai/dsh-speech-dashscope`

English | [中文](README.zh.md)

DashScope Qwen-Audio-TTS HTTP SSE Service Provider for [`ctx.speechSynthesis`](../speech-synthesis/README.md). It registers one profile in the mounting preset's scope, so the speech runtime continues to own Agent authorization, text admission, decoded output limits, and provider selection.

## HTTP SSE protocol

The provider sends one complete-text request using DashScope's nested `model` and `input` fields, resolves the configured credential reference immediately before each operation, sets `X-DashScope-SSE: enable`, and refuses redirects. It accepts only a successful `text/event-stream` response. `sentence-synthesis` events contribute strict canonical-Base64 audio chunks in arrival order; a response succeeds only after audio and a terminal `finish_reason: "stop"` event. Provider error fields, malformed events, a truncated final event, and an EOF without `stop` fail without exposing the response body.

Incremental parsing applies fatal UTF-8 decoding and bounds both the complete encoded response and one event awaiting its blank-line separator. Decoded audio is checked before allocation against the remaining provider limit and is checked again by the speech runtime. The caller signal and configured timeout cover credential lookup, request setup, and response consumption.

The default endpoint is DashScope's still-supported Beijing legacy endpoint. Set `endpoint` to a workspace-specific HTTPS URL when the deployment uses one; loopback HTTP is accepted for replay tests and local adapters. See the [official HTTP API reference](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api).

## Config

| Key | Required | Meaning |
|---|---|---|
| `profile` | yes | Scope-local synthesis profile name. |
| `model` | yes | Qwen-Audio-TTS model id. |
| `voice` | yes | System, cloned, or designed DashScope voice id. |
| `format` | yes | `mp3`, `wav`, or `opus`; the provider derives `audio/mpeg`, `audio/wav`, or `audio/ogg`. |
| `maxResponseBytes`, `maxEventBytes` | yes | Complete encoded SSE and pending-event byte limits. |
| `endpoint` | no | HTTPS operation URL, or loopback HTTP for local adapters; defaults to the Beijing legacy SpeechSynthesizer endpoint. |
| `apiKeyEnv` | no | Credential reference; defaults to `DASHSCOPE_API_KEY`. |
| `timeoutMs` | no | Setup-and-stream deadline; defaults to 120000. |
| `maxInputChars`, `maxOutputBytes` | no | Profile text and decoded-audio limits; defaults to 4000 and 20 MiB. |
| `sampleRate` | no | One provider-supported rate: 8000, 16000, 22050, 24000, 44100, or 48000 Hz. |
| `volume` | no | Integer from 0 through 100. |
| `rate`, `pitch` | no | Provider controls from 0.5 through 2.0. |
| `languageHints` | no | Exactly one provider-supported language code when present. |
| `instruction` | no | Non-empty dialect, emotion, or delivery instruction. |
| `enableAigcTag` | no | Whether DashScope embeds its supported generated-content marker. |

`protocol: qwen-tts` uses Qwen3-TTS’s multimodal-generation endpoint and wraps streamed mono 24 kHz PCM16 in WAV headers without downloading the complete audio URL. It requires explicit `endpoint`, `format: wav`, `sampleRate: 24000`, and `maxInputChars` at most 600. `defaultLanguage` supplies the missing BCP 47 language; `voiceByLanguage` selects voices by primary language code. Cantonese uses a Cantonese voice with Qwen’s `Chinese` language selector. SpeechSynthesizer-specific rate, pitch, instruction, and tag controls are rejected. See the [Qwen-TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api).

## Model Experience

None, as the provider translates admitted text to DashScope synthesis requests and never changes model context.

#### KV Cache effect

None; synthesis reads Consumer-admitted text and does not issue an LLM request.

## Known Limitations and Deferred Work

- **Complete-text HTTP input** — each request accepts one Consumer-admitted sentence or message; incremental text input and WebSocket connection reuse require another provider.
- **Encoded browser formats** — the provider exposes MP3, WAV, and Opus. Qwen-TTS PCM is framed as WAV for browser playback.
- **No automatic retry** — any HTTP, provider, timeout, or stream failure ends the operation; deployment policy owns retry because another request may incur cost.
