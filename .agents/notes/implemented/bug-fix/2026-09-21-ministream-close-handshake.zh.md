# Agent Note：完成 MiniStream 关闭握手

Status: implemented

[English](2026-09-21-ministream-close-handshake.md) | 中文

## Problem

MiniStream 在 TTS WebSocket 完成正常关闭握手前一直保留实时容量。把已完成的鉴权 socket 保持空闲以便复用，或在取消及失败后直接终止已打开 socket，都可能让提供方继续占用容量直到过期连接超时。重复打断和多客户并发因此可能在 Host 已没有活跃 MiniStream TCP 连接时仍收到容量码 429。

## Decision

每项 MiniStream 合成操作拥有一条新的鉴权 WebSocket。提供方 `end` 事件完成音频传递，但只有客户端发送关闭码 1000 并收到对端 close 帧后，操作才会释放。`open` 之后的取消和提供方失败使用同一条正常关闭路径。`closeHandshakeTimeoutMs` 约束等待时间；到期后强制终止传输，避免无响应的对端无限期阻塞请求清理。

在 `open` 前取消会终止未完成的传输，因为 WebSocket close 帧不能先于建立握手发送。从 socket 创建到最终关闭期间保留持久错误监听器，因此该终止不会成为未处理的进程事件。

提供方不对 MiniStream socket 进行池化或复用。当前音频可听后，浏览器句子预读仍可准备一条后续句子，因此并发合成使用相互独立且分别关闭的操作。

## Alternatives considered

**保留鉴权连接池并缩短空闲超时。** 否决，因为 MiniStream 容量在关闭完成前一直被占用；任何空闲保留都会占用容量，而超时处置仍需要同样的握手。

**所有清理路径都使用 `terminate()`。** 否决，因为它不会发送关闭码 1000 或等待对端确认，提供方因此可能保留过期容量占用。

**无限期等待对端 close 帧。** 否决，因为提供方或网络失败会阻止 HTTP 响应清理，破坏有界资源清理。

## Consequences

每项已打开操作要么完成关闭码 1000 握手，要么达到部署配置的截止时间后强制终止。串行句子使用新 WebSocket 握手而不是复用鉴权连接，以一定启动延迟换取确定的提供方容量释放。提供方测试覆盖正常完成、调用方取消、容量拒绝、对端不响应关闭和建立握手期间取消。
