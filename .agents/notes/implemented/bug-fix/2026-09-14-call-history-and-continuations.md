# Agent Note: Call history and interrupted-question continuations

Status: implemented

English | [中文](2026-09-14-call-history-and-continuations.zh.md)

## Problem

A latest-pair call view removes the opening and earlier exchanges when recognition replaces its current strings. A brief pause can also submit an incomplete question; interrupting its answer then admits only the supplemental phrase, making the intended question harder to reconstruct despite durable history remaining intact.

## Decision

The shared voice controller retains a call-local transcript with stable greeting, utterance, and turn/step answer rows. Partial ASR updates one draft; committing its segments closes that draft. Generated answer rows update from Session projections independently of TTS and remain marked as interrupted when playback or generation is cancelled. Muted or abandoned drafts remain labeled unsubmitted. Starting a new call resets this display-only transcript; greetings and unsubmitted drafts never become model history.

The CEM phone screen renders this transcript without a surrounding card. It follows new text by default, allows scrollback without visible scrollbar tracks, preserves a reader's position during updates and minimization, and offers an explicit return to the latest text.

Automatic interruption waits for nonempty partial or final ASR text. A wordless onset only renews an existing final-segment deadline. The Web deployment uses an 850 ms final-segment merge interval, trading 700 ms of additional waiting for fewer premature handoffs. With the provider's 250 ms silence window, the nominal handoff is about 1.1 seconds before transport and generation latency.

When recognized speech or the explicit interrupt action cancels an active answer, the next prompt contains that answer's question followed by all supplemental final segments. Cancellation reaches idle before admission; additional segments arriving meanwhile are joined in order. The new text is logged through ordinary Session submission without modifying earlier messages. Once an answer and its playback finish, the next question does not repeat the preceding question. Topic changes and corrections are interpreted by the existing model rather than a client-side classifier.

## Alternatives considered

**Keep only the latest pair and rely on chat after hangup.** Rejected because callers need to review the same exchanges while continuing the call.

**Disable interruption.** Rejected because genuine corrections must stop an unfinished answer; recognized text provides more evidence than an onset alone without requiring another provider.

**Rewrite or delete the earlier user message.** Rejected because it changes durable history and obscures what the interrupted answer received. Carry-forward is explicit in the next logged prompt.

## Consequences

Continuation prompts repeat earlier question text and therefore add input tokens. Transient call history is not a recording or durable replacement for the Session. Nonempty ASR is not speaker verification: background speech and hallucinations can still interrupt. Physical-device validation remains necessary.

Unit tests cover wordless onset, interrupted-question carry-forward, cancellation-time accumulation, completed-answer separation, transcript retention, and manual scrollback. An assembled keyless CEM browser scenario checks a 350 ms pause, logged combined prompts, interrupted text, greeting scrollback, successive audio, responsive layout, and persisted chat. This partially supersedes the onset-only interruption and short handoff in the [customer-service call decision](../feature/2026-09-03-customer-service-voice-calls.md); its authorization and lifecycle rules remain active. The [visible replies and fallback decision](2026-09-14-visible-call-replies-and-tts-fallback.md) continues to own audio-failure handling.

The [context-aware interruption decision](../feature/2026-09-15-context-aware-call-interruption.md) supersedes interruption on every nonempty partial or final result. Transcript retention, interrupted-question carry-forward, the merge interval, and durable admission remain active.
