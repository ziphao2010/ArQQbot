# ArQQbot 官方能力插件设计

- 日期：2026-11-01
- 状态：设计已确认，待编写实施计划
- 范围：QQ 官方 API v2 全量 HTTP 接口 + WebSocket 事件，不含 Webhook 与旧版接口

## 1. 背景与目标

当前 `packages/adapter-qq` 只覆盖单聊/群聊文本收发。它已经是所有 QQ 能力的唯一入口，但接口面太窄，其他插件无法使用富媒体、群管理、频道、互动、菜单等官方能力。

目标是把 `adapter-qq` 重构为 ArQQbot 的**官方能力基座**：

1. 统一认证、HTTP 请求、WebSocket、限流、重试、错误映射与日志。
2. 以官方 API v2 文档索引为基线，覆盖全部 HTTP 接口与全部事件。
3. 向其他插件提供统一 `ctx.qq` 服务，插件不直接接触 HTTP、token 或平台错误码。
4. 提供 `raw request` 逃生口，官方新增接口无需等待类型化封装即可调用。
5. 保持现有 `ctx.qq.send` 与 `qq/message` 兼容，echo 插件无需修改。

## 2. 覆盖定义

“全量”以 **QQ 机器人官方 API v2 文档索引（2026-10-28 版）** 为基线：

- 47 个 HTTP 接口。
- 22 个事件类型。
- 传输方式仅 WebSocket；Webhook 明确不实现。
- 旧版 v1、Bot Token 鉴权、频道历史接口不在基线内。

基线之外的官方接口仍可通过 `ctx.qq.request()` 调用；类型化模块中对未收录端点返回 `CAPABILITY_UNAVAILABLE`，而不是静默失败。

## 3. 非目标

- Webhook 回调服务、公网 URL、隧道集成。
- 旧版接口与旧鉴权方式。
- 自动申请平台权限、自动通过审核。
- 控制台接口调试器或任意接口表单。
- 富媒体公网托管、CDN。
- 限流统计面板、计费、审计报表。

## 4. 总体架构

保留 `packages/adapter-qq`，内部重构为四层：

```text
src/
├── core/
│   ├── token.ts
│   ├── http-client.ts
│   ├── endpoint-catalog.ts
│   ├── capability-registry.ts
│   ├── intent-map.ts
│   └── errors.ts
├── transport/
│   └── gateway.ts
├── modules/
│   ├── messages.ts
│   ├── media.ts
│   ├── groups.ts
│   ├── guilds.ts
│   ├── interactions.ts
│   ├── menus.ts
│   ├── panels.ts
│   └── bot.ts
├── events/
│   ├── normalize.ts
│   └── router.ts
├── service.ts
└── index.ts
```

**调用链**：`ctx.qq.<module>.<method>` → 能力检查 → HTTP Client → QQ OpenAPI。
**事件链**：Gateway → router → normalize → `qq/*` 事件。

### 4.1 单元职责

- `token.ts`：获取/缓存/刷新 access_token，兼容新旧 token 接口。
- `http-client.ts`：基础域名选择、鉴权头、超时、重试、错误映射、请求日志。
- `endpoint-catalog.ts`：官方端点元数据，唯一权威清单。
- `capability-registry.ts`：按实例环境与 intents 计算能力可用性。
- `intent-map.ts`：intent 名称 ↔ 位值映射，事件元数据引用名称。
- `gateway.ts`：WebSocket 连接、心跳、Resume、重连、事件分发。
- `modules/*`：只负责参数校验、路径/请求体构造和响应类型。
- `events/normalize.ts`：平台事件 → 统一类型。
- `service.ts`：组装 `ctx.qq` 门面，不包含业务细节。

## 5. `ctx.qq` API

```ts
interface QQService {
  message: {
    send(input: QQSendMessageInput): Promise<QQSendResult>
    reply(source: QQMessage, content: QQMessageContent): Promise<QQSendResult>
    sendStream(input: QQStreamInput): Promise<QQStreamHandle>
    recall(scene: 'c2c' | 'group', targetId: string, messageId: string): Promise<void>
  }
  media: {
    upload(input: QQMediaUploadInput): Promise<QQUploadedMedia>
    uploadChunked(input: QQChunkedUploadInput): Promise<QQUploadedMedia>
    prepareUpload(input: QQUploadPrepareInput): Promise<QQUploadSession>
    finishUpload(input: QQUploadFinishInput): Promise<QQUploadedMedia>
  }
  group: {
    info(groupOpenid: string): Promise<QQGroupInfo>
    botState(groupOpenid: string): Promise<QQGroupBotState>
    members(groupOpenid: string, query?: QQPageQuery): Promise<QQGroupMembers>
    member(groupOpenid: string, memberOpenid: string): Promise<QQGroupMember>
    removeMembers(groupOpenid: string, memberOpenids: string[]): Promise<void>
    joinRequests(groupOpenid: string, query?: QQPageQuery): Promise<QQJoinRequestList>
    approveJoinRequest(groupOpenid: string, memberOpenid: string, approve: boolean): Promise<void>
    createJoinStrategy(input: QQJoinStrategy): Promise<QQJoinStrategy>
    updateJoinStrategy(id: string, input: Partial<QQJoinStrategy>): Promise<QQJoinStrategy>
    executeJoinStrategy(id: string): Promise<void>
    setJoinStrategyWhitelist(id: string, userIds: string[]): Promise<void>
    listJoinStrategies(): Promise<QQJoinStrategy[]>
    deleteJoinStrategy(id: string): Promise<void>
    blacklist(groupOpenid: string): Promise<QQBlacklistEntry[]>
    updateBlacklist(groupOpenid: string, input: QQBlacklistUpdate): Promise<void>
    muteSetting(groupOpenid: string): Promise<QQMuteSetting>
    setMute(groupOpenid: string, input: QQMuteInput): Promise<void>
  }
  guild: {
    get(guildId: string): Promise<QQGuild>
    channels(guildId: string): Promise<QQChannel[]>
    channel(channelId: string): Promise<QQChannel>
    createChannel(guildId: string, input: QQChannelInput): Promise<QQChannel>
    updateChannel(channelId: string, input: Partial<QQChannelInput>): Promise<QQChannel>
    deleteChannel(channelId: string): Promise<void>
  }
  interaction: {
    respond(interactionId: string, payload: QQInteractionResponse): Promise<void>
  }
  menu: {
    get(): Promise<QQMenu>
    set(menu: QQMenu): Promise<void>
  }
  panels: {
    list(): Promise<QQPanel[]>
    create(input: QQPanelInput): Promise<QQPanel>
    get(id: string): Promise<QQPanel>
    update(id: string, input: Partial<QQPanelInput>): Promise<QQPanel>
    delete(id: string): Promise<void>
    updateTarget(id: string, target: QQPanelTarget): Promise<void>
  }
  bot: {
    me(): Promise<QQBotInfo>
    guilds(): Promise<QQGuild[]>
    gateway(): Promise<string>
    generateUrlLink(input: QQUrlLinkInput): Promise<string>
  }
  request<T>(input: QQRawRequest): Promise<T>
  capabilities: QQCapabilityRegistry
  getStats(): QQStats
}
```

### 5.1 消息目标与内容

```ts
type QQSendTarget =
  | { scene: 'c2c'; userId: string }
  | { scene: 'group'; groupId: string }

type QQMessageContent =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: QQMarkdown; keyboard?: QQKeyboard }
  | { type: 'ark'; ark: QQArk }
  | { type: 'embed'; embed: QQEmbed }
  | { type: 'media'; fileInfo: string }

interface QQStreamHandle {
  write(chunk: string): Promise<void>
  end(): Promise<void>
}
```

`ark`/`embed` 是否可用由端点与场景决定；端点不支持时返回 `CAPABILITY_UNAVAILABLE`，不会静默降级。`sendStream` 返回 `QQStreamHandle`，由实现映射到底层的流式发送接口。

`send` 支持 `replyTo`（被动回复）、`eventId`（事件回复）、`msgSeq`。`reply(source, content)` 自动读取 `source.id` 并递增 `msg_seq`。不携带回复凭据的发送属于主动消息，受授权与配额约束。

Guild / DM 发送接口不在当前 v2 索引内，因此类型化 `send` 首版只声明 c2c/group；guild/dm 消息事件仍会归一化并发出事件，发送需通过 `request()` 或后续目录扩展。

### 5.2 媒体

`upload` 负责小文件直传；`uploadChunked` 负责预上传、分片、完成三步；返回 `file_info` 供消息内容 `{ type: 'media', fileInfo }` 使用。单聊与群聊的上传接口不互通，模块必须按 scene 选择路径。

### 5.3 raw request

```ts
interface QQRawRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string                 // 必须以 / 开头
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}
```

始终经过 token、基础域名、限流、错误映射与日志；不绕过鉴权。`raw` 用于目录未覆盖的新接口或特殊调用。

## 6. 事件模型

### 6.1 统一消息

`QQMessage` 扩展：

```ts
scene: 'c2c' | 'group' | 'guild' | 'dm'
groupId?: string
guildId?: string
channelId?: string
author?: { id: string; name?: string; bot?: boolean }
```

兼容策略：

- `qq/message` 继续只承载 c2c/group 消息，echo 等旧插件行为不变。
- guild/dm 消息分别发出 `qq/guild-message`、`qq/dm-message`。
- 每个事件同时发送 `qq/raw-event`，payload 为 `{ type, data }`，供调试与未覆盖事件使用。

### 6.2 领域事件

- 群：`qq/group-add`、`qq/group-del`、`qq/group-join-request`、`qq/group-member-add`、`qq/group-member-remove`、`qq/group-msg-receive`、`qq/group-msg-reject`
- 好友/单聊：`qq/friend-add`、`qq/friend-del`、`qq/c2c-msg-receive`、`qq/c2c-msg-reject`
- 互动：`qq/interaction`、`qq/subscribe-status`
- 频道：`qq/guild-create`、`qq/guild-update`、`qq/guild-delete`、`qq/channel-create`、`qq/channel-update`、`qq/channel-delete`
- 状态：`qq/ready`、`qq/error`、`qq/disconnect`

事件类型与 payload 类型集中在 shared 包声明合并；未知事件只发 `qq/raw-event`，不阻断连接。

## 7. 端点目录与能力注册表

### 7.1 端点描述

```ts
interface QQEndpointSpec {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  category: string
  environments: ('sandbox' | 'production')[]
  idempotent: boolean
  docsUrl: string
}
```

事件描述额外包含：

```ts
interface QQEventSpec {
  type: string
  intent: QQIntentName
  environments: ('sandbox' | 'production')[]
}
```

### 7.2 覆盖测试

仓库保存 `docs/qq-api-v2-endpoints.json` 快照，包含 method、path、category、docsUrl。测试要求：

- 快照中每条记录在 `endpoint-catalog` 中存在。
- catalog 中每条记录能反向匹配快照。
- 事件快照 22 条全部有 `QQEventSpec`。
- 新增官方接口时先更新快照，再补 catalog 与模块。

### 7.3 能力注册表

```ts
interface QQCapabilityInfo {
  id: string
  module: string
  available: boolean
  requiredIntents: QQIntentName[]
  reason?: string
}

interface QQCapabilityRegistry {
  list(): QQCapabilityInfo[]
  has(id: string): boolean
}
```

静态可用性由环境、intent、目录决定；平台权限不足在调用时映射为 `PERMISSION_DENIED`。

## 8. 实例配置与 intents

`instance.json` 增加：

```ts
intents: QQIntentName[]   // 默认 ['public_messages']
```

- `public_messages` 对应群聊/单聊消息与群基础事件。
- 首版 intent 名称至少包含 `public_messages`、`interaction`、`guilds`、`guild_members`、`guild_messages`、`direct_message`；具体位值集中在 `intent-map.ts`，并与官方文档逐项核对。
- Guild、互动、好友等事件需要显式开启对应 intent。
- 修改 intents 后保存，UI 标记“需重启生效”。
- `intent-map.ts` 集中维护 intent 名称与位值；未在映射中的事件不得默认开启。
- 连接时 intents 作为位掩码传给 Gateway。

## 9. 控制台改造

实例详情新增“能力”页签：

- 按模块展示能力列表：消息、富媒体、群、频道、互动、菜单、面板、机器人。
- 展示每个模块的端点数量、可用/不可用状态、不可用原因。
- 展示并编辑 intents 开关；保存后提示重启生效。
- 展示当前 WebSocket 连接状态与已订阅 intent。

后端：

- Worker 新增 `getCapabilities` 请求，返回 `QQCapabilityInfo[]`。
- Manager 新增 IPC `qq.capabilities(instanceId)` 与 `qq.updateIntents(instanceId, intents)`。
- 其他页面与消息日志保持不变。

## 10. 错误、重试、限流与日志

### 10.1 错误

统一 `QQApiError`：

- `UNAUTHORIZED`：token 无效/过期。
- `PERMISSION_DENIED`：平台权限或 intent 不足。
- `CAPABILITY_UNAVAILABLE`：环境/intents/目录不支持。
- `QUOTA_EXCEEDED`：被动回复或主动消息额度耗尽。
- `RATE_LIMITED`：429。
- `NOT_FOUND`、`BAD_REQUEST`、`SERVER_ERROR`、`NETWORK_ERROR`。

插件只处理语义错误，不解析平台错误码。

### 10.2 重试

- GET、429、5xx 可指数退避重试。
- 非幂等 POST/PATCH/PUT/DELETE 默认不自动重试，避免重复发送。
- 401 刷新 token 后重试一次。
- 超时默认 15 秒，可被单次请求覆盖。

### 10.3 限流

- HTTP Client 内按 endpoint 类别做简单令牌桶，避免瞬间并发打爆平台。
- 消息模块继续维护被动回复配额（群 5 分钟 5 次、单聊 60 分钟 4 次）。
- 主动消息不默认开放；调用时检查授权/额度，失败映射为 `QUOTA_EXCEEDED`。

### 10.4 日志

- 请求日志：method、path、status、耗时、错误码；不记录 Authorization、token、AppSecret。
- 消息日志：沿用现有“收到/已发送”格式。
- 事件日志：未知事件记录 `qq/raw-event` 类型。

## 11. 兼容与迁移

- `ctx.qq.send()` 保留，内部委托 `message.send` 的文本 c2c/group 场景。
- `qq/message` 保留 c2c/group 语义；新增 guild/dm 专用事件。
- echo 插件、runtime `createAdapter`、Worker 协议保持兼容。
- 包名仍为 `@arqqbot/adapter-qq`，模块化重构不改变外部 import 路径。
- 现有测试全部保留，新增能力测试不得破坏 echo 回归。

## 12. 测试与验收

### 12.1 单元

- 端点快照覆盖：47 个 HTTP、22 个事件。
- 路径参数替换、query 编码、body 构造。
- 能力注册表：环境、intents、不可用原因。
- intent 映射：名称 ↔ 位值唯一性。
- HTTP Client：鉴权、域名回退、401 刷新、429/5xx 重试、非幂等 POST 不重试。
- 错误映射：平台错误 → `QQApiError`。
- 每个模块至少一个代表性接口的请求/响应测试。
- 事件归一化：所有 22 类事件至少有 payload fixture。
- 被动回复配额与 msg_seq。

### 12.2 集成

- 假 Gateway 推送群 @、单聊、guild、interaction 事件，验证事件名称与 payload。
- 假 HTTP 服务验证 raw request、消息发送、媒体上传。
- echo 插件群聊/单聊回归。

### 12.3 验收

1. `capabilities.list()` 返回全部模块，端点总数与快照一致。
2. 任意 catalog 端点可通过对应模块方法调用，假 HTTP 收到预期 method/path/body。
3. `request()` 可调用未类型化路径，仍带鉴权与错误映射。
4. 沙箱实例启动、群 @ 收发、echo 回复不受影响。
5. 控制台“能力”页签能显示模块、端点数量与 intents 开关。
6. 无 Webhook 代码路径。

## 13. 风险

- **官方索引不完整**：快照只覆盖 2026-10-28 v2 索引；raw 兜底覆盖新增接口。
- **Guild 能力缺失**：当前索引没有频道消息发送等接口；类型化发送仅 c2c/group，guild/dm 发送走 raw 或等目录扩展。
- **权限不可预知**：静态能力表只能判断环境/intent，实际权限依赖平台，靠错误映射兜底。
- **模块数量大**：按模块拆分、每模块独立测试，避免单文件失控。
- **类型漂移**：所有请求/响应类型集中在 shared 或模块 types，端点目录变更时同步更新快照。

## 14. 附录：官方 v2 基线

### 14.1 HTTP 接口（47）

| 模块 | 接口 |
| --- | --- |
| 单聊消息 | DELETE `/v2/users/{user_openid}/messages/{message_id}`；POST `/v2/users/{user_openid}/messages`；POST `/v2/users/{user_openid}/stream_messages` |
| 群消息 | DELETE `/v2/groups/{group_openid}/messages/{message_id}`；POST `/v2/groups/{group_openid}/messages` |
| 富媒体 | POST `/v2/groups/{group_openid}/files`；POST `/v2/users/{user_openid}/files`；POST `/v2/groups/{group_id}/upload_prepare`；POST `/v2/users/{user_id}/upload_prepare`；POST `/v2/groups/{group_id}/upload_part_finish`；POST `/v2/users/{user_id}/upload_part_finish` |
| 菜单 | GET `/v2/menu`；PUT `/v2/menu` |
| 指令面板 | GET/POST `/v2/panels`；GET/PUT/DELETE `/v2/panels/{panel_id}`；PUT `/v2/panels/{panel_id}/target` |
| 互动 | PUT `/interactions/{interaction_id}` |
| 频道管理 | GET `/guilds/{guild_id}`；GET/POST `/guilds/{guild_id}/channels`；GET/PATCH/DELETE `/channels/{channel_id}` |
| 机器人 | GET `/users/@me`；GET `/users/@me/guilds`；GET `/gateway`；POST `/v2/generate_url_link` |
| 群信息 | GET `/v2/groups/{group_openid}/info`；GET `/v2/groups/{group_openid}/bot_state` |
| 群成员 | GET `/v2/groups/{group_openid}/members`；GET `/v2/groups/{group_openid}/members/{member_openid}`；POST `/v2/groups/{group_openid}/batch_remove_members` |
| 入群申请 | GET `/v2/groups/{group_openid}/join_request_list`；POST `/v2/groups/{group_openid}/approval_join_request/{member_openid}`；GET/POST `/v2/groups/join_approval_strategy`；PATCH/DELETE `/v2/groups/join_approval_strategy/{strategy_id}`；POST `/v2/groups/join_approval_strategy/{strategy_id}/execute`；POST `/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users` |
| 群黑名单 | GET/POST `/v2/groups/{group_openid}/member_blacklist` |
| 群禁言 | GET/POST `/v2/groups/{group_openid}/restrict_chat_setting` |

### 14.2 事件（22）

`INTERACTION_CREATE`、`SUBSCRIBE_MESSAGE_STATUS`、`FRIEND_ADD`、`FRIEND_DEL`、`C2C_MESSAGE_CREATE`、`C2C_MSG_RECEIVE`、`C2C_MSG_REJECT`、`GROUP_ADD_ROBOT`、`GROUP_DEL_ROBOT`、`GROUP_JOIN_REQUEST`、`GROUP_MSG_RECEIVE`、`GROUP_MSG_REJECT`、`GROUP_AT_MESSAGE_CREATE`、`GROUP_MESSAGE_CREATE`、`GROUP_MEMBER_ADD`、`GROUP_MEMBER_REMOVE`、`GUILD_CREATE`、`GUILD_UPDATE`、`GUILD_DELETE`、`CHANNEL_CREATE`、`CHANNEL_UPDATE`、`CHANNEL_DELETE`。

## 15. 参考

- 官方接口索引：https://bot.q.qq.com/wiki/develop/api-v2/autogen/
- 事件订阅：https://bot.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- 消息收发：https://bot.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
- 接口鉴权：https://bot.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
