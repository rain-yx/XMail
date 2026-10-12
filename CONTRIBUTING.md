# 贡献指南

感谢你愿意参与 XMail。缺陷修复、兼容性改进、界面优化、性能优化和文档更新都很有价值。

## 开始之前

1. 搜索现有 Issue，确认问题尚未被报告或处理。
2. 较大的功能改动请先创建 Issue，说明目标、使用场景和实现方向。
3. 不要在 Issue、日志、截图或提交中包含邮箱授权码、会话 Cookie、真实邮件内容及个人信息。

## 本地开发

服务端：

```powershell
Set-Location server
npm install
Copy-Item .env.example .env
npm run dev
```

客户端：

```powershell
Set-Location client
npm install
npm run dev
```

## 分支与提交

- 从最新主分支创建功能分支。
- 一个提交尽量只处理一个主题。
- 提交信息应简明描述结果，例如 `fix: 修复多关键词邮件搜索`。
- 不要提交 `node_modules`、`client/dist`、`.env`、`server/data` 或日志文件。

## 提交前检查

客户端改动：

```powershell
npm --prefix client run build
```

服务端改动至少进行语法检查并启动健康接口：

```powershell
Get-ChildItem server\src\*.js | ForEach-Object { node --check $_.FullName }
npm --prefix server start
```

请手动检查与改动相关的关键流程，并在 Pull Request 中说明验证方式。

## Pull Request

Pull Request 应包含：

- 问题背景与改动结果。
- 主要实现方式及重要取舍。
- 可复现的验证步骤。
- 界面改动前后的截图或录屏。
- 是否涉及配置、数据迁移或兼容性变化。

维护者可能要求缩小改动范围、补充文档或调整交互。提交贡献即表示你有权提交其中的内容；许可证尚未确定时，维护者不应合并外部贡献。
