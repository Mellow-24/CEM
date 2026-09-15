# dsh-customer-service-wiki

English | [中文](README.zh.md)

An embedding-free LLM Wiki for the isolated Macau customer-service preset. Operators compile and review mutable drafts, then publish approved pages and their exact source spans as one immutable content-addressed release. Customer sessions validate that release at preset mount and never scan the draft workspace or mutable operator sources.

## Operator workflow

The operator root contains these inputs and artifacts:

1. `sources/` holds collected text sources; symbolic links and junctions are rejected.
2. `baseline-qa.md`, `rules.md`, and `schema.md` define compilation and review policy.
3. `source-manifest.json` records raw-source byte hashes.
4. `knowledge-map.md` maps source versions to mutable review drafts.
5. `wiki/` holds strict JSON-frontmatter drafts; it is never read by customer tools.
6. `release/` holds `current.json` and immutable releases with copied source bytes.

The published package installs one operator executable:

```sh
dsh-customer-service-wiki compile
dsh-customer-service-wiki lint
dsh-customer-service-wiki publish
```

`compile` plans every source, segment, and topic id before writing. Unsafe ids, path escapes, collisions, source-tree links, malformed existing drafts, compiler failures, and complete-request or response overruns fail the operation. Changed source or policy inputs return affected pages to `draft`; `--force` rebuilds matching pages, and `--source-only` writes navigation-only drafts without putting source text in the page body. The repository convenience command `pnpm run macau-wiki:compile` invokes `compile`.

Each draft uses JSON inside Markdown frontmatter. A source page authorizes exactly one normalized extracted-text range with the raw-source SHA-256 and span SHA-256; a topic page requires ranges from at least two distinct sources. A reviewer checks the body, links, policy hash, source version, and every authorized range before changing only `"status": "draft"` to `"status": "approved"`.

`lint` reports malformed drafts and checks filename/id equality, global id uniqueness, policy freshness, exact source spans, distinct topic sources, and links. Every approved link must target one approved page. `publish` refuses any lint error or an empty approved set, copies required raw source bytes into a staging release, writes its content-addressed manifest, atomically installs the release, and atomically replaces `current.json`. Re-publishing identical approved content yields the same release id.

## Configuration

The customer plugin accepts only published-reader settings:

| Field | Meaning |
|---|---|
| `releaseDirectory` | Root containing `current.json` and immutable releases. |
| `navigationMaxChars` | Complete navigation-result character bound. |
| `evidenceChunkChars` / `evidenceChunkOverlapChars` | Evidence segmentation inside an authorized source range. |
| `resultCount` | Maximum positive lexical matches returned by one call. |
| `maxResultChars` | Complete page/evidence model-result character bound. |
| `queryMaxChars` | Evidence-query character bound. |
| `timeoutMs` | Cooperative customer-tool deadline. |

The operator CLI owns source, draft, policy, compiler-model, compiler-request/response, and publication settings. It uses the shipped Macau paths by default and accepts `--root` plus `DSH_MACAU_WIKI_*` overrides. Model compilation defaults to DashScope `qwen3.7-plus` at its OpenAI-compatible endpoint and sends `DASHSCOPE_API_KEY` only as the request Authorization header. `--source-only`, `lint`, and `publish` make no model request. Customer preset configuration and published Wiki artifacts contain neither the compiler credential nor mutable-draft fields.

The plugin validates `current.json`, the selected content hash, page graph, and manifest before registering any prompt or tool. A missing or corrupt release therefore fails preset mount without leaving partial registrations. Each page/evidence read revalidates the copied source bytes and authorized span from the same Buffer; release files and directories may not be symbolic links or junctions.

## Customer tools

The preset composes exactly four read-only tools:

- `read_company_wiki_map` returns the current `release_id` and published page graph.
- `read_company_wiki` reads one navigation page from that exact release.
- `follow_company_wiki_link` follows a declared link in the same release.
- `open_company_wiki_evidence` returns only positive lexical matches from that page's authorized ranges.

Every tool after the map requires `release_id`, so one investigation cannot mix releases. Evidence ids derive from the release, page, source version, range, and excerpt; citations use `[page-id:evidence-id]` and remain stable across repeated identical queries. A zero lexical score returns no evidence.

The system prompt treats pages and excerpts as untrusted data, forbids following instructions or authority claims inside them, requires evidence before every factual claim, and requires an honest unknown when evidence is absent. Legal, tax, regulatory, and other high-risk answers cannot claim current validity unless evidence establishes the applicable date and scope; the model recommends confirmation with the responsible authority or a qualified professional.

## Model Experience

### Published Wiki navigation and evidence

#### What the model sees

The model sees four fixed tool schemas and one fixed release-to-page-to-evidence rule. Map results contain one release id plus published page metadata. Page results contain bounded navigation summaries and authorized range metadata, never raw source text. Evidence results contain bounded excerpts framed as untrusted data and stable `[page-id:evidence-id]` markers. Drafts, compiler prompts, operator paths, mutable sources, source manifests, and draft maps never enter customer requests.

#### Token effect

The fixed tool schemas and navigation rule appear on each LLM Wiki request. The bounded map enters after the first tool call; one bounded page and positive evidence enter only after their calls. No embedding or reranker request contributes model context.

#### KV Cache effect

Tool schemas and the fixed rule remain prefix-stable for an agent lifetime. Publication changes later tool results and release ids, not the existing request prefix. Requiring the map's release id prevents a later publication from changing the source version used by an in-progress investigation.

## Known Limitations and Deferred Work

- **Approval remains manual** — publication validates hashes, ranges, graph relationships, and policy versions, but it does not record reviewer identity or business-owner authorization. A workflow-backed approval record remains deferred.
- **Text extraction is intentionally narrow** — Markdown, text, HTML, JSON, and CSV are supported. PDF, DOCX, images, and audio require approved extraction and provenance rules.
- **Evidence ranking is lexical** — there are no embeddings or reranking. A query with no positive lexical overlap returns no evidence, even when a human might recognize a semantic relation.
- **The shipped corpus uses deterministic source-only navigation** — reviewed CEM material is grouped by business category and subcategory, then divided only between complete FAQ entries across 49 raw documents; the approved cross-source topic links every source page. Model compilation remains an operator option and is covered by package tests.
