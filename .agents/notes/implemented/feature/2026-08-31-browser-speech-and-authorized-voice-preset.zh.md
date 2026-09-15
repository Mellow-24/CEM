# Agent Note: 浏览器语音与授权音色预设

Status: implemented

[English](2026-08-31-browser-speech-and-authorized-voice-preset.md) | 中文

## Problem

Agent 预设可以限定人设、语言策略与工具，但 Web 客户端没有语音输入或输出。只增加按钮会把提供方凭据暴露给浏览器，允许调用方用授权音色合成任意文本，还会迫使编码音频通过为小型控制消息设计的 JSON 传输。把录音作为模型内容还会引入语音转文字输入并不需要的持久附件、适配器、压缩、回放与模态语义。

授权音色只属于香港风水预设。仅在客户端隐藏无法执行该限制，因为同源调用方仍可直接调用 Host 路由，而 Web 客户端的 `trustedHosts` 检查是 DNS 重绑定防护，不是身份认证。

手动消息播放要求已提交文本；连续通话的逐句播放遵循[客服通话设计](2026-09-03-customer-service-voice-calls.md)，允许经日志前缀校验的实时文本。

## Decision

连续通话与显式 Qwen ASR 协议由[客服通话设计](2026-09-03-customer-service-voice-calls.md)规定。

语音转写与语音合成是在 `packages/speech` 下拆开的两个能力 seam。`@deepseek-ai/dsh-speech-transcription` 与 `@deepseek-ai/dsh-speech-synthesis` 提供按作用域分层的提供方注册表。提供方注册在挂载它的预设作用域内，每项操作运行前都按精确的实时根 Agent 解析。即使其他预设与它同处一个进程，也无法解析到提供方。

`@deepseek-ai/dsh-speech-http` 是两项能力的首个 Service Provider。两个可独立省略的配置分别指定 profile、端点、凭据引用、限额与媒体属性。转写请求把完整且已准入的录音作为原始字节发送，并接收最终 JSON transcript（文本记录）。合成请求发送包含已提交 assistant 文本的 JSON，并返回有界编码字节流。凭据在每次请求前即时解析，绝不进入浏览器配置，也绝不跟随重定向。

`@deepseek-ai/dsh-speech-dashscope` 是 DashScope 合成 Service Provider。它发送提供方的嵌套模型与输入请求，请求 HTTP SSE，并只从 `sentence-synthesis` 事件增量解码 Base64 音频。从设置到流消费的整个过程都执行严格 UTF-8 解码、完整响应与待完成事件字节上限、严格事件与 Base64 验证、必需的终止 `stop`、重定向拒绝，以及同一超时／取消信号。提供方失败只暴露稳定语音错误码，不返回提供方响应正文或凭据。

`@deepseek-ai/dsh-speech-web` 是 Host Consumer。它通过 Connection 服务注册精确、无信封的 Fetch 路由，由现有浏览器信任检查、缓冲前的路由级请求体上限、断连取消与响应背压负责传输。语音路由默认仅允许 loopback；部署可显式选择 trusted-host，并自行配置访问控制。Profile 发现只返回目标实时根 Agent 可见的操作。转写接收一份完整音频请求体。合成只接收 Session id、已提交 assistant 消息 id 与可见 profile；Host 从该 Session 的 append-origin `assistant/message` 读取可朗读文本，因此浏览器不能向授权音色提交任意文本。

`@deepseek-ai/dsh-client-ui-voice` 是全局浏览器插件；只有 Host profile 发现报告某项操作后，其配置项才渲染。它在 `conversation.input.right` 增加麦克风与语音发送控件，在 `conversation.composer.dock` 显示临时状态，并在 `conversation.chat.assistant-actions` 提供手动或自动播放。`MediaRecorder` 协商 Host 接受的媒体类型，并在录音过程中执行 Host 字节上限。最终 transcript 会追加到现有草稿供用户检查；只有通过普通输入框提交并形成持久 `user/message` 后，它才会到达模型。语音发送为第一条新提交的收尾 assistant 消息预备自动播放；自动播放遭浏览器拒绝后，手动播放仍可使用。

Web 界面只从已提交 assistant 消息启动合成，不读取原始 `assistant/chunk` 事件。失败的模型尝试可能先发出原始分片，随后被重试替换；已经播放的声音无法撤回。该选择增加了最终消息等待时间，但让可听输出与持久答案一致。

随附的 `hk-feng-shui` 预设把回复语言固定为 `yue-Hant-HK`，贡献适合 TTS 的虚拟顾问人设，在配置转写端点时挂载 HTTP 转写，并在存在 `DASHSCOPE_API_KEY` 凭据时挂载 DashScope 合成。预设固定 Qwen-Audio TTS 模型、授权音色 id、MP3 输出、粤语表达指令与 AIGC 音频标记；非秘密的提供方端点仍可配置。它声明自身是虚拟 AI 而非该真人，把播放标为 AI 合成语音，并说明文化娱乐、专业建议限制、反胁迫与数据最小化要求。仓库不附带任何凭据值。

语音仍是围绕文本的展示。原始录音与合成字节不进入 Session 日志、LLM 内容块词汇或持久附件存储。[持久图片附件决策](2026-07-22-web-multimodal-image-input-and-durable-attachments.md)继续管理模型可见媒体，并明确把音频留作独立设计。[仅自动化 ACP 决策](../simplification/2026-07-23-acp-automation-only-protocol.md)继续拒绝音频；ACP（Agent Client Protocol）与 SDK 不增加语音扩展。

## Alternatives considered

**让浏览器直接调用语音提供方。** 否决，因为这会暴露凭据、绕过 Agent 作用域授权，并允许任何浏览器脚本提交任意合成文本。

**把音频以 base64 放入现有 RPC 或事件 WebSocket。** 否决，因为当前通道是 JSON 控制传输，base64 会增加约三分之一的字节，而音频播放需要与 Session 事件交付相互独立的取消和响应背压。

**增加 `AudioBlock` 并持久化每份录音或合成答案。** 否决，因为模型看到的是最终 transcript，不是录音，而 TTS 属于派生展示。等真实消费方需要持久音频时，还必须单独设计引用生命周期、垃圾回收策略、提供方模态支持与回放要求。

**读取原始 assistant 分片以降低首段音频延迟。** 否决，因为重试可能在这些分片被朗读后放弃它们。本版本只把已提交 assistant 消息视为可听答案。

**在 UI 中硬编码 `hk-feng-shui`。** 否决，因为展示不是授权，复制出的预设或未来预设也应无需修改组件即可复用能力。Host 的作用域解析才是权限真源；profile 缺失会隐藏全局 UI 配置项。

**只使用浏览器语音识别。** 否决，因为提供方可用性、数据处理、语言与结果语义因浏览器而异。Web 客户端录制标准媒体，作用域内的 Host 提供方负责转写。

**用嵌套提供方模板与 SSE 解码扩展提供方无关的 HTTP 包。** 否决，因为 DashScope 事件类型、终止标记、Base64 音频与请求字段属于一种提供方协议。专用 Service Provider 负责 DashScope SSE 解码；`speech-http` 支持原始音频和显式固定的 Qwen ASR 映射，不提供任意供应商模板。

## Verification

能力测试覆盖作用域内的转写可见性、过期 synthesis Agent 拒绝、模糊 profile 选择、输入、transcript、文本与输出限额、预先 abort 的转写，以及畸形 synthesis metadata 或流长度。HTTP provider 测试覆盖独立配置、原始转写和 JSON 合成请求映射、关闭重定向时的凭据 header、已配置超时、受限且符合 UTF-8 的转写响应、synthesis media type 验证与传输错误脱敏。DashScope provider 测试覆盖嵌套请求映射、凭据隔离、超时与取消、网络分片边界、LF 与 CRLF 事件、已编码响应与事件限额、严格 UTF-8、JSON 与 Base64 验证、提供方错误及终止 stop 执行；感知凭据的真实 API 测试验证已配置模型与音色产生 MP3 字节。Speech Web 测试覆盖能力缺失和单边 profile、profile 与路由 metadata 中的有效转写上限及 handler 的补充检查，以及成功查找 append-origin 消息并从可朗读文本中排除 reasoning；它们尚未验证委派 Agent 拒绝、流取消、跨 Session 消息拒绝或完整错误状态表。客户端测试覆盖 profile 解析与 cold-to-live 刷新、媒体协商、track 清理、进行中与最终录音限额、可取消的延迟授权、向最新草稿追加 transcript、按 seq 限定的语音发送 arm、自动与手动播放、自动播放降级、预设与 Session 生命周期及 controller dispose。真实 Chromium 端到端测试通过客户端、Connection、Host runtime 和作用域 provider 驱动已提交消息的手动合成，验证授权请求体、凭据与 loading UI，并明确不断言媒体解码完成。随附预设的无密钥快照固定完整系统提示词、香港粤语选择、无工具、文本回复、合成 profile 与 DashScope 请求映射。

## Consequences

部署配置语音凭据或转写端点前，该预设以纯文本方式工作。DashScope API key 会启用合成；转写仍可独立省略，并需要自己的端点。默认合成端点是 DashScope 的北京旧域名，使用业务空间专属域名的部署可以替换它。UI 只暴露可用操作。语音为实时根 Agent 服务，默认采用 loopback；远程浏览器部署需要显式 trusted-host 与 HTTPS。委派 Session、ACP、SDK 客户端或冷 Session 读取不提供语音。

完整录音上传限制了实现复杂度，但不提供部分 transcript。合成在最终 assistant 消息之后开始，因此首段音频晚于推测式分片语音。音频播放兼容性取决于配置的编码媒体类型与浏览器原生媒体栈。录音在转写后消失，合成回复在重播时重新生成，重复播放可能再次调用提供方。
