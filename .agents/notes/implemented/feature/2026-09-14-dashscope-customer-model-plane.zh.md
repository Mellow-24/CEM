# Agent Note: DashScope 客服模型平面

Status: implemented

[English](2026-09-14-dashscope-customer-model-plane.md) | 中文

## Problem

澳门客服部署的语音服务共用一个服务端 DashScope 凭据，但对话、质检、Embedding 与重排仍使用其他提供方或未鉴权的 loopback 端点。把检索迁移到线上端点还需要保证凭据不会进入预设配置或向量缓存。

## Decision

Web 组合注册由 `DASHSCOPE_API_KEY` 支持的 `qwen-dashscope` OpenAI 兼容路由。澳门客服预设会在会话级路由解析后，把客户回答路由到非推理模式 `qwen3.7-flash`；AI 质检继续使用 `qwen3.7-plus`。可选的 Wiki 草稿编译器默认使用线上 Plus 模型与同一凭据。RAG 预设使用 DashScope `qwen3.7-text-embedding` 和 `qwen3-rerank`；两类请求都在发送前解析同一个凭据引用，只通过 Authorization header 发送。

可丢弃索引的 identity 包含 Embedding 端点与模型。两者不匹配时会在检索前原子重建全部来源向量；只更换重排模型会复用现有向量。凭据既不参与索引 identity，也不会写入持久内容。

Web 部署保留首个问题生成的本地确定性标题，并关闭辅助标题模型提供方。历史会话仍会立即得到标题，首个回答则不再与第二个线上模型调用竞争。

## Alternatives considered

**保留本地 Embedding 与重排。** 这种方式不需要重新索引，但会继续依赖工作站上的模型服务；本地服务不可用时，演示也会失败。

**把 API Key 写入端点配置。** 内联凭据会通过配置与诊断泄露，因此配置只保存 `DASHSCOPE_API_KEY` 引用，并在每次请求时解析它的值。

**更换 Embedding 模型后复用旧向量。** 不同模型的向量空间不可直接比较，复用会悄然破坏相似度得分，因此端点或模型变化会使缓存失效。

## Consequences

客服 Web 部署需要配置一个 `DASHSCOPE_API_KEY`，供文本模型、检索、语音识别和备用语音合成使用；运维模型编译也读取同一个环境项。客户回答路由限制在预设内，不会改写共享默认值或质检路由；关闭辅助标题生成则作用于组装后的 Web 部署，并保留本地确定性历史标题。Embedding 变化后的首次检索会等待全部已批准语料重新向量化；部署应在接收客户流量前预热索引。聚焦测试固定每次请求的 Bearer 鉴权、缺失 resolver 时的失败、索引失效、预设内回答路由及组装后的 Web 配置。
