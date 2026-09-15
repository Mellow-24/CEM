# Agent Note: 澳门客服管理控制台

Status: implemented

[English](2026-09-04-customer-service-admin-console.md) | 中文

## 问题

澳门客服预设已有接近生产形态的 RAG 与 LLM Wiki 检索，但演示运维人员需要统一查看模型设置、语料状态、检索行为、回归案例与历史会话。若让浏览器直接检查部署路径，就会暴露 Host 布局并绕开两个检索包拥有的审批规则。若让上传直接写入任一线上来源根目录，一次界面操作就等同于批准知识或发布 Wiki。

普通 Remote 载体也可通过显式 trusted-host 配置绑定到 loopback 之外。语料清单、失败评测案例与文件系统写入属于管理平面，因此仅注册普通 Remote 并不足以决定网络访问权限。

## 决策

控制台是完整的能力 seam：一个紧密耦合 Definition 与本地 Provider 的 Host 包 `@deepseek-ai/dsh-host-customer-service-admin`，以及一个浏览器 Consumer `@deepseek-ai/dsh-client-ui-customer-service-admin`。这些角色仍分处 Host 与 Client 包；Definition 与文件系统 Provider 放在一起，是因为唯一实现就是已部署澳门检索存储的投影，两者作为同一个运维 API 一同演进。平台无关的 `api-remotes` 组合挂载其生成的 Typert contribution，不再为它增加第二套手写 API proxy domain。

`CustomerServiceAdminGateway` 拥有 `customerServiceAdmin` 命名空间。知识相关方法为 `overview`、`listDocuments`、`listBadCases`、`searchTest`、`listStagedDocuments` 与 `stageTextDocument`；[会话质量检查](2026-09-09-conversation-quality-inspection.md)拥有额外的评估和复核方法。所有跨包文档、release、页面、证据、坏案例与 staging revision id 都使用品牌类型。公开请求与结果声明位于仅含类型的模块，生成的 `./typert` 和 `./remote` 产物使 Host 实现不会进入浏览器依赖图。

Provider 把审批与检索校验委托给现有 [`LocalKnowledgeIndex`](2026-08-29-macau-customer-service-knowledge-preset.md) 和 [`WikiReader`](2026-08-29-macau-customer-service-llm-wiki-preset.md)。RAG 清单来自已验证的版本化来源 manifest；一次性索引元数据在显式字节上限内读取，并把结构状态与其 identity 是否匹配当前来源及配置分开报告。Wiki 清单固定到当前已验证的不可变 release，而原始 Wiki 来源则按与 release artifact 的精确 SHA-256 对比分为已发布、已变更或未发布。坏案例 JSONL reader 会拒绝无效的 ISO 捕获时间，且只返回查询、verdict、诊断摘要、failure type 与验收标准；捕获的回答及 asset 路径留在 Host 侧。

`searchTest` 只执行证据检索。RAG 搜索保留 `LocalKnowledgeIndex` 行为，包括在需要时重建一次性向量缓存并调用配置的 embedding 端点与可选 reranking 端点。Wiki 搜索使用 `WikiReader`，在当前 release 的指定页面上执行词法证据检索。两个分支都不生成回答、不追加 Session 事件，也不存储对话。

管理界面组合该命名空间与现有模型设置、插件清单及 Session API，而不重复实现这些能力。跨会话历史搜索继续使用现有 `session.search` 路径。Web bundle 以 `openAt: first-search` 和内存派生索引选择 SQLite 查询 Provider，因此启动阶段不会导入 `node:sqlite`，而第一次运营内容查询会惰性对齐实时与持久化 Session。这是[会话内容搜索 opt-in 决策](../architecture/2026-08-13-session-content-search-opt-in.md)所描述的管理控制台部署选择，不是新的持久化权威。澳门运营工作区与 Settings 外框在默认 `zh` locale 中使用繁体中文操作文案；客户消息、历史回答、知识摘录、文件名称和标识码保持记录时的来源语言。

浏览器 Consumer 在相同回调与 store 权属之上提供两套展示 root。原有八个 `settings.section` 注册继续用于标准运营外壳；在 `/customer-admin` 上，Consumer 安装收口后的澳电品牌 alternate root，通过私有 keyed 页面出口提供分组导航、URL fragment 页面选择以及稳定的管理后台文档标题。该路由注册七个页面：工作台、智能体与渠道、当前知识库、发音与词库、会话中心、质检与评测、报表与大屏。对话编排、模型配置和提示词演练不在该路由中出现，但旧外壳仍保留这些功能。工作台和“当前知识库”默认选择真实数据，独立门户的真实数据视图不显示 Provider 标识，且不改变检索设置或结果。页面操作、质检记录、隔离草稿与 Host 权属都不改变。Session 执行证据使用只读门户轨迹，避免 alternate root 与 Settings 页面争用现有 `operations.trace` 子 slot 声明。

运营摘要从相同来源派生：历史会话数量排除空白与子代理行，组合状态和预设筛选，并在目录加载时显示未知总数。知识处理摘要区分暂存上传与已审批资料，并将索引可用性与模型连通性分开标注。案例通过占比明确限定为台账，空台账不显示百分比。界面不虚构满意度或解决率，也不把检索排序得分当作回答准确率。这样既能提供有用的演示，也不会建立另一套运维事实来源。

## 运营演练隔离

完整的旧后台组合 root 作用域、非持久化配置工作区与显式选择的真实数据视图。收口后的独立门户只复用与真实运营和发音管理相关的页面。模拟渠道、发音草稿、固定流程模板、本地文档加工和回归复核不持有真实写入回调。简洁的验证集、草稿和未接入标签将其与运营事实区分，详细数据说明收纳在工作区设置中。草稿跨页面挂载保留，在应用刷新或确认重置时恢复；重置修订号还会重新挂载编辑器私有输入。保存变更的发音会使原测试版本与复核版本失效，相同读音保存则保留两者。完成复核后等待发布，不得调用暂存晋升或修改电话语音提供方。

发音演练将客户看到的回答与仅供合成的文本副本分开。排序后的通用规则先规范化按地区区分的地址写法、机构缩写、数字、日期、金额与百分比；精确词条纠偏再覆盖专名或歧义读音，不在全局替换单字。浏览器可以筛选、启停和试读这些规则，但不合成音频，也不修改 Host 语音 Provider。真实接入位于已提交回答文本与 Provider 合成之间，由适配器向选定 Provider 输出纯文本替换、SSML 别名或其支持的音素。

文档验证和审批由共享操作管理，而不只依赖禁用按钮或组件状态。推进流程前必须使用非空查询命中切片，完成审核前必须明确勾选审批。修改文档、切片或查询会使两者失效。页面切换不能绕过这些前置条件，也不能丢弃正在进行的有效审核。

会话页面使用 Host 对权威事件的有界检查，历史 API 继续供其他消费方使用。两种读取都排除内部推理，不切换当前客服会话。缺失的渠道和语音元数据保持未知。该时间点快照不是新的 Session 权威，也不是音频对齐引擎。

将工作区审核与真实发布、隔离暂存明确区分，避免暗示已具备审核人身份、多用户授权、声学评测或真实发布安全。后续接通时必须定义这些能力，不能直接把工作区回调替换为真实写入。

## 独立 staging 与发布权属

上传只会进入必填的 `stagingDirectory`。配置会拒绝它与 RAG 来源、RAG manifest 和索引、Wiki 来源与 release 或坏案例台账发生词法重叠；每次 staging 操作还会用运行时解析后的父路径重复比较，使配置路径中的符号链接祖先不能把它映射到线上数据。公开请求只接受文件名和文本，绝不接受 Host 路径。文件名必须扁平且扩展名受限，内容必须能经 UTF-8 往返转换并包含非空白文本，单文件与目录清单都有上限。Staging 枚举拒绝符号链接与非文件。

`stageTextDocument` 串行执行 Provider 操作，可选择对比调用方观察到的内容派生目录 revision，随后写入仅属主可读写的同级临时 inode，再把它硬链接到最终名称。链接提交会拒绝已存在的目标，因此重试或并发创建都不会覆盖 staged 文档。完成写入会返回已提交文档及新的 revision。

Staging 刻意不提供提升方法。把 staged 内容移入 RAG 审批 manifest 或 Wiki 来源／草稿／release 流程，需要一个定义来源权属、审批、回滚及并发发布行为的已复核事务。现有 Wiki compiler 仍是 compile、lint、复核与 publish 的权威；控制台不能把上传直接变成面向客户的证据。

## 网络访问政策

浏览器 connection 拥有对端与 Host header 信任判断，因此也拥有网络限制。其固定 privileged-method 集合包含全部 `customerServiceAdmin/*` endpoint。共享 `/api` handler 会在 Typert interceptor 有机会认领这些方法之前，以空 trusted-host allowlist 执行浏览器信任检查，从而把命名空间固定到 loopback 并保留 DNS rebinding 防护。这个顺序很重要，因为直接生成的 Remote 会绕过旧 API proxy fallback。业务服务不接受由调用方提供的授权标志，也不把 loopback 冒充为租户或角色认证。

## 考虑过的替代方案

**在旧 API proxy 中加入 customer-service domain。** 不采用，因为服务已有适合直接生成 Typert 的具名请求与结果。新 domain 会扩大中心 wire union，并重复运行时校验，却没有增加传输层特有行为。

**让 Client 读取配置路径或在每次调用中选择 Host 路径。** 不采用，因为这会把运维面板变成通用文件系统探测器，并让浏览器代码负责来源格式与符号链接安全。部署配置选择全部根目录；Remote 结果只暴露相对路径与有界元数据。

**把上传直接写入 RAG 或 Wiki 来源树。** 不采用，因为目录成员关系不能授予 RAG 审批，且可变 Wiki 来源不能绕过草稿复核与原子 release 发布。独立 staging 区可以演示接入而不削弱任一证据政策。

**在同一纵切中暴露 compile、lint 与 publish。** 暂缓，因为安全发布需要明确的 staging 到 source 提升事务，以及复核者身份或审批状态。仅复用 `WikiCompiler` 并不能定义谁可以替换运维来源，也不能定义部分提升如何回滚。

**在每个 Remote 方法内授权。** 不采用，因为服务拿不到传输对端信息，而且此类检查会发生在共享 Remote interceptor 之后。Connection 会在分发前统一执行固定 loopback 检查。

**在存储或显示前改写已提交回答。** 不采用，因为知识措辞、证据复核、字幕与语音输出会失去共同来源。发音处理只派生独立的播报形式，已提交文本仍是权威记录。

**创建第二个管理后台包并复制八个页面。** 不采用，因为展示隔离不需要第二个 Remote Consumer 或第二套状态权属。仅在目标路由注册 root 与 keyed 出口，可以让澳电外壳相互独立，同时令两套界面使用相同页面实现和 Host 权威。

**在独立门户中展示所有旧后台演练页面。** 不采用，因为品牌路由是运营视图，不是第二套配置实验室。将流程设计、Provider 标识、模型配置和提示词草稿保留在旧外壳，既供开发使用，也不会被呈现为客服运营控件。

## 后果

控制台可以使用真实文档数量、当前 release 状态、坏案例、检索证据和对话搜索，同时保留现有来源及 Session 权威。模型配置仍可在旧 Settings 外壳中查看；独立门户刻意不显示 Provider 标识。运维响应只表示调用当下；若权属文件在投影期间改变、超过配置上限或违反格式，调用会明确失败。

控制台刻意是本机管理能力，而不是多用户控制平面。RAG 搜索可能产生 embedding 或 reranking 延迟，并可能替换一次性索引；Wiki 搜索是确定性的词法检索。Staged 文件占用本地磁盘，但在独立的已复核提升能力出现前保持惰性。PDF、Office、图片或音频输入在具备提取来源政策前不会加入可接受上传类型。发音试读输出只证明有序文本规范化，不表示真实声线的音质或标记支持。

## 验证

Host 包测试会建立临时的已审批 RAG 与已发布 Wiki 存储，并覆盖六个生成方法的注册、overview 与文档投影、已变更及未发布 Wiki 来源、有界坏案例解析、真实检索前后的 RAG 索引状态、Wiki 证据检索、校验失败、staging revision、禁止覆盖及符号链接拒绝。Connection 测试证明可信但非 loopback 的 Host 会在共享 Typert interceptor 收到管理调用前被拒绝。Client 测试在没有真实 Provider 时覆盖 loading、empty、error、overview、文档、检索测试、坏案例、staging、按语言执行的发音规范化、规则启停、精确词条纠偏、路由选择、收口后的独立注册、Provider 标识隐藏，以及两套管理界面共存。组合后的 Web 覆盖会执行原控制台、独立澳电 root、当前知识库与质检导航、发音试读、已屏蔽控件及首次搜索 Session 索引。
