# XMail Client

客户端按业务领域组织，而不是按文件类型平铺：

```text
src/
├─ app/                         应用壳、账号标签与全局编排
├─ features/
│  ├─ auth/                    登录领域
│  ├─ mail/                    邮箱、邮件列表、详情与实时收信
│  │  ├─ components/           邮件领域组件及其同名样式
│  │  ├─ composables/          状态、操作、聚合、IDLE/SSE 事件流
│  │  └─ lib/                  纯函数与虚拟列表工具
│  └─ notifications/           桌面通知能力与通知开关
├─ shared/
│  ├─ api/                     HTTP 基础设施与 XMail API
│  ├─ composables/             跨领域组合式函数
│  └─ ui/                      无业务归属的通用 UI
├─ styles/base.css             仅保留变量、reset 与共享基础控件
└─ main.js                     客户端入口
```

约定：

- 业务组件和同名 CSS 放在一起，使用 `scoped` 样式；不要把组件样式放回全局文件。
- 页面组件只负责组合能力，异步状态和业务操作放在领域 `composables` 中。
- 领域内部纯函数放在 `lib`，跨领域能力放在 `shared`。
- 跨目录导入使用 `@/` 别名，同目录或同领域的近距离导入使用相对路径。
- `styles/base.css` 不接收页面或业务组件的专属选择器。

开发与构建：

```powershell
npm run dev
npm run build
```
