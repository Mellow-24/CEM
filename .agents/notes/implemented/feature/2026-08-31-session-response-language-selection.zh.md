# Agent Note: Session response-language selection

Status: implemented

[English](2026-08-31-session-response-language-selection.md) | 中文

## Problem

两个澳门客服预设让模型根据每条客户消息推断回复语言。同一规则同时出现在两个 persona、RAG 工具指令与结果尾注以及 Wiki 指令中。系统无法表达固定的用户偏好，短消息或混合语言消息可能意外改变回答语言，也没有持久事实解释某次请求为何使用某种语言。

输入语言、回复语言、知识来源语言和 Web UI locale 是相互独立的事实。把它们绑定会让英文回复偏好把中文问题路由到英文知识副本；复用浏览器 locale 则会把展示设置变成模型行为。

`verifyOutput` 默认为 `true`，启用整段缓存和纠错；设为 `false` 则仅保留语言解析和提示词。两个客服预设关闭整段缓存以支持[逐句语音通话](2026-09-03-customer-service-voice-calls.md)。

## Decision

`@deepseek-ai/dsh-response-language` 为一个 agent 预设拥有回复语言选择与请求解析。随附的 [`macau-customer-service`](2026-08-29-macau-customer-service-knowledge-preset.md) 和 [`macau-customer-service-wiki`](2026-08-29-macau-customer-service-llm-wiki-preset.md) 组合挂载它，并提供 `auto`、简体中文、繁体中文、澳门粤语、香港粤语、英文和葡萄牙语选项。根据[单一提示词 owner](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)决定，它们的 persona 与检索 package 不再拥有第二套语言选择规则。

独立的 `@deepseek-ai/dsh-client-ui-response-language` package 渲染当前会话的选择器。浏览器 locale 仍由 `dsh-client-locale` 拥有；修改任一值都不会改变另一项。

## Resolution and persistence

`response-language/preference` 记录完整选择值，初始选择为 `auto`。`response-language/resolved` 记录一次已接受请求实际使用的固定语言、轮次、步骤、所选偏好、解析依据与置信度。两个事件都会决定后续提示词行为，因此读取时均为必需事件；根据[会话日志版本机制](../architecture/2026-08-10-session-log-version-mechanism.md)，普通事件词汇扩展仍将 `SESSION_FORMAT_VERSION` 保持为 `0`。

作用域 plugin 会在系统提示词组装前观察直接人工 inbox claim。固定偏好无需检查消息即可生效。Auto 解析只检查直接人工文本，并可使用 `autoDetectedLanguages` 限制允许的检测结果。允许范围内的确定性检测会选择该语言。列表受限时，不匹配的直接输入使用配置的后备语言；内部工具继续步骤保留当前轮次的解析结果。默认不限制列表时，含糊直接输入会先沿用上一次已解析语言，再使用后备语言。工具结果、检索证据、plugin 上下文和 assistant 文本永不参与，因此英文问题取得粤语证据后，最终回答不会被切回粤语。

提示词 section 会捕获本次组装使用的解析结果。完整 `agent/pre-step` waterfall（瀑布式事件）接受该步骤后，plugin 才追加相同的解析事件；被拒绝或取消的步骤不提交事件。即使事件追加在发送前失败，请求 header 仍会记录已渲染系统提示词，从而保持[请求可重建](../architecture/2026-07-05-reconstructable-requests.md)规则。section 位于工具指引之后，并在通常情况下要求缓冲投递。完整文本回复的本地检测确定地不同于解析语言时，会追加 `response-language/retry`、丢弃未提交 chunk，并且只重试一次，不会重新解析输入。Auto 重试会将被丢弃的答复作为 JSON 文本提供，并要求只输出解析后输入语言的面向客户译文；固定选择仍使用直接重试指令。工具调用、流式输出、达到 token 上限、含糊输出和第二次尝试均绕过语言纠正。`verifyOutput` 为 false 时，每个步骤还会把精确的解析策略作为最后一条已记录运行时上下文。该提示要求模型在流式输出客户文字前，改写历史答复、工具结果与证据的字形和语体。

回复语言解析不会翻译或改写用户消息、工具参数或检索 query。跨语言检索与条件式 query 翻译仍是独立的检索问题。

## Presentation and scope

Host plugin 挂载在两个客服预设内，因此提示词 section 与 `/response-language` 命令遵循[按会话预设作用域](../architecture/2026-08-03-per-session-agent-presets.md)。该命令修改日志中的偏好，不会开启模型轮次。Resume 与 fork 会折叠相同事件；重复选择当前值是 no-op。

两个澳门客服预设将自动检测限制为英语，并以澳门粤语作为后备语言。文字输入与语音通话转写因此共用同一策略：确定的英语输入使用英语；普通话、粤语、葡萄牙语、不支持语言和含糊直接输入都使用澳门粤语。逐句合成读取已记录的 `response-language/resolved` 事件，因此音色会跟随模型必须使用的语言，不会再作独立的音频语言决策。

`sessionProjections` 是进程级表，因此根据[宿主平面所有权](../architecture/2026-08-10-host-plane-ownership-after-presets.md)规则，projection key 是否存在不能表示按会话可用性。`responseLanguage` projection 因此携带显式 `available` 字段。选择 agent 预设后，该值会先变为不可用，直到提供回复语言能力的组合记录偏好。浏览器会隐藏 false 或缺失值，并依据 [Web 会话作用域与 provide channel](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md)通过现有会话作用域 `conversation.input.right` slot 渲染选择器。

## Verification

Host 测试覆盖配置校验、选择折叠、不受限和受限的 Auto 检测、固定语言优先级、含糊输入沿用与后备、只解析直接消息、claim 先于组装的顺序、已接受步骤提交、流式语言提示、命令 no-op、projection 可用性、预设切换、回放、dispose 和 package invariant。客户端测试覆盖 projection 缺失、全部选项、locked 与 pending 状态、命令错误、无障碍名称、slot 注册和清理。产品 snapshot 会启动两个随附客服组合；语音通话 snapshot 会提交简体中文普通话问题、显示粤语答复、选择粤语音色，并在挂断后保留流式答复。Snapshot normalizer 会用稳定且保持关联的 token 替换易变命令生命周期 id。

## Alternatives considered

**保留只用提示词推断语言。** 未采用，因为模型仍会成为未记录的策略 owner，系统也仍无法区分用户持久偏好和一次不同措辞的问题。

**使用 Web UI locale。** 未采用，因为界面展示与模型回复语言具有不同生命周期，也存在合理的不一致场景。

**只在浏览器保存选择。** 未采用，因为其他标签页、resume、fork、headless 使用和请求重建不会共享该值；[事件溯源会话](../architecture/2026-06-11-event-sourced-sessions.md)仍是权威。

**每种语言新建一个预设或工作区。** 未采用，因为语言与检索架构及知识权威正交。把两个客服预设乘以每种语言会重复组合，而且在输入语言与期望回复语言不同时仍会失败。

**让所有 agent 全局使用该策略。** 本次未采用，因为这会改变客服请求范围之外的 coding preset（编程预设）。后续部署可以在更多预设中挂载同一个 package，而无需改变事件或 UI 词汇。

**用 projection key 是否存在表示可用性。** 未采用，因为第一个预设注册会为进程内所有会话安装该 key。显式值可避免挂载顺序改变其他会话的控件。

## Consequences

固定选择不增加分类器或 LLM 调用。Auto 使用本地确定性分析和既有模型调用；每个已接受请求会增加一个小型日志事件，确定的输出不匹配会增加一次重试请求和一个重试事件。其重试复用被丢弃的答复作为翻译来源，而非要求模型根据完整会话重新生成回答。选择器与提示词读取 Host 计算状态，因此不存在客户端乐观权威。

检测器有意采用受限语言集合，不能推断所有短消息、转写文本、语言混用消息或方言中性消息。共用粤语标记在不受限的 Auto 中解析为澳门粤语；普通粤语文本无法可靠识别地区，因此调用方需要显式选择香港变体。受限的 Auto 策略会有意地将所有被排除或含糊的直接输入映射到部署后备语言。输出校验器会接受任一粤语目标使用的标准书面繁体中文，因为本地检测器无法确定地区不匹配。输出纠正只对确定的本地结果生效，且最多重试一次，因此不支持或含糊的输出仍可能通过。多语言别名、混合检索、重排和条件式 query 翻译不属于本次决定。
