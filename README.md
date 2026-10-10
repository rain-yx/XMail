# XMail

一个轻量、自托管的网易与 QQ 网页邮箱。浏览器访问 Vue 3 界面，由 Node.js 服务通过 TLS IMAP 直接连接邮箱，不依赖网易邮箱大师等桌面客户端或第三方邮件聚合服务。

## 支持的邮箱

- 网易：`163.com`、`126.com`、`yeah.net`、`vip.163.com`、`vip.126.com`、`188.com`
- 腾讯：`qq.com`、`foxmail.com`

项目只接受以上白名单域名，并固定连接各服务商的可信 IMAP TLS 993 地址。

## 功能

- 网易和 QQ 两个固定标签，标签内独立登录、独立文件夹和独立邮件状态
- 登录完成后原地切换为收件箱，切换标签无需重复登录
- 原生 Vue / HTML / CSS 交互组件，不依赖 UI 组件库
- 自研虚拟列表，只渲染可视区域及前后各 5 行缓冲，离屏节点自动销毁
- 滚动到底自动按 40 封一页加载，不一次性读取全部邮件
- 服务端普通列表也只按当前页的 IMAP 序号区间读取邮件摘要
- Lenis 接管登录页、邮件列表、文件夹和邮件详情滚动
- 文件夹与未读数、发件人/主题/正文搜索
- 阅读邮件、星标、标为已读/未读、批量移至已删除
- HTML/纯文本邮件、内嵌图片和附件下载
- 默认拦截邮件中的远程图片，减少阅读回执和追踪像素暴露
- 响应式桌面和移动端界面

## 本地运行

需要 Node.js 20.19 或更高版本。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

开发页面位于 <http://localhost:5173>，Vite 会把 `/api` 代理到 <http://localhost:3000>。

生产运行：

```powershell
npm run build
$env:NODE_ENV="production"
npm start
```

## 登录前准备

1. 登录网易或 QQ 邮箱网页端，进入账号或邮箱设置。
2. 开启 IMAP 服务，并按服务商提示生成客户端授权码。
3. 在 XMail 中填写完整邮箱地址和客户端授权码，不要填写网页登录密码。

服务商可能根据账号状态要求短信验证或安全检查，具体以邮箱设置页提示为准。

## 使用 Docker

```bash
docker compose up -d --build
```

容器访问地址为 <http://localhost:3000>，部署机器必须允许出站访问邮箱服务的 TCP 993。

## 安全设计

- 客户端授权码只保存在 Node.js 进程内存中。
- 浏览器仅持有 `HttpOnly`、`SameSite=Strict` 的随机会话 Cookie。
- 一个浏览器会话可以包含网易和 QQ 两个账号，所有邮件 API 都按不可预测的账号 ID 隔离。
- 退出单个邮箱只清除该账号；重启 Node.js 会清空全部凭据及会话。
- IMAP 固定使用 TLS 993 并校验证书，前端不能提交任意 IMAP 主机。
- 邮件 HTML 在显示前经过 DOMPurify 清理，并移除可能加载远程资源的样式。
- 登录入口有进程内频率限制。

公网部署必须使用 HTTPS，并限制实例访问范围。当前使用单机内存会话，不适合直接做多副本部署；横向扩容时应使用加密的共享会话存储。

## 配置变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | Node 服务监听端口 |
| `SESSION_TTL_MS` | `86400000` | 内存会话有效期，单位毫秒（默认 24 小时） |
| `NODE_ENV` | `development` | 生产模式托管 `dist` 并启用 Secure Cookie |

## 常用命令

```bash
npm test       # 运行单元测试
npm run build  # 构建 Vue 生产包
npm start      # 启动 Node 服务
```

## 项目结构

```text
src/                              Vue 3 原生组件前端
src/components/AccountWorkspace  单个标签内的独立邮箱状态
src/components/MessageList       原生虚拟滚动与增量加载
src/useLenis.js                   Lenis 滚动容器适配
server/index.js                   Express API 与多账号隔离
server/imap-service.js            IMAP、邮件解析与附件处理
server/providers.js               网易与 QQ 域名白名单
test/                             Node.js 单元测试
```
