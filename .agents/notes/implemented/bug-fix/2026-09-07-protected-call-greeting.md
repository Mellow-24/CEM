# Agent Note: Protect the fixed call greeting from acoustic interruption

Status: implemented

English | [中文](2026-09-07-protected-call-greeting.zh.md)

## Problem

Recognition speech-onset events do not distinguish the caller from loudspeaker feedback. Stopping the fixed greeting on the first onset can truncate an intact audio asset after its first words.

## Decision

The call prepares recognition and microphone capture concurrently with greeting playback but discards microphone frames locally until the greeting's natural end. Recognition onset and transcript events are ignored during that opening. Provider errors and hangup still terminate playback and release capture. After the greeting, ordinary recognition, transcript admission, and answer interruption resume without an additional timer.

This supersedes only greeting interruption in the [voice-call decision](../feature/2026-09-03-customer-service-voice-calls.md); its session ownership, transport bounds, and durable-text decisions remain active.

## Alternatives considered

**Trust onset or partial text during the greeting.** Neither proves that a human rather than the speaker produced the audio. Greeting-text matching can also suppress a legitimate short greeting from the caller.

**Disable interruption for every answer.** Rejected because callers need to interrupt longer generated answers; the protected interval is limited to the short fixed opening.

## Consequences

Callers must wait for the greeting before speaking; opening speech is not buffered or transcribed. No extra model request, durable event, or provider credential is introduced. Controller tests cover onset, partial/final echo, audio suppression, post-greeting upload, hangup, and provider failure. Browser replay for both customer-service presets verifies the prepared greeting reaches its natural end despite injected recognition events, then admits a question. Acoustic performance after the opening still depends on the playback device and environment.
