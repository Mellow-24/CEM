# Agent Note: CEM mobile chat service development plan

Status: proposed

English | [中文](2026-09-12-cem-mobile-chat-plan.zh.md)

## Problem

The mobile H5 needs the selected CEM design B: a customer chat experience with recommended questions, typed and voice input, and a dedicated call view. Session continuity and agent selection must remain usable without exposing developer settings. The desktop application, the existing mobile interface, and the separate customer portal must remain available during development and verification.

## Proposal

Build an isolated mobile presentation plugin over the existing backend and client runtime. The [mobile package](../../../../packages/client/ui-mobile-chat/README.md) implements the preview at `/mobile.html?ui=cem-chat`. The proposal remains active for physical-device acceptance and the default mobile entry switch; desktop, `/customer`, and the default legacy mobile entry remain available.

### Implemented preview and acceptance evidence

The preview includes recommended questions, real streaming chat, Session restoration/history, customer-agent selection, editable voice transcription, and a dedicated call screen with real mute/manual interruption and minimize/restore. The shared voice implementation is accessed through `ctx.voiceRuntime`, not a copied transport. Explicit-id Session creation resumes dormant agents before speech-profile lookup, including after a service restart, without fabricating a model turn. Permission requests can be declined on mobile; granting system-operation permissions stays in the original complete permission viewer.

The focused browser scenarios exercise the shipped Host and client composition with replayed providers, including draft review, call cleanup, durable text, and old-entry isolation. Credentialed deployment checks separately verify actual ASR transcription, realtime recognition setup after greeting playback, model response and refresh recovery; the MiniStream real-API test verifies MP3 synthesis. These checks do not certify an Android microphone, speaker, certificate trust, acoustic echo, noise-interruption behavior, or background suspension. Default entry switching remains gated on that device acceptance. Package typecheck, builds, and focused lint pass; repository-wide checks still report unrelated baseline and missing-Git-metadata failures.

The [independent mobile entry](../../implemented/architecture/2026-09-11-independent-mobile-web-entry.md) continues to own desktop/mobile document isolation. The [customer portal](../../implemented/feature/2026-09-12-cem-customer-conversation-portal.md) continues to own `/customer`; its fresh-conversation policy is not the policy for this mobile revision. Neither decision is superseded by this proposal.

### Scope and verified starting point

| Area | Existing implementation | Planned mobile B behavior |
|---|---|---|
| Entry | `/mobile.html` carries `data-dsh-mobile` and uses MobileFrame; `/customer` selects its own root | New mobile-only root, with an explicit preview selector and a legacy fallback |
| Conversation | Existing Session runtime provides prompts, streaming, cancellation, and history | Render customer-friendly messages while keeping the same durable records |
| Agent | The customer portal selects `macau-customer-service` for a blank Session | Default new customer Sessions to the configured customer preset; preserve existing Session assignments |
| Voice input | The voice controller supports start, stop, cancellation, and transcription | Press-to-talk or accessible tap recording, followed by editable recognized text |
| Calls | The call controller supports start/stop, phases, captions, and synthesized answers | Dedicated call view tied to the current Session; add real mute/manual-interruption controls before claiming prototype parity |
| Brand | The customer portal references a remote logo | Bundle an approved local copy of the supplied CEM logo; scope orange-red/yellow styling to mobile B |

The inspected integration owners are the [mobile entry](../../../../apps/web/mobile.html), [layout registration](../../../../packages/client/ui-layout/src/client/index.ts), [customer portal registration](../../../../packages/client/ui-customer-portal/src/client/index.ts), [voice runtime factory](../../../../packages/client/ui-voice/src/client/index.ts), and [call controller](../../../../packages/client/ui-voice/src/client/call.ts). Reuse their public runtime operations, not copied transports or component-internal subscriptions.

This iteration includes welcome, chat, history, service-agent selection, voice input, and in-browser AI calls. It excludes design A, developer settings, model/key configuration, backend replacement, real telephone-number dialing or human call transfer, account/billing-system integration, audio-recording storage, automatic call summaries, and production authentication changes. Recommended questions are conversation starters, not evidence that account lookup or payment execution is connected.

### Screens and interaction

**Welcome.** Use the original CEM mark, the title “澳電智能客服”, a short greeting, four service questions covering bills, payment, outages, and electricity applications, and a prominent “與澳電助手通話” card. Keep history and service selection lightweight in the header or a drawer; no settings page. Brand text is Traditional Chinese for Macau; engineering documentation remains bilingual English/Simplified Chinese.

**Chat.** Use left assistant/right user bubbles, readable streaming text, restrained timestamps, and a fixed bottom composer. The microphone switches input mode; the phone opens continuous calling. Preserve drafts on failed submission, show a retry action, and prevent duplicate submissions. A “停止回答” action cancels only the selected Session's applicable turn. Stop automatic scrolling when the reader moves upward and show “回到最新消息”. Required approvals and user questions remain actionable even though internal tool traces are collapsed.

**Voice input.** Show “按住說話”, recording progress, and “上滑取消”; support pointer cancellation and an equivalent tap-based action. Releasing ends recording and places the transcript into an editable draft; sending remains explicit. This deliberately replaces the prototype's “鬆開發送” wording to allow recognition corrections. Cancellation submits nothing; late recognition after cancellation or a Session switch cannot enter another draft. Do not show an audio playback bubble unless a real retained audio source exists; recognized text is the first-release message format.

**Call.** Show “澳電語音助手”, an elapsed timer after connection, a restrained brand animation, the actual call phase, and legible user/assistant captions. “返回聊天” minimizes the view and shows a persistent call banner without ending it; “結束通話” releases capture, recognition, and playback. Reopening the view does not create a second call. Chat and call share one Session; already submitted text remains after hangup, while interim recognition and a cancelled answer are not presented as completed messages.

The call controls are mute, hangup, and “我要說話”. The shared controller exposes `setMuted` and `interrupt` through its existing runtime service; mute suppresses outgoing microphone frames, and manual interruption stops the owned answer without ending recognition. Existing callers retain their behavior. No duplicate exported voice factory or transport is introduced.

The call screen reserves most available height for current captions, with a compact status ring and fixed controls. A bottom-aligned, clipped text window fades older overflow at its top instead of exposing nested scrollbars; long identifiers wrap. Current text remains during listening pauses, and replacement comes only from the shared controller's current utterance and audible-answer state. Timed caption deletion would remove text before slower readers finish, while a second local transcript store would duplicate Session ownership; neither is introduced. Full admitted messages remain accessible in chat. Browser regression covers long answers, the newest line's visibility, reduced motion, and controls at narrow, short, and landscape viewports; physical Android rendering still needs confirmation.

Call text uses a borderless conversational layout: assistant on the left, caller on the right, and small speaker labels without a caption heading or message bubbles. This keeps the customer's requested dialogue presentation separate from the shared media implementation.

Use at least 48-pixel touch targets, safe-area insets, keyboard/visual-viewport sizing, text scaling, visible focus, accessible names, and reduced-motion behavior. Color and animation supplement readable states rather than carry their meaning alone. Do not promise earpiece/speaker routing or lock-screen background calling without device-specific evidence.

### Version isolation and file ownership

Use the existing boot-enabled HTML document for preview: `/mobile.html?ui=cem-chat`. This avoids adding an HTML entry that the [static frontend server](../../../../packages/host/frontend-static/src/index.ts) does not inject with boot configuration. Retain `data-dsh-mobile` so the mobile greeting playback adapter remains selected.

| URL | During development | After mobile acceptance |
|---|---|---|
| `/` and `/index.html` | Existing desktop | Unchanged |
| `/customer` | Existing customer portal | Unchanged |
| `/mobile.html` | Existing mobile | Mobile B after explicit switch |
| `/mobile.html?ui=cem-chat` | Mobile B preview | Mobile B |
| `/mobile.html?ui=legacy` | Existing mobile | Existing mobile fallback |

Introduce a validated presentation-only plugin option with preview/default modes; default it to preview during development. Match the mobile pathname and selector explicitly, reject unsupported configured values, and leave unrelated routes untouched. Do not redirect based on user agent. Query selection affects presentation only, never authentication or permissions.

The implementation directory is `packages/client/ui-mobile-chat/`, with package name `@deepseek-ai/dsh-client-ui-mobile-chat`. The following initial component decomposition is a design guide; the package README and source tree own the implemented file layout:

```text
packages/client/ui-mobile-chat/
  src/index.ts
  src/invariant.ts
  src/client/index.ts
  src/client/store.ts
  src/client/presenter.ts
  src/client/MobileChatRoot.tsx
  src/client/Welcome.tsx
  src/client/MessageList.tsx
  src/client/Composer.tsx
  src/client/SessionDrawer.tsx
  src/client/CallScreen.tsx
  src/client/MobileChat.module.css
  src/client/assets/cem-logo.*
  tests/
  README.md
  README.zh.md
  README.i18n.yaml
```

The plugin owns presentation, drafts, selection, and gesture state. Existing Session/Workspace services own conversation data; the existing voice runtime owns media. Register through slots and their standard store/injection mechanisms, with effect-owned cleanup. Components receive plain view data and callbacks. Do not reproduce the customer portal's runtime subscriptions inside new presentation components.

Only the web composition/dependency registration and client build configuration should need shared integration edits, plus any reviewed additive voice-controller work. Keep desktop layout, old MobileFrame, `/customer` components, global theme defaults, backend APIs, persistence formats, and existing speech preset values unchanged. Where presentation conflicts, copy and isolate the small view first; do not clone Session/agent runtimes, ASR/TTS transports, or the entire customer portal package.

Use CSS Modules and mobile-root-scoped semantic theme overrides, following [web styling](../../../../docs/web-styling.md). No unscoped `body`, shared button, or desktop theme overrides. Mobile-specific title/language changes must have scoped cleanup. Only namespace transient mobile UI persistence; a second message database or session log is unnecessary.

### Session, agent, and failure behavior

On entry, restore the last accessible customer Session when valid; otherwise show the welcome state and create/select an authorized blank Session when an action needs it. Validate stored identifiers against the current runtime after reconnect. Do not reuse the portal's unconditional fresh-conversation behavior or change an existing nonblank Session's agent silently.

Provide history, new conversation, and reopening existing conversations through the current Workspace/Session operations. A customer-facing history filter is not an authorization mechanism: do not expose operator Sessions merely because the same local server can list them. Real multi-customer isolation must come from backend identity/authorization before public deployment.

Default new Sessions to the configured customer-service agent. If the backend exposes additional allowed service agents, show a simple service selector rather than developer settings. Changing service during an active conversation creates a new Session after confirmation; opening history retains that Session's agent. Hide unsupported voice actions for an agent without speech profiles and explain why; text conversation stays available.

Recording, calling, and other audio playback are mutually exclusive. Block Session/agent switching during a call or confirm hangup and await cleanup first. Leaving the page releases media; reconnecting never automatically redials or resends a possibly accepted prompt. Network, permission, recognition, synthesis, and playback errors have separate readable messages, retries where safe, and a typed-chat fallback. Keep same-origin API access and existing authorization; no frontend provider keys or new public network exposure.

### Implementation steps

1. **Establish the baseline.** Confirm the selected three-screen design, capture current desktop/legacy-mobile/customer behavior, and record existing test failures. Audit Session restoration, approvals, and voice lifecycle operations; specify the missing mute/interruption API and its review requirement. Deliver a route-isolation and capability checklist.
2. **Add the isolated shell.** Create the mobile plugin, composition registration, scoped brand assets/styles, and preview selector. Implement welcome, empty/loading/error screens, header, drawer, and responsive geometry. Deliver a clickable preview; the default mobile URL still renders the existing UI.
3. **Connect text, Session, and agent workflows.** Bind the real Session projection, recommendation prompts, streaming, cancellation, draft recovery, history, and authorized service selection. Preserve approvals and user-question handling. Deliver continuous conversations across navigation and refresh without changing agents or duplicating messages.
4. **Connect voice input.** Reuse recording/transcription controllers; add hold/tap gestures, cancellation, reviewed transcripts, permissions, and text fallback. Test delayed permission grants and recognition completion after cancellation. Deliver real voice-to-text input, not simulated recording.
5. **Build the call experience.** Reuse the current Session's call runtime; add dedicated/minimized views, phase captions, elapsed time, and hangup cleanup. Implement reviewed mute/manual-interruption operations with old-caller regression coverage. Treat VAD/noise-policy changes as a separate audio task; UI work alone cannot fix false interruptions. Deliver real multi-turn calls with clear failure recovery.
6. **Verify assembled behavior and real phones.** Add focused unit/component tests and keyless assembled-Web snapshots, then run real speech smoke tests with approved existing credentials. Cover Android Chrome and the actual Android system browser; add iPhone Safari before claiming support there. Record screenshots and limitations, including speakerphone, headset, background noise, weak network, and background/foreground transitions.
7. **Switch and retain rollback.** After acceptance, switch only the mobile presentation option, publish matching plugin/frontend build artifacts, and verify the phone URL. Preserve the legacy selector and previous frontend artifacts. Roll back presentation/configuration only; never delete Sessions, credentials, certificates, or recorded history. Document the supported rollback window before removing legacy presentation in a separate change.

The application serves built client-plugin bundles; rebuilding only the HTML/frontend shell is insufficient. Build each changed client plugin and the frontend before assembled checks, following [client package instructions](../../../../packages/client/AGENTS.md) and [testing policy](../../../../docs/testing.md). Reuse the current backend process/configuration where possible; schedule any necessary restart rather than assume that editing source updates the running site.

## Alternatives considered

**Restyle the shared desktop/mobile components.** This increases coupling to the desktop and makes a safe preview and rollback harder. Keep the existing layouts intact and register a separate mobile root.

**Point mobile users directly to `/customer`.** That route is a useful implementation reference, but its fresh-Session entry behavior and existing design do not satisfy mobile history and the selected three-screen interaction. Preserve that independently usable version.

**Create a second full frontend/backend stack.** Separate servers and copied transports add deployment and state-consistency work without meeting an additional requirement. Isolate the presentation package while retaining the existing authenticated API and runtime.

**Start with a new HTML file.** It requires coordinated boot injection, static-serving, and build changes. The existing mobile document plus an explicit preview selector provides version isolation without changing server routes; reconsider a separate document only if distribution requirements demand it.

## Acceptance criteria

- Desktop, `/customer`, and legacy mobile retain their appearance and behavior; no duplicate root UI, global brand leakage, unexpected microphone access, or changed speech defaults appears outside mobile B.
- Recommended questions and typed messages reach the real backend once, stream into readable answers, survive refresh through Session history, and support cancellation/error recovery. New/reopened Sessions retain the correct agent; required approvals remain usable.
- Voice input records, cancels, transcribes, and permits correction; recognition failures preserve typed drafts. No cancelled or late transcript is submitted, and no unavailable audio playback is advertised.
- Calls support multiple turns, truthful states/captions, minimize/restore, working mute/manual interruption, and hangup cleanup. Text already submitted remains in the same Session; stale audio cannot play after switching or exiting. A call UI without real controls does not count as prototype parity.
- At 360, 390, and 430 CSS-pixel widths, text scaling and the soft keyboard do not obscure messages or controls. A physical Android phone on the existing trusted HTTPS entry completes both voice input and calls; additional browser support is claimed only after testing.
- Focused mobile tests, legacy regression tests, and assembled keyless snapshots cover the changed behavior. Real speech/device results are reported separately from mocked tests; pre-existing failures are documented, not hidden or repaired outside scope.
- Default entry switching and rollback are demonstrated without resetting backend data. Service restarts preserve the existing deployment configuration and recorded Sessions.

## Risks

The existing false-interruption problem remains an independent audio-quality risk. Manual interruption provides control but is not a substitute for improved detection and device testing; unresolved noise behavior must remain visible in acceptance results.

Shared voice-controller changes can affect other versions despite isolated CSS. Keep additions explicit, preserve existing defaults, and test desktop, legacy mobile, and customer-portal call paths whenever shared media logic changes. Review any required public API addition before implementation.

Browser audio permissions, playback policy, device processing, and background suspension can limit the experience. Local HTTPS trust and same-origin access remain prerequisites for the current deployment; visual redesign does not remove these requirements. Public deployment needs a separate identity, authorization, privacy, and operational-readiness review.

Keeping two mobile presentations costs maintenance. Restrict duplicated code to presentation and define a later retirement decision; do not remove the working fallback while the replacement is still under evaluation.
