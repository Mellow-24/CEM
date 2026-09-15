# preset/：按会话组装 agent

[English](README.md) | 中文

**agent preset** 是一个目录，其中放置一份 `agent.cordis.yml`。名单会为每一代 preset 挂载一份常驻组装，每个 agent（智能体）再加入其指定的代；带 scope 的注册在不同 preset 之间保持隔离，而插件自身的会话状态仍以 Session 或 Agent 为键。

| 包 | 职责 | ctx 键 |
|---|---|---|
| `agent-presets/` | preset 词汇体系、对受信任根目录和用户自定义根目录的文件系统发现、受防护的常驻挂载，以及 agent 加入 | `ctx.agentPresets` |
| `customer-service-knowledge/` | 为随附的澳门客服 preset 提供带 scope 的向量检索与可引述证据 | — |
| `customer-service-wiki/` | 在已审核 LLM Wiki 上提供只读导航与原始证据工具 | — |
| `persona/` | 把 agent 人设做成可组装的行，使 preset 不止能改工具、也能改身份 | — |

部署交付哪些 preset，看 [`apps/cli/config/agent-presets/`](../../apps/cli/config/agent-presets)——一个 preset 一个目录，那份目录列表就是清单。在这里再列一遍只会多出一份需要同步的名单，而且总是它先过时。

本组假定的组装划分是：注册表与跨会话设施是进程单例，留在宿主组装中；preset 只承载加入其中的 agent 对它们的贡献。若 preset 中某一行发布了进程级全局服务，挂载时即被拒绝，而不是让它泄漏到宿主或与另一代组装相撞。

设计详见 [按会话组装 agent preset 的 Agent Note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md)。
