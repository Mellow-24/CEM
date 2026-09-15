# Agent Note: Independent mobile web entry

Status: implemented

English | [中文](2026-09-11-independent-mobile-web-entry.zh.md)

## Problem

The existing browser application is a desktop-oriented workbench. A mobile surface needs a different interaction model for text, microphone, and call actions, but changing the assembled desktop shell would increase regression risk for the existing Web UI.

## Decision

The Web frontend builds two HTML documents that both load `AppWebEntry` and receive the Host boot manifest. `index.html` selects the desktop AppFrame; `mobile.html` declares `data-dsh-mobile` and selects MobileFrame in the same layout plugin. The mobile frame renders one panel at a time through the existing conversation, sidebar, details, and overlay slots. Both documents share the client plugin composition, Session service, Agent presets, model selection, tools, approvals, and configured speech providers. No mobile-only message store or agent transport exists.

MobileFrame keeps panels mounted across navigation, returns to chat on Session selection, and sizes itself to the visual viewport for keyboard changes. Conversation-owned CSS scopes mobile adjustments to the explicit document marker, including wrapped composer controls and the mobile hero. Mobile boot documents run through index taps just like the desktop entry; unrelated HTML assets do not receive executable boot configuration.

The mobile voice platform fetches greetings, call sentences, and committed-message audio through the page's same-origin credential path and plays local Blob URLs through one media element per runtime. Native media loading can fail independently of authenticated page requests, and a gesture that unlocks one element need not authorize later-created elements. The same unlocked element therefore survives successive sentences and replies. Silent unlock audio publishes no call events. Preparation owns its download and Blob URL; only the active preparation may clear the shared media source. Desktop playback retains progressive direct URLs.

## Alternatives considered

**Make the existing desktop shell responsive.** Rejected: responsive layout alone does not provide the distinct mobile interaction model, and it couples mobile iteration to the desktop regression surface.

**Create a second client-plugin composition or call the model directly from the mobile page.** Rejected: either approach duplicates Session ownership, tool execution, permission handling, and speech lifecycle. A different presentation does not require a second agent runtime.

**Expose greeting routes without authentication or disable certificate checks.** Rejected: a media compatibility fix does not authorize weakening deployment access control. Page-authenticated loading retains the existing server checks and reports HTTP, download, and playback failures separately.

## Consequences

The built frontend exposes `/mobile.html` alongside `/` without changing desktop entry selection. Agent capabilities and speech availability follow the selected Host preset. Calls use the existing browser voice conversation, not telephone-number dialing. Browser tests exercise the assembled mobile application's streaming response, tool result, persisted history, Session selection, Agent selection, cancellation, and voice-call hangup; frame tests cover panel lifetime and keyboard geometry.

Serving the mobile document does not alter network trust: the server remains loopback-only by default. A physical phone needs an explicitly secured network route to the Host; microphone access additionally needs a browser-trusted secure context. Publishing an unauthenticated agent endpoint is outside this presentation change.

Mobile playback tests cover early clicks, source reuse, isolated prefetch cancellation, late play rejection, HTTP errors, invalid responses, media errors, and Blob cleanup. Assembled browser replay rejects native-media greeting requests while admitting page fetch, snapshots a 403 failure, and exercises reconnection. The CEM replay denies newly created media elements after the greeting and requires audible successive replies on the unlocked element. Each mobile sentence waits for its complete, Host-bounded audio response before playback, which can add startup delay; one-sentence lookahead overlaps the next download with current playback. Caption projection and provider fallback remain independent concerns owned by the [call reply and fallback decision](../bug-fix/2026-09-14-visible-call-replies-and-tts-fallback.md). Vendor-specific phone playback still requires device verification; these checks do not claim that every media error 4 has the same cause.
