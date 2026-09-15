# Agent Note: 生成的工具 schema 目录（启动并采集）

Status: implemented

[English](2026-07-02-tool-schema-catalog.md) | 中文

## 问题

仓库此前没有一份统一的参考文档来记录实际暴露给模型的工具名称、描述与 JSON Schema。源码声明分散各处且在运行时组合，而既有的 Cordis 参考和子系统页面覆盖的是接线与词汇，而非工具。

## 决策

目录通过**启动每个工具插件并读取其已注册 schema** 来生成，而不是解析源码。`scripts/gen-tool-catalog.ts` 在全新的 Cordis `Context` 上挂载每个已发布工具包；该上下文还提供 `SystemPrompt`、`ToolRuntime` 以及插件 `apply` 所读取的注入服务。生成器调用 `ctx.tools.schemas()`——也就是发送给模型的确切 `ToolSchema[]`——随后 dispose（资源释放）上下文，并为每个包渲染一个 `## <package>` 章节，每个工具附带一个 ` ```json ` `parameters` 块。它与 `gen-cordis-catalog` / `gen-module-graph` 的 CLI 形状一致：默认 `--write` 重新生成；提交副本陈旧时 `--check` 失败；输出具有确定性（按清单排序，工具按名称排序）。`verify-tool-catalog`（即 `--check`）在 `doc-sync` 内运行，因此相关文档变更和 CI 会执行同一项新鲜度检查。

### 为何启动而非解析（核心要点）

Cordis 目录是纯 TypeScript AST 遍历，因为每个事件/服务名都是字符串字面量，可以往返映射到静态声明——AST 即全部事实。**工具 schema 在静态层面不可知**，因此同样的技术会产出一份说谎的文档：

- `tool-todo` 写了 `enum: [...STATUSES]`——对一个运行时 `const` 的展开。AST 看到的是展开表达式，而非 `["pending","in_progress","completed"]`。
- 每段描述都通过字符串**拼接**构建（`'…' + '…'`）。AST 看到的是拼接节点，而非模型实际读到的最终文本。
- `tool-subagent` 的工具名是 `config.toolName ?? 'subagent'`——加载时选定，并非字面量。
- MCP 插件可以通过 `ctx.tools.register()` 直接注册**原始 JSON Schema**，完全不经过 `defineTool`，因此结构化枚举 `defineTool(` 调用点会遗漏。

唯一准确的真源，是插件加载后注册表实际持有的 schema。启动插件是把[测试策略](../../../../docs/testing.md)中「验证现实，而非自我报告」的准则应用到文档生成器：读取已发布产物，而非重新推导一份。

### 恢复「不会静默遗漏」的保证

启动有一项 schema AST 遍历不存在的代价：没有 schema 声明集合可供枚举，新工具包可能被遗忘。一个**完整性守卫**从两份独立清单恢复这项保证：一份是惯例目录 `packages/*/tool-*`，另一份是对 `packages/*/*/src` 中直接调用 `<context>.tools.register(...)` 的 TypeScript AST 扫描。每个发现的包都必须在 `TOOL_PACKAGES` 中拥有启动配方，或明确说明其运行时提供的 schema 为何无法一次性采集。AST 扫描只发现包的归属；schema 仍然完全来自启动插件后读取注册表。任何遗漏都会使生成器失败，进而使 `doc-sync` 失败。

### 手动维护的启动 manifest 是无法省去的策略

文件系统与注册调用扫描负责发现工具包清单，完整性守卫负责拒绝遗漏、空白的排除理由、陈旧排除项，以及同时列为可采集和排除的包。`TOOL_PACKAGES` 仍然为每个固定 schema 包持有一份显式启动配方，因为所需的 Service Provider 和配置属于策略，不是能从目录布局或注入名称安全推断的事实。

### 范围

范围包括具有固定产品工具 schema 的已发布包，每个都使用默认配置启动：既包括惯例中的 `tool-*` 包，也包括澳门客服包等位于其他目录的固定 schema 注册方。由模型创作的动态包工具、已连接 MCP 服务器的工具，以及每次运行提供 schema 的结构化输出工具没有一份可代表它们的包级固定 schema，因此不渲染进目录；其归属包作为带明确理由的排除项列入清单。仅供示例使用的工具不在范围内。

目录的单位是包，而非经过配置的每个工具实例。每个包以默认配置启动一次；加载时的别名（如 `subagent_fork`）会注明，但不枚举所有部署配置组合。部署清单覆盖的是一个独立且无界的范围。

### 使用普通 `json` 围栏

schema 块使用 ` ```json `，而非自定义的 `ts` 系围栏。`doc-typecheck` 只提取 `ts*` 围栏，因此 JSON 块对它不可见——无需 `BlockKind` 接线（不同于 Cordis 目录的 `ts cordis-catalog` 围栏，后者需要加入白名单以避免裸签名片段被编译）。

## 曾考虑的替代方案

- **纯 TypeScript AST 遍历，如 Cordis 目录**：工具 schema 在静态层面不可知（见上文核心要点）：运行时展开、字符串拼接、配置选定的名称，以及原始 `ctx.tools.register()` 注册，都会让 AST 推导出的文档说谎。
- **从各包的 inject 推断启动配方**：属于[发现包清单提案](../../proposed/process/2026-06-20-discover-package-inventory.md)所警告的「过度聪明」路径；配方保持为手写策略，清单由文件系统发现并由完整性守卫把关。
- **为 schema 块使用自定义 `ts` 系围栏**：不必要。普通 ` ```json ` 围栏对 `doc-typecheck` 不可见，无需 `BlockKind` 白名单。

## 验证

`scripts/gen-tool-catalog.spec.ts` 固定了以下行为：发现不以 `tool-*` 命名的注册方；运行时 schema 必须给出明确理由；惯例目录仍作为后备清单；陈旧或重叠的排除项会被拒绝。普通 `verify-tool-catalog` 运行会先检查完整仓库清单，再启动并采集每一项固定 schema manifest 条目。

## 后果

- 目录不会发生漂移：提交文件未反映的工具 schema 变化会使 `doc-sync` 和 CI 中的 `verify-tool-catalog` 失败。新增的惯例工具包或直接工具注册方若未加入 manifest，会直接使完整性守卫失败，即使其目录名不以 `tool-` 开头。
- 工具描述文本有唯一归属——源码中 `defineTool` 的 `description`——生成的条目质量取决于它，与 Cordis 目录对事件 JSDoc 施加的强制力相同。
- 生成器导入并执行工作区包（这是仓库中第一个这样做的脚本；其他脚本只读文本）。它通过根 `tsconfig` 的 `paths` 映射在 `tsx` 下运行，使用与演示和测试相同的未构建源码路径，因此不需要构建步骤。
- 未来某个工具背后新增一个能力 seam，意味着 manifest 中需要新增一条配方条目（声明要挂载哪些 seam）。这正是上文指出的有意为之的手写成本；仅在新增工具包时才需变更。
