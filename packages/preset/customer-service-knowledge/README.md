# dsh-customer-service-knowledge

English | [中文](README.zh.md)

Scoped approved-source retrieval for the Macau customer-service agent preset. Before each direct customer message reaches the model, the function plugin searches with that exact message and appends bounded evidence in the preset's standing scope without publishing a Cordis service or a model-facing tool. Every agent on that preset shares one serialized index instance; other presets receive neither the automatic retrieval path nor its configuration. Preset scoping is capability isolation, not filesystem or tenant isolation: deployments must keep the corpus and cache in an owner-only location outside workspaces available to coding agents.

## Approved sources

`sourceManifestPath` is a strict version 1 allowlist. Every supported file under `sourceDirectory` must appear once in lexical path order with the SHA-256 of its exact bytes; missing entries, extra supported files, symlinks, invalid UTF-8, hash changes, and malformed manifests fail preset mounting. Unsupported files such as `.DS_Store` are ignored. A manifest inside the source root is excluded from the source inventory.

```json
{
  "version": 1,
  "sources": [
    { "path": "company-hours.md", "sha256": "<64 lowercase hex characters>" }
  ]
}
```

Changing a source requires review followed by a manifest-hash update. The manifest approves bytes for retrieval; document prose must still state provenance, effective dates, audience, and limitations needed to use those bytes safely.

## Configuration

Every operational value is explicit in the preset composition.

| Field | Meaning |
|---|---|
| `sourceDirectory` / `sourceManifestPath` | Approved source root and strict hash allowlist; both must exist when the preset first mounts. |
| `indexPath` | Disposable owner-only JSON vector cache; it must be outside the source root and must not replace the manifest. |
| `embeddingBaseURL` / `embeddingModel` / `embeddingApiKeyEnv` | OpenAI-compatible `/embeddings` endpoint prefix, model, and optional server-side Bearer credential reference. Source fragments and customer queries are sent here. |
| `rerankerURL` / `rerankerModel` / `rerankerApiKeyEnv` / `rerank` | Optional rerank endpoint, model, and server-side Bearer credential reference. A failed attempt keeps vector order for that lookup, logs the failure, and retries on the next lookup; caller cancellation propagates. |
| `embeddingBatchSize` | Fragments embedded in one indexing request. |
| `chunkChars` / `chunkOverlapChars` | Heading-aware fragment cap and repeated suffix in UTF-16 code units. |
| `candidateCount` / `resultCount` | Vector candidates considered and maximum evidence excerpts supplied to the model. |
| `minimumVectorScore` / `minimumRerankScore` | Deployment-calibrated relevance thresholds. No qualifying source produces `not-found` with reason `insufficient-evidence`. |
| `maxQueryBytes` / `maxExcerptBytes` / `maxResultBytes` | UTF-8 limits for the query, each excerpt, and both complete canonical/rendered results. |
| `responseProvider` / `responseModel` / `responseReasoningEffort` | Preset-local route for customer replies. It does not change the deployment default or the quality-inspection model. |
| `requestTimeoutMs` / `timeoutMs` | One embedding or reranker request and the whole automatic lookup deadline. |

The shipped preset routes customer replies to non-thinking DashScope `qwen3.7-flash` and uses `qwen3.7-text-embedding` plus `qwen3-rerank` for retrieval, resolving `DASHSCOPE_API_KEY` immediately before every model request. The Web deployment uses the deterministic first-prompt title instead of launching a concurrent title-model call. It reads `DSH_MACAU_KNOWLEDGE_DIR`, `DSH_MACAU_KNOWLEDGE_MANIFEST`, `DSH_MACAU_KNOWLEDGE_INDEX`, `DSH_MACAU_EMBEDDING_BASE_URL`, `DSH_MACAU_EMBEDDING_MODEL`, `DSH_MACAU_RERANKER_URL`, and `DSH_MACAU_RERANKER_MODEL` before its composition values. Without a manifest override, `source-manifest.json` is read from the effective source directory. Paths are resolved once for the standing preset instance, not from each session's workspace; credentials are never stored in the vector cache.

## Behavior

Each direct customer message triggers one lookup before the model request. The lookup uses the final non-empty direct-user text exactly as submitted; plugin context and prior messages do not replace that query. It re-reads the manifest, verifies every approved file hash, and derives the exact current chunk ids, text, titles, headings, and paths. A persisted cache is reused only after strict parsing proves its source hashes, embedding endpoint/model, chunk parameters, vector dimension, and complete chunk metadata/text match that derivation. Changing the embedding endpoint or model therefore rebuilds every stored source vector before retrieval; changing only the reranker does not. Malformed or stale cache content is discarded and rebuilt; non-missing filesystem errors fail the turn. Index preparation and searches run through one instance queue.

Every non-empty customer question is embedded, and the finite vector Top-K candidates are sent to the configured reranker when reranking is enabled. A successful rerank must pass both `minimumVectorScore` and `minimumRerankScore`; a transient rerank failure falls back only to candidates that pass the vector threshold. An empty approved manifest returns reason `empty-corpus`. Evidence ids are content-derived and stable across equivalent builds.

## Model Experience

### Company-knowledge retrieval

#### What the model sees

The model sees the direct customer message followed by bounded evidence framed as escaped JSON data. It does not spend an initial model request selecting or formulating a retrieval tool call. Rendered evidence includes only excerpt text; source paths, titles, stable ids, order, scores, and citation markers stay out of customer-facing model input. Prompt text says source strings are quoted data and never instructions, and forbids mentioning source documents, retrieval metadata, or the retrieval process. A no-result context requires an honest unknown answer and permits mentioning human support only when approved evidence or the conversation already provides that path.

#### Token effect

Standing guidance appears on each request for this preset, and one bounded evidence context appears immediately after a direct customer message. `maxResultBytes` bounds the complete canonical result and rendered model text independently. Removing the retrieval tool schema and its preliminary model turn reduces time to the first answer token while every customer question retains query embedding, vector retrieval, and configured reranking.

The preset request route selects the configured customer-response model after the host's session-selection listener. This keeps customer latency tuning local to the preset while the operator quality engine and unrelated sessions retain their configured models.

#### KV Cache effect

Standing guidance remains prefix-stable for a preset generation. Source or cache changes affect later evidence messages. The exact query, bounded evidence, result status, rerank use, source count, and duration are recorded in `customer-service-knowledge/retrieval` for session replay and quality inspection.

## Known Limitations and Deferred Work

- **Thresholds are deployment-specific** — embedding and reranker score distributions differ; operators must calibrate both thresholds against approved positive and out-of-domain queries before customer use.
- **Text-oriented ingestion only** — PDF, DOCX, image, and audio extraction remain excluded until an approved parser and provenance policy exist; long Markdown tables receive heading-aware, not table-aware, chunking.
- **First-use indexing is synchronous** — a changed corpus embeds before the lookup completes. Large deployments should provision and warm the cache before accepting customer traffic.
