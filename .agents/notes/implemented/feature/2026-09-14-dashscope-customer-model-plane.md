# Agent Note: DashScope customer-service model plane

Status: implemented

English | [中文](2026-09-14-dashscope-customer-model-plane.zh.md)

## Problem

The Macau customer-service deployment shared one server-side DashScope credential for speech while conversation, quality inspection, embedding, and reranking used separate providers or unauthenticated loopback endpoints. Moving retrieval to a hosted endpoint also requires credential handling that never places secrets in preset configuration or the vector cache.

## Decision

The Web composition registers a `qwen-dashscope` OpenAI-compatible route backed by `DASHSCOPE_API_KEY`. The Macau customer-service preset routes customer replies to non-thinking `qwen3.7-flash` after session-level routing is resolved, while AI quality inspection retains `qwen3.7-plus`. The optional Wiki draft compiler defaults to the hosted Plus model and the same credential. The RAG preset uses DashScope `qwen3.7-text-embedding` and `qwen3-rerank`; both requests resolve the same credential reference immediately before dispatch and send it only as an Authorization header.

The disposable index identity includes the embedding endpoint and model. A mismatch rebuilds all source vectors atomically before retrieval, while a reranker-only change reuses the vectors. Credentials are neither part of index identity nor persisted content.

The Web deployment retains the deterministic first-prompt fallback title and disables the auxiliary title-model provider. Customer history still receives an immediate title, while the first answer does not compete with a second hosted model call.

## Alternatives considered

**Keep the local embedding and reranker.** This avoids reindexing but preserves a workstation dependency and makes the demonstration fail when the local model server is unavailable.

**Put the API key in endpoint configuration.** Inline credentials would leak through configuration and diagnostics, so configuration stores only the `DASHSCOPE_API_KEY` reference and resolves its value per request.

**Reuse old vectors after changing the embedding model.** Vector spaces from different models are not comparable. Reusing them can silently corrupt similarity scores, so endpoint or model changes invalidate the cache.

## Consequences

The customer Web deployments need one configured `DASHSCOPE_API_KEY` for text models, retrieval, recognition, and fallback synthesis; operator model compilation reads the same environment entry. Customer-response routing remains preset-local and does not change the shared default or quality-inspection route. Disabling auxiliary title generation applies to the assembled Web deployment and leaves deterministic history titles intact. The first retrieval after an embedding change waits for the complete approved corpus to be re-embedded; deployments warm the index before customer traffic. Focused tests pin per-request Bearer authentication, missing-resolver failure, index invalidation, preset-local response routing, and the assembled Web configuration.
