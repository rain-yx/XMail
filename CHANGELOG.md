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
- Windows Nginx 与 Cloudflare Tunnel 部署文档。

### Changed

- 客户端与服务端拆分为独立项目和依赖清单。
- 邮件列表按日期从新到旧排列，聚合数据固定置顶。
- 登录界面与退出确认交互精简。

### Security

- IMAP 主机限制为受支持邮箱服务商白名单。
- 浏览器会话使用 HttpOnly、SameSite=Strict Cookie。
- HTML 邮件经过 DOMPurify 清理并默认拦截远程图片。
