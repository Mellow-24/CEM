# Agent Note: Customer corrections and requested forms of address

Status: implemented

English | [中文](2026-10-05-customer-dialogue-repair.zh.md)

## Problem

A customer asking to be addressed personally does not need company-policy evidence. Applying a missing-evidence refusal to that request obscures the conversational intent. Repeatedly prefixing an interrupted question to each correction also makes retrieval treat rejected premises as current input. Existing business answers can then dominate the conversation even after the customer rejects them.

## Decision

The [knowledge instructions](../../../../packages/preset/customer-service-knowledge/src/evidence.ts) limit business facts to relevant approved evidence while allowing conversational actions from the customer's actual words and current session. Missing evidence does not prevent an acknowledgement, apology, correction, or response to a requested form of address. It still prohibits invented company facts, unsupported account access, and claims of completed actions. Customer corrections do not override safety, authorization, evidence, or reply-language rules.

Current evidence is logged immediately before the latest direct customer message. The provider receives both as user-role messages without the internal plugin-source tag; keeping the actual question after its evidence distinguishes the requested action from the evidence notice. Other messages, including runtime context, retain their relative order. Every nonempty customer question still receives embedding and reranking with its unchanged text.

The [CEM persona](../../../../apps/cli/config/agent-presets/macau-customer-service/agent.cordis.yml) gives the customer's latest intended question priority over rejected topics and answers. Explicitly provided names and preferred forms of address belong to that session; a later correction wins. The assistant does not guess names or gendered honorifics, collect names proactively, or make a name a prerequisite for service. It may ask how to address the customer only when the customer requests personal address and has not supplied a usable preference.

The [voice controller](../../../../packages/client/ui-voice/src/client/call.ts) submits only the newly accepted utterance after an interruption. Final ASR segments within that utterance still merge in order, including segments queued during cancellation. Prior questions remain separate durable messages and continue to inform the answer model and interruption classifier. This supersedes cross-turn question prefixing in [call history and continuations](2026-09-14-call-history-and-continuations.md), not transcript retention, merge timing, or cancellation ownership. [Hybrid interruption admission](../feature/2026-09-30-hybrid-call-interruption.md) remains unchanged.

## Alternatives considered

**Add a serial intent classifier or answer verifier.** It adds a provider round trip to ordinary answers. The existing answer request already receives the current question and conversation; the policy distinction belongs there.

**Skip embedding or reranking for social-looking text.** A keyword-based shortcut can misclassify mixed requests and bypass approved business evidence. Retrieval remains enabled for every nonempty message; the answer instructions distinguish what evidence governs.

**Always ask for a name.** It interrupts customers who only want service and unnecessarily collects personal information. Personal address is customer-led.

**Carry the entire old question into each interruption.** It can help an isolated fragment but also accumulates rejected premises. Separate logged turns preserve context without making old text part of every new retrieval query.

## Consequences

The change adds no provider call, post-generation buffering, model switch, or persistent customer-profile store. Embedding, reranking, ASR, TTS routing, fallback, and reply-language selection retain their configuration. The additional prompt text affects model input size; first-token timing still depends on the provider. Very short follow-ups can require a focused clarification when current evidence and conversation cannot resolve them.

Focused controller tests cover repeated corrections and same-utterance merging. Shipped-preset keyless transcripts pin business evidence alongside missing-evidence dialogue turns. Credential-gated live-provider tests exercise corrections, requested names, and English switching; browser replay covers the shared customer and mobile call entry paths. These checks do not prove speaker identity or guarantee every generative answer.
