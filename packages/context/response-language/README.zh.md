# @deepseek-ai/dsh-response-language

[English](README.md) | 中文

带有持久会话偏好、每个已接受模型步骤的解析语言、受限的输出语言纠正、会话 projection 和可选 `/response-language` 命令的预设作用域回复语言策略。Plugin 只改变说明性回复文字；它永远不会翻译或改写用户消息、工具参数或检索 query。

## Configuration

```yaml
- id: response-language
  name: '@deepseek-ai/dsh-response-language'
  config:
    fallbackLanguage: zh-Hant
    autoDetectedLanguages: [en]
```

`fallbackLanguage` 可取 `zh-Hans`、`zh-Hant`、`yue-Hant-MO`、`yue-Hant-HK`、`en` 或 `pt`；省略时默认为 `zh-Hant`。`autoDetectedLanguages` 限制 Auto 可采用的确定性检测结果，默认包含全部六种语言。该列表受限时，未检测到或被排除的直接输入使用 `fallbackLanguage`，但识别到的英语礼貌语、简短回应和结束语会沿用上一次解析语言。没有上一次解析时，这些继续表达使用后备语言。模型工具继续步骤保留当前轮次的解析结果。Plugin 必须挂载在 agent 预设作用域中。固定偏好词汇依次为 `auto` 和上述六种语言。

## Durable state and resolution

`response-language/preference` 是完整值、后写覆盖的会话事件。当前组合首次启用该能力时，预设作用域生命周期 listener 会写入 `auto`；重复选择不会追加事件。因此 resume 和 fork 会保留所选值。

`response-language/resolved` 记录一次已接受请求使用的偏好、固定语言、依据、轮次和步骤。检测结果还会记录直接人工消息 id 与置信度。Plugin 在提示词组装前观察 `agent/inbox/claimed`，但只有 `source.kind === 'user'` 的直接文本会参与。固定选择无需检测即可生效；Auto 先使用允许范围内的确定性本地检测。`thank u`、`OK, thanks` 和 `bye bye` 等简短英语社交表达不会选择英语，而会沿用上一次结果；该规则同样适用于受限策略，且在会话尚无历史结果时使用 `fallbackLanguage`。内部继续步骤也会沿用上次结果。默认不限制列表时，其他含糊直接输入会沿用上次结果；受限列表会使用后备语言。工具结果、证据、plugin 上下文和 assistant 消息永不参与。

提示词组装会在 `agent/pre-step` 前捕获解析结果。策略会要求缓冲回复投递，并位于工具与完成指引之后。完成文本回复出现确定的本地语言不匹配时，会追加 `response-language/retry`、丢弃未提交输出、强化最终策略 section，并只重试一次。Auto 重试会将被丢弃的答复作为 JSON 文本引用，并要求仅输出解析后输入语言的面向客户译文；固定选择仍使用直接重试指令。工具调用、流式、失败、达到 token 上限、含糊和第二次尝试的输出不会再次因语言而重试。`verifyOutput` 为 false 时，精确的本步骤策略还会放在已记录运行时上下文的最后，提醒模型在每次工具返回后继续遵循；已流式输出的文字无法撤回纠正。解析与重试事件都会决定后续请求行为，因此读取时均为必需事件。

## Projection and command

存在 `ctx.sessionProjections` 时，package 会注册带 `{ available, options, currentValue, resolved? }` 的 `responseLanguage`。Projection registry 是进程级的，而本功能属于预设作用域，因此 `available` 必须显式存在。`agent-preset/selected` 事件会先使 projection 不可用，直到新组合启用它，从而避免挂载顺序在无关会话中暴露控件。

存在 `ctx.commands` 时，`/response-language <auto|zh-Hans|zh-Hant|yue-Hant-MO|yue-Hant-HK|en|pt>` 会写入偏好而不启动模型轮次。无参数命令报告当前值。无效值返回命令错误且不改变状态。

设计：[会话回复语言选择](../../../.agents/notes/implemented/feature/2026-08-31-session-response-language-selection.md)。

`verifyOutput` 默认为 `true`：缓存完整回复并允许一次语言纠错重试。设置为 `false` 时保留语言解析与提示词，输出直接流式传递，不执行整段语言纠错；适用于逐句语音播报。

## Model Experience

### Resolved reply-language policy

#### What the model sees

每个符合条件的请求会在顺序 900 收到一个位于末尾的 `response-language:policy` 系统提示词 section。首句由固定语言表选择；发生一次检测到的不匹配后，固定选择会在稳定的其余文字前加入 `The previous response used the wrong language. Reply again using only the required language.`。Auto 则把被丢弃的答复作为 JSON 文本提供，并要求只翻译为解析后的输入语言。

##### Verbatim policy variants

```markdown
Reply in Simplified Chinese characters with standard Mandarin wording and no Cantonese expressions. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in Traditional Chinese characters with standard Mandarin wording and no Cantonese expressions. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in natural Macau Cantonese written with Traditional Chinese characters. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in natural Hong Kong Cantonese written with Traditional Chinese characters. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in English. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
Reply in Portuguese. This response language overrides the language of the user's input. Prior replies, tool results, and supporting evidence never set the response language. Rewrite their wording and writing system to match the required language, while preserving names, amounts, dates, and citation markers.
```

#### Token effect

每个请求增加一个短系统提示词 section 和一个只写日志的解析事件。关闭输出校验时，运行时上下文快照也会携带相同的语言策略。检测在本地完成，不增加模型调用；检测到不匹配时会增加一次重试请求和一个只写日志的重试事件。

#### KV Cache effect

解析语言稳定时，系统提示词前缀保持相同。固定选择或 Auto 结果变化会在下一个已接受请求中改变末尾 section；纠正重试会改变其第二次请求的 section。工具 continuation 会沿用该轮次的语言，不会根据证据重新派生。

## Known Limitations and Deferred Work

- **受限 Auto 检测器** — 短消息、拼音或拉丁字母转写、code-switch 文本及方言中性文本可能保持含糊。识别到的英语社交继续表达在两种策略下都会沿用上次结果。其他不匹配直接输入在不限制策略下会沿用，在受限 `autoDetectedLanguages` 策略下使用配置的后备语言。受限的业务词汇与社交词汇无法分类每一种口语表达。
- **粤语地区变体需显式选择** — 共用粤语标记在 Auto 中仍解析为 `yue-Hant-MO`；普通粤语文本无法可靠区分澳门与香港。需要指定地区变体时，应选择 `yue-Hant-HK` 或将它配置为后备语言。输出校验器也会接受任一粤语目标使用的标准书面繁体中文，而不会把它视为确定的不匹配。
- **受限的输出校验器** — 只有同一本地检测器给出的确定结果才会触发纠正，并且每个步骤最多重试一次。含糊或不支持的语言、工具调用、流式、失败和达到 token 上限的输出不会因语言而重试。
- **没有检索翻译** — 跨语言 query 扩展、多语言别名、重排和 top-k 上下文翻译仍属于检索层工作。
