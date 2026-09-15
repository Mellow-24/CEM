# Agent Note: Macau customer-service administration console

Status: implemented

English | [中文](2026-09-04-customer-service-admin-console.zh.md)

## Problem

The Macau customer-service presets have production-shaped RAG and LLM Wiki retrieval, but a demonstration operator needs one coherent view of model settings, corpus state, retrieval behavior, regression cases, and historical conversations. Letting a browser inspect deployment paths directly would expose Host layout and bypass the approval rules owned by the two retrieval packages. Letting an upload write into either live source root would make a UI action equivalent to knowledge approval or Wiki publication.

The normal Remote carrier may also be bound beyond loopback through an explicit trusted-host configuration. Corpus inventory, failed evaluation cases, and filesystem writes are an administration plane, so ordinary Remote registration alone is not an adequate network access decision.

## Decision

The console is a complete capability seam with one narrowly coupled Host Definition/local Provider package, `@deepseek-ai/dsh-host-customer-service-admin`, and one browser Consumer, `@deepseek-ai/dsh-client-ui-customer-service-admin`. The roles remain in separate Host and Client packages; the Definition and filesystem Provider stay together because their only implementation is a projection of the deployed Macau retrieval stores and they evolve as one operational API. The platform-neutral `api-remotes` assembly mounts its generated Typert contribution rather than adding a second hand-written API-proxy domain.

`CustomerServiceAdminGateway` owns the `customerServiceAdmin` namespace. Its knowledge methods are `overview`, `listDocuments`, `listBadCases`, `searchTest`, `listStagedDocuments`, and `stageTextDocument`; [conversation quality inspection](2026-09-09-conversation-quality-inspection.md) owns the additional evaluation and review methods. Every cross-package document, release, page, evidence, bad-case, and staging revision id is branded. Public request and result declarations live in a types-only module, and generated `./typert` and `./remote` artifacts keep the Host implementation out of the browser dependency graph.

The Provider delegates approval and retrieval validation to the existing [`LocalKnowledgeIndex`](2026-08-29-macau-customer-service-knowledge-preset.md) and [`WikiReader`](2026-08-29-macau-customer-service-llm-wiki-preset.md). RAG inventory comes from the validated versioned source manifest; disposable index metadata is read under an explicit byte limit and reports structural state separately from whether its identity matches current sources and configuration. Wiki inventory is pinned to the current validated immutable release, while raw Wiki sources are classified as published, changed, or unpublished by exact SHA-256 comparison with release artifacts. The bad-case JSONL reader rejects invalid ISO capture times and returns only query, verdict, diagnosis summary, failure types, and acceptance criteria; captured answers and asset paths remain Host-side.

`searchTest` performs evidence retrieval only. RAG search keeps `LocalKnowledgeIndex` behavior, including rebuilding its disposable vector cache and contacting the configured embedding and optional reranking endpoints when required. Wiki search uses `WikiReader` lexical evidence over a page in the current release. Neither branch generates an answer, appends a Session event, or stores a conversation.

The administration UI composes this namespace with the existing model-settings, plugin-inventory, and Session APIs rather than duplicating them. Cross-session history search continues through the existing `session.search` path. The Web bundle selects the SQLite query provider with `openAt: first-search` and an in-memory derived index, so startup does not import `node:sqlite` and the first operator content query lazily reconciles live and persisted Sessions. This is the management-console deployment choice described by the [session content-search opt-in decision](../architecture/2026-08-13-session-content-search-opt-in.md), not a new persistence authority. The Macau operations workspace and Settings chrome use Traditional Chinese operator copy in the default `zh` locale. Customer messages, historical answers, knowledge excerpts, filenames, and identifiers remain in their recorded source language.

The browser Consumer exposes two presentation roots over the same callback and store owners. The original eight `settings.section` registrations remain available in the standard operator shell. On `/customer-admin`, the Consumer installs a focused CEM-branded alternate root with a private keyed page outlet, grouped navigation, URL-fragment page selection, and a stable administration document title. It registers seven pages: Workbench, Agents and channels, Current knowledge, Pronunciation and terms, Sessions, Quality and evaluation, and Reports. Conversation flows, model configuration, and prompt rehearsal are absent from that route but remain available in the legacy shell. Workbench and Current knowledge select live data initially, and the standalone live views omit provider identities without changing retrieval settings or results. Page actions, quality records, isolated drafts, and Host ownership are unchanged. Session execution evidence uses a read-only portal trace so the alternate root does not compete with the Settings page for the existing `operations.trace` child-slot declaration.

The operations summaries derive from these same sources: historical conversation counts exclude blank and subagent rows, combine status and preset filters, and display unknown totals while the catalog loads. Knowledge processing summaries distinguish staged uploads from approved assets and label index availability separately from model connectivity. Recorded-case pass share is explicitly scoped to the ledger, with no percentage for an empty ledger. The UI neither invents satisfaction or resolution metrics nor treats retrieval ranking scores as answer accuracy. This keeps the demonstration useful without creating a competing source of operational facts.

## Operator rehearsal isolation

The complete legacy console composes a root-scoped, nonpersistent configuration workspace with explicitly selected live-data views. The focused standalone portal reuses only the pages relevant to live operations and pronunciation management. Synthetic channels, pronunciation drafts, fixed flow templates, local document processing, and regression reviews have no reference to live write callbacks. Compact validation-set, draft, and disconnected labels distinguish these features from operational facts; detailed provenance belongs in Workspace settings. Drafts survive section remounts but reset on application refresh or confirmed reset; a reset revision also remounts private editor buffers. Saving a changed pronunciation invalidates the tested and reviewed versions, while an unchanged save preserves them. Completed review awaits publication and must never call staging promotion or alter the telephone provider.

Pronunciation rehearsal keeps the answer displayed to the customer separate from a synthesis-only text copy. Ordered general rules first normalize locale-specific address notation, institution abbreviations, numbers, dates, amounts, and percentages; exact term corrections then override proper names or ambiguous readings without replacing isolated characters globally. The browser can filter, toggle, and try these rules, but it neither synthesizes audio nor changes the Host speech provider. A connected implementation belongs between committed answer text and provider synthesis, with an adapter that emits plain substitutions, SSML aliases, or supported phonemes for the selected provider.

Document verification and approval belong to shared actions, not only disabled buttons or component state. A matching nonempty retrieval query is required before advancing, and explicit approval is required before completing review. Editing the document, chunks, or query invalidates both states. Section navigation cannot bypass these prerequisites or discard a valid review in progress.

The Sessions page uses the Host's bounded inspection of canonical events, while the history API remains available to other consumers. Both readings exclude internal reasoning and leave the currently open customer session unchanged. Missing channel and speech metadata remain unknown. This point-in-time readout is not a new Session authority or an audio-alignment engine.

Keeping workspace review visually distinct from live publication and isolated staging avoids implying reviewer identity, multi-user authorization, acoustic evaluation, or live publication safety. A future connected implementation must define those capabilities rather than replace workspace callbacks with writes.

## Isolated staging and publication ownership

Uploads land only in the required `stagingDirectory`. Configuration rejects lexical overlap with RAG sources, the RAG manifest and index, Wiki sources and releases, or the bad-case ledger; each staging operation repeats the comparison with runtime-resolved parent paths so configured symlink ancestors cannot alias live data. The public request accepts a filename and text, never a Host path. Filenames are flat and extension-limited, content must round-trip through UTF-8 and contain non-whitespace text, and both individual files and directory inventory are bounded. Staging enumeration rejects symbolic links and non-files.

`stageTextDocument` serializes Provider operations, optionally compares the caller's content-derived directory revision, writes an owner-only sibling temp inode, and hard-links it to the final name. The link commit refuses an existing target, so neither retries nor concurrent creation overwrite a staged document. A completed write returns the committed document and the new revision.

Staging deliberately has no promotion method. Moving staged content into the RAG approval manifest or Wiki source/draft/release pipeline needs a reviewed transaction that names source ownership, approval, rollback, and concurrent-publication behavior. The existing Wiki compiler remains the authority for compile, lint, review, and publish; the console cannot turn an upload into customer-visible evidence.

## Network access policy

The browser connection owns peer and Host-header trust, so it also owns the network fence. Its fixed privileged-method set contains every `customerServiceAdmin/*` endpoint. The shared `/api` handler applies the browser trust check with an empty trusted-host allowlist before a Typert interceptor can claim one of those methods, pinning the namespace to loopback and preserving the DNS-rebinding defense. This ordering matters because direct generated Remotes bypass the older API-proxy fallback. The business service does not accept a caller-supplied authorization flag and does not pretend that loopback is tenant or role authentication.

## Alternatives considered

**Add a customer-service domain to the legacy API proxy.** Rejected because the service already has named requests and results suitable for direct Typert generation. A new domain would expand the central wire union and duplicate runtime validation without adding a transport-specific behavior.

**Let the Client read configured paths or choose a Host path per call.** Rejected because it would turn an operations dashboard into a general filesystem oracle and make browser code responsible for source-format and symlink safety. Deployment configuration selects every root; Remote results expose only relative paths and bounded metadata.

**Write uploads directly into the RAG or Wiki source tree.** Rejected because directory membership must not grant RAG approval, and mutable Wiki sources must not bypass draft review and atomic release publication. An isolated staging area demonstrates ingestion without weakening either evidence policy.

**Expose compile, lint, and publish in the same slice.** Deferred because safe publication requires an explicit staging-to-source promotion transaction and reviewer identity or approval state. Reusing `WikiCompiler` alone does not define who may replace operator sources or how partial promotion rolls back.

**Authorize inside each Remote method.** Rejected because the service has no transport peer information and such checks would occur after shared Remote interception. The connection performs the fixed loopback check once, before dispatch.

**Rewrite the committed answer before storing or displaying it.** Rejected because knowledge wording, evidence review, subtitles, and speech output would lose a common source. Pronunciation processing derives a separate spoken form while the committed text remains authoritative.

**Create a second administration package and duplicate the eight pages.** Rejected because presentation isolation does not require a second Remote consumer or a second state owner. A route-specific root and keyed outlet keep the CEM shell independent while both interfaces exercise the same page implementations and Host authority.

**Expose every legacy rehearsal page in the standalone portal.** Rejected because the branded route is an operations view, not a second configuration laboratory. Keeping flow design, provider identities, model configuration, and prompt drafts in the legacy shell preserves access for development without presenting them as customer-service operations controls.

## Consequences

The console gets real document counts, current release state, bad cases, retrieval evidence, and conversation search while preserving the existing source and Session authorities. Model configuration remains available in the legacy Settings shell; the standalone portal intentionally withholds provider identity. Operational responses remain point-in-time and can fail loudly when an owner file changes during projection, exceeds its configured bound, or violates its format.

The console is intentionally local administration, not a multi-user control plane. RAG search can incur embedding or reranking latency and can replace a disposable index; Wiki search is deterministic lexical retrieval. Staged files consume local disk but remain inert until a separate reviewed promotion capability exists. Text formats are the only accepted upload class until extractor provenance exists for PDF, office, image, or audio inputs. Pronunciation trial output demonstrates ordered text normalization, not the sound quality or markup support of a live voice.

## Verification

Host package tests build temporary approved RAG and published Wiki stores, then cover all six generated method registrations, overview and document projections, changed and unpublished Wiki sources, bounded bad-case parsing, RAG index state before and after real retrieval, Wiki evidence retrieval, validation failures, staging revisions, no-overwrite behavior, and symbolic-link rejection. Connection tests prove that a trusted non-loopback Host is rejected before a shared Typert interceptor receives an administration call. Client tests cover loading, empty, error, overview, document, retrieval-test, bad-case, staging, language-specific pronunciation normalization, rule toggles, exact corrections, route selection, focused standalone registration, provider-identity omission, and coexistence of the two administration presentations without a live provider. Assembled Web coverage exercises the original console, the standalone CEM root, current-knowledge and quality navigation, pronunciation tryout, excluded controls, and first-search Session index.
