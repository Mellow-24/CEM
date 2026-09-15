# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings and operations-console shell, ownerless copy, and durable product-onboarding namespace. It occupies `sidebar.settings` with the trigger chrome and renders the customer-service console as a full-screen page while retaining a near-full-viewport dialog for ordinary Settings, projects the `settings.section` ledger into an independently scrolling navigation rail and the `settings.onboarding` ledger into one mounted step at a time, and registers everything on the Settings pages that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, and the `settings` dictionaries. The navigation remains usable when six or more sections are registered. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance), sections (Models), and conditional onboarding steps stay with their feature packages.

The shell ships no onboarding copy of its own — all text arrives from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on a section-ledger change or locale revision. When `customer-service-overview` is registered, the trigger and title identify the Macau Power intelligent customer-service operations console, opening without an explicit section selects that overview, and the console replaces the application viewport as a page; other compositions retain the Settings copy, dialog presentation, and first-section default. An onboarding step's explicit `openSection(id)` selection always takes precedence. The onboarding ledger projects in ascending order and mounts exactly one step at a time. Visible steps own their dialog chrome and app-root `inert` lifecycle; a mounted step still resolving private facts renders null, so nothing paints or blocks while it decides. The active registrant receives its id, `complete()`, and an `openSection(id)` callback; completing or skipping transfers ownership to the next entry. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source.

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the console or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

The Host half registers `ui-onboarding` in the user-settings seam. The welcome step contributed by `ui-settings-models` reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

The full-screen console groups customer-service sections ahead of a collapsed Developer maintenance list. Business pages hide configuration-file actions; technical pages retain them. Section navigation callbacks select registered pages inside the same shell. The console header carries the 深 brand mark. Its Settings and operations chrome has complete `zh`, `en`, and `pt` dictionaries.

## Model Experience

None, as the plugin renders browser settings UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The General section has no built-in rows; each row appears only when its owning feature plugin is mounted.
- The console keeps component-local navigation state and intentionally provides no URL route or deep link.
