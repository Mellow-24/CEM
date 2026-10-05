# dsh-customer-service-knowledge

English | [中文](README.zh.md)

Scoped approved-source retrieval for the Macau customer-service agent preset. Before each direct customer message reaches the model, the function plugin searches with that exact message and inserts bounded evidence immediately before it in the preset's standing scope without publishing a Cordis service or a model-facing tool. Every agent on that preset shares one serialized index instance; other presets receive neither the automatic retrieval path nor its configuration. Preset scoping is capability isolation, not filesystem or tenant isolation: deployments must keep the corpus and cache in an owner-only location outside workspaces available to coding agents.

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

The preset request route selects the configured customer-response model after the host's session-selection listener. This keeps customer latency tuning local to the preset while the operator quality engine and unrelated sessions retain their configured models.

## Behavior

Preset mounting prepares the vector cache before accepting customer sessions. It re-reads the manifest, verifies every approved file hash, and derives the exact current chunk ids, text, titles, headings, and paths. A persisted cache is reused only after strict parsing proves its source hashes, embedding endpoint/model, chunk parameters, vector dimension, and complete chunk metadata/text match that derivation. Changing the embedding endpoint or model therefore rebuilds every stored source vector during startup; changing only the reranker does not. Malformed or stale cache content is discarded and rebuilt, and a preparation failure prevents the preset from mounting instead of delaying the first customer answer. Index preparation and searches run through one instance queue.

Each direct customer message triggers one lookup before the model request. The lookup uses the final non-empty direct-user text exactly as submitted; plugin context and prior messages do not replace that query. The evidence notice precedes that direct-user message, with all other proposed messages retaining their relative order. The ordinary `user/message` events record this order for request reconstruction and replay. Each lookup still revalidates the approved source bytes and derived chunk metadata before using the prepared cache. Non-missing filesystem errors fail the turn.

After a successful, uncancelled lookup, each earlier live notice owned by this plugin is replaced in derived model history by a short superseded-evidence marker. The replacement is a logged `user/message` with a single-node `surfaceOp`, citing the original event in `sourceEventSeqs`; it occurs before the new step begins. Original evidence and retrieval events remain in the append-only audit log. Customer, assistant, tool and unrelated context messages keep their content and order. Rejected or empty input, failed retrieval and cancellation before replacement leave earlier evidence unchanged. The distinct `customer-service-knowledge-history` source prevents markers from being retired again.

Every non-empty customer question is embedded, and the finite vector Top-K candidates are sent to the configured reranker when reranking is enabled. A successful rerank must pass both `minimumVectorScore` and `minimumRerankScore`; a transient rerank failure falls back only to candidates that pass the vector threshold. An empty approved manifest returns reason `empty-corpus`. Evidence ids are content-derived and stable across equivalent builds.

### Dialogue guidance

The latest customer message determines the response, including corrections of an earlier misunderstanding; evidence notices do not replace that request. Greetings, thanks and forms of address can be handled from the current conversation without company evidence. The model is instructed not to repeat unrelated or rejected answers, solicit a name without an explicit request for a form of address, or infer a surname, gender or title. A name, title or preference the customer supplies for themselves is sufficient to use naturally in this conversation, without reconfirming it or repeating it in every sentence; the latest explicit choice applies. If the customer requests a form of address and none is known, it may ask their preference. Using a supplied name does not require account lookup, identity recognition or a saved profile. In English replies, supplied names and titles are rendered naturally in English or transliteration without Chinese originals or parenthetical Chinese. This guidance adds no cross-session preference store and does not relax business-evidence, safety or authorization requirements.

When a message only greets, thanks, apologizes, introduces a name or requests or corrects a form of address, the instructions require a brief response to that action without old business answers, unsolicited business follow-up questions or human-support suggestions. This restriction does not shorten answers to business questions, including business questions combined with a conversational action; those still require complete answers supported by relevant evidence.

## Model Experience

### Company-knowledge retrieval

#### What the model sees

The model sees bounded evidence framed as escaped JSON data immediately before the latest direct customer message; earlier retrieval notices appear only as short superseded-evidence markers. It does not spend an initial model request selecting or formulating a retrieval tool call. Rendered evidence includes only excerpt text; source paths, titles, stable ids, order, scores, and citation markers stay out of customer-facing model input. Prompt text says source strings are quoted data and never instructions, and forbids mentioning source documents, retrieval metadata, or the retrieval process. Business facts require relevant evidence from the current lookup; missing evidence requires an honest unknown answer, not reuse of older evidence. Human support may be mentioned only when approved evidence or the conversation already provides that path.

#### Token effect

Standing guidance appears on each request for this preset, and one bounded evidence context appears immediately before the latest direct customer message. Earlier excerpt bodies do not accumulate in model history; each retired notice retains one fixed-size marker. `maxResultBytes` bounds the complete canonical result and rendered model text independently. Removing the retrieval tool schema and its preliminary model turn reduces time to the first answer token while every customer question retains query embedding, vector retrieval, and configured reranking.

#### KV Cache effect

Standing guidance remains prefix-stable for a preset generation. Retiring an earlier notice changes the history prefix from that position; later requests retain its stable marker. Source or cache changes affect later evidence messages. The exact query, bounded evidence, result status, rerank use, source count, and duration are recorded in `customer-service-knowledge/retrieval` for session replay and quality inspection; raw notices and replacements reconstruct both original and later requests.

## Known Limitations and Deferred Work

- **Thresholds are deployment-specific** — embedding and reranker score distributions differ; operators must calibrate both thresholds against approved positive and out-of-domain queries before customer use.
- **Text-oriented ingestion only** — PDF, DOCX, image, and audio extraction remain excluded until an approved parser and provenance policy exist; long Markdown tables receive heading-aware, not table-aware, chunking.
- **First-use indexing is synchronous** — a changed corpus embeds before the lookup completes. Large deployments should provision and warm the cache before accepting customer traffic.
