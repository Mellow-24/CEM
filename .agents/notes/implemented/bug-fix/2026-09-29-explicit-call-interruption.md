# Agent Note: Explicit call interruption

Status: implemented

English | [中文](2026-09-29-explicit-call-interruption.zh.md)

## Problem

Transcript length and general question forms cannot establish that a caller wants to stop an assistant. Acknowledgements during generation bypassing playback-only screening, and ordinary bystander speech satisfying a three-character threshold, cancel otherwise useful answers.

## Decision

Optional [hybrid call interruption](../feature/2026-09-30-hybrid-call-interruption.md) supersedes rule-only admission and adds single-character suppression; this note retains the cancellation ownership and conservative screening rationale.

The call controller screens input for the entire owned reply, including generation and synthesis preparation. It captures whether a candidate began during that reply and retains screening through final recognition even if playback finishes first. Unaccepted hypotheses remain transient and cannot change the displayed phase, add a conversation message, or cancel synthesis. Muting clears pending interruption evidence.

Only explicit stop commands or final assistant-directed correction and clarification forms can claim the turn. A partial stop command needs the configured confirmation interval measured from recognized text; other directed requests require a final transcript. Short exact echo and longer similar echo are checked before intent, including quoted stop commands. Text length and arbitrary questions never independently authorize cancellation. Standalone stop commands clear pending questions and keep listening without another model request; compound commands retain the follow-up question. Listening without an active reply still accepts normal questions through the existing utterance merge interval.

This partially supersedes the admission criteria and playback-only activation in [context-aware call interruption](../feature/2026-09-15-context-aware-call-interruption.md). Its local screening, cancellation, manual interrupt, and interrupted-question continuation mechanisms remain active. ASR, answer-language selection, retrieval, and TTS providers retain their existing configuration.

## Alternatives considered

**Increase only the confirmation time.** Longer background speech still passes a length-based rule, and final recognition bypasses the partial delay. Delaying all recognition also slows ordinary questions without establishing intent.

**Add a model request or speaker enrollment.** A model call adds provider latency and does not identify speakers from text. Speaker enrollment needs audio identity evidence and a separate product flow; the current transcription stream provides neither. Conservative admission addresses accidental interruption within the existing latency budget.

**Treat every recognized question as an interruption.** This admits natural topic changes but also nearby conversation. Explicit stop, correction, or assistant-addressing forms are required during answers; general new questions remain available while listening.

## Consequences

Acknowledgements, noise without a command, and ordinary background conversation do not stop answers or become queued prompts. Genuine interruptions expressed as unaddressed new questions can be missed; callers can say a clear stop command or wait for listening. A bystander uttering the same accepted command remains indistinguishable without speaker verification. Provider mistranscription and acoustic conditions still require microphone testing.

Classifier and controller regressions cover acknowledgements, background questions, explicit commands, directed corrections, short echo, generation-time input, cancellation, and delayed final events. The assembled browser replay pins continued playback and unchanged history for ignored speech followed by accepted interruption. No extra model or speech-provider request is introduced.
