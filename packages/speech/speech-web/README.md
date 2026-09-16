# @deepseek-ai/dsh-speech-web

English | [中文](README.zh.md)

The Host Consumer exposing agent-scoped speech profiles through exact authority-checked raw Fetch routes registered on `ctx.connection`. It neither accepts audio as model content nor writes speech events.

## Routes

| Method/path | Behavior |
|---|---|
| `GET /api/speech/profile?sessionId=&profile?=` | Resolves public transcription and synthesis metadata independently for the exact live root Agent. An unavailable capability is absent. |
| `POST /api/speech/transcribe?sessionId=&profile?=` | Accepts one complete raw audio body with an `audio/*` Content-Type and returns `{ text, language? }`. It does not submit the text. |
| `GET /api/speech/synthesize?sessionId=&messageId=&profile?=` | Verifies an append-origin committed `assistant/message`, extracts only non-empty text blocks, and returns its encoded TTS stream. |

All routes use Connection's configured authority trust check, defaulting to `loopback`. The transcription route additionally registers `maxTranscriptionBodyBytes` with Connection, so the Node bridge rejects an oversized body before buffering it; profile metadata advertises the smaller of this transport cap and the selected provider's `maxBytes`, and the handler enforces the same effective value again. The default transport cap is 16 MiB and remains configurable.

The synthesis response uses the provider media type, `Cache-Control: no-store`, chunked framing, and a pull-driven `ReadableStream`; cancellation aborts the provider operation and closes its iterator. Raw audio bytes never enter the JSON RPC or Session-event queues. A provider-declared length is checked only when its stream ends and is never forwarded as HTTP framing.

The `./client` export contains the exact path constants and browser-safe payload types. It is a protocol outlet, not a Client Cordis plugin.

## Calls and remote deployment

Optional `call` configuration contains required `greetings`, `defaultGreeting`, `responseInstructions`, `playbackRate`, `microphone`, `maxPendingAudioMs`, `utteranceMergeMs`, `interruption`, `responseTimeoutMs`, `sentenceMaxChars`, `sentencePauseMinChars`, and `sentenceQueueLimit`; `synthesisProfile` selects a preferred provider when several are visible, and `fallbackSynthesisProfile` optionally authorizes a browser retry when the preferred provider fails before audio begins. `sentencePauseMinChars` sets the minimum segment length at which comma-like punctuation can begin synthesis and must not exceed `sentenceMaxChars`. The Host advertises browser settings only with streaming recognition and synthesis. `responseInstructions` stays server-side and becomes agent-scoped runtime context for the lifetime of the realtime connection. `microphone` selects browser `echoCancellation`, `noiseSuppression`, and `autoGainControl` processing before PCM reaches recognition. `maxPendingAudioMs` bounds queued and in-flight browser PCM independently from the request-size limit. `utteranceMergeMs` lets speech resumed shortly after a provider-final segment remain in the same submitted user message. `interruption` configures the browser's sustained-partial confirmation time, minimum meaningful text, playback-echo similarity, and short-backchannel limit; these fields affect only automatic interruption during audible answers. Each greeting configures `text` and a packaged WAV `asset` module specifier. Assets load at startup; missing files or the default greeting fail loading. The profile advertises authorized `/api/speech/greeting` URLs for browser preloading. Fixed greetings require no runtime model or TTS call and remain outside conversation history. The bundled Cantonese recording uses the company `mailinlin` voice; the Mandarin, English, and Portuguese recordings use Qwen3-TTS voices Cherry, Jennifer, and Maia. `/api/speech/realtime` supplies a newline-delimited event stream and owns one recognizer per live root Session. `/api/speech/realtime/audio` accepts 1–20 whole 100 ms frames of mono 16 kHz PCM16 per ordered upload (3,200–64,000 bytes), with the same call token and live-Agent authorization. The Host forwards each batch as ordered 100 ms provider frames and rejects overlapping uploads. Closing the downlink aborts recognition and removes the call context. Raw call audio and partial captions remain transient.

`authority` defaults to `loopback`. A controlled remote deployment can explicitly select `trusted-host` to apply Connection's configured Host/Origin trust checks instead. This is an authority allowlist, not per-user authentication or tenant isolation; the deployment must supply access control before exposing the shared Harness. Use HTTPS for remote browser microphone access. A cold historical Session still requires ordinary resumption before its speech operations are available.

`GET /api/speech/synthesize-sentence` accepts Session, profile, turn, step, block, start, end, and a SHA-256 prefix digest during calls. The Host reconstructs text from that Session log and synthesizes only matching sentences, excluding reasoning and arbitrary client text. Layout whitespace in an authorized call sentence is collapsed before synthesis so line wrapping does not introduce a spoken pause. `sentenceMaxChars` and `sentenceQueueLimit` configure browser segmentation and pending audio. Sentences enter synthesis serially so limited provider capacity is not consumed by speculative lookahead. Generated answer text reaches the call caption immediately; audio playback changes the phase independently. If the preferred provider fails before the first audible frame, the current sentence retries once with the advertised fallback and the rest of that call keeps the working profile.

Synthesis reads the matching turn and step’s `response-language/resolved` event, rather than browser-supplied language or the current selector. Missing events use provider policy; historical playback therefore retains its original language.

## Model Experience

### Active voice-call response instructions

#### What the model sees

While `/api/speech/realtime` is connected, the selected Agent receives the deployment's complete `call.responseInstructions` text as the `speech-web:active-call` runtime-context section. The agent loop records the resolved snapshot before the model request. The next non-call model request receives the standard cleared-runtime-context message. Complete-recording transcription and manual synthesis add no context.

#### Token effect

The first call request adds the configured instruction text and runtime-context framing. Further steps reuse the retained snapshot until another dynamic context changes. The first model step after hangup adds one clearing message.

#### KV Cache effect

The first model step after call connection changes the runtime-context prefix. Further call steps reuse it until another dynamic context changes. The first model step after hangup records the cleared context and changes the prefix again.

## Known Limitations and Deferred Work

- **Live ordinary Sessions only** — profile and media routes do not resume cold Sessions and reject delegated Agents; the Web session resolver needs a shared cold-resume API before historical playback can be transparent.
- **Audible content cannot be retracted** — calls synthesize sentences before generation finishes; retries can revise the final answer and cancellation only stops subsequent audio.
