# Agent Note：限制手机语音取消影响并恢复其 Session

Status: implemented

[English](2026-09-20-mobile-voice-cancellation-recovery.md) | 中文

## Problem

取消客服回答时，可能会在 MiniStream WebSocket 仍在建立握手时终止它。一次性 acquire 监听器在 `terminate()` 前已移除，连接池监听器则只在成功打开后安装。因此产生的 `error` 事件没有监听器，导致 Node.js 进程退出。在 systemd 重启 Host 之前，Nginx 会为该取消请求及所有并发请求返回 502。

重启后，手机界面在显式恢复持久化 Session 前就刷新语音 profile，因此 Host 返回 `SESSION_NOT_LIVE`。没有记住手机 Session 的浏览器还会采用 Host 全局当前 Session，导致共享部署中的不同设备可能意外进入同一对话。

## Decision

MiniStream 连接池在等待握手完成前取得每个 socket 的所有权，并立即安装持久的 `error` 和 `close` 处理。取消操作会丢弃已归属的连接；终止错误可以结束当前操作，但不会成为未处理的进程事件。

澳电手机界面只恢复该浏览器存储的 Session id。本地标记缺失时，会创建空白客服对话，不回退到 Host 全局当前 Session。连接重置时，界面会停用媒体并使已缓存的语音权限失效，恢复正在使用的精确 Session id，并且只在恢复结算后刷新语音 profile。Session 和传输失败使用客服连接重试标签；录音和语音 profile 失败保留语音服务重试标签。

桌面端和 `/customer` 入口保持现有选择及展示行为。它们共用加固后的 MiniStream 提供方，因此可获得进程崩溃限制，但界面和 Session 选择不变。

## Alternatives considered

**安装进程级未捕获异常处理器。** 否决，因为它会隐藏其他生命周期缺陷，并在发生异常后使进程状态变得不确定。Socket 所有者会在局部处理预期的终止事件。

**连接重置时立即刷新语音 profile。** 否决，因为语音授权属于 live Session scope；Host 重启后，如果在显式 id 恢复前请求语音权限，就会确定性返回 `SESSION_NOT_LIVE`。

**浏览器存储为空时恢复 Host 全局当前 Session。** 否决，因为 `current` 是共享部署状态，不是浏览器身份。它可能导致一台设备取消或继续另一台设备的对话。

## Consequences

在 MiniStream 握手期间取消时，只会拒绝该合成请求，不再因此路径触发 Host 重启。手机端重连会在语音 profile 请求前增加一次显式 id 恢复。使用早期手机存储标记的浏览器会在新标记下创建一次空白对话；持久化的对话仍保留在 Host 历史中。

该客户端选择规则可避免意外采用当前 Session，但不提供授权或租户隔离：除非部署鉴权和 Host 授权将用户隔离，共享部署中的用户仍可枚举客服历史。提供方测试覆盖握手未完成时的取消，组装后的手机 slot 测试覆盖新建激活及先恢复后刷新 profile 的顺序。
