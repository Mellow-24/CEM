# Agent Note: Complete the MiniStream close handshake

Status: implemented

English | [中文](2026-09-21-ministream-close-handshake.zh.md)

## Problem

MiniStream retains realtime capacity until a TTS WebSocket completes a normal close handshake. Keeping a completed authenticated socket idle for reuse, or terminating an open socket after cancellation or failure, can leave provider-side capacity allocated until its stale-connection timeout. Repeated interruption and concurrent callers then receive capacity code 429 even when the Host has no live MiniStream TCP connection.

## Decision

Each MiniStream synthesis operation owns one fresh authenticated WebSocket. A provider `end` event completes audio delivery but does not release the operation until the client sends close code 1000 and receives the peer close frame. Cancellation and provider failures after `open` use the same normal close path. `closeHandshakeTimeoutMs` bounds the wait; expiry forces transport shutdown so an unresponsive peer cannot block request teardown indefinitely.

Cancellation before `open` terminates the incomplete transport because a WebSocket close frame cannot precede the opening handshake. A persistent error listener remains installed from socket construction through final closure so this termination cannot escape as an unhandled process event.

The provider does not pool or reuse MiniStream sockets. Browser sentence lookahead may still prepare one later sentence after current audio becomes audible, so concurrent synthesis uses separate, independently closed operations.

## Alternatives considered

**Retain the authenticated connection pool and shorten its idle timeout.** Rejected because MiniStream capacity remains allocated until close completes; any idle retention consumes capacity, and timeout disposal still needs the same handshake.

**Use `terminate()` for every cleanup path.** Rejected because it does not send close code 1000 or wait for peer acknowledgement, allowing the provider to retain a stale capacity allocation.

**Wait indefinitely for the peer close frame.** Rejected because provider or network failure would prevent HTTP response teardown and violate bounded resource cleanup.

## Consequences

Every opened operation either completes a close-code-1000 handshake or reaches a deployment-configured deadline before forced shutdown. Sequential sentences pay a new WebSocket handshake instead of reusing an authenticated connection, trading some startup latency for deterministic provider-capacity release. Provider tests cover normal completion, caller cancellation, capacity rejection, an unresponsive close peer, and cancellation during the opening handshake.
