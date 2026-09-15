# Agent Note: Keep call replies visible through TTS failure

Status: implemented

English | [中文](2026-09-14-visible-call-replies-and-tts-fallback.zh.md)

## Problem

The call caption advanced only when a sentence audio element emitted `playing`. A synthesis request that stalled or failed therefore left the call screen blank even though the model answer had already entered the durable Session and appeared after hangup. The company MiniStream service can acknowledge a request with `start` and then emit no MP3 frames; it can also reject realtime capacity with code 429. Concurrent lookahead synthesis consumed more of that limited capacity.

## Decision

The call controller derives its assistant caption from each visible partial or committed assistant text block as the Session updates. It collapses layout whitespace for the telephone view and keeps the generated answer visible independently from the playback phase. Audio `playing` changes the phase but no longer gates text display.

The sentence queue sends the first TTS request without speculative lookahead. Once that sentence becomes audible, it prepares at most one next sentence while preserving ordered playback. Synthesis startup for the next sentence therefore overlaps current audio without opening several unseen realtime requests. MiniStream has a deployment-configured `firstAudioTimeoutMs` in addition to its complete-stream timeout, and maps a connection-level 429 response to `PROVIDER_BUSY`.

Call configuration may name a preferred `synthesisProfile` and an optional `fallbackSynthesisProfile`. The Host resolves the preferred profile without making ordinary single-provider sessions ambiguous and advertises an available fallback to the browser. If synthesis or playback fails before a sentence becomes audible, the browser retries that sentence once through the fallback. A successful fallback remains selected for later sentences and questions in the same call. Failure after audio starts does not retry because replaying the sentence could repeat words the caller already heard.

The Macau customer-service presets keep company MiniStream and `mailinlin` as the preferred Cantonese path with a five-second first-audio timeout. A separate Qwen3-TTS profile supplies Kiki for Cantonese, Cherry for Mandarin, Jennifer for English, and Maia for Portuguese when MiniStream cannot begin playback.

## Alternatives considered

**Keep captions synchronized only to audible sentences.** Rejected because a provider failure hides an answer that already exists and gives the caller no indication that the model completed the turn.

**End speech for the turn after the preferred provider fails.** Rejected because the deployment already has a configured Qwen credential and a working streaming provider, while the caller still expects an audible answer.

**Prepare the next sentence before current audio becomes audible, or prepare several later sentences.** Rejected because it opens realtime generation requests before the current provider is known to work or occupies several capacity slots for one answer. One lookahead begins only after current audio is audible.

**Retry after partial playback.** Rejected because the fallback would repeat an unknown audible prefix.

## Consequences

Call text can lead audio while synthesis starts, which accurately represents generated content and remains useful during provider degradation. A failed preferred request can add up to five seconds before the first fallback audio in a call; later speech uses the fallback directly. Audible-gated, one-sentence lookahead removes most inter-sentence synthesis delay while limiting each answer to the current audio plus one prepared sentence. Client tests cover immediate generated captions, audible-gated lookahead, fallback before audio, and reuse across questions. Host tests cover explicit preferred-profile selection and fallback advertisement. MiniStream tests cover stalled first audio and capacity classification.
