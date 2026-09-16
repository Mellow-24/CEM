# `@deepseek-ai/dsh-speech-ministream`

English | [中文](README.zh.md)

Credential-aware MiniStream WebSocket Service Provider for [`ctx.speechSynthesis`](../speech-synthesis/README.md). It registers one scope-local profile and converts each admitted sentence into one `preset_voice` operation. Binary MP3 frames pass through as they arrive, so browser playback can begin before synthesis completes.

The provider places the resolved credential in the server-side `Authorization` header. The endpoint URL never receives the token. Each operation uses a fresh opaque request id, requires `start` before binary audio and `end` after at least one frame, and rejects unrelated or malformed events. A completed connection can serve a later sequential operation with the same language, voice, and credential. Busy connections remain exclusive because binary frames do not carry request ids; concurrent synthesis opens another socket. The pool retains at most `maxIdleConnectionsPerVoice` sockets per language and voice and closes them after `connectionIdleTimeoutMs`. Cancellation, failure, credential changes, and plugin disposal prevent unsafe reuse. The caller signal and `timeoutMs` terminate an operation; `firstAudioTimeoutMs` fails a generation that acknowledges `start` but emits no audio. Provider capacity responses with code 429 are reported as `PROVIDER_BUSY`. `maxEventBytes` bounds each WebSocket frame; `maxOutputBytes` bounds received and queued audio.

## Config

| Key | Required | Meaning |
|---|---|---|
| `profile` | yes | Scope-local synthesis profile name. |
| `endpoint` | yes | WSS URL containing exactly one `{client_id}` placeholder; loopback WS is accepted for tests. |
| `apiKeyEnv` | no | Credential reference; defaults to `MINISTREAM_TTS_TOKEN`. |
| `defaultLanguage`, `voicePresetKey` | yes | Default BCP 47 language and provider preset voice. |
| `voicePresetByLanguage` | no | Preset voice overrides keyed by primary BCP 47 language. |
| `generationMode` | yes | Must be `preset_voice`. |
| `maxGenerateLength`, `normalize` | yes | Provider generation and text-normalization parameters. |
| `timeoutMs` | yes | Complete connection-and-stream deadline. |
| `firstAudioTimeoutMs` | yes | Deadline for the first non-empty MP3 frame. |
| `connectionIdleTimeoutMs` | yes | Maximum idle time before a reusable authenticated socket closes. |
| `maxIdleConnectionsPerVoice` | yes | Maximum idle sockets retained for one language and voice. |
| `maxInputChars`, `maxOutputBytes`, `maxEventBytes` | yes | Input, complete audio, and individual frame limits. |
| `tlsRejectUnauthorized` | no | TLS certificate verification; defaults to `true`. |

The provider sends `buffer=off` because the voice call already admits complete sentences in order. It advertises 48 kHz mono MP3, matching the MiniStream streaming protocol.

## Model Experience

None, as the provider translates committed text to MiniStream synthesis requests and never changes model context.

#### KV Cache effect

None; speech synthesis issues no LLM request.

## Known Limitations and Deferred Work

- **No multiplexing** — binary MP3 frames do not identify their request, so one socket handles only one active synthesis operation. Concurrent sentence preparation uses separate sockets; only completed sequential operations reuse an authenticated connection.
- **Preset voices only** — random and uploaded-reference generation modes are outside this provider.
- **No automatic retry** — transport, provider, timeout, and malformed-stream failures end the operation because retrying may duplicate billable audio.
