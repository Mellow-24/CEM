# Agent Note: Session response-language selection

Status: implemented

English | [中文](2026-08-31-session-response-language-selection.zh.md)

## Problem

The two Macau customer-service presets asked the model to infer a reply language from each customer message. The same rule appeared in both personas, the RAG tool guidance and result suffix, and the Wiki guidance. A fixed user preference could not be represented, short or mixed-language messages could change the answer language accidentally, and no durable fact explained why a request used one language.

Input language, reply language, knowledge-source language, and Web UI locale are independent facts. Coupling them would make an English preference route a Chinese question to an English knowledge copy, while reusing the browser locale would turn a presentation setting into model behavior.

`verifyOutput` defaults to `true`, enabling buffered correction; `false` retains language resolution and instructions without withholding output. Both customer-service presets disable buffering for [sentence-by-sentence calls](2026-09-03-customer-service-voice-calls.md).

## Decision

`@deepseek-ai/dsh-response-language` owns reply-language selection and request resolution for an agent preset. The shipped [`macau-customer-service`](2026-08-29-macau-customer-service-knowledge-preset.md) and [`macau-customer-service-wiki`](2026-08-29-macau-customer-service-llm-wiki-preset.md) compositions mount it with `auto`, Simplified Chinese, Traditional Chinese, Macau Cantonese, Hong Kong Cantonese, English, and Portuguese choices. Their personas and retrieval packages own no second language-selection rule, following the [single prompt owner](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) decision.

The independent `@deepseek-ai/dsh-client-ui-response-language` package renders the current session's selector. Browser locale remains owned by `dsh-client-locale`; changing either value never changes the other.

## Resolution and persistence

`response-language/preference` records the complete selected value, with `auto` as the initial choice. `response-language/resolved` records the exact fixed language, turn, step, selected preference, resolution basis, and confidence used by one accepted request. Both events are required-on-read because they determine later prompt behavior; ordinary event-vocabulary growth leaves `SESSION_FORMAT_VERSION` at `0` under the [session-log version mechanism](../architecture/2026-08-10-session-log-version-mechanism.md).

The scoped plugin observes direct human inbox claims before system-prompt assembly. A fixed preference wins without inspecting the message. Auto resolution examines only direct human text and may restrict accepted detections with `autoDetectedLanguages`. An allowed decisive detection selects that language. Recognized English courtesies, backchannels, and closings carry the prior resolved language under either policy, and use the configured fallback when no prior resolution exists. With a restricted list, other unmatched direct input uses the fallback; internal tool continuations preserve the current turn's resolution. With the default unrestricted list, other ambiguous direct input carries the prior resolved language before falling back. Tool results, retrieved evidence, plugin context, and assistant text never participate, so Cantonese evidence returned for an English question cannot switch the final answer back to Cantonese.

The prompt section captures the resolution used by assembly. After the complete `agent/pre-step` waterfall accepts the step, the plugin appends the same resolution event; rejected or aborted steps commit none. The request header records the rendered system prompt, preserving the [reconstructable-request](../architecture/2026-07-05-reconstructable-requests.md) rule even if an append fails before dispatch. The section is terminal after tool guidance and normally requests buffered delivery. A completed text reply whose local detection decisively differs from the resolved language appends `response-language/retry`, discards uncommitted chunks, and retries once without resolving input again. An Auto retry supplies the discarded reply as JSON text and asks for only its customer-facing translation into the resolved input language; a fixed selection retains the direct retry instruction. Tool calls, streaming output, max-token output, ambiguous output, and the second attempt bypass language correction. When `verifyOutput` is false, the exact resolved policy also becomes the last recorded runtime-context entry for every step. That reminder tells the model to rewrite the writing system and register of prior replies, tool results, and evidence before emitting streamed customer text.

Reply-language resolution does not translate or rewrite the user message, a tool argument, or a retrieval query. Cross-language retrieval and conditional query translation remain separate retrieval concerns.

## Presentation and scope

The host plugin is mounted inside the two customer-service presets, so its prompt section and `/response-language` command follow the [per-session preset scope](../architecture/2026-08-03-per-session-agent-presets.md). The command changes the logged preference without opening a model turn. Resume and fork fold the same events; selecting the existing value is a no-op.

The two Macau customer-service presets restrict automatic detections to English and use Macau Cantonese as their fallback. Their text composer and voice-call transcript therefore share one policy: a substantive English request or explicit English-language instruction receives English, while Mandarin, Cantonese, Portuguese, unsupported, and ambiguous direct input receives Macau Cantonese. Short borrowed expressions such as `thank u`, `OK, thanks`, and `bye bye` retain the current session language instead of switching it. Sentence synthesis reads the logged `response-language/resolved` event, so its voice follows the model's required language without an independent audio-language decision.

`sessionProjections` is process-wide, so projection-key presence cannot represent per-session availability under the [host-plane ownership](../architecture/2026-08-10-host-plane-ownership-after-presets.md) rule. The `responseLanguage` projection therefore carries an explicit `available` field. An agent-preset selection makes it unavailable until a response-language-enabled composition records its preference. The browser hides false or absent values and renders the selector through the existing session-scoped `conversation.input.right` slot, following the [Web session scope and provide channel](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md).

## Verification

Host tests cover config validation, selection folds, unrestricted and restricted Auto detection, fixed-language precedence, ambiguous carry and fallback, borrowed-English continuation in Cantonese and English sessions, explicit English requests, direct-message-only resolution, claim-before-assembly ordering, accepted-step commits, streaming reminders, command no-ops, projection availability, preset switches, replay, disposal, and package invariants. Client tests cover projection absence, all choices, locked and pending states, command errors, accessibility names, slot registration, and teardown. Product snapshots boot both shipped customer-service compositions; the voice-call snapshot submits a Simplified Chinese Mandarin question, displays a Cantonese reply, selects the Cantonese voice, and preserves the streamed answer after hangup. The snapshot normalizer replaces volatile command lifecycle ids with stable correlated tokens.

## Alternatives considered

**Keep prompt-only language inference.** Rejected because the model would remain the unlogged policy owner, and a user's persistent preference would still be indistinguishable from a differently worded question.

**Use the Web UI locale.** Rejected because interface presentation and model reply language have different lifetimes and legitimate mismatches.

**Store the choice only in the browser.** Rejected because another tab, resume, fork, headless use, and request reconstruction would not share the value; the [event-sourced session](../architecture/2026-06-11-event-sourced-sessions.md) remains the authority.

**Create one preset or workspace per language.** Rejected because language is orthogonal to retrieval architecture and knowledge authority. Multiplying the two customer-service presets by every language duplicates composition and still fails when input and desired reply languages differ.

**Make the policy global for every agent.** Rejected for this delivery because it would change coding presets outside the customer-service request. A later deployment may mount the same package in more presets without changing the event or UI vocabulary.

**Treat projection-key presence as availability.** Rejected because the first preset registration installs that key for every session in the process. The explicit value prevents mount order from changing another session's controls.

## Consequences

Fixed selection adds no classifier or LLM call. Auto uses local deterministic analysis and the existing model call; each accepted request adds a small log event, while a decisive output mismatch adds one retry request and one retry event. Its retry reuses the discarded answer as a translation source instead of asking the model to regenerate the answer from the full conversation. The selector and prompt read Host-computed state, so there is no optimistic client authority.

The detector intentionally has a bounded language set and cannot infer every short, transliterated, code-switched, or dialect-neutral message. Shared Cantonese markers resolve unrestricted Auto as Macau Cantonese; callers choose the Hong Kong variety explicitly because ordinary Cantonese text does not identify the region reliably. A restricted Auto policy maps excluded and ambiguous direct input to its deployment fallback, except recognized English social continuations preserve the session language. The bounded business and social lexicons cannot classify every colloquial expression. The output verifier accepts standard Traditional Chinese wording for either Cantonese target because its local detector cannot establish a regional mismatch. Output correction acts only on decisive local results and is capped at one retry, so unsupported or ambiguous output can still pass. Multilingual aliases, hybrid retrieval, reranking, and conditional query translation remain outside this decision.
