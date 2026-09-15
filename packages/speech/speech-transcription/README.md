# @deepseek-ai/dsh-speech-transcription

English | [中文](README.zh.md)

The Service Definition for complete-recording and streaming speech transcription. `ctx.speechTranscription` owns scope-aware provider registration, profile selection, recording admission, cancellation, and final transcript validation; providers own decoding and speech recognition, while Consumers decide whether returned text remains a draft or becomes user input.

## Service API

| Member | Semantics |
|---|---|
| `registerProvider(provider)` | Registers `provider.profile` in the calling Context's global or exact scope layer and returns its effect disposer. Duplicate names within one layer fail. |
| `profile(agent, profile?)` | Returns detached limits for a profile visible along the exact live Agent's scope chain. Omission succeeds only when one profile is visible. |
| `resolve(agent, profile?)` | Returns the same public profile plus a registration-bound `transcribe(input, signal)` operation. |

A preset-mounted provider belongs to that standing scope. Agents joined under it inherit the profile; unrelated agents do not. A nearer scope may shadow the same global profile name. Resolution rejects stale Agent instances, unavailable explicit profiles, and ambiguous implicit selection.

Every profile declares accepted base audio media types, `maxBytes`, and `maxTranscriptChars`. The runtime rejects empty or oversized recordings and unsupported media types before provider execution, propagates the required `AbortSignal`, then rejects malformed or oversized provider transcripts before returning them.

Providers may additionally expose `openRealtime(event, signal)`. Its ready input accepts mono 16 kHz PCM16 and has an asynchronous close operation. Events distinguish speech onset, replaceable partial text, final transcript, and terminal error. Profile metadata exposes `realtime: true` only for registrations with this operation; providers validate their wire events and own transport limits.

## Model Experience

None, as this service returns transcript text to its Consumer and never inserts it into a model request.

#### KV Cache effect

None; a Consumer that submits accepted text through the Agent inbox owns the later append-only user-message effect.

## Known Limitations and Deferred Work

- **No audio retention** — the service neither stores recording bytes nor adds an audio content block or Session event.
