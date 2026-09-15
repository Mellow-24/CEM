# @deepseek-ai/dsh-client-ui-customer-portal

English | [中文](README.zh.md)

Customer-facing CEM conversation shell for the `/customer` Web route. The package replaces the root slot only on that path, so the standard DeepSeek Harness operator interface remains unchanged at `/`. It reuses the existing browser Session runtime, agent-preset selection, streaming event projection, cancellation, and browser voice runtime.

The portal activates or creates a blank Session in the current Workspace and selects the shipped `macau-customer-service` preset before the first prompt. Every visit opens on the greeting and grouped recommended questions. A fixed-height history rail lists non-blank, non-archived root Sessions that use the same preset, ordered by recent activity and paged eight at a time. Selecting one opens its canonical history, New conversation returns to a blank Session, and Delete conversation confirms before archiving the entry out of customer history while retaining its Session log for quality inspection. Running Sessions cannot be deleted. The customer route does not link to the separate `/customer-admin` operations portal or embed administration controls. Other presets, subagent work, tool calls, reasoning, configuration controls, and Workspace navigation are absent from the customer view.

The initial state presents a customer-service greeting and Traditional Chinese questions selected from exact approved FAQ headings in the Macau customer-service knowledge corpus: bills and payment, supply and contracts, outages and safety, and electric vehicles and applications. A typed or selected question enters the ordinary Session prompt path. The customer projection suppresses tool-calling assistant steps and first-step partial text, so lookup announcements never become customer messages. A visible progress card spans local submission, model preparation, and hidden knowledge lookup until answer prose begins streaming; later answer-stage partial text replaces that card through the existing stream, and a direct first-step answer appears when it is complete. The microphone uses the standard voice controller to record and transcribe one utterance into the composer. The header call control uses the same continuous recognition, interruption, prepared greeting, and sentence-synthesis controller as the standard conversation UI; its submitted text and answers remain ordinary Session history.

The official CEM wordmark is loaded from the public CEM website. Deployments that require offline operation should serve an approved local copy and update the asset URL in the component.

## Model Experience

Indirectly, through the ordinary Session prompt submitted by its typed, recommended-question, and transcribed-text controls; the selected agent preset owns every model-facing system prompt, tool, and response policy.

#### KV Cache effect

Submitting a question extends Session history like any other user message; the portal adds no prompt content or cache material of its own.

## Known Limitations and Deferred Work

- The customer route requires an existing Workspace because the shared Session runtime associates every new Session with a Workspace.
- Voice input and calls require the selected preset to expose transcription and synthesis profiles; the controls report an unavailable service instead of falling back to browser speech APIs.
