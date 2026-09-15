# @deepseek-ai/dsh-speech-http

English | [中文](README.zh.md)

Optional HTTP Service Providers for [`ctx.speechTranscription`](../speech-transcription/README.md) and [`ctx.speechSynthesis`](../speech-synthesis/README.md). An absent `transcription` or `synthesis` config section registers no provider for that capability.

## HTTP contracts

The transcription provider POSTs the admitted recording bytes with their base `Content-Type` and accepts a successful `application/json` object `{ "text": string, "language"?: string }`. It bounds encoded response bytes before fatal UTF-8 decoding and JSON parsing. The synthesis provider POSTs JSON containing the configured text field plus non-secret static body fields and requires a successful streaming body whose base `Content-Type` equals the profile's configured `mediaType`.

Both operations use `redirect: 'error'`, so a credential-bearing request never follows an endpoint redirect. `apiKeyEnv` is a credential reference resolved through `ctx.credentials` immediately before every request; the value enters only the configured header and is never accepted as literal plugin config. A missing referenced value rejects that operation. Each endpoint's required `timeoutMs` is combined with the caller signal, so setup and streaming reads cannot wait indefinitely.

## Config

| Section/key | Required when enabled | Meaning |
|---|---|---|
| `transcription.profile`, `synthesis.profile` | yes | Scope-local registration name. |
| `transcription.url`, `synthesis.url` | yes | Absolute HTTP(S) operation URL without embedded credentials. |
| `apiKeyEnv` | no | Credential reference; omission permits an endpoint requiring no key. |
| `apiKeyHeader`, `apiKeyPrefix` | no | Credential header and prefix; defaults are `authorization` and `Bearer `. |
| `timeoutMs` | yes | Positive provider request deadline within Node's timer range. |
| `transcription.mediaTypes` | yes | Accepted recording base media types. |
| `transcription.maxBytes`, `maxTranscriptChars` | yes | Complete recording and returned-transcript bounds. |
| `transcription.maxResponseBytes` | yes | Encoded endpoint JSON bound enforced before UTF-8 decoding and parsing. |
| `synthesis.mediaType` | yes | Required response base media type. A missing response `Content-Type` fails. |
| `synthesis.maxInputChars`, `maxOutputBytes` | yes | Complete text and encoded stream bounds. |
| `synthesis.textField` | no | JSON text field; defaults to `text`. |
| `synthesis.body` | no | Static non-secret string, number, or boolean fields; it may not define `textField`. |

## Qwen ASR

Set `transcription.protocol: qwen-asr` and a non-empty `transcription.model` such as `qwen3-asr-flash` to use Qwen's chat-completions ASR endpoint. The provider sends the complete recording as a Base64 data URL in `input_audio`, with `stream: false` and inverse text normalization enabled. It requires a completed `stop` choice with string `message.content`; partial or malformed replies fail. The same credential, cancellation, and bounded JSON response handling applies. Omitted `protocol` selects `raw`.

For Qwen3-ASR-Flash, keep the complete Base64 request below the service's 10 MB limit; the Macau presets cap raw recordings at 6 MiB. The configured browser formats are WebM, Ogg, and WAV. See the [official Qwen ASR reference](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference).

## Streaming Qwen ASR

Optional `transcription.realtime` registers Qwen WebSocket recognition alongside complete-recording ASR. Configure `url`, `model`, server VAD `silenceMs` and `threshold`, `maxDurationMs`, and `maxBufferedBytes`. Credentials remain on the Host. Setup uses the endpoint timeout; response and transcript limits apply to each event. The connection becomes ready only after `session.updated`; cancellation closes the socket, and malformed events or queue overflow terminate the call.

## Model Experience

None, as these providers translate speech-service operations to HTTP and never assemble or modify a model request.

#### KV Cache effect

None; transcription remains a Consumer-owned draft and synthesis reads already-committed text.

## Known Limitations and Deferred Work

- **One normalized protocol per operation** — endpoints other than the explicit raw and Qwen ASR protocols, including multipart transcription, WebSocket streaming, or non-JSON synthesis requests need sibling provider packages or an explicit protocol extension.
- **No automatic retry** — an HTTP, transport, or timeout failure ends that operation; deployment policy owns any retry that is safe for its endpoint.
