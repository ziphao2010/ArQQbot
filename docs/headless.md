# 无头服务器与远程控制台

ArQQBot 除了桌面版，还可以作为无头服务运行在 Linux 服务器上：同一个进程同时提供

- 后台运行的 QQ 实例（每个实例一个 Worker 进程，崩溃自动重启）
- 端口上的 Web 控制台（就是桌面版界面，浏览器访问）
- 远程 CLI（`arqqbot ...`），用于脚本化与运维

> 同一 AppID 同时只能有一条网关连接。不要在用无头服务端的同时，又在桌面版里启动同一个实例。

## 安装方式

### Docker

```bash
docker build -t arqqbot .
docker run -d --name arqqbot \
  -p 127.0.0.1:17800:17800 \
  -v arqqbot-data:/data \
  arqqbot
docker logs arqqbot
```

首次启动会生成 `/data/access-token`，日志里会打印控制台地址（含 token）。
容器内监听 `0.0.0.0:17800`，请只用反向代理对外暴露，并把端口映射限制在本机。

### 源码 / systemd

```bash
pnpm install
pnpm build                     # 生成服务端 dist、Web 控制台、Worker 与内置插件
node scripts/package-server.mjs # 生成 dist-server/arqqbot-server 目录
sudo cp -r dist-server/arqqbot-server /opt/arqqbot
sudo useradd -r -d /var/lib/arqqbot arqqbot
sudo mkdir -p /var/lib/arqqbot && sudo chown -R arqqbot:arqqbot /var/lib/arqqbot
sudo cp /opt/arqqbot/arqqbot.service /etc/systemd/system/
sudo systemctl enable --now arqqbot
```

`/etc/arqqbot/env` 可写入：

```bash
ARQQBOT_TOKEN=<至少 16 个字符的固定 token>
ARQQBOT_HOST=127.0.0.1
ARQQBOT_PORT=17800
```

## 启动参数

```bash
arqqbot serve \
  --data-dir /var/lib/arqqbot \
  --host 127.0.0.1 \
  --port 17800 \
  --builtin-plugins /opt/arqqbot/builtin \
  --worker-entry /opt/arqqbot/runtime/worker-entry.cjs \
  --web-root /opt/arqqbot/web \
  --autostart
```

| 参数 | 说明 |
| --- | --- |
| `--host` | 默认 `127.0.0.1`。要公网直连才用 `0.0.0.0`，建议配合反向代理 |
| `--port` | 默认 `17800` |
| `--data-dir` | 数据目录，默认 `~/.arqqbot` |
| `--token` | 访问 token。不传则读 `ARQQBOT_TOKEN`，再读 `data-dir/access-token`，都没有就自动生成并写入该文件 |
| `--autostart` | 启动后拉起上次在运行的实例 |
| `--trust-proxy` | 置于反向代理之后时启用，正确识别客户端 IP |

## CLI

所有命令默认连 `http://127.0.0.1:17800`，token 自动从数据目录读取，也可用 `--url` / `--token` /
`ARQQBOT_URL` / `ARQQBOT_TOKEN` 覆盖。

```bash
arqqbot health
arqqbot instance list
arqqbot instance create --name 我的BOT --app-id 1024xxxx --env sandbox --secret-stdin <<< 'AppSecret'
arqqbot instance start <id>
arqqbot instance status <id>
arqqbot instance capabilities <id>
arqqbot instance restart <id>
arqqbot instance remove <id>

arqqbot plugin list <id>
arqqbot plugin enable <id> echo
arqqbot plugin config <id> persona-distill --file config.json
arqqbot market search persona
arqqbot market install persona-distill

arqqbot logs <id>            # 实时日志，Ctrl+C 退出
arqqbot --json ...           # 任意命令输出 JSON，便于脚本处理
```

AppSecret 通过 `--secret-stdin` 或 `ARQQBOT_APP_SECRET` 传入，避免出现在 shell 历史和进程列表里。

## Web 控制台

浏览器打开 `http://<host>:17800/`，输入启动日志里的 token；也可以直接访问
`http://<host>:17800/#token=<token>`，页面会读取 token 后从地址栏抹掉，只存在当前浏览器会话中。

## 反向代理（Nginx + TLS）

```nginx
server {
  listen 443 ssl http2;
  server_name bot.example.com;
  ssl_certificate     /etc/ssl/bot.crt;
  ssl_certificate_key /etc/ssl/bot.key;

  location / {
    proxy_pass http://127.0.0.1:17800;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

启用 `--trust-proxy` 后服务端才会信任 `X-Forwarded-*`。

## 数据目录

```
$ARQQBOT_DATA_DIR/
├── access-token      # Web/CLI 访问 token（0600）
├── master.key        # 加密 AppSecret 的 AES-256-GCM 主密钥（0600）
├── instances.json    # 实例索引
├── instances/<id>/   # instance.json / plugins.json
└── plugins/          # 插件市场安装的第三方插件
```

备份时连同 `master.key` 一起备份，否则 AppSecret 无法解密。桌面版与无头服务端的密钥不同，
从桌面迁移到服务器需要重新填写 AppSecret。

## 安全要点

- 服务端默认只监听 `127.0.0.1`；对外必须经 HTTPS 反向代理，不要直接把 17800 暴露到公网。
- token 用 `Authorization: Bearer` 传递；WebSocket 使用 30 秒有效、一次性的 ticket，不会把长期 token 放进 URL。
- 所有 `/api/*` 都需要 token（`/api/health` 除外），响应带 CSP、`X-Frame-Options: DENY` 等安全头。
- AppSecret 落盘前用 AES-256-GCM 加密，API 返回的配置里密钥字段始终掩码。
