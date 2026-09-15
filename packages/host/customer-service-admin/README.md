# @deepseek-ai/dsh-host-customer-service-admin

English | [中文](README.zh.md)

Host-owned operational data for the Macau customer-service administration UI. `CustomerServiceAdminGateway` registers the Remote-only `customerServiceAdmin` service; generated Host and browser artifacts are exported through `./typert` and `./remote`. The assembled browser carrier restricts this namespace to loopback callers before shared Typert dispatch.

The gateway reads the RAG approval manifest through `LocalKnowledgeIndex`, reads the current immutable Wiki through `WikiReader`, and projects the operator bad-case JSONL ledger. Bad-case capture times must be real ISO calendar dates or UTC timestamps. Inventory responses contain relative source paths and public model names, never configured Host paths, model endpoints, source answers captured in bad cases, or arbitrary files. Every projection is bounded by required deployment limits and validates the source-owned format before returning data.

| Remote | Result or effect |
|---|---|
| `overview` | RAG document/chunk counts, safe retrieval settings, disposable-index metadata, current Wiki release, and bad-case counts |
| `listDocuments` | Approved RAG files plus Wiki raw sources classified as published, changed, or unpublished |
| `listBadCases` | The bounded regression ledger with diagnosis summary and acceptance criteria |
| `searchTest` | Direct RAG or current-release Wiki evidence retrieval without answer generation or Session mutation |
| `listStagedDocuments` | Complete isolated-staging snapshot and content-derived revision |
| `stageTextDocument` | Add one new flat UTF-8 text document with optional compare-and-set; never overwrite |
| `inspectConversation` | Complete bounded conversation evidence without resuming its agent |
| `startQuality` | Admit an asynchronous, fingerprint-pinned model evaluation |
| `listQuality` | Persisted evaluation, risk, review, and remediation summaries |
| `getQuality` | One evaluation with its original evidence and review history |
| `reviewQuality` | Revision-checked human review or remediation transition with a required reason |

`rag` accepts the complete `KnowledgeConfig`. `wiki` accepts the complete `WikiReaderConfig` plus its raw `sourceDirectory`. Deployments also provide `badCasesPath`, an independent `stagingDirectory`, and positive safe-integer limits for documents, Wiki pages, bad-case count and bytes, index bytes, and each staged document's bytes. Programmatic construction runs the same semantic validation as Loader configuration.

Staging accepts `.csv`, `.htm`, `.html`, `.json`, `.markdown`, `.md`, and `.txt`. It rejects path separators, absolute or blank names, invalid UTF-8, blank content, oversized content, symbolic links, non-files, unsupported extensions, stale revisions, and existing targets. A fresh owner-only temp inode is hard-linked to the final name so concurrent creation cannot replace a file. Both lexical and runtime-resolved checks keep staging disjoint from every configured live source and artifact path.

## Conversation quality

Optional `quality` configuration enables evaluation and requires `directory`, `provider`, `model`, `timeoutMs`, `maxEvents`, `maxInputBytes`, `maxOutputTokens`, `maxRecordBytes`, `maxRuns`, `maxTurns`, and `slowResponseMs`. Its directory must be separate from staging and live knowledge stores. Missing configuration rejects quality operations. The existing sessions, persistence, and LLM services supply source records and model execution. Unfinished turns remain inspectable and are skipped by the default evaluation; operators may select a completed turn explicitly. A selected unfinished turn cannot be scored. Oversized conversations reject inspection; no partial source is silently scored.

Each run stores its source fingerprint, projected evidence, scope, six weights, model, rule version, automatic scores, and append-only review entries in owner-only files. Identical concurrent requests share the running job. Failed output, unknown evidence references, timeouts, and interrupted jobs remain explicit failures; retry creates a new run. Human overrides do not replace automatic scores. Revision checks reject stale reviews. Persistence is local and single-process; there is no reviewer authentication or automatic retention deletion.

Intent, retrieval relevance, answer grounding, completion, expression, and execution receive separate results. Without ground-truth labels, retrieval quality is a reasoned assessment, not measured precision or recall. Missing evidence suppresses the aggregate score; inapplicable dimensions are excluded. Critical findings remain independent of the total. Execution uses recorded errors and durations, not unrecorded speech latency. Inspection excludes reasoning and applies pattern-based credential, email, and Macau-phone redaction; this is not a complete personal-data classifier.

## Model Experience

### Retrieval test

#### What the model sees

`searchTest` with RAG sends approved document chunks to the configured embedding endpoint when its disposable cache needs a rebuild, sends the operator query for embedding, and sends the query plus candidate excerpts to the configured reranker when reranking is enabled. Wiki search is local lexical retrieval. No result enters a conversation model request.

#### Token effect

No conversation tokens are added. Embedding and optional reranker input scale with the configured source corpus, query, candidate count, and chunk bounds.

#### KV Cache effect

None; the gateway does not assemble a conversation model request.

### Quality evaluation

#### What the model sees

An explicit `startQuality` sends the selected historical user/assistant text and tool input/output, together with the six-dimension rubric, to the configured LLM. These records are untrusted data; the evaluator has no tools and runs with reasoning output disabled so the bounded response budget carries the required JSON. The exact system, messages, output limit, and reasoning setting are recorded in a detached audit Session before dispatch, under the quality directory, never in the customer's log. The request asks for strict JSON with original event references and concise Traditional Chinese intent, reason, and suggestion fields. Opening history, viewing scores, and reviewing results make no model call.

#### Token effect

Evaluation consumes a separate bounded request per admitted job. Source bytes, turns, output tokens, and timeout are deployment limits; the customer's conversation token history is unchanged.

#### KV Cache effect

The auxiliary request does not reuse or modify the customer's conversation composition.

## Known Limitations and Deferred Work

- **Text formats only** — PDF, DOCX, spreadsheet, image, and audio ingestion require an approved extractor and provenance policy.
- **Staging is not publication** — the gateway does not copy staged files into live RAG or Wiki roots and does not compile, lint, approve, or publish Wiki releases. Promotion needs an explicit review transaction.
- **Point-in-time reads** — evaluation uses captured evidence, not a new retrieval against today's corpus. Missing recordings cannot establish pronunciation, STT accuracy, or subtitle alignment. RAG search tests may rebuild the existing disposable vector cache according to `LocalKnowledgeIndex` semantics.
- **Trusted local administration only** — the service has no tenant or role model; the assembled connection's loopback restriction is its network access policy.
