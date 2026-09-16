# Agent Note: Macau customer-service knowledge preset

Status: implemented

English | [中文](2026-08-29-macau-customer-service-knowledge-preset.zh.md)

## Problem

A customer-service conversation needs company facts with retrievable evidence, language-matched answers, and an explicit unknown outcome. Directory membership alone cannot mean “approved”: another agent or process can add a file, a source can change without review, and an old vector cache can retain text that no longer matches the approved corpus. Similarity ranking without a relevance threshold always produces a nearest fragment for ordinary finite vectors, even when no fragment supports the question.

Giving general coding presets the retrieval path would also add unrelated processing to every agent session. Preset scope can isolate that behavior, but it does not make corpus files private or create a tenant security boundary.

## Decision

`macau-customer-service` is a shipped agent preset with a scoped persona and `@deepseek-ai/dsh-customer-service-knowledge`. The function plugin publishes no Cordis service or model-facing tool. On each proposed step containing direct-user text, it retrieves with the final non-empty customer message exactly as submitted and appends the bounded result as durable plugin context before the model request. The standing preset mount shares its private indexer closure among customer-service sessions. Other presets receive neither the automatic retrieval listener nor its prompt guidance or configuration.

The preset's language-matched answer requirement is implemented by the session-scoped [response-language selection](2026-08-31-session-response-language-selection.md) plugin. The persona and retrieval path own evidence and customer-service behavior, not language inference.

Approval is a version 1 source manifest. It lists every supported relative path exactly once, in lexical order, with the SHA-256 of the approved bytes. Preset mounting validates the real source directory and manifest file, rejects symlinks, invalid UTF-8, unsafe paths, missing or extra supported files, and hash mismatches, then prepares the vector cache before accepting customer sessions. A changed source becomes usable only after its manifest digest is updated. A stale or missing cache is rebuilt during startup so the first customer question never owns corpus embedding latency; a preparation failure prevents the preset from mounting.

The on-disk index is an untrusted disposable cache. Reuse requires strict JSON parsing and exact agreement with a fresh derivation of source paths, titles, headings, chunk text, and content-derived evidence ids. Its identity also records the manifest and approved-source hashes, embedding endpoint and model, chunk parameters, parser version, and vector dimension. A query vector with a different dimension forces a rebuild; malformed or stale cache content never reaches the model. The cache path is rejected when it equals the manifest or lies inside the source root.

Every non-empty customer question receives a query embedding. The finite vector Top-K candidates are sent to the configured reranker when reranking is enabled, including when no candidate will ultimately pass the vector threshold. A successful rerank must pass both the deployment's `minimumVectorScore` and `minimumRerankScore`. No surviving fragment returns `not-found` with `insufficient-evidence`; an empty approved manifest returns `empty-corpus`. A transient reranker failure falls back only to vector-threshold-qualified candidates for that lookup and retries later. Caller cancellation propagates without changing future behavior.

The shipped composition uses DashScope `qwen3.7-text-embedding` and `qwen3-rerank`, with reranking enabled. Its `minimumVectorScore` is `0.45`, separating reviewed CEM positive questions from the removed Macau industrial-tax question in the deployment model.

One FIFO queue serializes validation, cache publication, and search across every session sharing the standing instance. Query, excerpt, and complete-result limits use UTF-8 bytes. Complete canonical JSON and rendered model text must each fit `maxResultBytes`; excerpts shrink and sources drop before an oversized result can be emitted.

Each internal result carries a content-derived evidence id, but the model-visible renderer emits only excerpt text and escapes source-controlled markup into a JSON data block. The standing prompt and result text state that source strings are quoted data rather than instructions and prohibit exposing documents, identifiers, scores, or retrieval process details to the customer. The plugin records the exact query, bounded evidence, result status, rerank use, source count, and duration in `customer-service-knowledge/retrieval`; the quality projection presents that event as an automatic knowledge-retrieval trace.

## Alternatives considered

**Treat every supported file in one directory as approved.** Rejected because an unreviewed file or same-size edit would silently become model evidence. The manifest makes approval a reviewable exact-byte decision and rejects inventory drift.

**Trust a cache when source size and modification time match.** Rejected because timestamps do not prove content, configuration, chunk derivation, or vector-space identity. A cache saves embedding work only after current approved bytes independently reproduce all non-vector fields.

**A host-wide knowledge service.** Rejected because every live agent could resolve one shared capability and the service API would have one internal consumer. The private closure has the desired standing lifetime without expanding the host service registry.

**A third-party MCP memory server.** Rejected because an MCP tool catalog does not provide the required approval manifest, cache validation, relevance thresholds, stable evidence citations, or complete-result limits. MCP memory remains appropriate for optional personal memory, not approved company evidence.

**Let the model call a retrieval tool before answering.** Rejected for this customer-facing preset because it serializes a full model request before embedding, reranking, and the answer request. Automatic retrieval preserves the same candidate thresholds and reranker while removing that preliminary request; the tradeoff is that retrieval uses the customer's exact message instead of a model-rewritten query.

**Disable or bypass reranking for lower latency.** Rejected because both exact FAQ wording and ambiguous free-form questions must exercise the deployed vector-retrieval path. Every non-empty question retains query embedding, vector thresholds, and configured reranking.

## Consequences

The source root and manifest must exist before the preset can mount. Mounting may contact the embedding endpoint and delays service readiness when an approved corpus or index-identity change requires rebuilding the cache. Every direct customer message incurs query embedding and reranking before its single answer request, while source-vector rebuilding stays outside customer turns. Searches reuse the prepared cache after revalidating source bytes and derived chunks. Operators must calibrate both relevance thresholds with approved positive and out-of-domain questions for their selected models.

Embedding endpoints, and reranker endpoints when enabled, receive approved fragments and customer queries, so they are deployment data-trust decisions. The preset keeps automatic retrieval out of other agent compositions, but corpus and cache confidentiality still depends on filesystem placement and policy. The checked-in CEM corpus selects one source-priority answer for each published FAQ, preserves conditions and source versions, and excludes unresolved same-priority conflicts, a dynamic payment-QR placeholder, a stale fuel-price comparison, and a response that claimed a customer's current supply state.

Spreadsheet FAQ additions use exact-answer deduplication: approved Chinese answers stay in their existing canonical entries, while new English and Portuguese answers use language-specific sections with stable FAQ ids and source-row provenance. This avoids duplicate Chinese fragments consuming a bounded retrieval result set while preserving direct multilingual query text for embedding.

The current source formats remain text-oriented. PDF, DOCX, image, audio, and table-aware extraction require an approved parser and provenance policy before joining the manifest format.

## Verification

The focused package suite pins manifest rejection paths, strict cache reuse and poisoning rejection, vector-dimension changes, full retrieval for exact FAQ-heading questions, both relevance thresholds, cancellation and transient reranker retry, shared-instance serialization, UTF-8 query/result limits, automatic context injection and disposal, durable retrieval relations, and quality-trace projection. The shipped preset composition supplies every required operational value and an exact manifest for its checked-in source. Its keyless assembled-Web transcript reaches the customer answer in one model step, includes English and Portuguese FAQ evidence, and verifies that evidence ids stay out of the customer answer.
