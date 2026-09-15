# Agent Note: Evidence-linked conversation quality inspection

Status: implemented

English | [中文](2026-09-09-conversation-quality-inspection.zh.md)

## Problem

An operator must inspect an actual conversation, understand why an answer failed, and retain review decisions. A synthetic score or a new retrieval against changed knowledge cannot explain the original answer. Scoring inside the customer's agent would alter the record being inspected. Treating missing speech data as measured quality would obscure rather than diagnose telephone failures.

## Decision

The existing customer-service Host gateway owns bounded inspection, asynchronous evaluation, local quality records, and revision-checked human review. The [administration isolation decision](2026-09-04-customer-service-admin-console.md) continues to govern staging, unconnected configuration controls, and loopback access. Sessions and Quality use real records rather than the pronunciation fixtures; no evaluation action publishes knowledge or changes a speech configuration.

Inspection reads canonical live events or uses persistence inspection without resuming the source Session. A content fingerprint and complete projected evidence pin each run. Unfinished turns remain readable and the default evaluation skips them; a selected unfinished turn rejects evaluation. Completed turns can be selected independently. Oversized source logs fail visibly. The projection excludes reasoning, pairs tool input and output using recorded call identifiers, and retains original sequence references and available timing. Pattern-based redaction removes common credentials, emails, and Macau phone literals; it is not a complete sensitive-data classifier.

One auxiliary LLM request evaluates selected turns without tools or reasoning output, reserving its bounded output for structured JSON. Before dispatch, its exact system, messages, output limit, and reasoning setting are written as an event in a detached audit Session under the quality directory. The customer log and active session selection remain unchanged. Operator-facing trace labels, errors, inferred intent, reasons, and suggestions use Traditional Chinese; quoted customer and evidence text stays in its source language. Each run saves provider, model, rubric version, scope, weights, evidence, automatic result, and human review entries. Identical concurrent admissions reuse the running job. Invalid output, unknown event references, timeouts, and abandoned jobs are failures, not zero scores. Retry creates a separate record.

Six dimensions cover intent, retrieval relevance, grounding, completion, expression, and execution. Intent is retrospective analysis unless the source records an explicit routing decision. Retrieval assessment is not precision or recall without ground-truth labels. Every scored dimension requires original-event evidence. Inapplicable dimensions leave the denominator; insufficient evidence suppresses the aggregate total and reduces visible coverage. Critical findings remain visible regardless of the mean. Versioned execution rules deduct 30 points per recorded error and 10 per operation beyond the configured latency threshold, with a floor of zero. They do not measure unrecorded STT or TTS latency.

The browser uses the existing trajectory ledger through a registered `operations.trace` slot, without value-importing another plugin's components. Score references select original records. Human overrides remain separate from automatic scores; each review or remediation transition requires a reason and the expected revision. Closing an issue records an operator's acceptance, not proof that a live fix was deployed.

## Alternatives considered

**Score fixtures or store results only in browser state.** Rejected because results would not explain actual customer exchanges and would disappear on refresh.

**Resume the source agent or rerun retrieval while reviewing.** Rejected because either changes the evidence or evaluates a different corpus state. Auxiliary evaluation uses recorded tool results only.

**Average only the dimensions the model could score.** Rejected because an apparently high total could hide a missing retrieval result or unrecorded execution data. Evidence coverage and unavailable totals retain that distinction.

**Replace the shared trace with an independent inspector.** Rejected because two event renderers would drift. A root-scoped slot adapts the bounded operational projection to the existing ledger.

## Consequences

Quality inspection incurs separate model cost and local disk usage. Records are bounded, single-process, and revision-checked; there is no multi-user reviewer authentication, automatic retention deletion, batch scheduling, or acoustic evaluation. The configured evaluator's judgment remains advisory. Strict JSON and reference validation detect structural errors but cannot prove its semantic conclusions; human review remains necessary.

## Verification

Host tests cover source fingerprints, complete bounded projection, request logging before evaluation, no source mutation, evidence validation, durable reads, restart recovery, review revisions, and remediation transitions. Client tests cover real-history entry, retained filters, evidence selection, required review reasons, invalid weights, and insufficient evidence. An assembled browser scenario uses a deterministic external model adapter through the real Remote gateway, cold Session persistence, quality files, and trajectory slot; it verifies scoring, evidence navigation, refresh recovery, human override, and remediation acceptance. This keyless scenario verifies integration, not live-provider judgment quality.
