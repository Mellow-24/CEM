# Agent Note: Macau customer-service LLM Wiki preset

Status: implemented

English | [中文](2026-08-29-macau-customer-service-llm-wiki-preset.zh.md)

## Problem

The vector RAG customer-service preset selects raw fragments through embedding retrieval and reranking. It does not provide human-reviewed navigation pages, explicit page relationships, or an approval unit that binds each customer-visible citation to one exact source version and text range.

Compiling and reviewing pages in the same directory that customer sessions scan would let malformed drafts interrupt published answers and let one conversation cross compilation generations. Page status alone also cannot prove which source bytes, policy inputs, and evidence range a reviewer approved.

## Decision

`macau-customer-service-wiki` is a separate agent preset backed by `@deepseek-ai/dsh-customer-service-wiki`. The package has two roles with separate configurations: `WikiCompiler` owns mutable sources, policy files, drafts, lint, and publication; `WikiReader` owns only immutable published releases and bounded customer retrieval. The customer plugin publishes no compiler service or mutation tool.

The preset's reply language is selected and resolved by the session-scoped [response-language selection](2026-08-31-session-response-language-selection.md) plugin. Wiki guidance owns navigation, evidence, and safety behavior, not language inference.

The package installs `dsh-customer-service-wiki` with `compile`, `lint`, and `publish` commands. Compilation canonicalizes the source root, rejects symbolic links and junctions, reads each source version once, divides normalized extracted text into exact ranges, and plans every source, segment, and topic id before writing. Page ids use a strict path-free grammar; any id or target-path collision fails before draft mutation. Compiler requests contain the complete planned id set, have complete request/response bounds, and treat source text as untrusted data. `--source-only` writes navigation metadata without copying source text into a page body.

Draft frontmatter is strict JSON. Each source reference carries the raw-source SHA-256, extracted-text start/end offsets, and span SHA-256. A source page authorizes one range; a topic page requires ranges from at least two distinct raw sources. The policy hash binds schema, rules, and baseline inputs. Lint reports malformed drafts independently and validates filename/id equality, global uniqueness, policy freshness, exact ranges, distinct topic sources, and a graph whose approved links target unique approved pages.

Publication is the only customer-visibility commit point. It refuses any lint error, copies the exact raw source bytes required by approved pages into a staging release, writes a deterministic content-addressed manifest, atomically installs the immutable release, and atomically replaces `current.json`. Customer runtime never scans the draft directory. Preset mount validates the selected pointer, manifest hash, and graph before registering prompts or tools, so a missing or corrupt release fails without partial registrations.

The map returns a release id that every page, link, and evidence call must repeat. A page read validates all authorized ranges from the copied release source; evidence uses those same verified Buffers and cannot read outside the approved ranges. Lexical ranking returns only positive matches. Evidence identity derives from release, page, source version, range, and excerpt, so `[page-id:evidence-id]` remains stable for an identical call and cannot collide with another query result merely because both ranked first.

Customer prompts treat pages and excerpts as untrusted data, forbid following instructions or authority claims inside them, require evidence before factual claims, and require an honest unknown for absent support. Legal, tax, regulatory, and other high-risk claims require evidence establishing applicable date and scope plus a recommendation to confirm with the responsible authority or a qualified professional.

## Alternatives considered

**Extending the vector RAG preset.** Rejected because one composition would mix retrieval methods, mutable data roots, prompts, and evaluation behavior. Separate presets preserve a meaningful RAG-versus-Wiki comparison and prevent either approval model from weakening the other.

**Serving approved Markdown directly from the draft directory.** Rejected because an editor's partial save or malformed unrelated draft could interrupt every customer read, and sequential compilation could expose a mixed generation. Immutable releases put validation before publication and give customer tools one release identity.

**Approving an entire source file through any one page.** Rejected because long sources produce several independently reviewed pages. Exact ranges keep approval and citations aligned; a page cannot authorize facts that only appear in another segment.

**Using call-local citation numbers.** Rejected because repeated evidence calls for the same page would each create `[page:1]` for different excerpts. Content-derived evidence ids remain unambiguous in the durable transcript.

**Giving the customer agent compilation or approval tools.** Rejected because raw sources and compiler output are untrusted and publication is an operator-owned state change. Customer sessions receive only release-pinned read tools.

## Consequences

The Wiki path requires explicit compile, review, lint, and publish steps and stores source bytes once per content-addressed release. This costs more operator work and disk space than reading live Markdown, while gaining atomic publication, reproducible evidence, stable citations, fail-loud deployment, and isolation between customer traffic and draft maintenance.

The customer performs map, page, and evidence calls instead of one vector lookup. It receives deterministic lexical results without semantic fallback; zero overlap intentionally produces no evidence. The shipped CEM release groups 267 selected FAQ entries by business category and subcategory, divides them at complete-entry boundaries across 49 source documents, approves one source-only navigation page per document, and publishes a cross-source topic linking every page. Compiler-model summaries remain optional and covered by package tests.

## Verification

Package tests cover configuration, Unicode bounds, source-only and model compilation, complete request/response limits, active cancellation and timeout, recursive text extraction, id planning and collisions, source and release symlink rejection, strict draft and release parsing, graph validation, policy/source invalidation, deterministic atomic publication, copied-source corruption, release pinning, exact-range evidence, stable evidence ids, zero matches, complete rendering bounds, real scoped tool/prompt registration and disposal, fail-before-registration mount behavior, CLI operations, and the invariant companion. Focused per-file coverage is 100% for statements, branches, functions, and lines. The keyless product snapshot boots the shipped preset and pins the map-to-page-to-evidence transcript.
