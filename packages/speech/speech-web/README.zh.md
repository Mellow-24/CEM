# @deepseek-ai/dsh-speech-web

[English](README.md) | 中文

通过注册到 `ctx.connection` 的精确、经过访问地址检查的 raw Fetch route 公开 Agent scope 语音 profile 的 Host Consumer。它既不把音频接受为模型内容，也不写入语音 event。

## Routes

| Method/path | 行为 |
|---|---|
| `GET /api/speech/profile?sessionId=&profile?=` | 为精确 live root Agent 独立解析公开转写和合成元数据。不可用能力不出现。 |
| `POST /api/speech/transcribe?sessionId=&profile?=` | 接受一个带 `audio/*` Content-Type 的完整 raw audio body，并返回 `{ text, language? }`。它不提交文本。 |
| `GET /api/speech/synthesize?sessionId=&messageId=&profile?=` | 校验 append-origin 已提交 `assistant/message`，仅提取非空文本 block，并返回其编码 TTS 流。 |

所有 route 都使用 Connection 配置的访问地址信任检查，默认值为 `loopback`。转写 route 还向 Connection 注册 `maxTranscriptionBodyBytes`，因此 Node bridge 在缓冲之前拒绝超限 body；profile 元数据公布该传输上限与所选提供方 `maxBytes` 的较小值，handler 会再次强制同一有效值。默认传输上限为 16 MiB，且仍可配。

合成响应使用提供方媒体类型、`Cache-Control: no-store`、chunked framing 和由 pull 驱动的 `ReadableStream`；取消会 abort 提供方操作并关闭其 iterator。Raw audio 字节绝不会进入 JSON RPC 或 Session-event queue。提供方声明的长度仅在其流结束时校验，从不转发为 HTTP framing。

`./client` export 包含精确 path 常量和 browser-safe payload type。它是协议出口，而非 Client Cordis plugin。

## 通话与远程部署

可选 `call` 配置包含必填的 `greetings`、`defaultGreeting`、`responseInstructions`、`playbackRate`、`microphone`、`maxPendingAudioMs`、`utteranceMergeMs`、`interruption`、`responseTimeoutMs`、`sentenceMaxChars`、`sentencePauseMinChars` 和 `sentenceQueueLimit`；多个合成提供方可见时，`synthesisProfile` 选择首选提供方，`fallbackSynthesisProfile` 可授权浏览器在首选提供方开始播放前失败时重试。`sentencePauseMinChars` 规定逗号等停顿标点可以开始合成时的最短片段，且不得超过 `sentenceMaxChars`。Host 仅在具有流式识别与合成能力时公布浏览器设置。`responseInstructions` 只留在服务端，并在实时连接期间成为 Agent scope 的运行时上下文。`microphone` 选择 PCM 送入识别前的浏览器 `echoCancellation`、`noiseSuppression` 和 `autoGainControl` 处理。`maxPendingAudioMs` 独立于单次请求大小，约束浏览器排队与在途 PCM 的总量。用户在提供方最终片段后很快继续说话时，`utteranceMergeMs` 让这些片段留在同一条提交的用户消息中。`interruption` 配置浏览器对持续临时文字的确认时间、最少有效文字、播报回声相似度及短附和上限；这些字段仅影响客服正在播报时的自动打断。每条欢迎语配置 `text` 和指向打包 WAV 文件的 `asset` 模块标识符。音频在启动时加载，文件或默认欢迎语缺失会导致加载失败。配置接口公布经过授权的 `/api/speech/greeting` URL，供浏览器预加载。固定欢迎语不需要运行时模型或 TTS 调用，也不进入会话历史。内置粤语音频使用公司 `mailinlin` 音色；普通话、英语和葡语音频使用 Qwen3-TTS 的 Cherry、Jennifer、Maia。`/api/speech/realtime` 提供按行分隔的事件流，每个实时根 Session 只拥有一个识别器。`/api/speech/realtime/audio` 每次按顺序接收 1–20 个完整的 100 毫秒单声道 16 kHz PCM16 音频帧（3,200–64,000 字节），要求相同通话令牌和实时 Agent 授权。Host 将每批拆成有序的 100 毫秒帧发送给提供方，并拒绝重叠上传。关闭下行连接会取消识别并移除通话上下文。原始音频与临时字幕不持久化。

`authority` 默认为 `loopback`。受控的远程部署可显式选择 `trusted-host`，改为使用 Connection 配置的 Host/Origin 信任检查。这是访问地址白名单，不是用户认证或租户隔离；向外开放共享 Harness 前，部署方须提供访问控制。远程浏览器麦克风访问使用 HTTPS。冷历史 Session 仍需经普通恢复流程激活后才能使用语音操作。

通话的 `GET /api/speech/synthesize-sentence` 接收 Session、profile、turn、step、block、start、end 和文本前缀 SHA-256。Host 从该 Session 日志重建文本，只合成匹配的句子；不接受客户端任意文字，不播报推理块。授权通话句子中的排版空白会在合成前合并，避免文字换行产生语音停顿。配置中的 `sentenceMaxChars` 和 `sentenceQueueLimit` 分别约束浏览器断句和队列。句子按顺序逐个进入合成，避免预读占用有限的提供方容量。模型生成的回答会立即显示在通话字幕中，音频播放只独立更新通话阶段。首选提供方在首个可听音频帧前失败时，当前句子会使用公布的降级 profile 重试一次；本次通话后续内容继续使用已经成功的 profile。

合成读取同一 turn、step 的 `response-language/resolved` 日志事件，传递该轮语言；不读取浏览器提供的语言或当前下拉框值。缺少语言事件时使用提供方的默认策略，因此历史重播不会跟随新一轮语言漂移。

## Model Experience

### 实时通话回答要求

#### What the model sees

`/api/speech/realtime` 连接期间，所选 Agent 会接收部署方完整的 `call.responseInstructions` 文本，对应运行时上下文段 `speech-web:active-call`。Agent loop 在模型请求前记录解析后的快照。挂断后的下一次非通话模型请求会收到标准的运行时上下文清除消息。完整录音转写和手动合成不会加入上下文。

#### Token effect

首次通话请求加入配置的要求文本和运行时上下文框架。后续步骤复用保留的快照，直到其他动态上下文发生变化。挂断后的第一次模型步骤会增加一条清除消息。

#### KV Cache effect

通话连接后的第一个模型步骤会改变运行时上下文前缀；后续通话步骤复用该前缀，直到其他动态上下文发生变化。挂断后的第一个模型步骤记录清除状态，并再次改变该前缀。

## Known Limitations and Deferred Work

- **仅 live 普通 Session** — profile 和媒体 route 不恢复 cold Session，且拒绝 delegated Agent；历史播放要做到透明，Web session resolver 需要共享 cold-resume API。
- **已播报内容无法撤回** — 通话逐句合成，生成重试可能改写最终回答；取消只能停止后续音频。
