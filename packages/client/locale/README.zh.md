# @deepseek-ai/dsh-client-locale

[English](README.md) | 中文

locale 插件：LocaleRuntime——`zh`／`en`／`pt` 偏好以 `locale.preference` 存储在 `$DSH_HOME/settings.yaml` 中；若没有显式 Host 值，全新浏览器会暂时使用 `navigator` 请求的语言（按主子标签匹配；若其请求的语言本应用都不提供，则使用 `zh`）。Host 读取在插件激活后执行，因此 settings 服务不可用不会阻塞页面；读取结果会实时替换浏览器暂定值。settings API 仅限回环请求，因此远程浏览器的选择仅保留在进程内。`locale/change` 仅在切换语言时触发。该服务还拥有 ns×locale 字典注册表（类型化 `register(ns, {zh, en?, pt?})` 按 `LocaleNamespaceMap` 校验，且完整的 `zh` 回落词典为必填；`bind(ns)`→`TranslateNS<ns>`；查找链 ns → common → zh → key），实现 slot 系统的 `LocaleFace`，并经 `ctx.slots.installLocale` 自行安装，支撑框架注入的 `t` 标准席位（`Translate`／`TranslateNS` 是 ui-slots 的类型；请从那里导入——本包的再导出仅为字典所有者提供便利）。该持久化边界由[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)拥有。

## 模型体验

无。locale 注册表为浏览器 UI 文案提供服务；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **语言覆盖由 namespace 所有者负责**——未提供 `en` 或 `pt` 词典的 namespace 沿用现有 `zh` 回落。澳门智能客服运营后台的 `zh` locale 使用繁体中文；已记录的客户消息与知识证据保留来源语言。
- **注册表持有的文本只读取一次翻译**——在 slot 渲染路径之外于注册时捕获的文案（例如 command 注册表中的 `/model` 命令描述）在重新注册前保持注册时的语言；slot 渲染的文案随切换实时更新。
