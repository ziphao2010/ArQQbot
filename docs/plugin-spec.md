# ArQQbot 插件规范

- 适用版本：ArQQbot 0.1+
- 运行时：Node.js 22、Cordis 4
- 状态：早期规范，接口可能随版本调整

插件是标准的 [Cordis](https://github.com/shigma/cordis) 插件，通过 `arqqbot` manifest 声明身份与配置。插件不直接接触 QQ 的 HTTP、token 或平台错误码，而是调用宿主提供的 `ctx.qq` 服务。

## 1. 目录结构

```text
my-plugin/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
├── dist/                 # 预构建产物，随包发布
│   └── index.js
└── README.md
```

宿主只读取插件根目录的 `package.json`，并按 `main`（缺省为 `dist/index.js`）加载入口。`src/` 不参与运行时加载。

## 2. package.json 与 manifest

```json
{
  "name": "arqqbot-plugin-example",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "license": "MIT",
  "keywords": ["arqqbot", "arqqbot-plugin", "qq-bot"],
  "files": ["dist", "README.md", "LICENSE"],
  "arqqbot": {
    "id": "example",
    "displayName": "示例插件",
    "description": "最小可运行的插件示例",
    "schema": {
      "type": "object",
      "properties": {
        "prefix": {
          "type": "string",
          "title": "回复前缀",
          "default": "收到："
        }
      }
    },
    "defaultConfig": {
      "prefix": "收到："
    }
  }
}
```

字段要求：

| 字段 | 要求 |
| --- | --- |
| `name` | npm 包名。社区插件建议 `arqqbot-plugin-*`，内置插件使用 `@arqqbot/plugin-*` |
| `version` | 合法 semver |
| `type` | 必须为 `module` |
| `main` | 入口文件，缺省 `dist/index.js` |
| `arqqbot.id` | 必填，匹配 `^[a-z0-9-]+$`，在实例内必须唯一 |
| `arqqbot.displayName` | 必填，非空字符串 |
| `arqqbot.description` | 可选，缺省空字符串 |
| `arqqbot.schema` | 必填，顶层必须是 `object` 的 JSON Schema 子集 |
| `arqqbot.defaultConfig` | 可选，缺省 `{}` |

`arqqbot` 对象是严格校验的：除上述字段外的键会导致 manifest 校验失败。根级其他字段允许存在。

## 3. Cordis 导出契约

插件入口必须导出一个 Cordis 插件，支持以下任一形式：

```ts
// 形式一：命名导出
export const name = 'example'
export const inject = ['qq']
export function apply(ctx: Context, config: Config): void { /* ... */ }

// 形式二：默认导出函数
export default function plugin(ctx: Context, config: Config): void { /* ... */ }
```

- `name`：插件在 Cordis 中的名称，建议与 `arqqbot.id` 一致，用于日志标识。
- `inject`：声明依赖的服务。使用 `ctx.qq` 的插件必须声明 `['qq']`；使用 `ctx.storage` 时声明 `['storage']`。
- `apply(ctx, config)`：挂载入口。`config` 是合并 `defaultConfig` 与用户配置后的对象，并已通过 manifest schema 校验。
- 不要在模块顶层执行副作用或访问宿主服务；所有初始化逻辑放在 `apply` 内。
- 注册的事件监听会随插件卸载自动清理；长生命周期任务应监听 `ctx` 的销毁事件并主动释放。

挂载失败、超时（默认 5 秒）或运行时抛出错误会把插件状态置为 `error`，单个插件失败不会阻断其他插件。

## 4. 可用服务

### 4.1 `ctx.qq`

`ctx.qq` 是 QQ 官方能力的统一门面：

| 成员 | 说明 |
| --- | --- |
| `message.send` / `message.reply` / `message.sendStream` / `message.recall` | 发送文本、Markdown、Ark、Embed、媒体与流式消息；被动回复；撤回 |
| `media.upload` / `uploadChunked` / `prepareUpload` / `finishUpload` | 小文件直传、分片上传与 `file_info` 获取 |
| `group.*` | 群信息、机器人状态、成员查询与移除、入群申请、入群策略、黑名单、禁言 |
| `guild.*` | 频道信息、子频道列表、创建/修改/删除子频道 |
| `interaction.respond` | 响应按钮互动 |
| `menu.get` / `menu.set` | 快捷菜单读取与设置 |
| `panels.*` | 消息面板列表、创建、读取、修改、删除、目标更新 |
| `bot.*` | 机器人信息、频道列表、网关地址、链接生成 |
| `request` | 通用原始请求逃生口，仍经过鉴权、限流与错误映射 |
| `capabilities` | 按实例环境与 intents 计算的能力可用性 |
| `getStats()` | 当前连接的收发统计 |

兼容入口 `ctx.qq.send({ scene, targetId, content, msgId? })` 仍可用于 c2c/group 的纯文本被动回复。

能力不可用时调用会返回明确错误（例如 `CAPABILITY_UNAVAILABLE`），插件不应假设所有接口在任何实例环境都可用。

### 4.2 `ctx.storage`

按实例隔离的键值存储，仅支持 JSON 可序列化值：

```ts
const value = await ctx.storage.get<MyState>('state')
await ctx.storage.set('state', next)
await ctx.storage.delete('state')
```

键名会映射为实例数据目录下的文件。请为键加插件前缀，避免与其他插件冲突。

### 4.3 `ctx.logger`

Cordis 日志服务。推荐使用插件名作为 logger 名称：

```ts
const logger = ctx.logger('example')
logger.info('插件已启动')
logger.warn('发送失败', error)
```

日志会写入实例日志文件并在桌面界面展示。不要把令牌、AppSecret 或用户隐私写入日志。

## 5. 事件

### 5.1 统一消息事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `qq/message` | `QQMessage` | 仅 c2c 与 group 消息，保持旧插件兼容 |
| `qq/group-message` | `QQMessage` | 群消息 |
| `qq/guild-message` | `QQMessage` | 频道消息 |
| `qq/dm-message` | `QQMessage` | 频道私信 |

`QQMessage` 主要字段：`id`、`scene`、`userId`、`groupId?`、`guildId?`、`channelId?`、`content`、`mentions`、`attachments`、`timestamp`、`author?`、`raw`。

### 5.2 22 个官方事件与归一化事件

| 官方事件 | 归一化事件 |
| --- | --- |
| `GROUP_ADD_ROBOT` | `qq/group-add` |
| `GROUP_DEL_ROBOT` | `qq/group-del` |
| `GROUP_JOIN_REQUEST` | `qq/group-join-request` |
| `GROUP_MEMBER_ADD` | `qq/group-member-add` |
| `GROUP_MEMBER_REMOVE` | `qq/group-member-remove` |
| `GROUP_MSG_RECEIVE` | `qq/group-msg-receive` |
| `GROUP_MSG_REJECT` | `qq/group-msg-reject` |
| `FRIEND_ADD` | `qq/friend-add` |
| `FRIEND_DEL` | `qq/friend-del` |
| `C2C_MSG_RECEIVE` | `qq/c2c-msg-receive` |
| `C2C_MSG_REJECT` | `qq/c2c-msg-reject` |
| `INTERACTION_CREATE` | `qq/interaction` |
| `SUBSCRIBE_MESSAGE_STATUS` | `qq/subscribe-status` |
| `GUILD_CREATE` | `qq/guild-create` |
| `GUILD_UPDATE` | `qq/guild-update` |
| `GUILD_DELETE` | `qq/guild-delete` |
| `CHANNEL_CREATE` | `qq/channel-create` |
| `CHANNEL_UPDATE` | `qq/channel-update` |
| `CHANNEL_DELETE` | `qq/channel-delete` |
| `GROUP_AT_MESSAGE_CREATE` | `qq/group-message` 与 `qq/message` |
| `GROUP_MESSAGE_CREATE` | `qq/group-message` 与 `qq/message` |
| `C2C_MESSAGE_CREATE` | `qq/message`（`scene` 为 `c2c`） |

此外还有连接状态事件：

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `qq/ready` | 无 | 网关就绪 |
| `qq/error` | `Error` | 适配器错误 |
| `qq/disconnect` | 无 | 网关断开 |

### 5.3 原始事件

每个收到的平台事件都会同时发出 `qq/raw-event`，载荷为 `{ type: string; data: unknown }`。它用于调试与覆盖尚未类型化的事件。未知事件只发原始事件，不阻断连接。

即使事件已归一化，插件也应检查 `message.scene` 与目标 id 是否存在，再决定是否处理。

## 6. 配置 Schema 子集

当前使用内置 JSON Schema 子集，只支持：

- `type`：`string`、`number`、`boolean`、`object`、`array`
- 通用注解：`title`、`description`、`default`
- 枚举与范围：`enum`、`minimum`、`maximum`
- UI 提示：`format` 取 `password`、`textarea`、`select`；`secret: true` 表示敏感值
- 对象：`properties`、`required`
- 数组：`items`

不支持 `$ref`、`oneOf`、`anyOf`、`allOf`、`additionalProperties`、`patternProperties`、`dependentSchemas` 等关键字；出现未知关键字会导致 manifest 校验失败。

`defaultConfig` 必须是对象，并应与 schema 的默认值保持一致。敏感字段使用 `secret: true`，界面会掩码显示。

## 7. 权限声明（规划中）

插件权限声明与按权限拒绝调用的机制仍在规划中，**当前版本没有强制任何权限模型**。插件一旦启用即可调用 `ctx.qq` 暴露的全部能力。

现阶段请在 README 与提交说明中主动列出插件实际使用的服务与能力（例如“需要发送群消息、读取群成员”），便于用户判断风险。不要声称插件已受权限系统限制。

## 8. 兼容性

- Node.js 22 或更高版本。
- Cordis 4（当前验证版本 `4.0.0-rc.12`）。
- ArQQbot 0.1 及更高版本。
- 插件 id 在实例内唯一；重复 id 的插件会被跳过并产生告警。
- `version` 必须遵循 semver；破坏性变更使用主版本号升级，并在 README 说明迁移方式。
- 依赖 QQ 官方 API 的插件应处理能力不可用、限流与平台错误。

## 9. 打包要求

- 入口与所有运行时模块必须是 **ESM**。共享包应打包进产物，不要依赖宿主未提供的模块加载机制。
- 发布前必须提交预构建的 `dist/`；宿主不会在安装时执行构建。
- 运行时依赖必须打包进 `dist`，或作为随包安装的依赖存在。宿主不会为外部插件执行 `npm install`。
- `cordis` 只能作为 **type-only** 依赖（`import type`），不能在运行时导入；宿主已提供该实例。
- `@arqqbot/shared` 是仓库内部 workspace 包，不会安装到外部插件目录。外部插件应自行声明所需类型，或将类型代码打包；不要把 `@arqqbot/shared` 作为运行时依赖。
- 不要把 `node_modules` 打进 tarball；使用 `files` 白名单。

## 10. 命名与发现

- GitHub topic：`arqqbot-plugin`
- npm keyword：`arqqbot-plugin`
- 社区包名：`arqqbot-plugin-*`
- 内置包名：`@arqqbot/plugin-*`

插件索引从 GitHub topic `arqqbot-plugin` 聚合仓库，读取仓库默认分支上的 `package.json` 并校验 manifest。索引结构见 [plugin-marketplace.md](plugin-marketplace.md)。

## 11. 安装路径与生命周期

- 外部插件放在桌面应用用户数据目录下的 `plugins/`（Windows 通常为 `%APPDATA%\<应用名>\plugins`）。
- 插件以目录为单位存在，目录内必须包含 `package.json` 与入口文件。
- 宿主在实例启动时扫描内置与外部插件目录；复制新插件后需要**重启对应实例**才会被发现。
- 扫描到的插件默认不自动启用；必须在实例插件页面手动启用。
- 禁用插件会卸载其 Cordis 实例，但不会删除 `ctx.storage` 中已有数据。
- 配置修改会先卸载再挂载插件；挂载失败会回滚到上一次配置。

## 12. 安全规则与禁止行为

外部插件运行在实例 Worker 中，拥有与 Worker 相同的 Node.js 权限。宿主没有插件沙箱，安装插件等同于信任其代码。插件必须遵守：

- 不得读取、上传或记录 AppSecret、access_token、其他实例数据或其他插件的存储。
- 不得执行远程下发的任意代码，不得在运行时从不可信地址加载可执行模块。
- 不得伪装来源、隐藏实际行为，或在 manifest 之外偷偷启用额外功能。
- 不得绕过 `ctx.qq` 直接访问 QQ 接口、伪造鉴权或规避限流。
- 不得对其他插件、实例或日志文件进行未授权写入。
- 不得发送垃圾消息、骚扰用户或规避平台频率限制。
- 不得收集用户数据而不在 README 中明确说明用途与存储位置。
- 不得在模块顶层执行副作用、阻塞事件循环或发起无上限的定时任务。
- 不得声明未实际使用的权限，也不得声称拥有当前版本并不存在的权限隔离。

违反上述规则的插件会被移出索引，并可能被社区举报。
