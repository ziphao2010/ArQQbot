# ArQQbot 设计文档

- 日期：2026-10-31
- 状态：设计已确认，待编写实施计划
- 产品形态：Windows 桌面端 QQ 官方机器人实例管理器

## 1. 背景与目标

ArQQbot 是一个以 AI 聊天为核心、对接 QQ 官方机器人平台的机器人实例管理器。用户可以在桌面控制台中创建多个机器人实例，每个实例绑定独立的 AppID/AppSecret，并在实例内启用、配置、热重载可插拔的插件。

核心目标：

1. 多实例管理：创建、编辑、启动、停止、重启、删除机器人实例。
2. 插件化：实例能力由 Cordis 插件组成，支持启用、禁用、配置与热重载。
3. 低耦合高内聚：QQ 接入、插件运行时、控制台相互独立，通过明确的协议通信。
4. 故障隔离：单个实例崩溃不影响其他实例，单个插件激活失败不影响同实例其他插件。

## 2. 范围与非目标

### 2.1 MVP 范围

- Electron 桌面控制台：实例列表、创建向导、实例详情、插件配置、实时日志。
- 多实例运行：每个运行中实例一个独立 Worker 进程，内部为 Cordis 插件树。
- 插件内核：Cordis 原生插件 + manifest、配置 Schema、插件级热重载、错误隔离。
- QQ 官方适配器：WebSocket 网关，单聊与群聊 @ 文本消息收发。
- 内置 `echo` 示例插件，用于验证“消息进入 → 插件处理 → 回复发出”全链路。
- Windows 安装包（NSIS）。

### 2.2 非目标（MVP 不做）

- QQ 频道（guild）场景与频道私信。
- 图片、语音、视频、文件等富媒体收发。
- 主动消息推送、互动按钮、Markdown 卡片、流式消息。
- 从 UI 安装 npm 插件、插件市场、插件签名与沙箱。
- 自动启动实例、定时任务、多窗口、Web 远程控制台。
- 插件热更新版本、灰度发布、权限审批。
- Koishi 插件直接兼容（借鉴写法，不承诺 API 兼容）。

## 3. 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 | TypeScript 5.x，全仓库 strict |
| 桌面壳 | Electron（锁定当前稳定版） |
| UI | React 19 + Vite + Tailwind CSS + Radix Primitives（仅交互原语） |
| 状态管理 | Zustand |
| 插件内核 | `cordis` 4.x（锁定版本） |
| 进程管理 | Electron `utilityProcess.fork()` + MessagePort |
| 配置校验 | Ajv（JSON Schema 子集） |
| 构建 | pnpm workspaces + electron-vite + electron-builder |
| 测试 | Vitest + React Testing Library + `ws` 假网关 |

## 4. 总体架构

### 4.1 进程角色

| 角色 | 位置 | 职责 |
| --- | --- | --- |
| Renderer | Electron 渲染进程 | 实例列表、创建向导、实例详情、插件配置、日志展示 |
| Main（Manager） | Electron 主进程 | 实例注册表、生命周期管理、密钥加密、IPC 网关、日志落盘；普通 TS 服务，不使用 Cordis |
| Worker | 每个运行中实例一个 `utilityProcess` | 一棵完整 Cordis 插件树：核心服务 + QQ 适配器 + 已启用插件 |

```text
┌────────────────────┐        Electron IPC        ┌────────────────────────┐
│ Renderer (React)   │ <─────────────────────────> │ Main / Manager         │
└────────────────────┘   contextBridge + zod      │ 实例注册表 / 密钥 / 日志 │
                                                   └───────────┬────────────┘
                                                               │ MessagePort
                                     ┌─────────────────────────┼─────────────────────────┐
                                     ▼                         ▼                         ▼
                              ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
                              │ Worker A    │           │ Worker B    │           │ Worker C    │
                              │ Cordis 树   │           │ Cordis 树   │           │ Cordis 树   │
                              └─────────────┘           └─────────────┘           └─────────────┘
```

### 4.2 通信契约

- Renderer ↔ Main：`contextBridge` 暴露类型化 API；所有入参用 zod 校验；渲染进程 `nodeIntegration: false`、`contextIsolation: true`。
- Main ↔ Worker：`utilityProcess.fork()` 建立 MessagePort，协议分为：
  - `request/response`：`start`、`stop`、`applyPluginConfig`、`setPluginEnabled`、`getStatus`。
  - `event`：`status`、`log`、`pluginState`、`stats`。
  - Worker 启动后先发送 `ready`，Manager 再下发配置；请求带 `requestId`，10 秒超时。
- Manager 不转发机器人业务消息，只管理系统面。

### 4.3 实例状态机

```text
created → starting → running → stopping → stopped
                  ↘ error        ↘ crashed
```

- `crashed`：Worker 非预期退出，记录退出码与最后 50 行日志。
- `error`：启动失败（鉴权失败、网关不可用、插件根挂载失败等），实例不自动重试。
- Worker 崩溃后不自动重启，UI 提供手动重启，避免崩溃循环。
- 运行中修改 AppID、AppSecret 或环境后，配置立即保存，但需要重启实例才会使用新连接参数；UI 显示“需重启生效”。

### 4.4 数据存放

全部通过 `app.getPath('userData')` 获取，不硬编码路径。

```text
<userData>/
├── instances.json                     # 实例索引（id、名称、创建时间）
├── instances/<instanceId>/
│   ├── instance.json                  # appId、secretRef、env、createdAt、updatedAt
│   ├── plugins.json                   # 插件清单与配置
│   ├── data/                          # 插件持久化数据
│   └── logs/<YYYY-MM-DD>.jsonl        # 按天滚动日志
└── plugins/<pluginId>/                # 外部插件
```

### 4.5 实例配置模型

`instance.json`：

```ts
interface InstanceRecord {
  id: string                 // uuid
  name: string
  appId: string
  secretRef: string          // safeStorage 加密后的密文
  env: 'sandbox' | 'production'
  createdAt: string          // ISO 8601
  updatedAt: string
}
```

`plugins.json`：

```ts
interface PluginRecord {
  id: string                 // 对应 manifest.id
  enabled: boolean
  config: Record<string, unknown>
}
```

- 插件配置中的 `secret: true` 字段单独加密存储，Worker 挂载时解密注入；落盘时替换为 `{ "$secret": "<cipher>" }`。
- 未运行实例的插件运行时状态显示为 `enabled` / `disabled`；运行中由 Worker 上报。

## 5. 插件规范

### 5.1 插件形态

插件是 Cordis 原生插件：函数、类或 `{ apply }` 对象，可带 `inject`、`name`。另外必须通过 `package.json` 的 `arqqbot` 字段导出 manifest。插件代码不感知 Electron 与 Manager。

```text
my-plugin/
├── package.json
├── dist/index.js
└── README.md
```

```json
{
  "name": "arqqbot-plugin-ai-chat",
  "version": "0.1.0",
  "main": "dist/index.js",
  "arqqbot": {
    "id": "ai-chat",
    "displayName": "AI 对话",
    "description": "接入 OpenAI 兼容接口的聊天插件",
    "schema": {
      "type": "object",
      "properties": {
        "baseUrl": { "type": "string", "title": "接口地址", "default": "https://api.openai.com/v1" },
        "apiKey": { "type": "string", "title": "API Key", "format": "password", "secret": true },
        "model": { "type": "string", "title": "模型", "default": "gpt-4o-mini" },
        "systemPrompt": { "type": "string", "title": "人设", "format": "textarea" },
        "maxContext": { "type": "number", "title": "上下文条数", "default": 20, "minimum": 1, "maximum": 100 }
      },
      "required": ["apiKey", "model"]
    },
    "defaultConfig": {
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o-mini",
      "maxContext": 20
    }
  }
}
```

### 5.2 配置 Schema 子集

顶层必须是 `type: "object"`。支持字段：

- `type`：`string | number | boolean | object | array`
- `title`、`description`、`default`
- `enum`（字符串或数字）
- `minimum`、`maximum`（number）
- `required`（object）
- `properties`（object）
- `items`（array，元素为单个 schema）
- `format`：`password | textarea | select`
- `secret`：`true` 表示加密存储

manifest 校验会拒绝上述之外的 Schema 关键字，避免 UI 无法渲染。配置由 Ajv 校验；保存非法配置时返回字段级错误。

### 5.3 插件类型

- 服务插件：向上下文提供 `ctx.<key>` 服务，例如 `ctx.qq`、`ctx.storage`、`ctx.llm`（后续 AI 插件）。
- 功能插件：订阅 `qq/message` 等事件或注册命令。
- 组合插件：通过 `ctx.plugin()` 挂载子插件，允许内部分解。

### 5.4 生命周期

```text
discovered → enabled → activating → active ↔ error → disabled
```

- 每个插件挂载在实例根上下文下的独立子上下文，激活失败只标记该插件 `error`，不抛出到 Worker 根。
- 消息事件分发统一 try/catch，异常记录日志（含插件 id）后继续分发；MVP 不自动禁用，只累计错误计数。
- 已启用插件的配置保存执行插件级热重载：销毁该插件子树 → 用新配置重新挂载 → 成功则持久化，失败则重新挂载上一份可用配置并标记 `error`。
- 未启用插件的配置保存只持久化，不触发挂载。
- 启用、禁用同样以销毁/重建完成，不重启 Worker。
- Worker 未运行时，配置直接持久化，下次启动生效。

### 5.5 发现与加载

- 内置插件随应用打包，位于 `resources/plugins/<id>/`。
- 外部插件位于 `<userData>/plugins/<id>/`，启动时扫描。
- Manager 只扫描 manifest 供 UI 展示；Worker 才动态 `import()` 插件入口。
- 入口支持 ESM 默认导出与命名导出 `apply`/`name`/`inject`。
- 插件 `id` 全局唯一；发现重复 id 时记录警告并跳过外部插件，内置插件优先。
- 入口 `import()` 失败或 manifest 不合法时，该插件标记 `error` 并展示原因，不阻断其他插件加载。
- 插件视为本地可信代码，MVP 不提供沙箱；UI 安装第三方插件前需向用户明确提示风险（该提示属于后续安装功能）。

## 6. QQ 适配器

内置核心插件 `adapter-qq`，提供 `ctx.qq` 服务。它是唯一接触 QQ 官方接口的模块，其他插件只使用统一消息对象。

### 6.1 连接与鉴权

- 认证：优先使用当前 QQ 开放平台的 `POST https://api.bot.qq.com/app/getAppAccessToken`（`appId` + `clientSecret`）换取 access_token，并兼容旧版 `https://bots.qq.com/app/getAppAccessToken`（`appId` + `appSecret`）；响应中的 `expires_in` 可能为字符串，统一转换为数字，到期前 60 秒刷新。
- 通过 WebSocket 网关接收事件；API 域名优先使用 `https://api.bot.qq.com`，不可用时回退到正式 `https://api.sgroup.qq.com` 或沙箱 `https://sandbox.api.sgroup.qq.com`。
- 心跳按网关 `Hello` 下发间隔发送；断线指数退避重连（1s 起，上限 60s），优先使用 `Resume` 携带 session id 与 seq。
- 鉴权失败、intent 未开通等错误上报为 `qq/error`，并让实例进入 `error`。

### 6.2 事件与消息

MVP 订阅 `PUBLIC_MESSAGES`（`1 << 25`），处理：

- `C2C_MESSAGE_CREATE`：单聊消息。
- `GROUP_AT_MESSAGE_CREATE`：群聊 @ 机器人消息。

统一消息对象：

```ts
interface QQMessage {
  id: string
  scene: 'c2c' | 'group'
  userId: string            // c2c: user_openid；group: member_openid
  groupId?: string          // group_openid
  content: string
  mentions: string[]
  attachments: Array<{ contentType: string; url: string; filename?: string; size?: number }>
  timestamp: string
  raw: unknown              // 原始 payload，仅供适配器与调试插件使用
}
```

- 适配器对外事件：`qq/ready`、`qq/message`、`qq/disconnect`、`qq/error`。
- 消息 id 维护 10,000 条 LRU 去重，重复事件直接丢弃。

### 6.3 发送与被动回复

- API：`ctx.qq.send({ scene, targetId, content, msgId? })`。
- 便捷方法：`msg.reply(content)`，自动携带 `msgId` 并递增 `msg_seq`。
- 适配器维护被动回复配额：群聊 5 分钟内 5 次、单聊 60 分钟内 4 次。超出配额返回 `QUOTA_EXCEEDED`，由插件自行降级处理。
- 文本按平台长度限制自动分段，分段仍计入回复次数。
- MVP 主动消息一律拒绝，返回 `ACTIVE_MESSAGE_UNSUPPORTED`。

## 7. 控制台界面

### 7.1 页面

- **实例列表**：卡片展示名称、环境标识、状态圆点（运行中/已停止/崩溃/错误）、启动与停止入口；空状态提供创建引导。
- **创建实例向导**：名称 → AppID/AppSecret → 沙箱/正式 → 确认；密钥输入即加密，不回显明文。
- **实例详情**：
  - 概览：连接状态、运行时长、收发消息计数、当前错误摘要。
  - 插件：已发现插件列表、启用开关、按 Schema 生成的配置表单、热重载结果提示。
  - 日志：实时滚动、级别过滤、关键词搜索、只看消息、导出 JSONL。
- **删除实例**：二次确认，停止 Worker 后删除目录；不进入回收站。

### 7.2 视觉

- 大圆角、轻阴影、半透明层次、克制动效；跟随系统深浅色。
- 表单控件与 Radix 原语统一封装，错误态与禁用态明确。
- 所有危险操作（删除、覆盖配置）使用确认对话框。

## 8. IPC 接口

所有接口由 zod 校验，返回结构化错误 `{ code, message, details? }`。

```ts
instances.list(): InstanceSummary[]
instances.create(input: { name; appId; appSecret; env }): InstanceSummary
instances.update(id, input: { name?; appId?; appSecret?; env? }): InstanceSummary
instances.remove(id): void
instance.start(id): void
instance.stop(id): void
instance.restart(id): void
instance.getStatus(id): InstanceRuntimeStatus

plugins.list(instanceId): PluginSummary[]        // 含 manifest、启用状态、运行时状态
plugins.enable(instanceId, pluginId): void
plugins.disable(instanceId, pluginId): void
plugins.updateConfig(instanceId, pluginId, config): void

logs.subscribe(instanceId): void
logs.unsubscribe(instanceId): void
// 日志通过 webContents.send 推送，按 instanceId 过滤
```

## 9. 错误处理

| 场景 | 行为 |
| --- | --- |
| Worker 意外退出 | 实例置 `crashed`，记录退出码与最后日志，UI 可手动重启 |
| QQ 认证失败 | 实例置 `error`，提示 AppSecret 错误、未开通群聊权限等可操作原因 |
| 网关断线 | 指数退避重连，状态保持 `running` 并展示“重连中” |
| 插件激活失败 | 该插件置 `error`，配置回滚到上一份可用版本，其余插件继续运行 |
| 插件事件抛错 | 捕获并记录，附带插件 id；不中断 Worker |
| IPC 超时 | 10 秒后返回 `TIMEOUT`，UI 提示实例无响应 |
| 实例 JSON 损坏 | 备份为 `.bak`，用默认值重建并在界面提示 |
| 应用启动 | 不自动启动任何实例，避免意外联网 |

## 10. 安全

- 实例 AppSecret 与插件 `secret` 配置使用 Electron `safeStorage`（Windows DPAPI）加密，渲染进程与日志永远不出现明文。
- Renderer 开启 `contextIsolation`、关闭 `nodeIntegration`，配置 CSP，仅允许本地资源。
- 日志写入前对疑似密钥字段做脱敏（`apiKey`、`secret`、`token`、`authorization`）。
- 插件为本地可信代码，不提供沙箱；外部插件目录由用户自行放置，后续安装功能需展示风险提示。
- 不监听公网端口，Manager 与 Worker 仅通过本地 IPC 通信。

## 11. 测试与验收

### 11.1 测试

- 单元：manifest 校验、Schema 表单生成、配置校验、插件挂载/销毁/热重载/错误隔离、消息归一化、去重、回复配额。
- 集成：`ws` 假 QQ 网关验证鉴权握手、心跳、断线重连、Resume、事件分发。
- UI：实例列表与创建流程、插件配置表单、日志订阅与过滤。
- 手工：Windows 干净环境安装包冒烟测试。

### 11.2 验收标准

1. 创建实例后重启应用，实例与加密密钥仍可读取，渲染进程无法拿到明文。
2. 用假网关启动实例，状态变为 `running`，日志实时显示。
3. 假网关推送群聊 @ 消息，`echo` 插件正确回复且携带 `msg_id`；重复推送同一消息只回复一次；超出回复配额返回明确错误。
4. 修改 `echo` 插件配置触发热重载，无需重启 Worker；非法配置被拒绝；激活失败回滚到旧配置。
5. 禁用插件后不再响应消息。
6. 杀死一个实例的 Worker，状态变 `crashed`，其他实例继续运行；手动重启可恢复。
7. 日志可过滤、搜索、导出；密钥不出现在日志中。
8. NSIS 安装包可在干净 Windows 环境安装并启动。

## 12. 分期计划

### 第一阶段：控制台与运行时骨架（MVP）

1. Monorepo 脚手架、共享类型与 IPC 契约。
2. Manager：实例 CRUD、密钥加密、状态机、Worker 进程管理、日志落盘。
3. Worker：Cordis 根上下文、核心服务（logger/storage）、插件宿主、manifest 加载。
4. QQ 适配器：鉴权、WebSocket、单聊/群聊事件、被动回复与配额。
5. 内置 `echo` 插件。
6. 控制台三页与实例向导。
7. 测试、打包与验收。

### 第二阶段：AI 对话插件

按第 5 节规范实现首个正式插件：

- OpenAI 兼容接口（可配置 `baseUrl`/`apiKey`/`model`）。
- 人设配置、按会话滚动上下文（持久化到实例 `data/`）。
- 超时、重试、错误降级；按平台长度自动分段。
- 群聊仅 @ 触发；单聊直接触发。

### 后续候选

- npm 插件安装、插件市场与风险提示。
- QQ 频道、富媒体、主动消息、流式消息。
- 实例自动启动、资源监控、插件错误自动禁用。
- 消息监控面板（收发消息可视化与手动测试）。

## 13. 风险与约束

- **Cordis 版本演进**：Cordis 仍快速迭代；锁定版本，并在 `packages/runtime` 内封装兼容层，升级时只改一层。
- **QQ 平台审核**：正式环境需要平台审核与权限开通；MVP 以沙箱环境验证，UI 需清楚区分环境。
- **被动回复时效**：群聊 5 分钟内 5 次、单聊 60 分钟内 4 次；AI 插件必须设置超时，避免超时后无法回复。
- **插件生态差异**：Koishi 插件不能直接运行，需按本规范移植。
- **Electron 打包**：`utilityProcess` 入口与内置插件需正确随 `resources` 打包，需在 Windows 安装包中验证路径解析。
- **多实例资源**：每个运行实例一个进程，内存随实例数线性增长；MVP 不限制实例数，后续可加资源监控与上限。

## 14. 参考资料

- Cordis 文档：https://cordis.moe/
- DeepSeek Harness Cordis 入门：https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer
- QQ 机器人官方文档（事件订阅）：https://bot.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- QQ 机器人官方文档（消息收发概述）：https://bot.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
- Koishi 插件文档：https://cordis.moe/zh-CN/guide/essential/index.html
