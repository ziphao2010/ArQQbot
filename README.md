# ArQQbot

A multi-instance QQ official bot desktop runtime with a Cordis plugin ecosystem.

[![CI](https://github.com/ziphao2010/ArQQbot/actions/workflows/ci.yml/badge.svg)](https://github.com/ziphao2010/ArQQbot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![GitHub topic](https://img.shields.io/badge/topic-arqqbot--plugin-blue.svg)](https://github.com/topics/arqqbot-plugin)

> 状态：早期开发阶段。当前覆盖 QQ 官方机器人 API v2 的核心能力，接口与插件规范仍可能调整。

## 项目简介

ArQQbot 是一个面向 **QQ 官方机器人 API v2** 的桌面端多实例运行环境。每个实例使用独立的 AppID / AppSecret、独立配置与独立日志，通过 Cordis 插件承载具体业务逻辑。

- 桌面应用基于 Electron，主进程负责实例管理与密钥保护，每个实例在独立 Worker 中运行。
- 客户端不接触渠道细节：插件通过 `ctx.qq` 统一服务调用消息、富媒体、群、频道、互动、菜单、面板与机器人接口。
- 插件是标准的 Cordis 插件，可独立构建、发布、分发。

## 核心能力

- **多实例**：多个机器人实例并行运行，配置、插件启用状态、存储与日志互相隔离。
- **QQ 官方 API v2**：以官方文档索引为基线，覆盖 47 个 HTTP 接口与 22 个事件类型，传输层使用 WebSocket。
- **消息与富媒体**：文本、Markdown、Ark、Embed、流式消息，以及媒体上传与分片上传。
- **群与频道**：群信息、成员、入群申请与策略、黑名单、禁言；频道与子频道管理。
- **互动与菜单**：按钮互动回调响应、快捷菜单设置。
- **面板与机器人**：消息面板管理、机器人信息、频道列表、网关地址、链接生成。
- **Cordis 插件**：插件按 Cordis 契约挂载，配置由 JSON Schema 驱动的表单渲染；插件可在运行时启用、禁用与热更新配置。
- **能力可用性**：按实例环境与 intents 计算能力状态，未覆盖的端点返回明确错误，而不是静默失败。

## 架构简述

```text
apps/desktop (Electron)
├── main        实例管理、密钥加解密、Worker 监督、IPC
├── preload     受控的渲染进程桥接
└── renderer    实例列表 / 详情 / 创建 / 日志 / 插件配置

packages/runtime
├── bootstrap   启动实例、装配 Cordis 上下文与服务
├── plugin-host 插件发现、挂载、启用/禁用、配置热更新
└── worker      独立进程内的实例运行时

packages/adapter-qq
├── core        token、HTTP 客户端、端点目录、能力注册表、错误映射
├── events      网关事件路由与归一化
└── modules     消息 / 媒体 / 群 / 频道 / 互动 / 菜单 / 面板 / 机器人

packages/shared  跨进程类型、manifest 校验、配置 Schema、IPC 契约
```

调用链：`ctx.qq.<module>.<method>` → 能力检查 → HTTP 客户端 → QQ OpenAPI。
事件链：QQ 网关 → 事件路由 → 归一化 → `qq/*` 事件 → 插件。

## 快速开始

要求：Node.js 22+、pnpm 11.7、Windows（桌面打包目前仅适配 Windows）。

```bash
pnpm install
pnpm build
pnpm --filter @arqqbot/desktop dev
```

打包 Windows 安装包：

```bash
pnpm package:win
```

首次启动后，在界面中创建实例，填写 QQ 开放平台的 AppID 与 AppSecret，选择沙箱或正式环境并配置事件订阅，然后启动实例。

> 群聊默认只有直接 @ 机器人时才会收到消息；沙箱实例只接收测试环境事件。当前阶段的常见触发条件见 [docs/qq-bot-invocation-and-use-cases.md](docs/qq-bot-invocation-and-use-cases.md)。

## 插件生态

- 插件规范：[docs/plugin-spec.md](docs/plugin-spec.md)
- 市场与发现机制：[docs/plugin-marketplace.md](docs/plugin-marketplace.md)
- 插件索引：[plugins/index.json](plugins/index.json)
- 插件模板：[plugin-template/](plugin-template/)
- 桌面应用内置插件市场页（发现 + 安装），可从顶部导航或实例详情“插件”页签进入
- 市场默认使用 jsDelivr 索引，失败时自动回退 GitHub raw；下载地址同样支持多地址回退
- 社区插件使用 GitHub topic **[`arqqbot-plugin`](https://github.com/topics/arqqbot-plugin)** 聚合

社区插件包名建议使用 `arqqbot-plugin-*`，并在 `package.json` 的 `keywords` 中包含 `arqqbot-plugin`。内置插件使用 `@arqqbot/plugin-*` 命名。

## 无头模式（Linux 服务器 / Web 控制台 / CLI）

不想开 Electron 时，可以把同一套实例管理与 Web 控制台跑在服务器的一个端口上，并用 CLI 远程管理。完整部署说明（Docker、systemd、反向代理、安全要点）见 [docs/headless.md](docs/headless.md)。

```bash
pnpm install
pnpm build

# 启动服务端（默认监听 127.0.0.1:17800）
pnpm serve -- --host 0.0.0.0 --port 17800 --autostart
```

也可以用 Docker：

```bash
docker build -t arqqbot .
docker run -d -p 127.0.0.1:17800:17800 -v arqqbot-data:/data arqqbot
```

- 浏览器打开启动日志里的 `http://<host>:17800/#token=xxx` 即可使用与桌面端一致的 Web 控制台。
- 服务端使用数据目录下的 `master.key` 做 AES-256-GCM 加密；从桌面端迁移实例时需要重新填写 AppSecret。
- 服务端默认只监听 `127.0.0.1`；对外请经 HTTPS 反向代理，不要直接暴露端口。

CLI 管理（服务端保持运行，token 自动从数据目录读取）：

```bash
arqqbot health
arqqbot instance list
arqqbot instance create --name 我的BOT --app-id xxx --env sandbox --secret-stdin
arqqbot instance start <id>
arqqbot plugin list <id>
arqqbot plugin enable <id> persona-distill
arqqbot plugin config <id> persona-distill --file config.json
arqqbot market search persona
arqqbot logs <id>
```

## 人格蒸馏插件

`packages/plugin-persona-distill` 基于 `packages/persona-core` 实现分层记忆：

- **个人记忆（全局）**：人格自己的经历、偏好与口头禅，来自首次语料蒸馏与后续聊天整理。
- **会话记忆**：每个会话的最近聊天与滚动摘要。
- **用户印象**：跨会话累积的、TA 对你的认识与关系变化。
- **强沉浸**：默认以本人第一人称回应，不自称 AI；只有被直接追问身份时才承认是人格模拟。

安装后启用插件，在实例插件配置中填写模型接口即可；命令见 [插件 README](packages/plugin-persona-distill/README.md)。

## 安全说明

- AppSecret 通过系统安全存储加密保存，不会以明文写入实例配置文件或日志。
- 外部插件在实例 Worker 中运行，**拥有与 Worker 相同的 Node.js 权限**。仅安装你信任来源的插件。
- 外部插件放入外部插件目录后，需要重启对应实例才会被发现；插件默认不自动启用，需在界面中手动启用。
- 当前信任等级只校验 manifest 与预构建入口，不构成沙箱或权限隔离。请勿安装来源不明的插件。
- 发现安全问题请不要公开提交 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发命令

```bash
pnpm install               # 安装依赖
pnpm typecheck             # 全仓类型检查
pnpm test                  # 全仓单元测试
pnpm build                 # 构建内置插件、运行时与桌面应用
pnpm package:win           # 构建 Windows NSIS 安装包
pnpm --filter @arqqbot/desktop dev  # 开发模式启动桌面应用
```

## 贡献

开发环境、分支约定、提交规范与 PR 检查清单见 [CONTRIBUTING.md](CONTRIBUTING.md)。参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE) © 2026 ArQQbot contributors
