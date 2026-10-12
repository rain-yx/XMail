# 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的记录方式。正式发布版本后建议使用语义化版本号。

## [Unreleased]

### Added

- 网易与 QQ 双账号标签页。
- IMAP 文件夹、邮件列表、邮件详情与附件下载。
- 邮件搜索、聚合、自定义右键菜单和返回顶部功能。
- 已读、未读、星标和批量移动操作。
- 移动端响应式布局。
- AES-256-GCM 加密持久会话。
- IMAP IDLE 与 SSE 实时新邮件提醒、账号角标和可选浏览器桌面通知。
- 不支持 IMAP IDLE 的网易邮箱使用 10 秒 `STATUS` 兼容监听。
- Windows Nginx 与 Cloudflare Tunnel 部署文档。

### Changed

- 客户端与服务端拆分为独立项目和依赖清单。
- 客户端按 `app`、`features`、`shared` 领域分层，邮箱状态、邮件操作、聚合和实时事件流拆为独立组合式模块。
- 原全局组件样式拆分到对应组件，`base.css` 只保留变量、reset 和共享基础控件。
- 新邮件同步增加 `mailbox-change` 事件触发校准与连接状态反馈，连接异常时自动重连并提示。
- QQ、Yeah 优先使用 IMAP IDLE；163、126 等无 IDLE 端点按运行时能力自动切换兼容策略。
- 邮件列表按日期从新到旧排列，聚合数据固定置顶。
- 登录界面与退出确认交互精简。

### Security

- IMAP 主机限制为受支持邮箱服务商白名单。
- 浏览器会话使用 HttpOnly、SameSite=Strict Cookie。
- HTML 邮件经过 DOMPurify 清理并默认拦截远程图片。
