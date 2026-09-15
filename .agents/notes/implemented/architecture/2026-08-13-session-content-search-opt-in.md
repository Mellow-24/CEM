# Agent Note: Session content search uses profile-specific openAt

Status: implemented

English | [中文](2026-08-13-session-content-search-opt-in.zh.md)

## Problem

The base profile and the Macau customer-service operations console have different search needs. A general deployment should not create a full-text index unless an operator opts in, while the console needs cross-session content search during a demonstration. The index has a node:sqlite import, per-search source reconciliation, and derived storage; the model-facing search tools remain opt-in and unmounted (the [not-shipped-default decision](../feature/2026-08-02-session-search-not-shipped-default.md)).

Turning the capability off by unmounting the plugin row is not viable. `ApiProxyService` declares `sessionQuery` as a required injection, so without the provider the whole host API gateway stays unloaded and the Web GUI never boots. Session-log export traces subagent descendants through `ctx.sessionQuery.traceSession`, and a subagent fork resolves its Workspace through the same lineage trace — both would need optional-service guards plus a replacement lineage source, roughly tripling the change surface while losing exact reads everywhere.

## Decision

`openAt: 'never'` is a third opening phase on `@deepseek-ai/dsh-session-query-sqlite`: `searchSessions` and `searchEvents` fail with the typed `SESSION_QUERY_SEARCH_DISABLED` code before any request normalization, node:sqlite is never imported or opened, and no source observation or reconciliation runs. Every inherited `ctx.sessionQuery` exact read, filter, and trace keeps working, so session export, fork Workspace inheritance, and title reads are unaffected.

`SESSION_QUERY_SEARCH_DISABLED` joins the closed `SessionQueryErrorCode` taxonomy, and the `tool-session-query` service boundary maps it to the model-safe message `session search is disabled in this deployment`.

The base bundle sets `openAt: never` on the `session-query-sqlite` row. The Web bundle is the explicit customer-service operator profile: it restates the provider as `openAt: first-search` with an in-memory path, so the first search initializes the disposable index while startup stays clear of node:sqlite. Other deployments may choose `first-search` or `startup` in a later patch layer, typically with a durable path. The host `session.search` endpoint reports the provider failure through its existing error path, and a profile that keeps `never` retains the sidebar's local title/workspace matching plus content-search-unavailable notice. The CLI compatibility spec pins the base `openAt: never` row; Web e2e scenarios cover the first-search behavior through seeded-session navigation.

## Alternatives considered

- **Unmount the plugin row** (`disabled: true` in the base patch): rejected — the api-gateway's required `sessionQuery` injection keeps the whole host API unloaded, and making that injection optional forces guards plus a header-walk lineage fallback in session export and fork resolution.
- **Disable at the consumers** (the host `session.search` endpoint or the sidebar): rejected — enforcement belongs to the operation that makes the decision; opt-in model tools or any other consumer would still reach the index.
- **A separate boolean beside `openAt`**: rejected — the opening phase already owns when SQLite starts; `never` extends the same axis instead of adding a second knob that can contradict it.

## Consequences

- The base profile runs no derived index: no node:sqlite import or experimental-SQLite startup warning, no reconciliation work, and no derived database on disk. Sidebar search matches session titles and workspace names only.
- The Web customer-service profile opens an ephemeral index only after the operator first searches, so its management console can find historical conversation content without delaying startup.
- Search failures in a profile that keeps `never` are typed and stable rather than incidental, so callers distinguish a deployment choice from an index fault (`SESSION_QUERY_INDEX_FAILED`).
- Compositions that mount the search tools without overriding `openAt` get the model-safe disabled message on every search call; enabling the tools implies enabling the index.
