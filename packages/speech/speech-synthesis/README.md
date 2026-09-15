# @deepseek-ai/dsh-speech-synthesis

English | [中文](README.zh.md)

The Service Definition for streaming speech synthesis. `ctx.speechSynthesis` owns scope-aware provider registration, profile selection, text and output-byte admission, cancellation, media metadata validation, and ordered `Uint8Array` delivery.

## Service API

| Member | Semantics |
|---|---|
| `registerProvider(provider)` | Registers `provider.profile` in the calling Context's global or exact scope layer and returns its effect disposer. |
| `profile(agent, profile?)` | Returns visible `mediaType`, `maxInputChars`, and `maxOutputBytes`; omission requires exactly one visible profile. |
| `resolve(agent, profile?)` | Returns profile metadata plus a registration-bound `synthesize(input, signal)` operation. |

Preset-scoped registrations are visible only to Agents whose scope chain inherits that preset. Resolution requires the exact live Agent and an available, unambiguous profile.

The runtime rejects blank or oversized text before provider setup. It validates response metadata before returning a stream, checks every chunk during consumption, and stops with `AUDIO_TOO_LARGE` before yielding bytes beyond the configured complete-output cap. Consumers must keep consuming or cancel with the supplied signal; streams are single-pass borrowed provider output.

`SpeechSynthesisInput` contains text and an optional BCP 47 reply language. The Consumer resolves the language from its authorized conversation log; providers map it to supported voices and language parameters.

## Model Experience

None, as synthesis renders Consumer-admitted assistant text to a human and never changes model input or output.

#### KV Cache effect

None; synthesis reads admitted text and does not alter Session history.

## Known Limitations and Deferred Work

- **One encoded stream per operation** — profiles promise one fixed media type; format negotiation and voice choice require separate profiles.
- **No durable audio artifact** — chunks are transient and no Session event permits replay after refresh.
