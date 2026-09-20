# Agent Note: Contain mobile voice cancellation and recover its Session

Status: implemented

English | [中文](2026-09-20-mobile-voice-cancellation-recovery.zh.md)

## Problem

Cancelling a customer answer could terminate a MiniStream WebSocket while its handshake was still opening. The one-shot acquire listener was removed before `terminate()`, while the connection-pool listener was installed only after a successful open. The resulting `error` event had no listener and exited the Node.js process. Nginx then returned 502 for the cancellation and every concurrent request until systemd restarted the Host.

After a restart, the mobile shell refreshed its speech profile before explicitly resuming the persisted Session, so the Host returned `SESSION_NOT_LIVE`. A browser without a remembered mobile Session also adopted the Host-wide current Session, allowing separate devices on one shared deployment to enter the same conversation unintentionally.

## Decision

The MiniStream pool owns each socket before awaiting its opening handshake and installs persistent `error` and `close` containment at that point. Cancellation discards the owned connection; a terminal error can close that operation but cannot become an unhandled process event.

The CEM mobile shell restores only the Session id stored by that browser. A missing local marker starts a blank customer conversation instead of falling back to the Host-wide current Session. On connection reset, the shell deactivates media and invalidates cached speech authority, resumes the exact active Session id, and refreshes the speech profile only after that resume settles. Session and transport failures use a customer-connection retry label; recording and speech-profile failures retain the speech-service retry label.

The desktop and `/customer` entries keep their existing selection and presentation behavior. They share the hardened MiniStream provider and therefore gain process-crash containment without a UI or Session-selection change.

## Alternatives considered

**Install a process-level uncaught-exception handler.** Rejected because it would hide unrelated lifecycle defects and leave process state uncertain after an exception. The socket owner handles the expected terminal event locally.

**Refresh the speech profile immediately on connection reset.** Rejected because speech authorization belongs to a live Session scope; fetching it before explicit-id resume deterministically returns `SESSION_NOT_LIVE` after a Host restart.

**Restore the Host-wide current Session when browser storage is empty.** Rejected because `current` is shared deployment state, not browser identity. It can make one device cancel or continue another device's conversation.

## Consequences

Cancelling during a MiniStream handshake rejects only that synthesis request, and a Host restart no longer follows this path. Mobile reconnect performs an extra explicit-id resume before its speech-profile request. Browsers using the earlier mobile storage marker begin one blank conversation under the new marker; persisted conversations remain in Host history.

This client selection rule prevents accidental current-Session adoption but does not provide authorization or tenant isolation: users on a shared deployment can still enumerate customer history unless deployment authentication and Host authorization isolate them. Provider tests cover cancellation during an incomplete handshake, and assembled mobile-slot tests cover fresh activation and resume-before-profile ordering.
