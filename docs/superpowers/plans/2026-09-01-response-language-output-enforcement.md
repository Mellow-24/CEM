# Response-language output enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a selected reply language control the customer-visible final answer, with at most one hidden corrective model attempt.

**Architecture:** The agent loop gains an opt-in buffered-response path. `dsh-response-language` requests buffering, validates the complete final text before it is persisted, records one retry event, and reassembles a correction prompt. Agents that do not opt in keep current streaming behavior.

**Tech Stack:** TypeScript, Cordis events, session events, Vitest.

---

### Task 1: Add buffered post-response validation to the loop

**Files:**

- Modify: `packages/core/agent/src/runtime-types.ts`
- Modify: `packages/core/agent-loop/src/agent.ts`
- Test: `packages/core/agent-loop/tests/agent.spec.ts`
- Modify: `docs/architecture.md`, `docs/architecture.zh.md`, `docs/architecture.i18n.yaml`

- [ ] **Step 1: Add a failing opt-in buffering test**

```ts
it('buffers output until a post-response listener accepts it', async () => {
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    return decision.kind === 'reject' ? decision : { ...decision, responseDelivery: 'buffered' }
  })
  ctx.on('agent/post-response', async (_payload, next) => {
    expect(session.events.some(event => event.type === 'assistant/chunk')).toBe(false)
    return await next()
  })
  await send('Hello')
  expect(session.events.some(event => event.type === 'assistant/message')).toBe(true)
})
```

- [ ] **Step 2: Verify the test is red**

Run: `./node_modules/.bin/vitest run packages/core/agent-loop/tests/agent.spec.ts -t "buffers output until"`

Expected: FAIL because neither `responseDelivery` nor `agent/post-response` exists.

- [ ] **Step 3: Implement the smallest generic extension**

```ts
export type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[]; responseDelivery?: 'stream' | 'buffered' }

export type PostResponseDecision = { kind: 'accept' } | { kind: 'retry' }
```

In buffered mode, collect chunks in memory, construct the response, run `agent/post-response`, and append chunks plus `assistant/message` only after `accept`. A `retry` discards those in-memory chunks and reassembles the prompt for the next attempt. The default `stream` mode keeps existing chunk timing.

- [ ] **Step 4: Verify green and document the event**

Run: `./node_modules/.bin/vitest run packages/core/agent-loop/tests/agent.spec.ts -t "buffers output until"`

Expected: PASS. Update the English/Chinese turn-flow diagram to show `agent/post-response` between model completion and durable assistant output, then re-record the bilingual pair.

### Task 2: Enforce one reply-language correction

**Files:**

- Modify: `packages/context/response-language/src/index.ts`
- Modify: `packages/context/response-language/src/detect.ts`
- Modify: `packages/context/response-language/src/invariant.ts`
- Test: `packages/context/response-language/tests/response-language.spec.ts`
- Test: `packages/context/response-language/tests/invariant.spec.ts`

- [ ] **Step 1: Add a failing fixed-English test**

```ts
it('retries a buffered Chinese answer once for fixed English', async () => {
  adapter.responses = ['你可以透過網上繳費。', 'You can pay online.']
  await select('en')
  await send('如何繳交電費？')
  expect(adapter.requests).toHaveLength(2)
  expect(lastAssistantText(session)).toBe('You can pay online.')
  expect(session.events.filter(event => event.type === 'response-language/retry')).toHaveLength(1)
})
```

- [ ] **Step 2: Verify the test is red**

Run: `./node_modules/.bin/vitest run packages/context/response-language/tests/response-language.spec.ts -t "retries a buffered Chinese"`

Expected: FAIL because no retry event or post-response listener exists.

- [ ] **Step 3: Add one durable correction decision**

Declare `response-language/retry` with `{ turn, step, expected, observed? }`. Request buffered delivery in `agent/pre-step`. In `agent/post-response`, skip tool-call-only messages, compare final text with the resolved language, and retry only on the first decisive mismatch. Append the retry event before returning `retry`; accept a second mismatch or unclassifiable short text.

- [ ] **Step 4: Reassemble a final correction instruction**

Render the response-language policy after every tool rule. When the retry event exists for the same turn/step, add a final instruction that the earlier output did not use the required language and this attempt must answer only in the resolved language.

- [ ] **Step 5: Add invariant and green checks**

The invariant must require an open matching step, a preceding matching `response-language/resolved` event, and no more than one retry record per step. Run:

```sh
./node_modules/.bin/vitest run packages/context/response-language/tests/response-language.spec.ts packages/context/response-language/tests/invariant.spec.ts
```

Expected: PASS; no rejected answer chunk or message is persisted.

### Task 3: Lock the customer-service outcome and update contracts

**Files:**

- Modify: `examples/headless-agent/tests/fixtures/customer-service-mock-llm.ts`
- Modify: `apps/cli/tests/customer-service-presets.snapshot.ts`
- Modify: `apps/cli/tests/snapshots/customer-service-presets/rag.expected.jsonl`
- Modify: `packages/context/response-language/README.md`, `packages/context/response-language/README.zh.md`, and sidecar
- Modify: `.agents/notes/implemented/feature/2026-08-31-session-response-language-selection.{md,zh.md,i18n.yaml}`

- [ ] **Step 1: Add a failing product transcript assertion**

```ts
expect(actual).toContain('"response-language/retry"')
expect(actual).toContain('Customers can cancel automatic transfer')
expect(actual).not.toContain('"text":"可以透過指定銀行')
expect(actual).toContain('\\"query\\":\\"點樣取消自動轉賬？\\"')
```

- [ ] **Step 2: Verify the assertion is red**

Run: `./node_modules/.bin/vitest run --config vitest.snapshot.config.ts apps/cli/tests/customer-service-presets.snapshot.ts -t "response-language correction"`

Expected: FAIL before the fixture produces a first wrong-language final answer.

- [ ] **Step 3: Make the fixture emit one wrong-language answer, then refresh the focused snapshot**

The first final RAG attempt emits Chinese despite fixed English; the second emits English. Refresh only this transcript with `DSH_SNAPSHOT=refresh`.

- [ ] **Step 4: Update documentation and run focused gates**

Document the buffering tradeoff, one-retry bound, and unclassifiable-output limitation. Regenerate persistence and graph catalogs, update pair hashes, then run:

```sh
./node_modules/.bin/tsc -b packages/core/agent packages/core/agent-loop packages/context/response-language --pretty false
node --import tsx/esm scripts/gen-persistence-catalog.ts
node --import tsx/esm scripts/gen-doc-graphs.ts
node --import tsx/esm scripts/verify-translation-pairing.ts packages/context/response-language/README.md .agents/notes/implemented/feature/2026-08-31-session-response-language-selection.md docs/architecture.md
```

Expected: targeted tests, typecheck, generated artifacts, and named bilingual pairs pass.
