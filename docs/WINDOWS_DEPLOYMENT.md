# Windows 部署指南

本文介绍如何在 Windows Server 上部署 XMail：Nginx 托管客户端，Node.js 运行服务端，Cloudflare Tunnel 提供公网 HTTPS。

## 部署结构

```text
C:\nginx\html\                 client/dist 的内容
D:\Web\XMailServer\           server 目录的内容
D:\Web\XMailData\             加密会话数据
```

请求链路：

```text
浏览器 → Cloudflare Tunnel → Nginx:80 → /api → Node.js:3000
                                      └→ 其他路径 → 静态客户端
```

## 1. 部署客户端

在开发机器构建：

```powershell
Set-Location client
npm ci
npm run build
```

将 `client/dist/` 内的所有内容复制到服务器 Nginx 的 `html` 目录。目录中应直接存在：

```text
index.html
favicon.ico
assets\
```

不要复制成 `html/dist/index.html`，除非同时将 Nginx 的 `root` 指向 `html/dist`。

## 2. 部署服务端

将整个 `server/` 目录复制到 `D:\Web\XMailServer`，不要复制开发机器上的 `node_modules`。

```powershell
Set-Location D:\Web\XMailServer
npm ci --omit=dev
Copy-Item .env.example .env
```

编辑 `.env`：

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=replace-with-a-long-stable-random-secret
XMAIL_DATA_DIR=D:/Web/XMailData
```

创建数据与日志目录：

```powershell
New-Item -ItemType Directory -Force D:\Web\XMailData
New-Item -ItemType Directory -Force D:\Web\XMailServer\logs
```

首次启动并检查：

```powershell
npm start
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

## 3. 配置 Nginx

以下配置假设客户端文件直接位于 `C:\nginx\html`，Cloudflare Tunnel 转发到 `http://localhost:80`：

```nginx
worker_processes 1;

error_log logs/error.log warn;
pid logs/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;

    log_format main
        '$http_cf_connecting_ip - $remote_user [$time_local] '
        '"$request" $status $body_bytes_sent '
        '"$http_referer" "$http_user_agent"';

    sendfile on;
    keepalive_timeout 65;
    server_tokens off;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;

    map $http_cf_connecting_ip $client_ip {
        default $http_cf_connecting_ip;
        ""      $remote_addr;
    }

    server {
        listen 80 default_server;
        server_name example.com www.example.com;

        root C:/nginx/html;
        index index.html;
        charset utf-8;

        location ^~ /api/ {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $client_ip;
            proxy_set_header X-Forwarded-For $client_ip;
            proxy_set_header X-Forwarded-Proto https;
            proxy_connect_timeout 15s;
            proxy_send_timeout 180s;
            proxy_read_timeout 180s;
            proxy_buffering off;
            add_header Cache-Control "no-store" always;
        }

        location ^~ /assets/ {
            try_files $uri =404;
            expires 30d;
        }

        location = /favicon.ico {
            try_files $uri =404;
            expires 7d;
        }

        location = /index.html {
            try_files $uri =404;
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        }

        location / {
            try_files $uri $uri/ /index.html;
        }

        location ~ /\.(?!well-known) {
            deny all;
        }
    }
}
```

将 `example.com` 替换为自己的域名，将 `root` 替换为实际 Nginx `html` 路径。Windows Nginx 配置路径使用 `/`。

`proxy_buffering off` 用于确保新邮件 SSE 事件立即转发给浏览器。删除该配置可能导致提醒延迟或长期不刷新。QQ 与支持 IDLE 的邮箱使用实时监听；不支持 IDLE 的网易端点使用每 10 秒一次的轻量 `STATUS` 兼容监听。详细机制及排查方法见 [实时新邮件监听与提醒](NEW_MAIL_NOTIFICATIONS.md)。

验证并重新加载：

```powershell
Set-Location C:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

## 4. 注册 Windows 服务

可使用 NSSM 将 Node.js 注册为自动启动的 Windows 服务：

```powershell
& C:\Tools\nssm\nssm.exe install XMail "C:\Program Files\nodejs\node.exe"
& C:\Tools\nssm\nssm.exe set XMail AppDirectory "D:\Web\XMailServer"
& C:\Tools\nssm\nssm.exe set XMail AppParameters "src/index.js"
& C:\Tools\nssm\nssm.exe set XMail Start SERVICE_AUTO_START
& C:\Tools\nssm\nssm.exe set XMail AppExit Default Restart
& C:\Tools\nssm\nssm.exe set XMail AppStdout "D:\Web\XMailServer\logs\stdout.log"
& C:\Tools\nssm\nssm.exe set XMail AppStderr "D:\Web\XMailServer\logs\stderr.log"
& C:\Tools\nssm\nssm.exe start XMail
```

## 5. 配置 Cloudflare Tunnel

Public Hostname 示例：

```text
Hostname: mail.example.com
Service:  http://localhost:80
```

为 `/api/*` 设置 Bypass Cache。不要将 Node.js `3000` 端口直接开放到公网。

## 6. 更新应用

客户端更新后重新构建并覆盖 Nginx `html` 中的文件。服务端更新步骤：

```powershell
Stop-Service XMail
Set-Location D:\Web\XMailServer
npm ci --omit=dev
Start-Service XMail
```

更新时保留 `.env`、`XMAIL_DATA_DIR` 和 `SESSION_SECRET`，否则已有持久会话将无法恢复。

## 故障排查

```powershell
# Node API
Invoke-RestMethod http://127.0.0.1:3000/api/health

# Nginx 静态首页
(Invoke-WebRequest http://127.0.0.1/ -UseBasicParsing).StatusCode

# Nginx 代理后的 API
Invoke-RestMethod http://127.0.0.1/api/health

# Nginx 配置与日志
C:\nginx\nginx.exe -t
Get-Content C:\nginx\logs\error.log -Tail 100
```

- Nginx 返回 404：确认 `root` 下直接存在 `index.html`。
- 页面正常但 API 失败：确认 Node.js 正在监听 `127.0.0.1:3000`。
- 登录后立即失效：确认公网使用 HTTPS，且代理传递 `X-Forwarded-Proto https`。
- 邮箱连接超时：确认服务器允许出站访问 TCP 993。
