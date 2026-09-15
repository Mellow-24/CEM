# 澳电手机聊天版：开发与验收记录

检查日期：2026-09-12。当前交付为已部署的方案 B 预览；安卓真机最终验收和默认入口切换待用户确认。不能将浏览器自动化或服务接口测试等同于手机声学体验验收。

## 访问

- 新版手机：[CEM 聊天预览](https://10.138.135.63:3443/mobile.html?ui=cem-chat)。手机与电脑需连接同一局域网，并信任现有 HTTPS 证书。
- 旧手机：[原手机入口](https://10.138.135.63:3443/mobile.html?ui=legacy)。未带参数的 `/mobile.html` 暂时仍为旧版。
- 桌面 `/`、独立客服 `/customer`、原有后台接口和会话数据不替换。

## 实现范围

新增独立 [ui-mobile-chat](../../packages/client/ui-mobile-chat/README.zh.md) 包：欢迎与推荐问题、真实流式聊天、Session 新建/恢复/历史、客服 agent 切换、按住/点击语音输入、转写确认、通话界面、字幕、缩小/恢复、静音、手动打断和挂断。品牌样式限定在手机新版根节点，logo 使用用户提供的原图，未引入第二套后台或消息数据库。

共享语音控制器只增加静音与手动打断操作；现有 ASR/TTS、麦克风降噪及 VAD 配置不改动。语音转写保留到可编辑草稿后，由用户点击发送；未保存原始录音，因此不显示虚假的录音播放气泡。系统操作授权可在手机拒绝，允许操作需去原应用查看完整权限详情。

实际部署验收发现并修复了休眠 Session 的语音配置 404：进入/恢复会话时，先通过现有后台显式 id 创建操作激活原身份和预设，再查询语音能力，不需要先发文字，也不制造额外模型轮次。

## 验证证据

| 检查 | 结果 |
|---|---|
| 新手机与共享语音单元/组件测试 | 9 个测试文件，110 项通过 |
| 新手机聊天真实组装回放 | 推荐问题、连续追问、刷新、历史、新 Session、agent 切换、旧入口隔离通过 |
| 新手机语音真实组装回放 | 浏览器录音、转写留草稿、通话字幕、静音、缩小/恢复、手动打断、挂断清理和历史保留通过；外部服务为测试回放 |
| 原有通话回归 | 两个桌面客服 agent 和旧手机入口共 3 项通过 |
| 独立客服与旧手机 Session 回归 | 与两项新手机测试一起运行，5 项通过、1 项按原测试条件跳过 |
| 真实 HTTPS 手机入口 | 实际 ASR 识别固定测试音频、开场白后实时 ASR 连接、真实模型回答及刷新恢复通过 |
| 公司 MiniStream 真实 API | 3 句短粤语并发合成 MP3 成功，测试通过 |
| 新包 TypeScript、插件 bundle、web 前端构建 | 通过 |
| 本次手机与通话改动的定向 lint | 通过 |
| 新增/变更文档的中英一致性、Agent Note 格式、相对链接 | 通过；Git 对象快照无法在源代码压缩包中保存 |
| Cordis 配置和包 invariant 规范 | 分别检查 123 个配置、234 个包，通过 |

主要复现命令在仓库根目录执行：

```sh
node node_modules/typescript/bin/tsc -b packages/client/ui-mobile-chat --pretty false
pnpm_config_verify_deps_before_run=false pnpm --filter @deepseek-ai/dsh-client-ui-mobile-chat --filter @deepseek-ai/dsh-client-ui-voice run bundle
pnpm_config_verify_deps_before_run=false pnpm run build:web
node node_modules/vitest/vitest.mjs run packages/client/ui-mobile-chat/tests packages/client/ui-voice/tests
DSH_SNAPSHOT=replay node node_modules/vitest/vitest.mjs run --config vitest.web.config.ts apps/web/tests/mobile-chat.e2e.ts apps/web/tests/mobile-chat-voice.e2e.ts apps/web/tests/voice-call.e2e.ts apps/web/tests/customer-portal.e2e.ts apps/web/tests/mobile-session.e2e.ts
```

以下两个命令明确调用真实服务，会产生少量测试请求；不用于默认无凭证 CI。手机 live 检查会在本机后台保留一条无敏感信息的验收对话，不删除已有会话：

```sh
node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts packages/speech/speech-ministream/tests/provider.e2e.ts --retry=0
CEM_MOBILE_LIVE_URL=https://10.138.135.63:3443 node apps/web/tests/mobile-chat.live.mjs
```

## 全量检查限制

本次未把无关模块的已有问题顺带修改。全量 `lint` 的前置 Host 构建被 `core/scope/tests/invariant.spec.ts` 缺少 `agent/post-response` 和 `customer-service-admin/tests/quality.spec.ts` 的类型错误阻断。工作区 constraints 报告 `speech-web/package.json` 的现有 files 清单不符合规则。领域依赖检查报告原 runtime/conversation 等模块的 27 项违规，新手机包不在其中。

`doc-sync` 还报告其他模块的 JSDoc、生成目录、配对记录和 type-equiv 问题，以及缺少 `.git` 导致的检查失败。本次发现的新包 JSDoc、slot 说明、README 配对和模型体验分类问题已修复，客户端 slot 目录已重新生成。此目录是无 Git 元数据的源代码副本，不能提供 git diff、提交或完整绿色 CI 结论；双语侧文件保存了真实 blob 内容哈希，但无法写入 Git 对象库与恢复引用。

## 真机待验收

请使用实际安卓系统浏览器检查：页面不横向溢出；软键盘打开后仍可输入/发送；录音授权、按住与上滑取消正常；转写可修改；通话能听到开场白并完成至少两轮回答；静音、手动打断、返回聊天及挂断生效；挂断后麦克风和声音停止；弱网或切到后台后有合理恢复路径。

外放噪声误打断、回声、耳机效果、锁屏/后台通话以及具体机型兼容性仍需实机验证。此轮 UI 改造没有承诺解决原有噪声检测算法问题。当前 LAN 免密沿用用户此前配置，不代表已具备生产鉴权、租户隔离或真实电话网络拨号能力。

## 通话字幕布局优化（2026-09-12）

新版通话页移除两侧装饰波形及嵌套滚动容器；圆环直径从 210 缩至 126 CSS 像素，字幕正文从 14 调整为 13 像素并增加行距。字幕窗口占用剩余空间并底部对齐，顶部超出的旧内容渐隐，最新文字停留到下一次内容更新，不按计时删除。高度不超过 600 像素时改用标题旁的小圆环，底部静音、挂断、手动打断按钮保持可见。只改手机 B 版展示，不修改后台、共享语音控制器、VAD 或其他版本。

本轮组件测试 6 项通过；两个真实组装浏览器回放场景通过，覆盖连续两轮通话、长回答、连续编号换行、320×568、360×640、390×740、430×844、844×390 五种视口、最新一行可见、无滚动容器、减少动态效果、静音/收起/恢复/打断/挂断，以及刷新后历史保留。回放外部语音与模型使用测试服务；测试音频加速播放以缩短多句回放时间，实际采集、解码和释放仍走浏览器实现，不等于安卓硬件验收。新版包类型检查、bundle、定向 lint 和两组中英配对检查通过。手机 HTTPS 入口返回 200，现有后台未重启。

全仓 `lint` 仍被前述 Host 测试类型错误阻断；本轮 `doc-sync` 为 16 项通过、12 项失败，失败集中在其他模块的生成目录、JSDoc、配对记录、类型文档及缺少 Git 元数据。没有为此修改无关模块，也不宣称全仓检查通过。

复现本轮浏览器回归：

```sh
DSH_SNAPSHOT=replay node node_modules/vitest/vitest.mjs run --config vitest.web.config.ts apps/web/tests/mobile-chat-voice.e2e.ts apps/web/tests/mobile-chat.e2e.ts
```

实际回放截图：[普通通话](call.png)、[长回答最新字幕](call-latest.png)、[矮屏紧凑布局](call-compact.png)、[横屏](call-landscape.png)。安卓系统浏览器上的最新布局与字体仍需用户刷新后确认。

根据后续反馈，通话文字直接显示在页面上：移除字幕外框、阴影、标题与提示行，客服靠左、用户靠右，不增加消息气泡。保留说话人名称、最新内容渐隐和通话控制。6 项组件测试及五种视口的组装通话回放通过，并增加无外框/标题、双方文字对齐的断言；当前截图已更新为这一布局。

## 切换与回退

真机验收后，将 [web bundle 配置](../../packages/bundle/web-app/cordis.patch.yml) 中 `ui-mobile-chat.config.entryMode` 从 `preview` 改为 `default`，再重启原服务即可让 `/mobile.html` 默认显示新版；无需迁移消息。回退将该项改回 `preview`，或直接使用 `?ui=legacy`。不要清除会话、凭证、证书或重置后台。

## 实际页面截图

截图均来自运行中的浏览器，不是原型图贴图。回放截图中的对话是测试内容；真实服务截图另列。

- [欢迎页](welcome.png)
- [聊天页](chat.png)
- [录音状态](recording.png)
- [通话页](call.png)
- [真实后台回答](live-chat.png)
- [真实实时通话连接](live-call.png)
