# Agent Note: Context-aware call interruption

Status: implemented

English | [中文](2026-09-15-context-aware-call-interruption.zh.md)

## Problem

Stopping an audible answer on the first nonempty ASR hypothesis confuses recognized sound with an attempt to claim the conversational turn. Speaker feedback, a nearby voice, and passive acknowledgements can cancel useful audio and an unfinished model answer. Requiring only fixed interruption words misses ordinary questions and corrections phrased outside that list.

## Decision

The shared browser voice controller screens recognized text locally before cancelling an answer. Speech onset starts a candidate and keeps recognition active without stopping playback. The admission criteria, confirmation clock, and activation window are governed by [explicit call interruption](../bug-fix/2026-09-29-explicit-call-interruption.md), which supersedes playback-only screening and length-based turn claims.

Classification uses ASR finality, explicit request form, whole-utterance backchannel structure, and similarity to the active answer. Rejected hypotheses do not enter Session history. A confirmed interruption keeps cancellation and final-segment merging; [customer dialogue repair](../bug-fix/2026-10-05-customer-dialogue-repair.md) governs the submitted text. The manual interrupt action remains immediate.

The Host advertises deployment timing and thresholds under `call.interruption`. The [voice client](../../../../packages/client/ui-voice/README.md#voice-calls) owns their current interpretation.

## Alternatives considered

**Call the conversation LLM for every partial hypothesis.** Rejected because a second provider request adds variable delay exactly when interruption must feel responsive, consumes quota during playback echo, and requires separately logged model-visible classifier inputs. The deterministic multi-signal classifier gives bounded local latency and explicit deployment controls.

**Use a speech-onset or volume threshold.** Rejected because it cannot distinguish the caller's intended turn from echo, noise, or an acknowledgement.

**Use only an interruption-word list.** Rejected because callers express corrections, questions, and topic changes in open-ended Cantonese, Chinese, English, and Portuguese. Listed sentence forms are one signal; finality, duration, content, and playback context remain independently decisive.

**Wait for every final transcript.** Rejected because a caller speaking a longer correction would hear the assistant continue until server VAD closes the utterance. Stable meaningful partial text may interrupt after the bounded confirmation interval.

## Consequences

Local screening adds no model request. Explicit interruption retains cancellation and same-utterance merging; the superseding policy narrows which utterances can enter that path. The classifier does not verify speaker identity. Unit tests pin acknowledgement removal, playback similarity, cancellation, profile validation, and Host advertisement.

This partially supersedes the recognized-text interruption decision in [call history and interrupted-question continuations](../bug-fix/2026-09-14-call-history-and-continuations.md); its transcript retention, merge interval, and durable Session admission remain active.
