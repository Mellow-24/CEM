# @deepseek-ai/dsh-client-ui-response-language

English | [中文](README.zh.md)

Reply-language selector for sessions whose agent preset contributes [`@deepseek-ai/dsh-response-language`](../../context/response-language/README.md). The browser half occupies the existing session-scoped `conversation.input.right` list slot immediately before send-time controls; the Node half is an empty roster plugin.

The component reads the Host-computed `responseLanguage` projection. An absent or `available: false` projection renders nothing, so mounting one customer-service preset cannot expose the selector in unrelated sessions. The trigger displays the persisted `currentValue`; Auto's latest detected language never replaces the `Auto` label. Fixed-language labels are autonyms, while Auto follows the Web UI locale.

A menu selection executes `/response-language <value>` through the Commands Remote. The control single-flights a pending selection, stays disabled until the pushed projection confirms it, and restores the projected value with a localized Toast when the command or transport fails. Removed sessions and submission-owned composer phases close and disable the menu.

## Model Experience

Indirectly, through the `/response-language` command the selector dispatches: [`@deepseek-ai/dsh-response-language`](../../context/response-language/README.md) owns the durable events and model-visible policy, while this package renders Host state and sends what a user can type directly.

#### KV Cache effect

The selector itself adds no model tokens. A successful change may alter the Host package's policy section on the next request; opening, closing, or failing the menu has no request effect.

## Known Limitations and Deferred Work

- **Default composer only** — a pending whole-composer interaction temporarily replaces the InputBar and its language control.
- **No account-wide default** — the first preference is the preset's `auto`; this stage provides no General-settings row for future sessions.
