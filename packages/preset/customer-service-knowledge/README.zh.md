# dsh-customer-service-knowledge

[English](README.md) | 中文

澳门智能客服 Agent 预设专用的已批准来源检索插件。每条客户直接消息进入模型前，该 function plugin 会使用消息原文检索，并在预设的常驻作用域中将受限证据插入该消息之前；它不发布 Cordis service，也不注册模型可见工具。同一预设的所有 Agent 共用一个串行化索引实例；其他预设不会获得自动检索路径或其配置。预设作用域隔离的是能力，不是文件系统或租户：部署必须把语料和缓存放在编码 Agent 无法访问的工作区之外，并使用仅所有者可访问的位置。

## 已批准来源

`sourceManifestPath` 是严格的版本 1 allowlist。`sourceDirectory` 下每个受支持文件都必须按路径词法顺序出现一次，并带有精确文件字节的 SHA-256；条目缺失、额外受支持文件、符号链接、无效 UTF-8、hash 变化及 manifest 格式错误都会使预设挂载失败。`.DS_Store` 等不受支持文件会被忽略。放在来源根目录内的 manifest 不参与来源清单。

```json
{
  "version": 1,
  "sources": [
    { "path": "company-hours.md", "sha256": "<64 lowercase hex characters>" }
  ]
}
```

修改来源必须先完成审核，再更新 manifest hash。Manifest 批准的是可检索字节；文档正文仍须写明安全使用这些字节所需的出处、生效日期、受众和限制。

## 配置

所有运行参数都由预设组合文件显式提供。

| 字段 | 含义 |
|---|---|
| `sourceDirectory` / `sourceManifestPath` | 已批准来源根目录和严格 hash allowlist；预设首次挂载时两者必须存在。 |
| `indexPath` | 可丢弃、仅所有者可读写的 JSON 向量缓存；必须位于来源根目录之外，且不得替换 manifest。 |
| `embeddingBaseURL` / `embeddingModel` / `embeddingApiKeyEnv` | OpenAI 兼容 `/embeddings` 端点前缀、模型与可选的服务端 Bearer 凭据引用。来源片段和客户查询会发送至此端点。 |
| `rerankerURL` / `rerankerModel` / `rerankerApiKeyEnv` / `rerank` | 可选重排端点、模型与服务端 Bearer 凭据引用。一次失败仅让当前查询保留向量顺序，记录错误并在下一次查询重试；调用方取消会继续传播。 |
| `embeddingBatchSize` | 单次索引请求向量化的片段数。 |
| `chunkChars` / `chunkOverlapChars` | 以标题为边界的 UTF-16 code unit 片段上限与重复后缀。 |
| `candidateCount` / `resultCount` | 参与筛选的向量候选数与最多提供给模型的证据片段数。 |
| `minimumVectorScore` / `minimumRerankScore` | 由部署校准的相关性阈值。没有来源通过时返回 `not-found`，原因为 `insufficient-evidence`。 |
| `maxQueryBytes` / `maxExcerptBytes` / `maxResultBytes` | 查询、每段摘录、完整规范结果及完整模型渲染文本各自的 UTF-8 限制。 |
| `responseProvider` / `responseModel` / `responseReasoningEffort` | 客服回答的预设内路由，不会改写部署默认模型或 AI 质检模型。 |
| `requestTimeoutMs` / `timeoutMs` | 单次 Embedding 或重排请求，以及整个自动查询的超时。 |

随附预设将客服回答路由到 DashScope `qwen3.7-flash` 非推理模式，并使用 `qwen3.7-text-embedding` 和 `qwen3-rerank` 完成检索；每次模型请求前都会解析 `DASHSCOPE_API_KEY`。Web 部署使用首个问题的本地确定性标题，不再并发发起标题模型调用。预设会在组合值之前读取 `DSH_MACAU_KNOWLEDGE_DIR`、`DSH_MACAU_KNOWLEDGE_MANIFEST`、`DSH_MACAU_KNOWLEDGE_INDEX`、`DSH_MACAU_EMBEDDING_BASE_URL`、`DSH_MACAU_EMBEDDING_MODEL`、`DSH_MACAU_RERANKER_URL` 和 `DSH_MACAU_RERANKER_MODEL`。未覆盖 manifest 时，会从生效来源目录读取 `source-manifest.json`。路径只为常驻预设实例解析一次，不会从各会话工作区读取；凭据不会写入向量缓存。

预设请求路由会在宿主的会话模型选择监听器之后应用已配置的客服回答模型。因此，客服延迟调优只作用于此预设，运营质检引擎及无关会话继续使用各自配置的模型。

## 行为

预设挂载时会先准备向量缓存，再接受客户会话。系统会重新读取 manifest、校验每个已批准文件的 hash，并重新派生当前 chunk 的 id、正文、标题、标题层级和路径。只有严格解析证明来源 hash、Embedding 端点与模型、切分参数、向量维度以及完整 chunk 元数据和正文均与派生结果一致时，持久缓存才会复用。因此，更换 Embedding 端点或模型会在启动阶段重建全部来源向量；只更换重排模型不会重建。格式错误或过期的缓存会被丢弃并重建；准备失败会阻止预设挂载，而不会延迟首位客户的回答。索引准备和搜索共用一个实例队列。

每条客户直接消息都会在模型请求前触发一次查询。查询精确使用最后一条非空客户消息原文；插件上下文和既往消息不会替换该查询。证据提示紧接在该客户直接消息之前，其他待提交消息的相对顺序保持不变。普通 `user/message` 事件记录该顺序，用于请求重建和回放。每次查询仍会在使用已准备缓存前重新校验已批准来源字节和派生 chunk 元数据。非“文件不存在”的文件系统错误会使回合失败。

查询成功且未取消后，派生模型历史中本插件此前仍生效的每条证据提示都会被替换为简短的依据已失效标记。替换使用已记录的 `user/message` 和单节点 `surfaceOp`，通过 `sourceEventSeqs` 引用原始事件，并在新步骤开始前执行。原始证据和检索事件仍保留在仅追加审计日志中。客户、客服、工具和其他上下文消息的内容与顺序不变。被拒绝或空白输入、检索失败以及替换前取消都不会改动旧证据。独立的 `customer-service-knowledge-history` 来源使标记不会被再次替换。

每条非空客户问题都会执行 Embedding；启用重排时，系统会把向量检索得到的有限 Top-K 候选发送给已配置的重排模型。重排成功后，证据必须同时通过 `minimumVectorScore` 和 `minimumRerankScore`；瞬时重排失败时，只回退到通过向量阈值的候选。空的批准 manifest 返回 `empty-corpus`。证据 id 由内容派生，在等价构建之间保持稳定。

### 对话指引

回复须针对客户最新消息，包括对先前误解的纠正；证据提示不能取代该诉求。问候、感谢和称呼可依据当前会话处理，无需公司知识证据。提示词要求模型不得重复无关或已被否定的答案，不得在客户未明确提出称呼需求时追问姓名，也不得推断姓氏、性别或头衔。客户主动提供自己的姓名、称谓或偏好，就足以在当前会话中自然沿用，无需再次确认或每句复读，并以最新明确表达为准。客户提出称呼需求而偏好未知时，才可询问。使用自报姓名不需要查询账户、识别身份或建立档案。英文回答中，自报姓名和称谓也使用自然英文译称或转写，不附中文原文或中文括注。这些指令不增加跨会话偏好存储，也不放宽业务证据、安全或权限要求。

当一条消息只有问候、感谢、道歉、自我介绍、称呼要求或更正称谓时，指令要求只简短回应当前动作，不附带旧业务答复、未经请求的业务追问或转人工建议。这一限制不缩短业务问题的回答；即使业务问题与对话动作出现在同一条消息中，仍需按相关证据完整回答。

## Model Experience

### 公司知识检索

#### What the model sees

模型会看到以转义 JSON 表达的受限证据，紧接着是客户最新的直接消息；此前的检索提示仅显示为简短的依据已失效标记。它不再先花费一次模型请求来选择检索工具或编写检索参数。渲染给模型的证据只有片段正文；来源路径、标题、稳定 id、排序、分数和引文标记不会进入面向客户的模型输入。提示词明确要求把来源字符串视为引用数据而非指令，并禁止提及来源文档、检索元数据或检索过程。业务事实必须由本次检索的相关证据支持；缺少依据时须诚实说明不知道，而不是复用旧依据。只有在已批准证据或当前对话已提供人工支持路径时才可提及该路径。

#### Token effect

常驻指令会出现在该预设的每次请求中，客户最新直接消息之前会插入一份受限证据上下文。旧片段正文不会在模型历史中累积；每条被替换的提示仅保留一个固定大小的标记。`maxResultBytes` 分别约束完整规范结果和完整模型渲染文本。移除检索工具 schema 及其前置模型回合后，可缩短首个回答 token 的等待时间，同时每条客户问题仍保留 Query Embedding、向量检索和已配置的重排。

#### KV Cache effect

常驻指令在一个预设 generation 内保持前缀稳定。旧提示被替换时，历史前缀从该位置起发生变化；后续请求会保留其稳定标记。来源或缓存变化只影响后续证据消息。精确查询、受限证据、结果状态、是否重排、来源数量和耗时会记录在 `customer-service-knowledge/retrieval` 中，供会话回放和质检使用；原始提示及替换事件可重建原始请求与后续请求。

## Known Limitations and Deferred Work

- **阈值由部署决定** — 不同 Embedding 与重排模型的分数分布不同；面向客户启用前，运维人员必须使用已批准正例和域外查询校准两个阈值。
- **仅支持文本型导入** — 在具备已批准解析器和来源政策前，PDF、DOCX、图片与音频不会进入索引；长 Markdown 表格按标题而非表格语义切分。
- **首次索引同步执行** — 语料变化后会先完成 Embedding 才结束查询。大型部署应在接收客户流量前准备并预热缓存。
