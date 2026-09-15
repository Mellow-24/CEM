# Agent Note: Context-aware call interruption

Status: implemented

English | [中文](2026-09-15-context-aware-call-interruption.zh.md)

## Problem

Stopping an audible answer on the first nonempty ASR hypothesis confuses recognized sound with an attempt to claim the conversational turn. Speaker feedback, a nearby voice, and passive acknowledgements can cancel useful audio and an unfinished model answer. Requiring only fixed interruption words misses ordinary questions and corrections phrased outside that list.

## Decision

The shared browser voice controller screens interruption intent only while answer audio is audible. Speech onset starts a candidate and keeps recognition active without stopping playback. A final ASR utterance is classified immediately; a partial hypothesis must remain meaningful for the deployment-configured `confirmationMs` before it can interrupt.

Classification combines ASR finality and elapsed speech with normalized information length, character diversity, question or correction form, whole-utterance backchannel structure, and similarity to the active answer. A meaningful utterance can claim the turn without matching a listed phrase. Short complete acknowledgements and likely playback echo are removed from the call-local draft without entering Session history. A confirmed interruption keeps the existing cancellation, interrupted-question carry-forward, and final-segment merge behavior. The manual interrupt action remains immediate.

The Host advertises all deployment-varying timing and thresholds under `call.interruption`: `confirmationMs`, `minimumMeaningfulCharacters`, `echoMinimumCharacters`, `echoSimilarityThreshold`, and `backchannelMaximumCharacters`. The CEM Web deployment uses 420 ms confirmation, three meaningful characters, six characters before echo comparison, 0.82 similarity, and six characters for short acknowledgements.

## Alternatives considered

**Call the conversation LLM for every partial hypothesis.** Rejected because a second provider request adds variable delay exactly when interruption must feel responsive, consumes quota during playback echo, and requires separately logged model-visible classifier inputs. The deterministic multi-signal classifier gives bounded local latency and explicit deployment controls.

**Use a speech-onset or volume threshold.** Rejected because it cannot distinguish the caller's intended turn from echo, noise, or an acknowledgement.

**Use only an interruption-word list.** Rejected because callers express corrections, questions, and topic changes in open-ended Cantonese, Chinese, English, and Portuguese. Listed sentence forms are one signal; finality, duration, content, and playback context remain independently decisive.

**Wait for every final transcript.** Rejected because a caller speaking a longer correction would hear the assistant continue until server VAD closes the utterance. Stable meaningful partial text may interrupt after the bounded confirmation interval.

## Consequences

Ordinary acknowledgements and likely speaker echo no longer stop audible answers, while explicit short corrections and general meaningful questions remain interruptible. Partial interruption gains up to the configured confirmation delay. The classifier is not speaker verification or an open-ended language model: meaningful bystander speech may still claim the turn, and unusual one- or two-character corrections may be ignored. Unit tests pin timing, acknowledgement removal, playback similarity, multilingual short corrections, continuation cancellation, profile validation, and Host advertisement.

This partially supersedes the recognized-text interruption decision in [call history and interrupted-question continuations](../bug-fix/2026-09-14-call-history-and-continuations.md); its transcript retention, carry-forward, merge interval, and durable Session admission remain active.
