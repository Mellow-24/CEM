# preset/ — per-session agent composition

English | [中文](README.zh.md)

An **agent preset** is a directory holding one `agent.cordis.yml`. The roster mounts one standing composition per preset generation, and each agent joins the generation it names; scoped registrations stay isolated between presets while plugin-owned session state remains keyed by Session or Agent.

| Package | Role | ctx key |
|---|---|---|
| `agent-presets/` | Preset vocabulary, filesystem discovery over trusted and user-authored roots, guarded standing mounts, and agent joins | `ctx.agentPresets` |
| `customer-service-knowledge/` | Scoped vector retrieval and citeable evidence for the shipped Macau customer-service preset | — |
| `customer-service-wiki/` | Read-only navigation and raw-evidence tools over an approved LLM Wiki | — |
| `persona/` | The agent persona as a composable row, so a preset can change identity and not only tools | — |

The presets the deployment ships live in [`apps/cli/config/agent-presets/`](../../apps/cli/config/agent-presets) — one directory each, and that directory listing is the roster. Naming them here too would be a second list to keep in step, and the first one to fall behind.

The composition split this group assumes: registries and cross-session facilities are process singletons and stay in the host composition, while a preset carries what its agents contribute to them. A preset that names a row publishing a process-global service is rejected at mount rather than allowed to leak into the host or collide with another generation.

Design: [the per-session agent-preset note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md).
