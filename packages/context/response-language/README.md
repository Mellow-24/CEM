# @deepseek-ai/dsh-response-language

English | [中文](README.zh.md)

Preset-scoped reply-language policy with a durable session preference, one resolved language per accepted model step, bounded output-language correction, a session projection, and an optional `/response-language` command. The plugin changes explanatory response prose only: it never translates or rewrites user messages, tool arguments, or retrieval queries.

## Configuration

```yaml
- id: response-language
  name: '@deepseek-ai/dsh-response-language'
  config:
    fallbackLanguage: zh-Hant
    autoDetectedLanguages: [en]
```

`fallbackLanguage` is one of `zh-Hans`, `zh-Hant`, `yue-Hant-MO`, `yue-Hant-HK`, `en`, or `pt`; omission defaults to `zh-Hant`. `autoDetectedLanguages` restricts which decisive detections Auto may select and defaults to all six languages. When the list is restricted, direct input whose detection is absent or excluded resolves to `fallbackLanguage`; model tool continuations keep the current turn's resolution. The plugin must be mounted in an agent-preset scope. Its fixed preference vocabulary is `auto` followed by those six languages.

## Durable state and resolution

`response-language/preference` is a whole-value, last-write-wins session event. A preset-scoped lifecycle listener writes `auto` when the current composition first enables the capability, while a repeated selection appends nothing. Resume and fork therefore retain the selected value.

`response-language/resolved` records the preference, fixed language, basis, turn, and step used by an accepted request. A detected result also records the direct human message id and confidence. The plugin observes `agent/inbox/claimed` before prompt assembly, but only direct `source.kind === 'user'` text participates. Fixed selection wins without detection; Auto uses a decisive allowed local detection, carries the previous result for internal continuations, then falls back to `fallbackLanguage`. With the default unrestricted list, ambiguous direct input also carries the previous result. Tool results, evidence, plugin context, and assistant messages never vote.

Prompt assembly captures the resolution before `agent/pre-step`. The policy requests buffered reply delivery and is placed after tool and completion guidance. A decisive local mismatch in a completed text reply appends `response-language/retry`, discards the uncommitted output, strengthens the final policy section, and retries once. For Auto, the retry quotes the discarded reply as JSON text and requests only its customer-facing translation in the resolved input language; fixed selections retain the direct retry instruction. Tool-call, streaming, failed, max-token, ambiguous, and second-attempt output is accepted without another language retry. When `verifyOutput` is false, the exact per-step policy is also placed last in recorded runtime context, reminding the model after every tool result because streamed text cannot be retracted for correction. The resolution and retry events are required-on-read because they determine later request behavior.

## Projection and command

When `ctx.sessionProjections` is present, the package registers `responseLanguage` with `{ available, options, currentValue, resolved? }`. `available` is explicit because the projection registry is process-wide while this feature is preset-scoped. An `agent-preset/selected` event makes the projection unavailable until the new composition enables it, preventing mount order from exposing the control in unrelated sessions.

When `ctx.commands` is present, `/response-language <auto|zh-Hans|zh-Hant|yue-Hant-MO|yue-Hant-HK|en|pt>` writes the preference without starting a model turn. The bare command reports the current value. Invalid values return a command error and do not change state.

Design: [session response-language selection](../../../.agents/notes/implemented/feature/2026-08-31-session-response-language-selection.md).

`verifyOutput` defaults to `true`: buffer the completed reply and permit one language correction retry. Setting it to `false` retains language resolution and instructions but streams output without whole-answer correction, enabling sentence playback.

## Model Experience

### Resolved reply-language policy

#### What the model sees

Every eligible request receives one terminal `response-language:policy` system-prompt section at order 900. The first sentence is selected from the fixed language table; after one detected mismatch, fixed selections add `The previous response used the wrong language. Reply again using only the required language.` before the stable remainder. Auto instead supplies the discarded reply as JSON text and asks for only its translation into the resolved input language.

##### Verbatim policy variants

```markdown
Reply in Simplified Chinese characters with standard Mandarin wording and no Cantonese expressions. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in Traditional Chinese characters with standard Mandarin wording and no Cantonese expressions. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in natural Macau Cantonese written with Traditional Chinese characters. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in natural Hong Kong Cantonese written with Traditional Chinese characters. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in English. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in Portuguese. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
```

#### Token effect

Each request adds one short system-prompt section and one log-only resolution event. With output verification disabled, the runtime-context snapshot also carries the same language policy. Detection is local and makes no additional model call; a detected mismatch adds one retry request and one log-only retry event.

#### KV Cache effect

A stable resolved language preserves the same system-prompt prefix. Changing the fixed selection or an Auto result changes the terminal section on the next accepted request; a correction retry changes that section for its second request. Tool continuations carry the turn's language rather than deriving one from evidence.

## Known Limitations and Deferred Work

- **Bounded Auto detector** — short, transliterated, code-switched, or dialect-neutral text can remain ambiguous. An unrestricted policy carries the previous result or uses the configured fallback; a restricted `autoDetectedLanguages` policy sends unmatched direct input to the fallback.
- **Cantonese region requires an explicit choice** — shared Cantonese markers continue to resolve Auto as `yue-Hant-MO`; ordinary Cantonese text does not reliably distinguish Macau from Hong Kong. Select `yue-Hant-HK` or configure it as the fallback when the regional variety is required. The output verifier also accepts standard Traditional Chinese wording for either Cantonese target rather than treating it as a decisive mismatch.
- **Bounded output verifier** — only a decisive result from the same local detector triggers correction, and each step retries at most once. Ambiguous, unsupported, tool-call, streaming, failed, and max-token output is not retried for language.
- **No retrieval translation** — cross-language query expansion, multilingual aliases, reranking, and translated top-k context remain retrieval-layer work.
