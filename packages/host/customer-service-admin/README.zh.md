# @deepseek-ai/dsh-host-customer-service-admin

[English](README.md) | 中文

澳门电力客服管理界面的 Host 运维数据能力。`CustomerServiceAdminGateway` 注册仅供 Remote 使用的 `customerServiceAdmin` 服务；生成的 Host 与浏览器产物分别通过 `./typert` 和 `./remote` 导出。组合后的浏览器载体会在共享 Typert 分发之前，将该命名空间限制为仅 loopback 调用方可访问。

网关通过 `LocalKnowledgeIndex` 读取 RAG 审批清单，通过 `WikiReader` 读取当前不可变 Wiki，并投影运维人员维护的坏案例 JSONL 台账。坏案例捕获时间必须是真实有效的 ISO 日历日期或 UTC 时间戳。目录响应只包含相对来源路径与可公开的模型名称，绝不返回配置中的 Host 路径、模型端点、坏案例里捕获的来源回答或任意文件。每项投影都受必填部署上限约束，并在返回前验证来源拥有的格式。

| Remote | 结果或效果 |
|---|---|
| `overview` | RAG 文档／切片数量、安全的检索设置、一次性索引元数据、当前 Wiki release 与坏案例数量 |
| `listDocuments` | 已审批的 RAG 文件，以及分类为已发布、已变更或未发布的 Wiki 原始来源 |
| `listBadCases` | 有界的回归台账，包含诊断摘要与验收标准 |
| `searchTest` | 直接执行 RAG 或当前 release 的 Wiki 证据检索，不生成回答，也不修改 Session |
| `listStagedDocuments` | 完整的独立 staging 快照及其内容派生 revision |
| `stageTextDocument` | 以可选 compare-and-set 新增一个扁平 UTF-8 文本文档，绝不覆盖 |
| `inspectConversation` | 完整且有界的会话证据，不恢复其 agent |
| `startQuality` | 接收异步、指纹固定的模型评估任务 |
| `listQuality` | 持久化的评估、风险、复核与整改摘要 |
| `getQuality` | 单次评估、原始证据与复核历史 |
| `reviewQuality` | 带修订校验和必填依据的人工复核或整改状态变更 |

`rag` 接受完整的 `KnowledgeConfig`。`wiki` 接受完整的 `WikiReaderConfig` 及其原始 `sourceDirectory`。部署还必须提供 `badCasesPath`、独立的 `stagingDirectory`，以及文档数、Wiki 页面数、坏案例数量与字节数、索引字节数、单份 staged 文档字节数的正安全整数上限。以代码直接构造服务时，也会执行与 Loader 配置相同的语义校验。

Staging 接受 `.csv`、`.htm`、`.html`、`.json`、`.markdown`、`.md` 与 `.txt`。它拒绝路径分隔符、绝对或空白名称、无效 UTF-8、空白内容、过大内容、符号链接、非文件、不支持的扩展名、过期 revision 与已存在的目标。新建的仅属主可读写临时 inode 会通过硬链接安装到最终名称，因此并发创建也不能替换已有文件。词法检查与运行时实际路径检查共同保证 staging 不与任何已配置的线上来源或产物路径重叠。

## 会话质检

可选的 `quality` 配置启用评估，必须提供 `directory`、`provider`、`model`、`timeoutMs`、`maxEvents`、`maxInputBytes`、`maxOutputTokens`、`maxRecordBytes`、`maxRuns`、`maxTurns` 和 `slowResponseMs`。质检目录必须与暂存及线上知识目录分离。未配置时拒绝质检操作。现有会话、持久化和 LLM（大语言模型）服务提供来源记录与模型执行。未结束轮次仍可查看，默认评估会自动跳过；运营人员也可明确选择已结束轮次。选中的未结束轮次不能评分。超过上限的会话拒绝检查，不会静默对不完整记录评分。

每次任务以仅属主可读写的文件保存来源指纹、证据投影、检查范围、六项权重、模型、规则版本、自动评分及仅追加的复核记录。相同的并发请求共享正在执行的任务。无效输出、不存在的证据引用、超时和中断任务均明确失败；重试创建新任务。人工改分不替换自动评分，修订校验拒绝陈旧复核。持久化面向本机单进程，不提供复核人身份认证或自动到期删除。

意图、检索相关性、回答依据、处理完整性、表达和执行分别返回结果。没有标准标注时，检索质量是有依据的评估，不是实测准确率或召回率。缺失证据会使总分不可用；不适用维度不计入。严重风险独立于总分展示。执行维度使用已记录的错误及耗时，不推测未采集的语音延迟。检查排除内部推理，并按模式隐藏凭据、电邮和澳门电话号码；这不是完整的个人数据分类器。

## 模型体验

### 检索测试

#### 模型看到什么

当 RAG 的一次性缓存需要重建时，`searchTest` 会把已审批文档切片发给配置的 embedding 端点，并发送运维人员的查询以生成向量；启用 rerank 时，还会把查询和候选摘录发给配置的 reranker。Wiki 搜索是本地词法检索。任何结果都不会进入对话模型请求。

#### Token 影响

不会增加对话 token。Embedding 与可选 reranker 的输入量取决于配置的来源语料、查询、候选数量与切片上限。

#### KV Cache 影响

无；网关不组装对话模型请求。

### 质量评估

#### 模型看到什么

明确调用 `startQuality` 会把选定历史客户／客服文字、工具输入输出及六维规则传送给配置的 LLM。这些记录均视为不可信数据；评估器没有工具，并关闭推理输出，使有限响应预算用于必要的 JSON。准确的系统提示词、消息、输出上限和推理设置会在分发前记录到质检目录下的独立审计 Session，绝不写入客户日志。请求要求严格 JSON、原事件引用，以及简短的繁体中文意图、理由和建议字段。打开历史、查看评分和人工复核不会调用模型。

#### Token 影响

每项接收的任务消耗独立且有界的评估请求。来源字节、轮次、输出 token 和超时由部署限制；客户会话的 token 历史不变。

#### KV Cache 影响

辅助请求不复用或修改客户的对话组装。

## 已知限制与暂缓事项

- **仅支持文本格式** —— PDF、DOCX、电子表格、图片与音频接入需要经过审批的提取器与来源政策。
- **Staging 不等于发布** —— 网关不会把 staged 文件复制进线上 RAG 或 Wiki 根目录，也不负责编译、lint、审批或发布 Wiki release。提升到线上需要明确的复核事务。
- **只表示调用当下** —— 评估使用捕获的证据，不对当前语料重新检索。缺失录音时无法判断发音、STT 准确率或字幕同步。RAG 检索测试可按 `LocalKnowledgeIndex` 语义重建现有的一次性向量缓存。
- **仅供可信本机管理** —— 服务没有租户或角色模型；组合后 connection 的 loopback 限制就是其网络访问政策。
