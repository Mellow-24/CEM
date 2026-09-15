# dsh-customer-service-wiki

[English](README.md) | 中文

澳门智能客服独立预设使用的无 embedding LLM Wiki。运维人员编译并审核可变草稿，再将已批准页面及其精确来源区间发布为一个不可变、内容寻址的 release。客服会话在预设挂载时验证该 release，且永远不会扫描草稿工作区或可变运维来源。

## 运维工作流

运维根目录包含以下输入与产物：

1. `sources/` 保存已采集文本来源；系统拒绝符号链接和 junction。
2. `baseline-qa.md`、`rules.md` 和 `schema.md` 定义编译与审核规则。
3. `source-manifest.json` 记录原始资料的字节哈希。
4. `knowledge-map.md` 将资料版本映射到可变审核草稿。
5. `wiki/` 保存采用严格 JSON frontmatter 的草稿；客服工具永远不会读取该目录。
6. `release/` 保存 `current.json` 以及包含来源字节副本的不可变 release。

发布包会安装一个运维可执行文件：

```sh
dsh-customer-service-wiki compile
dsh-customer-service-wiki lint
dsh-customer-service-wiki publish
```

`compile` 会先规划全部资料、分段和主题 id，再执行写入。不安全 id、路径逃逸、碰撞、资料树链接、已有畸形草稿、编译器失败，以及完整请求或响应超限都会使操作失败。资料或规则输入变化会使受影响页面回到 `draft`；`--force` 重建匹配页面，`--source-only` 则创建不在页面正文放入来源文本的纯导航草稿。仓库便利命令 `pnpm run macau-wiki:compile` 会调用 `compile`。

每份草稿在 Markdown frontmatter 中使用 JSON。来源页只授权一个规范化提取文本区间，并记录原始资料 SHA-256 和区间 SHA-256；主题页必须包含至少两份不同资料的区间。审核人核对正文、链接、规则哈希、资料版本和每个授权区间后，只把 `"status": "draft"` 改为 `"status": "approved"`。

`lint` 会报告畸形草稿，并检查文件名/id 一致、全局 id 唯一、规则版本有效、资料区间精确、主题资料互异和链接有效。每个已批准链接必须指向一个已批准页面。`publish` 会拒绝任何 lint 错误或空的已批准集合，将所需来源字节复制到 staging release，写入内容寻址 manifest，原子安装该 release，并原子替换 `current.json`。再次发布相同已批准内容会得到相同 release id。

## 配置

客服 plugin 只接受已发布 reader 设置：

| 字段 | 含义 |
|---|---|
| `releaseDirectory` | 包含 `current.json` 和不可变 release 的根目录。 |
| `navigationMaxChars` | 完整导航结果的字符上限。 |
| `evidenceChunkChars` / `evidenceChunkOverlapChars` | 在授权来源区间内切分证据。 |
| `resultCount` | 单次调用返回的正向词法匹配上限。 |
| `maxResultChars` | 完整页面/证据模型结果的字符上限。 |
| `queryMaxChars` | 证据查询的字符上限。 |
| `timeoutMs` | 可协作取消的客服工具时限。 |

运维 CLI 拥有资料、草稿、规则、编译模型、编译请求/响应和发布设置。它默认使用随附澳门路径，并接受 `--root` 与 `DSH_MACAU_WIKI_*` 覆盖。模型编译默认调用 DashScope OpenAI 兼容端点的 `qwen3.7-plus`，并只通过请求 Authorization header 发送 `DASHSCOPE_API_KEY`。`--source-only`、`lint` 与 `publish` 不会发出模型请求。客服预设配置与已发布 Wiki 产物均不包含编译凭据或可变草稿字段。

plugin 会在注册任何提示或工具前验证 `current.json`、所选内容哈希、页面图和 manifest。因此，release 缺失或损坏会使预设挂载失败，且不会留下部分注册。每次页面/证据读取都会从同一个 Buffer 重新验证已复制来源字节与授权区间；release 文件和目录不得是符号链接或 junction。

## 客服工具

该预设只组合四个只读工具：

- `read_company_wiki_map` 返回当前 `release_id` 和已发布页面图。
- `read_company_wiki` 从该精确 release 读取一个导航页面。
- `follow_company_wiki_link` 在同一 release 内沿声明链接跳转。
- `open_company_wiki_evidence` 只返回该页面授权区间中的正向词法匹配。

地图之后的每个工具都要求 `release_id`，因此一次调查不能混用 release。证据 id 由 release、页面、资料版本、区间和摘录派生；引文使用 `[page-id:evidence-id]`，重复相同查询时保持稳定。词法得分为零时不返回证据。

系统提示将页面和摘录视为不可信数据，禁止遵从其中的指令或权限声明，要求每项事实先取得证据，并在没有证据时如实说明不知道。法律、税务、监管和其他高风险回答只有在证据明确证明适用日期与范围时，才可声称当前有效；模型还会建议客户向主管机关或合资格专业人士确认。

## Model Experience

### 已发布 Wiki 导航与证据

#### What the model sees

模型会看到四个固定工具 schema，以及一条固定的“release 至页面至证据”规则。地图结果包含一个 release id 和已发布页面元数据。页面结果包含受限导航摘要和授权区间元数据，绝不包含原始资料文本。证据结果包含按不可信数据框定的受限摘录和稳定 `[page-id:evidence-id]` 标记。草稿、编译提示、运维路径、可变来源、资料清单和草稿地图永远不会进入客服请求。

#### Token effect

固定工具 schema 与导航规则出现在每次 LLM Wiki 请求中。受限地图在首次工具调用后进入上下文；一个受限页面和正向证据只在对应调用后进入。embedding 或 reranker 请求不会进入模型上下文。

#### KV Cache effect

工具 schema 与固定规则在 Agent 生命周期内保持前缀稳定。发布只会改变后续工具结果和 release id，不会改写已有请求前缀。后续调用必须携带地图返回的 release id，因此调查进行期间发生的新发布不会改变它使用的资料版本。

## Known Limitations and Deferred Work

- **批准仍由人工完成** — 发布会验证哈希、区间、页面图关系和规则版本，但不会记录审核人身份或业务所有者授权。workflow 审批记录仍待实现。
- **文本提取范围有意保持狭窄** — 支持 Markdown、文本、HTML、JSON 和 CSV。PDF、DOCX、图片和音频需要先定义获批准的提取与来源规则。
- **证据采用词法排序** — 不使用 embedding 或重排。没有正向词法重叠的查询不会返回证据，即使人工可以识别语义关联。
- **随附语料使用确定性来源导航** — 已审核澳电资料按业务分类和子分类分组，再只在完整 FAQ 条目之间分成 49 份原始资料；已批准跨资料主题会链接每个来源页面。模型编译仍是可选运维操作，并由 package 测试覆盖。
