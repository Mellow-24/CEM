# Agent Note: Recover from short voice uplink stalls

Status: implemented

English | [中文](2026-09-14-recoverable-voice-uplink-backlog.zh.md)

## Problem

The browser used the 64,000-byte limit for one microphone upload as the limit for all queued and in-flight PCM. That amount represents two seconds of audio. A single slow request or a browser main-thread pause could therefore end an otherwise healthy call after recognition had already succeeded.

## Decision

The browser separates the per-request carrier limit from the total uplink backlog. Each ordered request still contains at most twenty complete 100 ms PCM frames, or 64,000 bytes. Frames captured during an in-flight request remain in FIFO order and are split across as many compliant requests as needed.

The Host advertises `call.maxPendingAudioMs` as a required deployment setting between 2,000 and 60,000 milliseconds in 100 ms increments. The browser counts queued and in-flight PCM against that duration and ends the call only when the combined amount exceeds it. The Macau web deployment uses 8,000 milliseconds, which retains at most 256,000 bytes of raw PCM while allowing a short request or scheduling stall to drain. No audio is dropped or reordered during recovery.

## Alternatives considered

**Increase the 64,000-byte request size.** Rejected because the Host route and Qwen provider framing intentionally cap one request. A larger browser body would either fail admission or create an oversized provider write.

**Remove the total backlog limit.** Rejected because a disconnected or permanently stalled upload would retain unbounded audio and could replay a stale question after recovery.

**Keep the two-second combined limit.** Rejected because it treats ordinary transient scheduling and transport latency as a terminal connection failure even when the provider connection remains healthy.

## Consequences

Short uplink stalls may delay recognition by the accumulated interval, but they do not force a reconnect. A sustained stall still ends the call at the configured bound. Client tests hold the first upload while forty frames arrive, then verify complete ordered delivery through carrier-sized batches; a separate stalled-upload test verifies the eight-second total bound. Host and client profile tests reject invalid durations and verify the resolved setting reaches the browser.
