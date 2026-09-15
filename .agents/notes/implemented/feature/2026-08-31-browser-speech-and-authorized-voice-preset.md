# Agent Note: Browser speech and authorized voice preset

Status: implemented

English | [中文](2026-08-31-browser-speech-and-authorized-voice-preset.zh.md)

## Problem

Agent presets can scope a persona, language policy, and tools, but the Web client had no speech input or output. Adding buttons alone would expose provider credentials to the browser, let callers synthesize arbitrary text with an authorized voice, and force encoded audio through JSON transports designed for small control messages. Treating recorded audio as model content would also require durable attachment, adapter, compaction, replay, and modality semantics that speech-to-text input does not need.

The authorized voice belongs only to the Hong Kong feng shui preset. Client-side hiding cannot enforce that restriction because a same-origin caller can invoke Host routes directly, and the Web client's `trustedHosts` check is a DNS-rebinding defense rather than authentication.

Committed-text requirements apply to manual message playback. Sentence playback in continuous calls follows the [customer-service call decision](2026-09-03-customer-service-voice-calls.md) and admits validated logged live text.

## Decision

Continuous calls and the explicit Qwen ASR protocol are specified by the [customer-service call decision](2026-09-03-customer-service-voice-calls.md).

Speech transcription and speech synthesis are separate capability seams under `packages/speech`. `@deepseek-ai/dsh-speech-transcription` and `@deepseek-ai/dsh-speech-synthesis` provide scope-aware provider registries. A provider registers in the mounting preset's scope, and each operation resolves against the exact live root Agent before it can run. Other presets therefore resolve no provider even when they share the same process.

`@deepseek-ai/dsh-speech-http` is the first Service Provider for both capabilities. Each independently optional configuration names a profile, endpoint, credential reference, limits, and media properties. The transcription request sends a complete admitted recording as raw bytes and accepts a final JSON transcript. The synthesis request sends JSON containing the committed assistant text and returns a bounded encoded byte stream. Credentials resolve immediately before each request, never enter browser configuration, and never follow redirects.

`@deepseek-ai/dsh-speech-dashscope` is the DashScope synthesis Service Provider. It sends the vendor's nested model and input request, requests HTTP SSE, and incrementally decodes Base64 audio only from `sentence-synthesis` events. Fatal UTF-8 decoding, complete-response and pending-event byte limits, strict event and Base64 validation, a required terminal `stop`, redirect refusal, and one timeout/cancellation signal cover setup through stream consumption. Provider failures expose stable speech error codes without returning the vendor response body or credential.

`@deepseek-ai/dsh-speech-web` is the Host Consumer. It registers exact no-envelope Fetch routes through the Connection service, which applies the existing browser trust checks, a route-local request-body limit before buffering, disconnect cancellation, and response backpressure. Speech routes default to loopback; deployments can explicitly select trusted-host authority with their own access control. Profile discovery returns only operations visible to the addressed live root Agent. Transcription accepts one complete audio body. Manual synthesis accepts a Session id, committed assistant message id, and visible profile; the Host reads speakable text from that Session's append-origin `assistant/message`, so the browser cannot submit arbitrary text to the authorized voice.

`@deepseek-ai/dsh-client-ui-voice` is a global browser plugin whose entries render only after Host profile discovery reports an operation. It adds a microphone and voice-send control to `conversation.input.right`, transient state to `conversation.composer.dock`, and manual or automatic playback to `conversation.chat.assistant-actions`. `MediaRecorder` negotiates a Host-accepted media type and enforces the Host byte cap while recording. A final transcript is appended to the existing draft for review; it reaches the model only through the ordinary composer submission and durable `user/message`. Voice send arms the first new committed closing assistant message for automatic playback. Manual playback remains available after an autoplay rejection.

The Web surface starts synthesis only from committed assistant messages, not raw `assistant/chunk` events. A failed model attempt may emit raw chunks before retry replaces it; speech already played cannot be retracted. This adds final-message latency but keeps audible output aligned with the durable answer.

The shipped `hk-feng-shui` preset fixes reply language to `yue-Hant-HK`, contributes a TTS-friendly virtual adviser persona, mounts HTTP transcription when its endpoint is configured, and mounts DashScope synthesis when the `DASHSCOPE_API_KEY` credential exists. The preset pins the Qwen-Audio TTS model, authorized voice id, MP3 output, Cantonese delivery instruction, and AIGC audio marker; the non-secret vendor endpoint remains configurable. It identifies itself as a virtual AI rather than the named person, labels playback as AI-generated speech, and states the cultural-entertainment, professional-advice, anti-coercion, and data-minimization limits. No credential value ships in the repository.

Speech remains presentation around text. Raw recordings and synthesized bytes do not enter the Session log, the LLM content-block vocabulary, or durable attachment storage. The [durable image attachment decision](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) continues to govern model-visible media and explicitly leaves audio as an independent design. The [automation-only ACP decision](../simplification/2026-07-23-acp-automation-only-protocol.md) continues to reject audio; ACP and the SDK receive no speech extension.

## Alternatives considered

**Call speech providers directly from the browser.** Rejected because it exposes credentials, bypasses Agent-scope authorization, and lets any browser script submit arbitrary synthesis text.

**Put audio in the existing RPC or event WebSocket as base64.** Rejected because the current channels are JSON control transports, base64 increases the bytes by roughly one third, and audio playback needs cancellation and response backpressure independent of Session event delivery.

**Add an `AudioBlock` and persist every recording or synthesized answer.** Rejected because the model sees the final transcript, not the recording, and TTS is derived presentation. Durable audio requires a separate reference lifecycle, garbage collection policy, provider modality support, and replay requirements when a real consumer needs it.

**Read raw assistant chunks for lower first-audio latency.** Rejected because retry can abandon those chunks after they have been spoken. This restriction applies to manual message playback; continuous calls follow the sentence policy linked above.

**Hard-code `hk-feng-shui` in the UI.** Rejected because presentation is not authorization and copied or future presets need the same capability without changing a component. Scope resolution on the Host is the authority; profile absence hides the global UI contribution.

**Use browser speech recognition as the only input provider.** Rejected because provider availability, data handling, languages, and result semantics vary by browser. The Web client records standard media, while a scoped Host provider owns transcription.

**Extend the provider-neutral HTTP package with nested vendor templates and SSE decoding.** Rejected because DashScope event types, terminal markers, Base64 audio, and request fields are one vendor protocol. A dedicated Service Provider owns DashScope SSE decoding; `speech-http` supports raw audio and an explicit fixed Qwen ASR mapping without arbitrary vendor templates.

## Verification

Capability tests cover scoped transcription visibility, stale synthesis-Agent rejection, ambiguous selection, input, transcript, text, and output bounds, a pre-aborted transcription, and malformed synthesis metadata or stream length. HTTP-provider tests cover independent configuration, raw transcription and JSON synthesis request mapping, credential headers with redirects disabled, configured timeouts, bounded and UTF-8 transcription responses, synthesis media-type validation, and transport-error redaction. DashScope-provider tests cover nested request mapping, credential isolation, timeout and cancellation, network chunk boundaries, LF and CRLF events, encoded response and event limits, fatal UTF-8, JSON and Base64 validation, provider errors, and terminal-stop enforcement; a credential-gated real-API test verifies the configured model and voice produce MP3 bytes. Speech Web tests cover absent and one-sided profiles, the effective transcription cap in profile and route metadata plus the handler backstop, and successful append-origin message lookup with reasoning omitted from spoken text; they do not exercise delegated-Agent denial, stream cancellation, cross-Session message rejection, or the complete error-status table. Client tests cover profile parsing and cold-to-live refresh, media negotiation, track cleanup, in-flight and final recording limits, cancellable late permission, latest-draft transcript append, seq-bounded voice-send arming, automatic and manual playback, autoplay fallback, preset and Session lifecycle, and controller disposal. A real-Chromium end-to-end test drives manual committed-message synthesis through the client, Connection, Host runtime, and scoped provider, asserting the authorized request body, credential, and loading UI while deliberately not asserting media decode completion. The shipped preset's keyless snapshot pins its complete system prompt, Hong Kong Cantonese selection, absent tools, text reply, synthesis profile, and DashScope request mapping.

## Consequences

The preset works as text-only until a deployment configures a speech credential or transcription endpoint. A DashScope API key enables synthesis; transcription remains independently optional and requires its own endpoint. The default synthesis endpoint is DashScope's Beijing legacy domain, while deployments with a workspace-specific domain can replace it. The UI exposes only the available operation. Speech serves live root Agents with loopback authority by default; remote browser deployments require explicit trusted-host authority and HTTPS. Delegated sessions, ACP, SDK clients, and cold Session reads do not provide speech.

Complete recording upload bounds implementation complexity but does not provide partial transcripts. Synthesis begins after the final assistant message, so its first audio arrives later than speculative chunk speech. Audio playback compatibility depends on the configured encoded media type and the browser's native media stack. Recordings disappear after transcription, synthesized responses are regenerated on replay, and repeated playback can incur another provider request.
