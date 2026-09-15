# @deepseek-ai/dsh-client-ui-customer-service-admin

English | [中文](README.zh.md)

Macau power customer-service operations console. The dedicated `/customer-admin` URL presents a focused CEM-branded administration portal, while the existing full-screen Settings console remains available without visual or routing changes. Both presentations use the same stores and Host callbacks. The standalone portal exposes Workbench, Agents and channels, Current knowledge, Pronunciation and terms, Sessions, Quality and evaluation, and Reports; Conversation flows, model configuration, and prompt rehearsal remain available only in the legacy console. The default `zh` locale presents the operator workspace in Traditional Chinese; customer messages, historical answers, knowledge excerpts, filenames, and identifiers remain in their recorded source language.

## Operational data and configuration workspace

The explicitly selected live views use `ctx.remote.customerServiceAdmin` for overview, document inventory, retrieval, staged uploads, and the bad-case ledger. They show loading, empty, error, and retry states without substituting synthetic data. Model and preset links open the existing settings owners. Sessions defaults to canonical `useSessions` history, excluding blank and subagent rows. The Host quality reader inspects recorded messages, tools, and timing without resuming the source agent or exposing model reasoning. Refresh is explicit; reading another conversation does not change the active customer session.

The standalone portal occupies the root slot only on `/customer-admin` and renders seven business pages through a private keyed child slot. URL fragments preserve direct page selection, such as `/customer-admin#knowledge` and `/customer-admin#sessions`; a fragment for an excluded page resolves to Workbench. It shares the CEM orange-red and yellow identity of `/customer`, links back to that customer surface, and owns the browser title so a selected technical Session cannot expose the legacy product title. Workbench and Current knowledge open directly on live operational data. Provider identities are omitted from the standalone overview, knowledge, and quality views, while retrieval settings and operational results remain visible. The legacy Settings registrations remain mounted for the original operator shell.

Live TXT/Markdown uploads enter the Host's isolated staging directory with revision checks and no overwrite. RAG/Wiki retrieval returns evidence without generating an answer. There is no live knowledge publish, delete, or promotion control. Index readiness is not model endpoint health, and evidence ranking is not answer accuracy.

The configuration workspace uses a root-scoped `defineStore` created by the plugin, separate from every real-data callback. Drafts survive section navigation and closing the console within the current browser application; refreshing or confirming Reset workspace restores the fixtures, including unsaved editor fields. Workspace settings holds the data-source explanation and reset action; compact draft, validation-set, and disconnected labels distinguish unconnected features from live services. No workspace action writes settings, uploads files, calls a model or speech provider, or modifies a Session.

- Channels have editable greetings, languages, and enable switches with a text phone preview and unsaved-change feedback.
- Three fixed five-node flow templates support dragging, keyboard movement, editable names and normal successors, graph validation, and stepwise normal/empty/timeout simulation. They do not execute business queries or human handoff.
- Knowledge processing accepts one local TXT/Markdown file up to 256 KiB, splits paragraphs, permits chunk edits and substring search, then completes review without publication. Shared actions require a matching nonempty retrieval query before advancing and explicit approval before completing review. Editing content or the query invalidates verification and approval; these states survive section navigation. Files remain in browser memory. A/B/C answer editors provide fixed text, required business placeholders, and knowledge-answer policy.
- Pronunciation management separates language-aware general rules from exact term corrections. The rule workspace expands Macau address and bank abbreviations from the supplied reference tables and normalizes building numbers, dates, amounts, and percentages on a synthesis-only text copy. Operators can filter by language and category, toggle a draft rule, and compare display text with spoken text and rule hits. Exact Cantonese term corrections retain the 16 searchable entries and version-checked review behavior. Both previews are text, not synthesized audio.
- Sessions and Quality use independent viewing state and persisted Host records, not configuration fixtures. Search combines title/id/inferred intent, preset, quality status, score thresholds, and ten-row pagination. Filters survive navigation; weights reset on browser refresh, while each run retains its exact weights.
- Reports aggregate the same synthetic session batch with channel filters and a full-screen display. Missing real channel, language, or speech-version fields remain unknown.

## Operational verification workflow

Open Sessions → View details → Select all or one turn → Start quality inspection. Six-dimensional scores show short reasons, suggestions, and evidence buttons. Execution process renders the existing trajectory ledger through `operations.trace`; Retrieval evidence shows the original tool results, never a fresh search. Quality and evaluation lists persisted tasks and exposes weight drafts. Human review requires a reason, permits a separate total-score override, and supports opening, accepting, or reopening remediation. History remains readable after refresh. Missing evidence does not receive an invented score; failures allow a new run.

## Model Experience

### Quality inspection

#### What the model sees

Configuration rehearsal does not reach a model. Explicit `startQuality` inspection invokes the [Host evaluator](../../host/customer-service-admin/README.md#quality-evaluation) with the selected historical evidence. Reading, filtering, tracing, and human review do not call a model or change the live Agent composition.

#### Token effect

Each admitted quality task consumes one separately bounded evaluator request. Browsing the console adds no tokens to the customer conversation.

#### KV Cache effect

The quality request is independent and does not reuse or modify the customer conversation's request prefix.

## Known Limitations and Deferred Work

- Configuration rehearsal is not durable; quality records are locally persistent but have no multi-user authorization or authenticated reviewer identity. Traditional Chinese is the default Macau operator locale; Portuguese and English remain selectable.
- Channel connections, pronunciation-rule publication, synthesis playback, business integrations, and reviewed live publication are not implemented by rehearsal controls. A connected implementation must run the language-specific normalizer after answer generation, preserve the display text, then compile exact aliases or phonemes for the selected TTS provider. Quality remediation records an operator decision and does not publish a fix.
- PDF/Office extraction, OCR, arbitrary flow nodes and branches, and audio-aligned history require their own capabilities.
- Remote data is a point-in-time snapshot; the canonical runtime owns conversation catalog recovery. The recorded real bad-case ledger remains read-only.
