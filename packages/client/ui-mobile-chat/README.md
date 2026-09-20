# `@deepseek-ai/dsh-client-ui-mobile-chat`

English | [中文](README.zh.md)

CEM-branded mobile chat over the existing Host, Sessions, agent presets, and [browser voice runtime](../ui-voice/README.md). The Node half contributes configuration only. The browser owns a separate root, Session-local draft store, welcome questions, message timeline, history drawer, recording controls, and minimizable call screen. It does not mount on desktop `/` or `/customer`.

## Configuration and entry

`entryMode: preview` enables `/mobile.html?ui=cem-chat`; `entryMode: default` also enables `/mobile.html`. `/mobile.html?ui=legacy` always retains the original mobile root. The web bundle owns deployment selection; this plugin does not redirect browsers or register a service worker.

`defaultPreset` selects the initial customer agent and must occur in `servicePresets`. The latter limits the service picker and history to configured customer agents. `language` selects the call greeting and speech language. The defaults are `macau-customer-service`, both Macau customer-service presets, and `yue`. A missing workspace, unavailable preset, or failed resume is displayed with retry; no synthetic answer substitutes for a Host failure.

Opening a Session uses the Host's explicit-id creation to resume its persisted identity, workspace, and preset before requesting speech capabilities. A browser restores only the Session id it previously selected; without that local marker it starts a blank conversation instead of adopting the Host-wide current Session. After a connection reset, the mobile shell invalidates cached speech authority, resumes that exact Session, and only then reloads speech capabilities. Changing service starts a blank conversation rather than rewriting the preset of existing history. Browser storage remembers only the selected Session id; messages remain in the Host log. Typed drafts and unsent recordings are not durable across page reloads.

## Interaction and media

Recommended questions and typed messages use ordinary Session admission and stream the real assistant answer. Recording supports press/hold, slide-up cancellation, and a tap alternative. Recognized text joins the latest draft and waits for explicit Send. A late send receipt cannot erase a newer edit. No audio-message bubble is fabricated: the recording is not retained for playback.

Calls use the same Session as chat. Returning to chat minimizes the call without releasing media; explicit hangup, Session navigation, and page departure release capture and playback. Mute suppresses outgoing PCM and unfinished recognition; “我要說話” interrupts the owned answer while retaining recognition. Host microphone processing and VAD settings are unchanged.

The fixed call view prioritizes text over its compact status ring and keeps controls visible. It retains the current call's greeting, caller utterances, and generated answers, including interrupted text. The text region scrolls without visible scrollbar tracks and follows new content until the customer scrolls back; “回到最新對話” resumes following. Minimizing preserves the reading position. Text wraps even for unbroken identifiers. The shared controller owns this transient call transcript; only admitted messages are durable in the Host Session. Ring and recording-wave animations indicate state, not microphone level, and respect reduced motion.

Call text appears directly on the page: assistant text aligns left and caller text right, with speaker labels but no enclosing card, caption heading, or message bubbles.

Host question requests remain answerable with separate choices and custom text for every question. System-operation approvals can be rejected here; granting permission requires the complete original permission viewer. No permission is granted automatically.

Colors live in the theme-owned `[data-cem-mobile="chat"]` palette; component styles are scoped CSS Modules. The supplied logo is served from `/cem-mobile/logo.jpeg`. The page adapts to the visual viewport and safe areas without adding a simulated phone status bar.

## Model Experience

Indirectly, through ordinary Session prompts for typed, recommended, and confirmed transcribed messages and the Host speech package's existing logged call instructions; UI navigation, waveform animation, and draft editing add no model content.

#### KV Cache effect

Ordinary append-only conversation behavior; presentation does not change provider requests or cache policy.

## Known Limitations and Deferred Work

- **Device acceptance** — automated Chromium capture and replay cannot certify a particular Android browser, speaker, microphone, echo path, or certificate trust. Microphone use requires HTTPS and permission; browser-managed background suspension remains possible.
- **AI calls only** — the call button starts a browser AI conversation, not PSTN dialing or human-agent transfer.
- **Shared deployment** — local Session restoration prevents accidental adoption of another browser's current conversation, but UI isolation does not create separate customer authorization, history visibility, quotas, or data tenancy. LAN password exemption is a development choice, not a production authentication design.
- **Permission details** — granting administrative tool permissions stays in the original application. Mobile customer conversations should use an appropriately restricted agent preset.
