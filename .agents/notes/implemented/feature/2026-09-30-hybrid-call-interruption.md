# Agent Note: Hybrid call interruption

Status: implemented

English | [中文](2026-09-30-hybrid-call-interruption.zh.md)

## Problem

Explicit command rules miss natural corrections and follow-up questions. Treating any recognized speech as an interruption admits acknowledgements and background conversation. Auxiliary inference must not delay ordinary replies, stop playback speculatively, or cancel a later answer.

## Decision

The browser rejects empty input, single-character utterances, and standalone acknowledgements during an owned reply. A lone “停” remains non-interrupting after polite-prefix removal. Explicit stop commands use local rules; other completed overlap candidates use optional Host-configured classification while audio continues. Classifier context contains recent questions and actually audible sentences, not unplayed generated text.

The Host makes one bounded non-thinking request without retrieval or retries. Timeout, invalid output, cancellation, and capacity exhaustion mean continue. Candidate identity, reply identity, and abort signals govern acceptance. Noise-only speech onset preserves a completed candidate; actual new text replaces its request and retains adjacent segments. Classification time counts toward the existing merge interval.

The exact auxiliary request is logged as `speech/interruption-request`, with `ignorable: true`. It contributes no conversation message; older readers may skip it without changing reconstructed history. No ASR, answer-language, RAG, TTS, or conversation prompt setting changes.

This partially supersedes rule-only admission in [explicit call interruption](../bug-fix/2026-09-29-explicit-call-interruption.md); its full-reply screening, transient rejected input and cancellation ownership remain active. [Customer dialogue repair](../bug-fix/2026-10-05-customer-dialogue-repair.md) governs the accepted message without changing admission.

## Alternatives considered

**Rules alone.** Predictable and fast, but natural corrections depend on phrasing rather than intent.

**Classify every partial transcript.** Repeated provider calls consume quota, race against changing text, and can affect normal reply capacity. Only screened completed overlap candidates reach inference.

**Stop first, resume after rejection.** This creates audible pauses for acknowledgements and background speech. Playback continues until positive intent is confirmed.

## Consequences

Natural interruptions incur ASR finalization and auxiliary inference latency; ordinary questions and explicit local commands do not gain a classifier dependency. Text cannot identify speakers, and conservative timeouts can miss genuine interruptions. Focused lifecycle tests, actual-provider classification, composed browser replay on customer and mobile entries, and old-reader log replay cover admission, cancellation, playback continuity, and rollback safety.
