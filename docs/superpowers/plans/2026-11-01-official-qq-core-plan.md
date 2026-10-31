# QQ 官方能力内核实施计划（Plan 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `@arqqbot/adapter-qq` 重构为 QQ 官方能力基座的第一阶段：端点目录、能力注册表、统一 HTTP 客户端、消息与富媒体模块、22 类事件归一化，并保持 `ctx.qq.send` 与 `qq/message` 完全兼容。

**Architecture:** 保留 `packages/adapter-qq`，内部按 `core` / `transport` / `modules` / `events` 分层。所有 HTTP 调用经过 `QQHttpClient`（鉴权、域名回退、重试、错误映射、日志），所有能力调用先经过 `QQCapabilityRegistry`，所有网关事件先进入 `QQEventRouter` 再归一化分发。

**Tech Stack:** TypeScript、Cordis 4、pnpm workspaces、Vitest 3、ws、Node 22。

**Spec:** `docs/superpowers/specs/2026-11-01-official-qq-capabilities-design.md`

**本计划范围：**
- 47 个官方 HTTP 端点的目录与快照（全部模块）。
- 22 个官方事件的事件目录、归一化与路由。
- 已实现类型化模块：`message`、`media`。
- 兼容层：`ctx.qq.send`、`qq/message`、echo 插件。
- `ctx.qq.request()`、`ctx.qq.capabilities`、`ctx.qq.getStats()`。

**不在本计划内（Plan 2）：** 群管理、频道、互动、菜单、面板、机器人模块的类型化方法；控制台“能力”页签与 intents 编辑 UI；实例 `instance.json` 的 intents 持久化。

**文件结构（本计划完成后）：**

```text
packages/shared/src/
├── types.ts                     # 扩展 QQMessage 场景与字段
├── qq.ts                        # 新增 QQ 官方能力公共类型
├── services.ts                  # 扩展 QQService 与 qq/* 事件声明
└── index.ts                     # 导出 qq.ts

packages/adapter-qq/src/
├── core/
│   ├── errors.ts                # QQApiError + HTTP 错误映射
│   ├── endpoint-catalog.ts      # 47 个 HTTP 端点目录
│   ├── capability-registry.ts   # 按环境与 intents 计算能力可用性
│   ├── http-client.ts           # 鉴权、重试、域名回退、错误映射、日志
│   └── intent-map.ts            # intent 名称 ↔ 位值
├── events/
│   ├── catalog.ts               # 22 个事件元数据
│   ├── normalize.ts             # 官方事件 → 统一事件
│   └── router.ts                # 原始事件 + 领域事件分发
├── modules/
│   ├── messages.ts              # 文本/markdown/ark/embed/富媒体/流式/撤回
│   └── media.ts                 # 直传/预上传/分片完成/分片编排
├── service.ts                   # ctx.qq 门面与网关集成
├── sender.ts                    # 兼容门面，内部委托 messages 模块
├── token.ts                     # 增加 invalidate()
└── gateway.ts                   # 增加 onClose 回调

docs/qq-api-v2-endpoints.json   # 47 HTTP + 22 事件快照
```

**测试命令：**

```bash
# 单文件
pnpm --filter @arqqbot/adapter-qq exec vitest run test/http-client.test.ts

# 适配器全量
pnpm --filter @arqqbot/adapter-qq test
pnpm --filter @arqqbot/adapter-qq typecheck

# 全仓回归
pnpm -r test
pnpm -r typecheck
```

---

## Task 1: 扩展 shared 契约

**Files:**
- Create: `packages/shared/src/qq.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/services.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/adapter-qq/src/log-format.ts`
- Modify: `packages/plugin-echo/src/index.ts`
- Modify: `packages/runtime/test/bootstrap.test.ts`

- [ ] **Step 1: 新建 QQ 公共类型**

写入 `packages/shared/src/qq.ts`：

```ts
import type { QQScene } from './types'

export type QQHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QQApiErrorCode =
  | 'UNAUTHORIZED'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'

export type QQIntentName =
  | 'public_messages'
  | 'interaction'
  | 'guilds'
  | 'guild_members'
  | 'guild_messages'
  | 'direct_message'

export type QQDomainEventName =
  | 'qq/raw-event'
  | 'qq/message'
  | 'qq/group-message'
  | 'qq/guild-message'
  | 'qq/dm-message'
  | 'qq/group-add'
  | 'qq/group-del'
  | 'qq/group-join-request'
  | 'qq/group-member-add'
  | 'qq/group-member-remove'
  | 'qq/group-msg-receive'
  | 'qq/group-msg-reject'
  | 'qq/friend-add'
  | 'qq/friend-del'
  | 'qq/c2c-msg-receive'
  | 'qq/c2c-msg-reject'
  | 'qq/interaction'
  | 'qq/subscribe-status'
  | 'qq/guild-create'
  | 'qq/guild-update'
  | 'qq/guild-delete'
  | 'qq/channel-create'
  | 'qq/channel-update'
  | 'qq/channel-delete'
  | 'qq/ready'
  | 'qq/error'
  | 'qq/disconnect'

export type QQSendTarget =
  | { scene: 'c2c'; userId: string }
  | { scene: 'group'; groupId: string }

export interface QQMarkdown {
  content: string
  [key: string]: unknown
}

export type QQKeyboard = Record<string, unknown>
export type QQArk = Record<string, unknown>
export type QQEmbed = Record<string, unknown>

export type QQMessageContent =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: QQMarkdown; keyboard?: QQKeyboard }
  | { type: 'ark'; ark: QQArk }
  | { type: 'embed'; embed: QQEmbed }
  | { type: 'media'; fileInfo: string }

export interface QQSendMessageInput {
  target: QQSendTarget
  content: QQMessageContent
  replyTo?: string
  eventId?: string
  msgSeq?: number
}

export interface QQStreamInput {
  target: QQSendTarget
  replyTo?: string
  eventId?: string
  msgSeq?: number
}

export interface QQStreamHandle {
  write(chunk: string): Promise<void>
  end(): Promise<void>
}

export interface QQSendResult {
  messageId?: string
}

export type QQMediaFileType = 1 | 2 | 3 | 4

export interface QQMediaUploadInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  url: string
  fileData?: string
}

export interface QQUploadedMedia {
  fileInfo: string
  fileUuid?: string
  ttl?: number
}

export interface QQUploadPrepareInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  fileName: string
  fileSize: number
  md5: string
  sha1: string
  md5_10m: string
}

export interface QQUploadPartSpec {
  index: number
  presignedUrl: string
  blockSize: number
}

export interface QQUploadSession {
  uploadId: string
  blockSize: number
  parts: QQUploadPartSpec[]
  raw: unknown
}

export interface QQUploadFinishInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  uploadId: string
}

export interface QQChunkedUploadInput extends QQUploadPrepareInput {
  chunks: Array<{ data: Uint8Array; md5: string }>
}

export interface QQRawRequest {
  method: QQHttpMethod
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface QQCapabilityInfo {
  id: string
  module: string
  available: boolean
  requiredIntents: string[]
  endpointCount: number
  reason?: string
}

export interface QQCapabilityRegistry {
  list(): QQCapabilityInfo[]
  has(id: string): boolean
}

export interface QQGroupLifecyclePayload {
  groupOpenid: string
  [key: string]: unknown
}

export interface QQGroupMemberPayload {
  groupOpenid: string
  memberOpenid: string
  [key: string]: unknown
}

export interface QQGroupJoinRequestPayload {
  groupOpenid: string
  memberOpenid?: string
  [key: string]: unknown
}

export interface QQMessageAuditPayload {
  groupOpenid?: string
  userId?: string
  messageId?: string
  [key: string]: unknown
}

export interface QQFriendPayload {
  userId: string
  [key: string]: unknown
}

export interface QQInteractionPayload {
  interactionId: string
  [key: string]: unknown
}

export type QQSubscribeStatusPayload = Record<string, unknown>

export interface QQGuildPayload {
  guildId: string
  [key: string]: unknown
}

export interface QQChannelPayload {
  guildId: string
  channelId: string
  [key: string]: unknown
}

export type QQMessageScene = QQScene
```

- [ ] **Step 2: 扩展 QQMessage**

修改 `packages/shared/src/types.ts`：在 `InstanceEnv` 下方新增场景类型，并把 `QQMessage` 的 `scene` 改为新类型、增加频道与作者字段。

```ts
export type InstanceEnv = 'sandbox' | 'production'

export type QQScene = 'c2c' | 'group' | 'guild' | 'dm'
```

把原 `QQMessage` 替换为：

```ts
export interface QQMessage {
  id: string
  scene: QQScene
  userId: string
  groupId?: string
  guildId?: string
  channelId?: string
  content: string
  mentions: string[]
  attachments: Array<{ contentType: string; url: string; filename?: string; size?: number }>
  timestamp: string
  author?: { id: string; name?: string; bot?: boolean }
  raw: unknown
}
```

- [ ] **Step 3: 适配日志场景与 echo 类型收窄**

修改 `packages/adapter-qq/src/log-format.ts` 的 `sceneLabel`：

```ts
export function sceneLabel(scene: QQMessage['scene']): string {
  if (scene === 'group') return '群聊'
  if (scene === 'c2c') return '单聊'
  if (scene === 'guild') return '频道'
  return '私信'
}
```

修改 `packages/plugin-echo/src/index.ts`，在读取 `targetId` 前收窄场景：

```ts
  ctx.on('qq/message', async (message: QQMessage) => {
    if (message.scene !== 'group' && message.scene !== 'c2c') return
    const targetId = message.scene === 'group' ? message.groupId : message.userId
```

其余代码不变。这样 `qq/message` 的运行时行为仍只覆盖 c2c/group，同时满足扩展后的 `QQScene` 类型。

- [ ] **Step 4: 扩展 QQService 与事件声明**

把 `packages/shared/src/services.ts` 替换为：

```ts
import type {} from 'cordis'
import type { QQMessage, QQSendInput, QQSendResult, QQStats } from './types'
import type {
  QQCapabilityRegistry,
  QQChannelPayload,
  QQChunkedUploadInput,
  QQFriendPayload,
  QQGuildPayload,
  QQGroupJoinRequestPayload,
  QQGroupLifecyclePayload,
  QQGroupMemberPayload,
  QQInteractionPayload,
  QQMediaUploadInput,
  QQMessageAuditPayload,
  QQMessageContent,
  QQUploadFinishInput,
  QQUploadPrepareInput,
  QQUploadSession,
  QQUploadedMedia,
  QQRawRequest,
  QQSendMessageInput,
  QQStreamHandle,
  QQStreamInput,
  QQSubscribeStatusPayload
} from './qq'

export interface QQService {
  send(input: QQSendInput): Promise<QQSendResult>
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
  request<T>(input: QQRawRequest): Promise<T>
  capabilities: QQCapabilityRegistry
  getStats(): QQStats
}

export interface StorageServiceContract {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

declare module 'cordis' {
  interface Events {
    'qq/message': (message: QQMessage) => void
    'qq/group-message': (message: QQMessage) => void
    'qq/guild-message': (message: QQMessage) => void
    'qq/dm-message': (message: QQMessage) => void
    'qq/raw-event': (event: { type: string; data: unknown }) => void
    'qq/group-add': (event: QQGroupLifecyclePayload) => void
    'qq/group-del': (event: QQGroupLifecyclePayload) => void
    'qq/group-join-request': (event: QQGroupJoinRequestPayload) => void
    'qq/group-member-add': (event: QQGroupMemberPayload) => void
    'qq/group-member-remove': (event: QQGroupMemberPayload) => void
    'qq/group-msg-receive': (event: QQMessageAuditPayload) => void
    'qq/group-msg-reject': (event: QQMessageAuditPayload) => void
    'qq/friend-add': (event: QQFriendPayload) => void
    'qq/friend-del': (event: QQFriendPayload) => void
    'qq/c2c-msg-receive': (event: QQMessageAuditPayload) => void
    'qq/c2c-msg-reject': (event: QQMessageAuditPayload) => void
    'qq/interaction': (event: QQInteractionPayload) => void
    'qq/subscribe-status': (event: QQSubscribeStatusPayload) => void
    'qq/guild-create': (event: QQGuildPayload) => void
    'qq/guild-update': (event: QQGuildPayload) => void
    'qq/guild-delete': (event: QQGuildPayload) => void
    'qq/channel-create': (event: QQChannelPayload) => void
    'qq/channel-update': (event: QQChannelPayload) => void
    'qq/channel-delete': (event: QQChannelPayload) => void
    'qq/ready': () => void
    'qq/error': (error: Error) => void
    'qq/disconnect': () => void
  }

  interface Context {
    qq: QQService
    storage: StorageServiceContract
  }
}
```

- [ ] **Step 5: 导出 qq 类型**

修改 `packages/shared/src/index.ts`：

```ts
export * from './types'
export * from './qq'
export * from './services'
export * from './ipc'
export * from './manifest'
export * from './config'
export * from './catalog'
export * from './api'
```

- [ ] **Step 6: 更新 runtime 测试中的 QQService mock**

修改 `packages/runtime/test/bootstrap.test.ts`，把 `const service: QQService = { ... }` 整段替换为：

```ts
    const service: QQService = {
      send: vi.fn(async () => ({})),
      message: {
        send: vi.fn(async () => ({})),
        reply: vi.fn(async () => ({})),
        sendStream: vi.fn(async () => ({
          write: async () => undefined,
          end: async () => undefined
        })),
        recall: vi.fn(async () => undefined)
      },
      media: {
        upload: vi.fn(async () => ({ fileInfo: '' })),
        uploadChunked: vi.fn(async () => ({ fileInfo: '' })),
        prepareUpload: vi.fn(async () => ({
          uploadId: '',
          blockSize: 0,
          parts: [],
          raw: {}
        })),
        finishUpload: vi.fn(async () => ({ fileInfo: '' }))
      },
      request: vi.fn() as unknown as QQService['request'],
      capabilities: {
        list: () => [],
        has: () => false
      },
      getStats: () => ({ connected: true, received: 1, sent: 0 })
    }
```

- [ ] **Step 7: 运行类型检查与 runtime 测试**

```bash
pnpm --filter @arqqbot/shared typecheck
pnpm --filter @arqqbot/adapter-qq typecheck
pnpm --filter @arqqbot/runtime test
```

预期：全部通过。`adapter-qq` 此时尚未实现新接口，`service.ts` 会报 `QQAdapter` 缺少 `message` / `media` / `request` / `capabilities`。如果出现这些错误，先继续 Task 2，Task 12 完成后再跑适配器类型检查；runtime 测试必须通过。

- [ ] **Step 8: 提交**

```bash
git add packages/shared/src/qq.ts packages/shared/src/types.ts packages/shared/src/services.ts packages/shared/src/index.ts packages/adapter-qq/src/log-format.ts packages/plugin-echo/src/index.ts packages/runtime/test/bootstrap.test.ts
git commit -m "feat(shared): 扩展 QQ 官方能力契约与事件类型"
```

---

## Task 2: 统一错误模型与 token 失效

**Files:**
- Create: `packages/adapter-qq/src/core/errors.ts`
- Create: `packages/adapter-qq/test/errors.test.ts`
- Modify: `packages/adapter-qq/src/token.ts`
- Modify: `packages/adapter-qq/test/token.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/errors.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QQApiError, mapHttpError } from '../src/core/errors'

describe('QQApiError', () => {
  it('保留错误码与元数据', () => {
    const error = new QQApiError('BAD_REQUEST', '参数错误', {
      status: 400,
      endpointId: 'group.message.send'
    })
    expect(error.name).toBe('QQApiError')
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.meta).toEqual({ status: 400, endpointId: 'group.message.send' })
  })
})

describe('mapHttpError', () => {
  it('401 映射为 UNAUTHORIZED', () => {
    const error = mapHttpError(401, { err_code: 11251, message: 'token 无效' }, 'c2c.message.send')
    expect(error.code).toBe('UNAUTHORIZED')
    expect(error.meta.status).toBe(401)
    expect(error.meta.platformCode).toBe('11251')
    expect(error.message).toContain('token 无效')
  })

  it('403/404/429/5xx 映射到语义错误', () => {
    expect(mapHttpError(403, {}).code).toBe('PERMISSION_DENIED')
    expect(mapHttpError(404, {}).code).toBe('NOT_FOUND')
    expect(mapHttpError(429, {}).code).toBe('RATE_LIMITED')
    expect(mapHttpError(500, {}).code).toBe('SERVER_ERROR')
    expect(mapHttpError(400, {}).code).toBe('BAD_REQUEST')
  })

  it('平台错误码优先于 HTTP 状态', () => {
    expect(mapHttpError(400, { err_code: 22009, message: 'msg limit exceed' }).code).toBe(
      'QUOTA_EXCEEDED'
    )
    expect(mapHttpError(400, { err_code: 11282 }).code).toBe('PERMISSION_DENIED')
  })

  it('兼容 code 字段与空响应体', () => {
    expect(mapHttpError(400, { code: 22009 }).code).toBe('QUOTA_EXCEEDED')
    expect(mapHttpError(500, undefined).message).toContain('500')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/errors.test.ts
```

预期：FAIL，提示无法找到 `../src/core/errors`。

- [ ] **Step 3: 实现错误模型**

新建 `packages/adapter-qq/src/core/errors.ts`：

```ts
import type { QQApiErrorCode } from '@arqqbot/shared'

export interface QQApiErrorMeta {
  status?: number
  platformCode?: string
  endpointId?: string
}

export class QQApiError extends Error {
  readonly code: QQApiErrorCode
  readonly meta: QQApiErrorMeta

  constructor(code: QQApiErrorCode, message: string, meta: QQApiErrorMeta = {}) {
    super(message)
    this.name = 'QQApiError'
    this.code = code
    this.meta = meta
  }
}

const PLATFORM_CODE_MAP: Record<string, QQApiErrorCode> = {
  '22009': 'QUOTA_EXCEEDED',
  '11251': 'UNAUTHORIZED',
  '11253': 'PERMISSION_DENIED',
  '11282': 'PERMISSION_DENIED'
}

function mapStatus(status: number): QQApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return 'BAD_REQUEST'
}

export function mapHttpError(status: number, body: unknown, endpointId?: string): QQApiError {
  const record =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const rawCode = record.err_code ?? record.code
  const platformCode = rawCode === undefined ? undefined : String(rawCode)
  const rawMessage = record.message ?? record.msg
  const message = typeof rawMessage === 'string' ? rawMessage : `HTTP ${status}`
  const code = platformCode ? PLATFORM_CODE_MAP[platformCode] ?? mapStatus(status) : mapStatus(status)
  const detail = platformCode ? `${status} (${platformCode})：${message}` : `${status}：${message}`

  return new QQApiError(code, `QQ API ${detail}`, {
    status,
    ...(platformCode ? { platformCode } : {}),
    ...(endpointId ? { endpointId } : {})
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/errors.test.ts
```

预期：PASS。

- [ ] **Step 5: 写 token 失效测试**

在 `packages/adapter-qq/test/token.test.ts` 的 `describe('TokenManager')` 内追加：

```ts
  it('invalidate 后重新获取 token', async () => {
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0
    })

    expect(await manager.get()).toBe('token-1')
    manager.invalidate()
    expect(await manager.get()).toBe('token-2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 6: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/token.test.ts
```

预期：FAIL，`manager.invalidate is not a function`。

- [ ] **Step 7: 实现 invalidate**

在 `packages/adapter-qq/src/token.ts` 的 `get()` 方法上方新增：

```ts
  invalidate(): void {
    this.state = undefined
  }
```

- [ ] **Step 8: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/token.test.ts test/errors.test.ts
pnpm --filter @arqqbot/adapter-qq typecheck
```

预期：PASS。

- [ ] **Step 9: 提交**

```bash
git add packages/adapter-qq/src/core/errors.ts packages/adapter-qq/test/errors.test.ts packages/adapter-qq/src/token.ts packages/adapter-qq/test/token.test.ts
git commit -m "feat(adapter-qq): 增加统一错误模型与 token 失效"
```

---

## Task 3: intent 映射

**Files:**
- Create: `packages/adapter-qq/src/core/intent-map.ts`
- Create: `packages/adapter-qq/test/intent-map.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/intent-map.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { QQIntentName } from '@arqqbot/shared'
import {
  DEFAULT_INTENTS,
  QQ_INTENT_BITS,
  decodeIntents,
  hasIntents,
  resolveIntents
} from '../src/core/intent-map'

describe('intent-map', () => {
  it('位值唯一且默认只开启群聊/单聊消息', () => {
    const bits = Object.values(QQ_INTENT_BITS)
    expect(new Set(bits).size).toBe(bits.length)
    expect(resolveIntents(DEFAULT_INTENTS)).toBe(1 << 25)
  })

  it('名称与位掩码可往返', () => {
    const names: QQIntentName[] = ['guilds', 'public_messages', 'interaction']
    const mask = resolveIntents(names)
    expect(decodeIntents(mask).sort()).toEqual([...names].sort())
  })

  it('hasIntents 检查全部必需 intent', () => {
    const mask = resolveIntents(['public_messages'])
    expect(hasIntents(mask, ['public_messages'])).toBe(true)
    expect(hasIntents(mask, ['public_messages', 'interaction'])).toBe(false)
  })

  it('未知 intent 抛出错误', () => {
    expect(() => resolveIntents(['unknown' as QQIntentName])).toThrow('未知 intent')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/intent-map.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 intent 映射**

新建 `packages/adapter-qq/src/core/intent-map.ts`：

```ts
import type { QQIntentName } from '@arqqbot/shared'

export const QQ_INTENT_BITS: Record<QQIntentName, number> = {
  guilds: 1 << 0,
  guild_members: 1 << 1,
  guild_messages: 1 << 9,
  direct_message: 1 << 12,
  public_messages: 1 << 25,
  interaction: 1 << 26
}

export const DEFAULT_INTENTS: QQIntentName[] = ['public_messages']

export function resolveIntents(names: QQIntentName[]): number {
  return names.reduce((mask, name) => {
    const bit = QQ_INTENT_BITS[name]
    if (bit === undefined) throw new Error(`未知 intent：${name}`)
    return mask | bit
  }, 0)
}

export function decodeIntents(mask: number): QQIntentName[] {
  return (Object.keys(QQ_INTENT_BITS) as QQIntentName[]).filter(
    (name) => (mask & QQ_INTENT_BITS[name]) !== 0
  )
}

export function hasIntents(mask: number, required: QQIntentName[]): boolean {
  return required.every((name) => (mask & (QQ_INTENT_BITS[name] ?? 0)) !== 0)
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/intent-map.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/core/intent-map.ts packages/adapter-qq/test/intent-map.test.ts
git commit -m "feat(adapter-qq): 增加 intent 名称与位值映射"
```

---

## Task 4: HTTP 端点目录与 47 条快照

**Files:**
- Create: `docs/qq-api-v2-endpoints.json`
- Create: `packages/adapter-qq/src/core/endpoint-catalog.ts`
- Create: `packages/adapter-qq/test/endpoint-catalog.test.ts`

- [ ] **Step 1: 写入端点快照**

新建 `docs/qq-api-v2-endpoints.json`。该文件同时容纳 HTTP 与事件快照，事件数组在 Task 5 使用。

```json
{
  "source": "https://bot.q.qq.com/wiki/develop/api-v2/autogen/",
  "capturedAt": "2026-10-28",
  "http": [
    {"id":"c2c.message.send","method":"POST","path":"/v2/users/{user_openid}/messages","category":"message","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html"},
    {"id":"c2c.message.recall","method":"DELETE","path":"/v2/users/{user_openid}/messages/{message_id}","category":"message","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages_message_id.delete.html"},
    {"id":"c2c.message.stream","method":"POST","path":"/v2/users/{user_openid}/stream_messages","category":"message","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_stream_messages.post.html"},
    {"id":"group.message.send","method":"POST","path":"/v2/groups/{group_openid}/messages","category":"message","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html"},
    {"id":"group.message.recall","method":"DELETE","path":"/v2/groups/{group_openid}/messages/{message_id}","category":"message","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages_message_id.delete.html"},
    {"id":"c2c.media.upload","method":"POST","path":"/v2/users/{user_openid}/files","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html"},
    {"id":"group.media.upload","method":"POST","path":"/v2/groups/{group_openid}/files","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html"},
    {"id":"c2c.media.prepare","method":"POST","path":"/v2/users/{user_id}/upload_prepare","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html"},
    {"id":"group.media.prepare","method":"POST","path":"/v2/groups/{group_id}/upload_prepare","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html"},
    {"id":"c2c.media.partFinish","method":"POST","path":"/v2/users/{user_id}/upload_part_finish","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_part_finish.post.html"},
    {"id":"group.media.partFinish","method":"POST","path":"/v2/groups/{group_id}/upload_part_finish","category":"media","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html"},
    {"id":"menu.get","method":"GET","path":"/v2/menu","category":"menu","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_menu.get.html"},
    {"id":"menu.set","method":"PUT","path":"/v2/menu","category":"menu","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_menu.put.html"},
    {"id":"panels.list","method":"GET","path":"/v2/panels","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels.get.html"},
    {"id":"panels.create","method":"POST","path":"/v2/panels","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels.post.html"},
    {"id":"panels.get","method":"GET","path":"/v2/panels/{panel_id}","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels_panel_id.get.html"},
    {"id":"panels.update","method":"PUT","path":"/v2/panels/{panel_id}","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels_panel_id.put.html"},
    {"id":"panels.delete","method":"DELETE","path":"/v2/panels/{panel_id}","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels_panel_id.delete.html"},
    {"id":"panels.target","method":"PUT","path":"/v2/panels/{panel_id}/target","category":"panels","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels_panel_id_target.put.html"},
    {"id":"interaction.respond","method":"PUT","path":"/interactions/{interaction_id}","category":"interaction","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/interactions_interaction_id.put.html"},
    {"id":"guild.get","method":"GET","path":"/guilds/{guild_id}","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/guilds_guild_id.get.html"},
    {"id":"guild.channels.list","method":"GET","path":"/guilds/{guild_id}/channels","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/guilds_guild_id_channels.get.html"},
    {"id":"guild.channels.create","method":"POST","path":"/guilds/{guild_id}/channels","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/guilds_guild_id_channels.post.html"},
    {"id":"guild.channel.get","method":"GET","path":"/channels/{channel_id}","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/channels_channel_id.get.html"},
    {"id":"guild.channel.update","method":"PATCH","path":"/channels/{channel_id}","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/channels_channel_id.patch.html"},
    {"id":"guild.channel.delete","method":"DELETE","path":"/channels/{channel_id}","category":"guild","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/channels_channel_id.delete.html"},
    {"id":"bot.me","method":"GET","path":"/users/@me","category":"bot","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/users_me.get.html"},
    {"id":"bot.guilds","method":"GET","path":"/users/@me/guilds","category":"bot","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/users_me_guilds.get.html"},
    {"id":"bot.gateway","method":"GET","path":"/gateway","category":"bot","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/gateway.get.html"},
    {"id":"bot.urlLink","method":"POST","path":"/v2/generate_url_link","category":"bot","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_generate_url_link.post.html"},
    {"id":"group.info","method":"GET","path":"/v2/groups/{group_openid}/info","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_info.get.html"},
    {"id":"group.botState","method":"GET","path":"/v2/groups/{group_openid}/bot_state","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html"},
    {"id":"group.members.list","method":"GET","path":"/v2/groups/{group_openid}/members","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members.get.html"},
    {"id":"group.members.get","method":"GET","path":"/v2/groups/{group_openid}/members/{member_openid}","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members_member_openid.get.html"},
    {"id":"group.members.remove","method":"POST","path":"/v2/groups/{group_openid}/batch_remove_members","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_batch_remove_members.post.html"},
    {"id":"group.joinRequests.list","method":"GET","path":"/v2/groups/{group_openid}/join_request_list","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_join_request_list.get.html"},
    {"id":"group.joinRequests.approve","method":"POST","path":"/v2/groups/{group_openid}/approval_join_request/{member_openid}","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_approval_join_request_member_openid.post.html"},
    {"id":"group.joinStrategies.list","method":"GET","path":"/v2/groups/join_approval_strategy","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy.get.html"},
    {"id":"group.joinStrategies.create","method":"POST","path":"/v2/groups/join_approval_strategy","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy.post.html"},
    {"id":"group.joinStrategies.update","method":"PATCH","path":"/v2/groups/join_approval_strategy/{strategy_id}","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy_strategy_id.patch.html"},
    {"id":"group.joinStrategies.delete","method":"DELETE","path":"/v2/groups/join_approval_strategy/{strategy_id}","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy_strategy_id.delete.html"},
    {"id":"group.joinStrategies.execute","method":"POST","path":"/v2/groups/join_approval_strategy/{strategy_id}/execute","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy_strategy_id_execute.post.html"},
    {"id":"group.joinStrategies.whitelist","method":"POST","path":"/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_join_approval_strategy_strategy_id_whitelist_users.post.html"},
    {"id":"group.blacklist.list","method":"GET","path":"/v2/groups/{group_openid}/member_blacklist","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.get.html"},
    {"id":"group.blacklist.update","method":"POST","path":"/v2/groups/{group_openid}/member_blacklist","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.post.html"},
    {"id":"group.mute.get","method":"GET","path":"/v2/groups/{group_openid}/restrict_chat_setting","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_restrict_chat_setting.get.html"},
    {"id":"group.mute.set","method":"POST","path":"/v2/groups/{group_openid}/restrict_chat_setting","category":"group","docsUrl":"https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_restrict_chat_setting.post.html"}
  ],
  "events": [
    {"type":"INTERACTION_CREATE","intent":"interaction"},
    {"type":"SUBSCRIBE_MESSAGE_STATUS","intent":"interaction"},
    {"type":"FRIEND_ADD","intent":"public_messages"},
    {"type":"FRIEND_DEL","intent":"public_messages"},
    {"type":"C2C_MESSAGE_CREATE","intent":"public_messages"},
    {"type":"C2C_MSG_RECEIVE","intent":"public_messages"},
    {"type":"C2C_MSG_REJECT","intent":"public_messages"},
    {"type":"GROUP_ADD_ROBOT","intent":"public_messages"},
    {"type":"GROUP_DEL_ROBOT","intent":"public_messages"},
    {"type":"GROUP_JOIN_REQUEST","intent":"public_messages"},
    {"type":"GROUP_MSG_RECEIVE","intent":"public_messages"},
    {"type":"GROUP_MSG_REJECT","intent":"public_messages"},
    {"type":"GROUP_AT_MESSAGE_CREATE","intent":"public_messages"},
    {"type":"GROUP_MESSAGE_CREATE","intent":"public_messages"},
    {"type":"GROUP_MEMBER_ADD","intent":"public_messages"},
    {"type":"GROUP_MEMBER_REMOVE","intent":"public_messages"},
    {"type":"GUILD_CREATE","intent":"guilds"},
    {"type":"GUILD_UPDATE","intent":"guilds"},
    {"type":"GUILD_DELETE","intent":"guilds"},
    {"type":"CHANNEL_CREATE","intent":"guilds"},
    {"type":"CHANNEL_UPDATE","intent":"guilds"},
    {"type":"CHANNEL_DELETE","intent":"guilds"}
  ]
}
```

- [ ] **Step 2: 写失败测试**

新建 `packages/adapter-qq/test/endpoint-catalog.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QQ_ENDPOINTS, buildPath } from '../src/core/endpoint-catalog'

interface SnapshotEntry {
  id: string
  method: string
  path: string
  category: string
  docsUrl: string
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../../docs/qq-api-v2-endpoints.json', import.meta.url), 'utf8')
) as { http: SnapshotEntry[] }

describe('QQ 端点目录', () => {
  it('快照包含 47 个 HTTP 接口', () => {
    expect(snapshot.http).toHaveLength(47)
    expect(new Set(snapshot.http.map((entry) => entry.id)).size).toBe(47)
  })

  it('快照与目录双向一致', () => {
    expect(QQ_ENDPOINTS).toHaveLength(47)
    expect(new Set(QQ_ENDPOINTS.map((endpoint) => endpoint.id)).size).toBe(47)

    for (const entry of snapshot.http) {
      const endpoint = QQ_ENDPOINTS.find((item) => item.id === entry.id)
      expect(endpoint, `快照端点缺少目录定义：${entry.id}`).toBeTruthy()
      expect(endpoint).toMatchObject({
        method: entry.method,
        path: entry.path,
        category: entry.category,
        docsUrl: entry.docsUrl
      })
    }

    for (const endpoint of QQ_ENDPOINTS) {
      expect(
        snapshot.http.some((entry) => entry.id === endpoint.id),
        `目录端点未写入快照：${endpoint.id}`
      ).toBe(true)
    }
  })

  it('路径参数替换并编码', () => {
    expect(
      buildPath('/v2/groups/{group_openid}/members/{member_openid}', {
        group_openid: 'g 1',
        member_openid: 'm/1'
      })
    ).toBe('/v2/groups/g%201/members/m%2F1')
  })

  it('缺少路径参数抛出 BAD_REQUEST', () => {
    expect(() => buildPath('/v2/groups/{group_openid}/info', {})).toThrow('缺少路径参数')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/endpoint-catalog.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 4: 实现端点目录**

新建 `packages/adapter-qq/src/core/endpoint-catalog.ts`：

```ts
import type { InstanceEnv, QQHttpMethod, QQIntentName } from '@arqqbot/shared'
import { QQApiError } from './errors'

export type QQModuleName =
  | 'message'
  | 'media'
  | 'menu'
  | 'panels'
  | 'interaction'
  | 'guild'
  | 'bot'
  | 'group'

export interface QQEndpointSpec {
  id: string
  method: QQHttpMethod
  path: string
  module: QQModuleName
  category: string
  capability: string
  environments: InstanceEnv[]
  requiredIntents: QQIntentName[]
  idempotent: boolean
  docsUrl: string
}

function docsSlug(path: string): string {
  return path
    .replace(/^\//, '')
    .replace(/[{}]/g, '')
    .replace(/@/g, '')
    .replace(/\//g, '_')
}

export function docsUrlFor(method: QQHttpMethod, path: string): string {
  return `https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/${docsSlug(path)}.${method.toLowerCase()}.html`
}

interface EndpointSeed {
  id: string
  method: QQHttpMethod
  path: string
  module: QQModuleName
  capability: string
  requiredIntents: QQIntentName[]
}

const ENDPOINT_SEEDS: EndpointSeed[] = [
  { id: 'c2c.message.send', method: 'POST', path: '/v2/users/{user_openid}/messages', module: 'message', capability: 'message.send', requiredIntents: [] },
  { id: 'c2c.message.recall', method: 'DELETE', path: '/v2/users/{user_openid}/messages/{message_id}', module: 'message', capability: 'message.recall', requiredIntents: [] },
  { id: 'c2c.message.stream', method: 'POST', path: '/v2/users/{user_openid}/stream_messages', module: 'message', capability: 'message.stream', requiredIntents: [] },
  { id: 'group.message.send', method: 'POST', path: '/v2/groups/{group_openid}/messages', module: 'message', capability: 'message.send', requiredIntents: [] },
  { id: 'group.message.recall', method: 'DELETE', path: '/v2/groups/{group_openid}/messages/{message_id}', module: 'message', capability: 'message.recall', requiredIntents: [] },
  { id: 'c2c.media.upload', method: 'POST', path: '/v2/users/{user_openid}/files', module: 'media', capability: 'media.upload', requiredIntents: ['public_messages'] },
  { id: 'group.media.upload', method: 'POST', path: '/v2/groups/{group_openid}/files', module: 'media', capability: 'media.upload', requiredIntents: ['public_messages'] },
  { id: 'c2c.media.prepare', method: 'POST', path: '/v2/users/{user_id}/upload_prepare', module: 'media', capability: 'media.prepareUpload', requiredIntents: ['public_messages'] },
  { id: 'group.media.prepare', method: 'POST', path: '/v2/groups/{group_id}/upload_prepare', module: 'media', capability: 'media.prepareUpload', requiredIntents: ['public_messages'] },
  { id: 'c2c.media.partFinish', method: 'POST', path: '/v2/users/{user_id}/upload_part_finish', module: 'media', capability: 'media.uploadPart', requiredIntents: ['public_messages'] },
  { id: 'group.media.partFinish', method: 'POST', path: '/v2/groups/{group_id}/upload_part_finish', module: 'media', capability: 'media.uploadPart', requiredIntents: ['public_messages'] },
  { id: 'menu.get', method: 'GET', path: '/v2/menu', module: 'menu', capability: 'menu.get', requiredIntents: [] },
  { id: 'menu.set', method: 'PUT', path: '/v2/menu', module: 'menu', capability: 'menu.set', requiredIntents: [] },
  { id: 'panels.list', method: 'GET', path: '/v2/panels', module: 'panels', capability: 'panels.list', requiredIntents: [] },
  { id: 'panels.create', method: 'POST', path: '/v2/panels', module: 'panels', capability: 'panels.create', requiredIntents: [] },
  { id: 'panels.get', method: 'GET', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.get', requiredIntents: [] },
  { id: 'panels.update', method: 'PUT', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.update', requiredIntents: [] },
  { id: 'panels.delete', method: 'DELETE', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.delete', requiredIntents: [] },
  { id: 'panels.target', method: 'PUT', path: '/v2/panels/{panel_id}/target', module: 'panels', capability: 'panels.target', requiredIntents: [] },
  { id: 'interaction.respond', method: 'PUT', path: '/interactions/{interaction_id}', module: 'interaction', capability: 'interaction.respond', requiredIntents: ['interaction'] },
  { id: 'guild.get', method: 'GET', path: '/guilds/{guild_id}', module: 'guild', capability: 'guild.get', requiredIntents: ['guilds'] },
  { id: 'guild.channels.list', method: 'GET', path: '/guilds/{guild_id}/channels', module: 'guild', capability: 'guild.channels.list', requiredIntents: ['guilds'] },
  { id: 'guild.channels.create', method: 'POST', path: '/guilds/{guild_id}/channels', module: 'guild', capability: 'guild.channels.create', requiredIntents: ['guilds'] },
  { id: 'guild.channel.get', method: 'GET', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.get', requiredIntents: ['guilds'] },
  { id: 'guild.channel.update', method: 'PATCH', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.update', requiredIntents: ['guilds'] },
  { id: 'guild.channel.delete', method: 'DELETE', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.delete', requiredIntents: ['guilds'] },
  { id: 'bot.me', method: 'GET', path: '/users/@me', module: 'bot', capability: 'bot.me', requiredIntents: [] },
  { id: 'bot.guilds', method: 'GET', path: '/users/@me/guilds', module: 'bot', capability: 'bot.guilds', requiredIntents: ['guilds'] },
  { id: 'bot.gateway', method: 'GET', path: '/gateway', module: 'bot', capability: 'bot.gateway', requiredIntents: [] },
  { id: 'bot.urlLink', method: 'POST', path: '/v2/generate_url_link', module: 'bot', capability: 'bot.urlLink', requiredIntents: [] },
  { id: 'group.info', method: 'GET', path: '/v2/groups/{group_openid}/info', module: 'group', capability: 'group.info', requiredIntents: ['public_messages'] },
  { id: 'group.botState', method: 'GET', path: '/v2/groups/{group_openid}/bot_state', module: 'group', capability: 'group.botState', requiredIntents: ['public_messages'] },
  { id: 'group.members.list', method: 'GET', path: '/v2/groups/{group_openid}/members', module: 'group', capability: 'group.members.list', requiredIntents: ['public_messages'] },
  { id: 'group.members.get', method: 'GET', path: '/v2/groups/{group_openid}/members/{member_openid}', module: 'group', capability: 'group.members.get', requiredIntents: ['public_messages'] },
  { id: 'group.members.remove', method: 'POST', path: '/v2/groups/{group_openid}/batch_remove_members', module: 'group', capability: 'group.members.remove', requiredIntents: ['public_messages'] },
  { id: 'group.joinRequests.list', method: 'GET', path: '/v2/groups/{group_openid}/join_request_list', module: 'group', capability: 'group.joinRequests.list', requiredIntents: ['public_messages'] },
  { id: 'group.joinRequests.approve', method: 'POST', path: '/v2/groups/{group_openid}/approval_join_request/{member_openid}', module: 'group', capability: 'group.joinRequests.approve', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.list', method: 'GET', path: '/v2/groups/join_approval_strategy', module: 'group', capability: 'group.joinStrategies.list', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.create', method: 'POST', path: '/v2/groups/join_approval_strategy', module: 'group', capability: 'group.joinStrategies.create', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.update', method: 'PATCH', path: '/v2/groups/join_approval_strategy/{strategy_id}', module: 'group', capability: 'group.joinStrategies.update', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.delete', method: 'DELETE', path: '/v2/groups/join_approval_strategy/{strategy_id}', module: 'group', capability: 'group.joinStrategies.delete', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.execute', method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/execute', module: 'group', capability: 'group.joinStrategies.execute', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.whitelist', method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users', module: 'group', capability: 'group.joinStrategies.whitelist', requiredIntents: ['public_messages'] },
  { id: 'group.blacklist.list', method: 'GET', path: '/v2/groups/{group_openid}/member_blacklist', module: 'group', capability: 'group.blacklist.list', requiredIntents: ['public_messages'] },
  { id: 'group.blacklist.update', method: 'POST', path: '/v2/groups/{group_openid}/member_blacklist', module: 'group', capability: 'group.blacklist.update', requiredIntents: ['public_messages'] },
  { id: 'group.mute.get', method: 'GET', path: '/v2/groups/{group_openid}/restrict_chat_setting', module: 'group', capability: 'group.mute.get', requiredIntents: ['public_messages'] },
  { id: 'group.mute.set', method: 'POST', path: '/v2/groups/{group_openid}/restrict_chat_setting', module: 'group', capability: 'group.mute.set', requiredIntents: ['public_messages'] }
]

export const QQ_ENDPOINTS: QQEndpointSpec[] = ENDPOINT_SEEDS.map((seed) => ({
  ...seed,
  category: seed.module,
  environments: ['sandbox', 'production'] satisfies InstanceEnv[],
  idempotent: seed.method === 'GET',
  docsUrl: docsUrlFor(seed.method, seed.path)
}))

const ENDPOINTS_BY_ID = new Map(QQ_ENDPOINTS.map((endpoint) => [endpoint.id, endpoint]))

export function findEndpoint(id: string): QQEndpointSpec {
  const endpoint = ENDPOINTS_BY_ID.get(id)
  if (!endpoint) throw new QQApiError('CAPABILITY_UNAVAILABLE', `端点未收录：${id}`)
  return endpoint
}

export function listEndpoints(module?: QQModuleName): QQEndpointSpec[] {
  return module ? QQ_ENDPOINTS.filter((endpoint) => endpoint.module === module) : QQ_ENDPOINTS
}

export function buildPath(
  pattern: string,
  params: Record<string, string | number> = {}
): string {
  return pattern.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new QQApiError('BAD_REQUEST', `缺少路径参数：${name}`)
    }
    return encodeURIComponent(String(value))
  })
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/endpoint-catalog.test.ts
```

预期：PASS，47 条快照与目录双向一致。

- [ ] **Step 6: 提交**

```bash
git add docs/qq-api-v2-endpoints.json packages/adapter-qq/src/core/endpoint-catalog.ts packages/adapter-qq/test/endpoint-catalog.test.ts
git commit -m "feat(adapter-qq): 增加官方端点目录与 47 条快照"
```

---

## Task 5: 22 个事件元数据

**Files:**
- Create: `packages/adapter-qq/src/events/catalog.ts`
- Create: `packages/adapter-qq/test/event-catalog.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/event-catalog.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QQ_EVENTS } from '../src/events/catalog'

interface EventSnapshotEntry {
  type: string
  intent: string
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../../docs/qq-api-v2-endpoints.json', import.meta.url), 'utf8')
) as { events: EventSnapshotEntry[] }

describe('QQ 事件目录', () => {
  it('快照包含 22 个事件', () => {
    expect(snapshot.events).toHaveLength(22)
    expect(new Set(snapshot.events.map((entry) => entry.type)).size).toBe(22)
  })

  it('事件目录与快照双向一致', () => {
    expect(QQ_EVENTS).toHaveLength(22)
    expect(new Set(QQ_EVENTS.map((event) => event.type)).size).toBe(22)

    for (const entry of snapshot.events) {
      const event = QQ_EVENTS.find((item) => item.type === entry.type)
      expect(event, `快照事件缺少目录定义：${entry.type}`).toBeTruthy()
      expect(event).toMatchObject({ intent: entry.intent })
    }

    for (const event of QQ_EVENTS) {
      expect(
        snapshot.events.some((entry) => entry.type === event.type),
        `目录事件未写入快照：${event.type}`
      ).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-catalog.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现事件目录**

新建 `packages/adapter-qq/src/events/catalog.ts`：

```ts
import type { InstanceEnv, QQIntentName } from '@arqqbot/shared'

export interface QQEventSpec {
  type: string
  intent: QQIntentName
  environments: InstanceEnv[]
}

const EVENT_SEEDS: Array<[string, QQIntentName]> = [
  ['INTERACTION_CREATE', 'interaction'],
  ['SUBSCRIBE_MESSAGE_STATUS', 'interaction'],
  ['FRIEND_ADD', 'public_messages'],
  ['FRIEND_DEL', 'public_messages'],
  ['C2C_MESSAGE_CREATE', 'public_messages'],
  ['C2C_MSG_RECEIVE', 'public_messages'],
  ['C2C_MSG_REJECT', 'public_messages'],
  ['GROUP_ADD_ROBOT', 'public_messages'],
  ['GROUP_DEL_ROBOT', 'public_messages'],
  ['GROUP_JOIN_REQUEST', 'public_messages'],
  ['GROUP_MSG_RECEIVE', 'public_messages'],
  ['GROUP_MSG_REJECT', 'public_messages'],
  ['GROUP_AT_MESSAGE_CREATE', 'public_messages'],
  ['GROUP_MESSAGE_CREATE', 'public_messages'],
  ['GROUP_MEMBER_ADD', 'public_messages'],
  ['GROUP_MEMBER_REMOVE', 'public_messages'],
  ['GUILD_CREATE', 'guilds'],
  ['GUILD_UPDATE', 'guilds'],
  ['GUILD_DELETE', 'guilds'],
  ['CHANNEL_CREATE', 'guilds'],
  ['CHANNEL_UPDATE', 'guilds'],
  ['CHANNEL_DELETE', 'guilds']
]

export const QQ_EVENTS: QQEventSpec[] = EVENT_SEEDS.map(([type, intent]) => ({
  type,
  intent,
  environments: ['sandbox', 'production']
}))
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-catalog.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/events/catalog.ts packages/adapter-qq/test/event-catalog.test.ts
git commit -m "feat(adapter-qq): 增加 22 个官方事件元数据"
```

---

## Task 6: HTTP 客户端

**Files:**
- Create: `packages/adapter-qq/src/core/http-client.ts`
- Create: `packages/adapter-qq/test/http-client.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/http-client.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { QQRawRequest } from '@arqqbot/shared'
import { QQHttpClient } from '../src/core/http-client'
import { findEndpoint } from '../src/core/endpoint-catalog'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeToken(fetchImpl: ReturnType<typeof vi.fn>): TokenManager {
  return new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
}

function makeTokenFetch(): ReturnType<typeof vi.fn> {
  let counter = 0
  return vi.fn(async () => {
    counter += 1
    return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
  })
}

describe('QQHttpClient', () => {
  it('携带鉴权头并解析 JSON', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-1' }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const result = await client.request<{ id: string }>(findEndpoint('group.message.send'), {
      pathParams: { group_openid: 'group-1' },
      body: { content: 'hi', msg_type: 0 }
    })

    expect(result.id).toBe('reply-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v2/groups/group-1/messages',
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('QQBot token-1')
    expect(JSON.parse(String(init.body))).toEqual({ content: 'hi', msg_type: 0 })
  })

  it('GET 网络错误时切换基础域名并重试', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://a.test', 'https://b.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 1
    })

    const result = await client.raw<{ ok: boolean }>({ method: 'GET', path: '/ping' })

    expect(result.ok).toBe(true)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://b.test/ping')
  })

  it('401 刷新 token 后重试一次', async () => {
    const tokenFetch = makeTokenFetch()
    const token = makeToken(tokenFetch)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ err_code: 11251, message: 'token 失效' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({ method: 'POST', path: '/v2/messages', body: {} })

    const headers = fetchImpl.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>
    )
    expect(headers[0]?.authorization).toBe('QQBot token-1')
    expect(headers[1]?.authorization).toBe('QQBot token-2')
    expect(tokenFetch).toHaveBeenCalledTimes(2)
  })

  it('非幂等 POST 对 500 不自动重试', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'boom' }, 500))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(
      client.raw({ method: 'POST', path: '/v2/send', body: { content: 'x' } })
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('raw 请求带 query 且校验 path', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({
      method: 'GET',
      path: '/v2/search',
      query: { keyword: '你好', limit: 10, online: true, skip: undefined }
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/search?keyword=%E4%BD%A0%E5%A5%BD&limit=10&online=true'
    )

    await expect(client.raw({ method: 'GET', path: 'v2/no-slash' })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
  })

  it('拒绝调用方覆盖鉴权头', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({
      method: 'GET',
      path: '/ping',
      headers: { authorization: 'Bearer evil' }
    })

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('QQBot token-1')
  })

  it('mapHttpError 保留端点信息', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ err_code: 22009 }, 400))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const request: QQRawRequest = { method: 'POST', path: '/v2/send' }

    await expect(client.raw(request)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      meta: { status: 400, platformCode: '22009', endpointId: 'raw' }
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/http-client.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 HTTP 客户端**

新建 `packages/adapter-qq/src/core/http-client.ts`：

```ts
import type { QQRawRequest } from '@arqqbot/shared'
import type { QQEndpointSpec } from './endpoint-catalog'
import { buildPath } from './endpoint-catalog'
import { QQApiError, mapHttpError } from './errors'
import { QQAuthError, type TokenManager } from '../token'

export interface QQHttpLogger {
  info(message: string): void
  warn(message: string, error?: unknown): void
}

export interface QQHttpClientOptions {
  token: TokenManager
  baseUrls: string[]
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  logger?: QQHttpLogger
  timeoutMs?: number
  maxRetries?: number
}

export interface QQRequestOptions {
  pathParams?: Record<string, string | number>
  query?: QQRawRequest['query']
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

interface ExecuteRequest {
  method: QQRawRequest['method']
  path: string
  query?: QQRawRequest['query']
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  endpointId: string
  idempotent: boolean
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2

function encodeQuery(query?: QQRawRequest['query']): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.append(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export class QQHttpClient {
  private readonly fetchImpl: typeof fetch
  private readonly nowFn: () => number
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly logger?: QQHttpLogger
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly baseUrls: string[]
  private baseIndex = 0

  constructor(private readonly options: QQHttpClientOptions) {
    if (options.baseUrls.length === 0) throw new Error('QQHttpClient 至少需要一个 baseUrl')
    this.baseUrls = options.baseUrls
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowFn = options.now ?? Date.now
    this.sleepFn =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.logger = options.logger
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  request<T>(endpoint: QQEndpointSpec, options: QQRequestOptions = {}): Promise<T> {
    return this.execute<T>({
      method: endpoint.method,
      path: buildPath(endpoint.path, options.pathParams),
      query: options.query,
      body: options.body,
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      endpointId: endpoint.id,
      idempotent: endpoint.idempotent
    })
  }

  async raw<T>(input: QQRawRequest): Promise<T> {
    if (!input.path.startsWith('/')) {
      throw new QQApiError('BAD_REQUEST', 'raw 请求 path 必须以 / 开头')
    }
    return this.execute<T>({
      method: input.method,
      path: input.path,
      query: input.query,
      body: input.body,
      headers: input.headers,
      timeoutMs: input.timeoutMs,
      endpointId: 'raw',
      idempotent: input.method === 'GET'
    })
  }

  private async execute<T>(request: ExecuteRequest): Promise<T> {
    let attempts = 0
    let authRetried = false

    while (true) {
      attempts += 1
      try {
        return await this.attempt<T>(request)
      } catch (error) {
        const qqError = this.toQQApiError(error, request.endpointId)

        if (qqError.code === 'UNAUTHORIZED' && !authRetried) {
          authRetried = true
          this.options.token.invalidate()
          continue
        }

        if (qqError.code === 'NETWORK_ERROR' && this.baseUrls.length > 1) {
          this.baseIndex = (this.baseIndex + 1) % this.baseUrls.length
        }

        const retryable =
          request.idempotent &&
          (qqError.code === 'NETWORK_ERROR' ||
            qqError.code === 'RATE_LIMITED' ||
            qqError.code === 'SERVER_ERROR')

        if (!retryable || attempts > this.maxRetries) throw qqError
        await this.sleepFn(Math.min(1000 * 2 ** (attempts - 1), 8000))
      }
    }
  }

  private async attempt<T>(request: ExecuteRequest): Promise<T> {
    const base = this.baseUrls[this.baseIndex]
    if (!base) throw new QQApiError('NETWORK_ERROR', '没有可用的 QQ API 域名')

    const startedAt = this.nowFn()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs)

    try {
      const accessToken = await this.options.token.get()
      const headers: Record<string, string> = {
        ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...request.headers
      }
      headers.authorization = `QQBot ${accessToken}`

      const response = await this.fetchImpl(`${base}${request.path}${encodeQuery(request.query)}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal
      })

      const text = await response.text()
      const parsed = parseBody(text)

      if (!response.ok) {
        const error = mapHttpError(response.status, parsed, request.endpointId)
        this.logger?.warn(
          `QQ ${request.method} ${request.path} 失败：HTTP ${response.status}（${error.code}）`
        )
        throw error
      }

      this.logger?.info(
        `QQ ${request.method} ${request.path} ${response.status} ${this.nowFn() - startedAt}ms`
      )
      return parsed as T
    } catch (error) {
      if (error instanceof QQApiError) throw error
      if (error instanceof QQAuthError) {
        throw new QQApiError('UNAUTHORIZED', error.message, {
          status: error.status,
          endpointId: request.endpointId
        })
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new QQApiError('NETWORK_ERROR', `请求超时：${request.endpointId}`, {
          endpointId: request.endpointId
        })
      }
      throw new QQApiError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : String(error),
        { endpointId: request.endpointId }
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private toQQApiError(error: unknown, endpointId: string): QQApiError {
    if (error instanceof QQApiError) return error
    if (error instanceof QQAuthError) {
      return new QQApiError('UNAUTHORIZED', error.message, {
        status: error.status,
        endpointId
      })
    }
    if (error instanceof Error) {
      return new QQApiError('NETWORK_ERROR', error.message, { endpointId })
    }
    return new QQApiError('NETWORK_ERROR', String(error), { endpointId })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/http-client.test.ts
pnpm --filter @arqqbot/adapter-qq typecheck
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/core/http-client.ts packages/adapter-qq/test/http-client.test.ts
git commit -m "feat(adapter-qq): 增加统一 HTTP 客户端"
```

---

## Task 7: 能力注册表

**Files:**
- Create: `packages/adapter-qq/src/core/capability-registry.ts`
- Create: `packages/adapter-qq/test/capability-registry.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/capability-registry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQ_ENDPOINTS } from '../src/core/endpoint-catalog'
import { resolveIntents } from '../src/core/intent-map'

describe('QQCapabilityRegistry', () => {
  it('按 intents 计算能力可用性', () => {
    const registry = new QQCapabilityRegistry({
      env: 'production',
      intents: resolveIntents(['public_messages'])
    })

    expect(registry.has('message.send')).toBe(true)
    expect(registry.has('group.info')).toBe(true)
    expect(registry.has('interaction.respond')).toBe(false)
    expect(registry.has('guild.get')).toBe(false)

    const interaction = registry.list().find((item) => item.id === 'interaction.respond')
    expect(interaction?.reason).toContain('interaction')

    const guild = registry.list().find((item) => item.id === 'guild.get')
    expect(guild?.reason).toContain('guilds')
  })

  it('能力列表覆盖全部 47 个端点', () => {
    const registry = new QQCapabilityRegistry({
      env: 'sandbox',
      intents: resolveIntents(['public_messages', 'interaction', 'guilds'])
    })
    expect(registry.list().reduce((sum, item) => sum + item.endpointCount, 0)).toBe(
      QQ_ENDPOINTS.length
    )
  })

  it('环境不支持时给出原因', () => {
    const endpoint = QQ_ENDPOINTS.find((item) => item.id === 'group.info')!
    const registry = new QQCapabilityRegistry({
      env: 'sandbox',
      intents: resolveIntents(['public_messages']),
      endpoints: [{ ...endpoint, environments: ['production'] }]
    })

    expect(registry.has('group.info')).toBe(false)
    expect(registry.list()[0]?.reason).toContain('sandbox')
  })

  it('assert 抛出 CAPABILITY_UNAVAILABLE', () => {
    const registry = new QQCapabilityRegistry({
      env: 'production',
      intents: resolveIntents(['public_messages'])
    })

    expect(() => registry.assert('interaction.respond')).toThrow('能力不可用')
    expect(() => registry.assert('not.exists')).toThrow('能力未收录')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/capability-registry.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现能力注册表**

新建 `packages/adapter-qq/src/core/capability-registry.ts`：

```ts
import type { InstanceEnv, QQCapabilityInfo, QQIntentName } from '@arqqbot/shared'
import { QQ_ENDPOINTS, type QQEndpointSpec } from './endpoint-catalog'
import { QQApiError } from './errors'
import { QQ_INTENT_BITS } from './intent-map'

export interface QQCapabilityGuard {
  assert(id: string): void
}

export interface QQCapabilityRegistryOptions {
  env: InstanceEnv
  intents: number
  endpoints?: QQEndpointSpec[]
}

export class QQCapabilityRegistry implements QQCapabilityGuard {
  private readonly entries: QQCapabilityInfo[]

  constructor(options: QQCapabilityRegistryOptions) {
    const grouped = new Map<string, QQEndpointSpec[]>()

    for (const endpoint of options.endpoints ?? QQ_ENDPOINTS) {
      const bucket = grouped.get(endpoint.capability) ?? []
      bucket.push(endpoint)
      grouped.set(endpoint.capability, bucket)
    }

    this.entries = [...grouped.entries()].map(([id, endpoints]) => {
      const requiredIntents = [...new Set(endpoints.flatMap((endpoint) => endpoint.requiredIntents))]
      const environmentAvailable = endpoints.some((endpoint) =>
        endpoint.environments.includes(options.env)
      )
      const missing = requiredIntents.filter(
        (name) => (options.intents & (QQ_INTENT_BITS[name] ?? 0)) === 0
      )
      const available = environmentAvailable && missing.length === 0
      const reason = !environmentAvailable
        ? `当前环境 ${options.env} 不支持该能力`
        : missing.length > 0
          ? `缺少 intents：${missing.join('、')}`
          : undefined

      const info: QQCapabilityInfo = {
        id,
        module: endpoints[0]?.module ?? 'unknown',
        available,
        requiredIntents,
        endpointCount: endpoints.length
      }
      if (reason) info.reason = reason
      return info
    })
  }

  list(): QQCapabilityInfo[] {
    return this.entries.map((entry) => ({
      ...entry,
      requiredIntents: [...entry.requiredIntents]
    }))
  }

  has(id: string): boolean {
    return this.entries.find((entry) => entry.id === id)?.available ?? false
  }

  assert(id: string): void {
    const entry = this.entries.find((item) => item.id === id)
    if (!entry) throw new QQApiError('CAPABILITY_UNAVAILABLE', `能力未收录：${id}`)
    if (!entry.available) {
      throw new QQApiError(
        'CAPABILITY_UNAVAILABLE',
        `能力不可用：${id}（${entry.reason ?? '未知原因'}）`
      )
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/capability-registry.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/core/capability-registry.ts packages/adapter-qq/test/capability-registry.test.ts
git commit -m "feat(adapter-qq): 增加能力注册表"
```

---

## Task 8: 消息模块与兼容发送

**Files:**
- Create: `packages/adapter-qq/src/modules/messages.ts`
- Create: `packages/adapter-qq/test/messages.test.ts`
- Modify: `packages/adapter-qq/src/sender.ts`
- Test: `packages/adapter-qq/test/sender.test.ts`（保持现有断言）

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/messages.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { QQMessage } from '@arqqbot/shared'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQHttpClient } from '../src/core/http-client'
import { QQMessageModule } from '../src/modules/messages'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeModule(
  fetchImpl: ReturnType<typeof vi.fn>,
  options: { maxTextLength?: number } = {}
): QQMessageModule {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      jsonResponse({ access_token: 'token-1', expires_in: 7200 })
    ) as unknown as typeof fetch
  })
  const http = new QQHttpClient({
    token,
    baseUrls: ['https://api.test'],
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
  const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
  return new QQMessageModule({ http, capabilities, maxTextLength: options.maxTextLength })
}

describe('QQMessageModule', () => {
  it('发送群聊文本被动回复', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-1' }))
    const messages = makeModule(fetchImpl)

    const result = await messages.send({
      target: { scene: 'group', groupId: 'group-1' },
      content: { type: 'text', text: '你好' },
      replyTo: 'msg-1'
    })

    expect(result.messageId).toBe('reply-1')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/v2/groups/group-1/messages')
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      content: '你好',
      msg_type: 0,
      msg_id: 'msg-1',
      msg_seq: 1
    })
  })

  it('发送 markdown 与 keyboard', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-2' }))
    const messages = makeModule(fetchImpl)

    await messages.send({
      target: { scene: 'c2c', userId: 'user-1' },
      content: {
        type: 'markdown',
        markdown: { content: '# 标题' },
        keyboard: { id: 'keyboard-1' }
      },
      replyTo: 'msg-2'
    })

    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      msg_type: 2,
      markdown: { content: '# 标题' },
      keyboard: { id: 'keyboard-1' },
      msg_id: 'msg-2',
      msg_seq: 1
    })
  })

  it('reply 自动递增 msg_seq', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply' }))
    const messages = makeModule(fetchImpl)
    const source: QQMessage = {
      id: 'msg-1',
      scene: 'group',
      userId: 'member-1',
      groupId: 'group-1',
      content: 'hi',
      mentions: [],
      attachments: [],
      timestamp: '2026-11-01T10:00:00+08:00',
      raw: {}
    }

    await messages.reply(source, { type: 'text', text: 'a' })
    await messages.reply(source, { type: 'text', text: 'b' })

    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(bodies.map((body) => body.msg_seq)).toEqual([1, 2])
  })

  it('撤回群聊消息使用 DELETE 路径', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }))
    const messages = makeModule(fetchImpl)

    await messages.recall('group', 'group-1', 'message-1')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/groups/group-1/messages/message-1'
    )
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE')
  })

  it('流式发送累积内容并携带 stream_msg_id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'stream-1' }))
    const messages = makeModule(fetchImpl)

    const handle = await messages.sendStream({
      target: { scene: 'c2c', userId: 'user-1' },
      replyTo: 'msg-1'
    })

    await handle.write('你')
    await handle.write('好')
    await handle.end()

    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(bodies[0]).toMatchObject({
      input_mode: 'replace',
      input_state: 1,
      index: 0,
      content_type: 'markdown',
      content_raw: '你',
      msg_id: 'msg-1',
      msg_seq: 1
    })
    expect(bodies[1]).toMatchObject({
      index: 1,
      content_raw: '你好',
      stream_msg_id: 'stream-1'
    })
    expect(bodies[2]).toMatchObject({
      input_state: 10,
      index: 2,
      content_raw: '你好'
    })
  })

  it('缺少 replyTo/eventId 时拒绝主动消息', async () => {
    const messages = makeModule(vi.fn())

    await expect(
      messages.send({
        target: { scene: 'group', groupId: 'group-1' },
        content: { type: 'text', text: 'x' }
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/messages.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现消息模块**

新建 `packages/adapter-qq/src/modules/messages.ts`：

```ts
import type {
  QQMessage,
  QQMessageContent,
  QQSendMessageInput,
  QQSendResult,
  QQSendTarget,
  QQStreamHandle,
  QQStreamInput
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQEndpointSpec } from '../core/endpoint-catalog'
import { findEndpoint } from '../core/endpoint-catalog'
import { QQApiError } from '../core/errors'
import type { QQHttpClient } from '../core/http-client'
import { PassiveReplyQuota } from '../quota'

export interface QQMessageModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
  quota?: PassiveReplyQuota
  now?: () => number
  maxTextLength?: number
  onSent?: (input: QQSendMessageInput, result: QQSendResult) => void
}

function splitText(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]
  const chunks: string[] = []
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength))
  }
  return chunks
}

function pathParamsFor(target: QQSendTarget): Record<string, string> {
  return target.scene === 'group'
    ? { group_openid: target.groupId }
    : { user_openid: target.userId }
}

class HttpStreamHandle implements QQStreamHandle {
  private streamMessageId?: string
  private index = 0
  private content = ''
  private ended = false

  constructor(
    private readonly http: QQHttpClient,
    private readonly endpoint: QQEndpointSpec,
    private readonly pathParams: Record<string, string>,
    private readonly credentials: Record<string, unknown>
  ) {}

  async write(chunk: string): Promise<void> {
    if (this.ended) throw new QQApiError('BAD_REQUEST', '流式消息已结束')
    this.content += chunk
    await this.push(1)
  }

  async end(): Promise<void> {
    if (this.ended) return
    await this.push(10)
    this.ended = true
  }

  private async push(inputState: number): Promise<void> {
    const body: Record<string, unknown> = {
      input_mode: 'replace',
      input_state: inputState,
      index: this.index,
      content_type: 'markdown',
      content_raw: this.content,
      ...this.credentials
    }
    if (this.streamMessageId) body.stream_msg_id = this.streamMessageId

    const result = await this.http.request<{ id?: unknown }>(this.endpoint, {
      pathParams: this.pathParams,
      body
    })

    if (!this.streamMessageId && typeof result?.id === 'string') {
      this.streamMessageId = result.id
    }
    this.index += 1
  }
}

export class QQMessageModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard
  private readonly quota: PassiveReplyQuota
  private readonly maxTextLength: number
  private readonly onSent?: (input: QQSendMessageInput, result: QQSendResult) => void

  constructor(options: QQMessageModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
    this.quota = options.quota ?? new PassiveReplyQuota(options.now ?? Date.now)
    this.maxTextLength = options.maxTextLength ?? 5000
    this.onSent = options.onSent
  }

  async send(input: QQSendMessageInput): Promise<QQSendResult> {
    this.capabilities?.assert('message.send')
    if (!input.replyTo && !input.eventId) {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '主动消息默认未开放：请提供 replyTo 或 eventId')
    }

    const result =
      input.content.type === 'text'
        ? await this.sendText(input, input.content.text)
        : await this.sendRich(input, input.content)

    this.onSent?.(input, result)
    return result
  }

  async reply(source: QQMessage, content: QQMessageContent): Promise<QQSendResult> {
    let target: QQSendTarget
    if (source.scene === 'group') {
      if (!source.groupId) throw new QQApiError('BAD_REQUEST', '群消息缺少 groupId')
      target = { scene: 'group', groupId: source.groupId }
    } else if (source.scene === 'c2c') {
      target = { scene: 'c2c', userId: source.userId }
    } else {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', `场景 ${source.scene} 暂不支持发送`)
    }

    return this.send({ target, content, replyTo: source.id })
  }

  async recall(scene: 'c2c' | 'group', targetId: string, messageId: string): Promise<void> {
    this.capabilities?.assert('message.recall')
    const endpoint = findEndpoint(
      scene === 'group' ? 'group.message.recall' : 'c2c.message.recall'
    )
    const pathParams =
      scene === 'group'
        ? { group_openid: targetId, message_id: messageId }
        : { user_openid: targetId, message_id: messageId }

    await this.http.request<unknown>(endpoint, { pathParams })
  }

  async sendStream(input: QQStreamInput): Promise<QQStreamHandle> {
    this.capabilities?.assert('message.stream')
    if (input.target.scene !== 'c2c') {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '流式发送目前仅支持单聊')
    }
    if (!input.replyTo && !input.eventId) {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '主动消息默认未开放：请提供 replyTo 或 eventId')
    }

    let msgSeq = input.msgSeq ?? 1
    if (input.replyTo) {
      if (!this.quota.consume('c2c', input.replyTo)) {
        throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }
      msgSeq = input.msgSeq ?? this.quota.nextSeq(input.replyTo)
    }

    const credentials: Record<string, unknown> = { msg_seq: msgSeq }
    if (input.replyTo) credentials.msg_id = input.replyTo
    if (input.eventId) credentials.event_id = input.eventId

    return new HttpStreamHandle(
      this.http,
      findEndpoint('c2c.message.stream'),
      { user_openid: input.target.userId },
      credentials
    )
  }

  private async sendText(
    input: QQSendMessageInput,
    text: string
  ): Promise<QQSendResult> {
    const endpoint = this.sendEndpoint(input.target)
    const pathParams = pathParamsFor(input.target)
    const chunks = splitText(text, this.maxTextLength)
    let messageId: string | undefined

    for (const [index, chunk] of chunks.entries()) {
      if (input.replyTo && !this.quota.consume(input.target.scene, input.replyTo)) {
        throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }

      const msgSeq =
        input.msgSeq !== undefined
          ? input.msgSeq + index
          : input.replyTo
            ? this.quota.nextSeq(input.replyTo)
            : 1

      const body: Record<string, unknown> = {
        content: chunk,
        msg_type: 0,
        msg_seq: msgSeq
      }
      if (input.replyTo) body.msg_id = input.replyTo
      if (input.eventId) body.event_id = input.eventId

      const result = await this.http.request<{ id?: unknown }>(endpoint, {
        pathParams,
        body
      })
      if (typeof result?.id === 'string') messageId = result.id
    }

    return { messageId }
  }

  private async sendRich(
    input: QQSendMessageInput,
    content: Exclude<QQMessageContent, { type: 'text' }>
  ): Promise<QQSendResult> {
    if (input.replyTo && !this.quota.consume(input.target.scene, input.replyTo)) {
      throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
    }

    const msgSeq =
      input.msgSeq ??
      (input.replyTo ? this.quota.nextSeq(input.replyTo) : 1)
    const body: Record<string, unknown> = { msg_seq: msgSeq }
    if (input.replyTo) body.msg_id = input.replyTo
    if (input.eventId) body.event_id = input.eventId

    switch (content.type) {
      case 'markdown':
        body.msg_type = 2
        body.markdown = content.markdown
        if (content.keyboard) body.keyboard = content.keyboard
        break
      case 'ark':
        body.msg_type = 3
        body.ark = content.ark
        break
      case 'embed':
        body.msg_type = 4
        body.embed = content.embed
        break
      case 'media':
        body.msg_type = 7
        body.media = { file_info: content.fileInfo }
        break
    }

    const result = await this.http.request<{ id?: unknown }>(this.sendEndpoint(input.target), {
      pathParams: pathParamsFor(input.target),
      body
    })

    return typeof result?.id === 'string' ? { messageId: result.id } : {}
  }

  private sendEndpoint(target: QQSendTarget): QQEndpointSpec {
    return findEndpoint(target.scene === 'group' ? 'group.message.send' : 'c2c.message.send')
  }
}
```

- [ ] **Step 4: 运行消息测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/messages.test.ts
```

预期：PASS。

- [ ] **Step 5: 重写 sender 为兼容门面**

把 `packages/adapter-qq/src/sender.ts` 替换为：

```ts
import type { QQSendInput, QQSendResult } from '@arqqbot/shared'
import { QQCapabilityRegistry } from './core/capability-registry'
import { QQApiError } from './core/errors'
import { QQHttpClient } from './core/http-client'
import { QQMessageModule } from './modules/messages'
import { PassiveReplyQuota } from './quota'
import type { TokenManager } from './token'

export type QQSendErrorCode =
  | 'ACTIVE_MESSAGE_UNSUPPORTED'
  | 'QUOTA_EXCEEDED'
  | 'QQ_API_ERROR'

export class QQSendError extends Error {
  readonly code: QQSendErrorCode
  readonly status?: number

  constructor(code: QQSendErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'QQSendError'
    this.code = code
    this.status = status
  }
}

export interface QQSenderOptions {
  token?: TokenManager
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  maxTextLength?: number
  messages?: QQMessageModule
}

export class QQSender {
  private readonly messages: QQMessageModule

  constructor(options: QQSenderOptions) {
    if (options.messages) {
      this.messages = options.messages
      return
    }

    if (!options.token || !options.baseUrl) {
      throw new Error('QQSender 需要 token/baseUrl 或 messages')
    }

    const http = new QQHttpClient({
      token: options.token,
      baseUrls: [options.baseUrl],
      fetchImpl: options.fetchImpl,
      now: options.now
    })
    const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
    this.messages = new QQMessageModule({
      http,
      capabilities,
      quota: new PassiveReplyQuota(options.now ?? Date.now),
      maxTextLength: options.maxTextLength
    })
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!input.msgId) {
      throw new QQSendError('ACTIVE_MESSAGE_UNSUPPORTED', 'MVP 不支持主动消息')
    }

    try {
      return await this.messages.send({
        target:
          input.scene === 'group'
            ? { scene: 'group', groupId: input.targetId }
            : { scene: 'c2c', userId: input.targetId },
        content: { type: 'text', text: input.content },
        replyTo: input.msgId
      })
    } catch (error) {
      if (error instanceof QQApiError) {
        if (error.code === 'QUOTA_EXCEEDED') {
          throw new QQSendError('QUOTA_EXCEEDED', error.message, error.meta.status)
        }
        throw new QQSendError('QQ_API_ERROR', error.message, error.meta.status)
      }
      throw error
    }
  }
}
```

- [ ] **Step 6: 运行 sender 回归**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/sender.test.ts test/messages.test.ts
```

预期：PASS。现有 sender.test 的分段、配额、主动消息拒绝断言全部保持。

- [ ] **Step 7: 提交**

```bash
git add packages/adapter-qq/src/modules/messages.ts packages/adapter-qq/test/messages.test.ts packages/adapter-qq/src/sender.ts
git commit -m "feat(adapter-qq): 增加消息模块并兼容旧发送入口"
```

---

## Task 9: 富媒体模块

**Files:**
- Create: `packages/adapter-qq/src/modules/media.ts`
- Create: `packages/adapter-qq/test/media.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/media.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQHttpClient } from '../src/core/http-client'
import { QQMediaModule } from '../src/modules/media'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeMedia(fetchImpl: ReturnType<typeof vi.fn>): QQMediaModule {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      jsonResponse({ access_token: 'token-1', expires_in: 7200 })
    ) as unknown as typeof fetch
  })
  const http = new QQHttpClient({
    token,
    baseUrls: ['https://api.test'],
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
  const capabilities = new QQCapabilityRegistry({
    env: 'production',
    intents: 1 << 25
  })
  return new QQMediaModule({
    http,
    capabilities,
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
}

describe('QQMediaModule', () => {
  it('直传群聊富媒体并返回 file_info', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ file_info: 'file-1', file_uuid: 'uuid-1', ttl: 3600 })
    )
    const media = makeMedia(fetchImpl)

    const result = await media.upload({
      scene: 'group',
      targetId: 'group-1',
      fileType: 1,
      url: 'https://img.test/a.png'
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/v2/groups/group-1/files')
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ file_type: 1, url: 'https://img.test/a.png' })
    expect(result).toMatchObject({ fileInfo: 'file-1', fileUuid: 'uuid-1', ttl: 3600 })
  })

  it('预上传返回 upload_id 与分片地址', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        upload_id: 'upload-1',
        block_size: '10485760',
        parts: [
          { index: 0, presigned_url: 'https://upload.test/0', block_size: '3' },
          { index: 1, presigned_url: 'https://upload.test/1', block_size: '3' }
        ],
        upload_config: { concurrency: 1 }
      })
    )
    const media = makeMedia(fetchImpl)

    const session = await media.prepareUpload({
      scene: 'group',
      targetId: 'group-1',
      fileType: 4,
      fileName: 'a.bin',
      fileSize: 6,
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m'
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/groups/group-1/upload_prepare'
    )
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({
      file_type: 4,
      file_size: '6',
      file_name: 'a.bin',
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m'
    })
    expect(session.uploadId).toBe('upload-1')
    expect(session.blockSize).toBe(10485760)
    expect(session.parts).toEqual([
      { index: 0, presignedUrl: 'https://upload.test/0', blockSize: 3 },
      { index: 1, presignedUrl: 'https://upload.test/1', blockSize: 3 }
    ])
  })

  it('分片编排：预上传、PUT 分片、分片完成、合并', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('upload_prepare')) {
        return jsonResponse({
          upload_id: 'upload-1',
          block_size: '3',
          parts: [
            { index: 0, presigned_url: 'https://upload.test/0', block_size: '3' },
            { index: 1, presigned_url: 'https://upload.test/1', block_size: '3' }
          ]
        })
      }
      if (href.startsWith('https://upload.test/')) return new Response('', { status: 200 })
      if (href.includes('upload_part_finish')) return jsonResponse({})
      if (href.includes('/files')) {
        return jsonResponse({ file_info: 'file-1', file_uuid: 'uuid-1', ttl: 0 })
      }
      throw new Error(`unexpected request: ${href}`)
    })
    const media = makeMedia(fetchImpl)

    const result = await media.uploadChunked({
      scene: 'group',
      targetId: 'group-1',
      fileType: 4,
      fileName: 'a.bin',
      fileSize: 6,
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m',
      chunks: [
        { data: new Uint8Array([1, 2, 3]), md5: 'part-0' },
        { data: new Uint8Array([4, 5, 6]), md5: 'part-1' }
      ]
    })

    const finishPartCalls = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('upload_part_finish')
    )
    expect(finishPartCalls).toHaveLength(2)
    const finishBodies = finishPartCalls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(finishBodies).toEqual([
      { upload_id: 'upload-1', part_index: 0, block_size: '3', md5: 'part-0' },
      { upload_id: 'upload-1', part_index: 1, block_size: '3', md5: 'part-1' }
    ])

    const mergeCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).endsWith('/v2/groups/group-1/files')
    )
    expect(mergeCall).toBeTruthy()
    const mergeBody = JSON.parse(String((mergeCall?.[1] as RequestInit).body))
    expect(mergeBody).toEqual({ file_type: 4, upload_id: 'upload-1' })
    expect(result.fileInfo).toBe('file-1')
  })

  it('intents 不足时抛出 CAPABILITY_UNAVAILABLE', async () => {
    const token = new TokenManager({
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: vi.fn(async () =>
        jsonResponse({ access_token: 'token-1', expires_in: 7200 })
      ) as unknown as typeof fetch
    })
    const http = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: vi.fn() as unknown as typeof fetch
    })
    const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
    const media = new QQMediaModule({ http, capabilities, fetchImpl: vi.fn() as unknown as typeof fetch })

    await expect(
      media.upload({
        scene: 'group',
        targetId: 'group-1',
        fileType: 1,
        url: 'https://img.test/a.png'
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/media.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现富媒体模块**

新建 `packages/adapter-qq/src/modules/media.ts`：

```ts
import type {
  QQChunkedUploadInput,
  QQMediaUploadInput,
  QQUploadFinishInput,
  QQUploadPrepareInput,
  QQUploadSession,
  QQUploadedMedia
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import { findEndpoint } from '../core/endpoint-catalog'
import { QQApiError } from '../core/errors'
import type { QQHttpClient } from '../core/http-client'

export interface QQMediaModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
  fetchImpl?: typeof fetch
}

function openidParams(scene: 'c2c' | 'group', targetId: string): Record<string, string> {
  return scene === 'group' ? { group_openid: targetId } : { user_openid: targetId }
}

function idParams(scene: 'c2c' | 'group', targetId: string): Record<string, string> {
  return scene === 'group' ? { group_id: targetId } : { user_id: targetId }
}

function toUploadedMedia(data: Record<string, unknown>): QQUploadedMedia {
  const fileInfo = data.file_info
  if (typeof fileInfo !== 'string' || fileInfo.length === 0) {
    throw new QQApiError('SERVER_ERROR', '富媒体上传响应缺少 file_info')
  }

  const result: QQUploadedMedia = { fileInfo }
  if (typeof data.file_uuid === 'string') result.fileUuid = data.file_uuid
  if (Number.isFinite(Number(data.ttl))) result.ttl = Number(data.ttl)
  return result
}

export class QQMediaModule {
  private readonly capabilities?: QQCapabilityGuard
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: QQMediaModuleOptions) {
    this.capabilities = options.capabilities
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async upload(input: QQMediaUploadInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.upload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.upload' : 'c2c.media.upload'
    )
    const body: Record<string, unknown> = {
      file_type: input.fileType,
      url: input.url
    }
    if (input.fileData) body.file_data = input.fileData

    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: openidParams(input.scene, input.targetId),
      body
    })
    return toUploadedMedia(result)
  }

  async prepareUpload(input: QQUploadPrepareInput): Promise<QQUploadSession> {
    this.capabilities?.assert('media.prepareUpload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.prepare' : 'c2c.media.prepare'
    )
    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: idParams(input.scene, input.targetId),
      body: {
        file_type: input.fileType,
        file_size: String(input.fileSize),
        file_name: input.fileName,
        md5: input.md5,
        sha1: input.sha1,
        md5_10m: input.md5_10m
      }
    })

    const uploadId = result.upload_id
    if (typeof uploadId !== 'string' || uploadId.length === 0) {
      throw new QQApiError('SERVER_ERROR', '预上传响应缺少 upload_id')
    }

    const rawParts = Array.isArray(result.parts) ? result.parts : []
    const parts = rawParts.map((item) => {
      const part = item as Record<string, unknown>
      const presignedUrl = part.presigned_url
      if (typeof presignedUrl !== 'string' || presignedUrl.length === 0) {
        throw new QQApiError('SERVER_ERROR', '预上传响应缺少 presigned_url')
      }
      return {
        index: Number(part.index ?? 0),
        presignedUrl,
        blockSize: Number(part.block_size ?? 0)
      }
    })

    return {
      uploadId,
      blockSize: Number(result.block_size ?? 0),
      parts,
      raw: result
    }
  }

  async finishUpload(input: QQUploadFinishInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.upload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.upload' : 'c2c.media.upload'
    )
    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: openidParams(input.scene, input.targetId),
      body: {
        file_type: input.fileType,
        upload_id: input.uploadId
      }
    })
    return toUploadedMedia(result)
  }

  async uploadChunked(input: QQChunkedUploadInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.prepareUpload')
    this.capabilities?.assert('media.uploadPart')
    this.capabilities?.assert('media.upload')

    const session = await this.prepareUpload(input)
    if (session.parts.length !== input.chunks.length) {
      throw new QQApiError(
        'BAD_REQUEST',
        `分片数量不匹配：服务端 ${session.parts.length}，本地 ${input.chunks.length}`
      )
    }

    const partFinishEndpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.partFinish' : 'c2c.media.partFinish'
    )
    const pathParams = idParams(input.scene, input.targetId)

    for (const part of session.parts) {
      const chunk = input.chunks[part.index]
      if (!chunk) throw new QQApiError('BAD_REQUEST', `缺少分片 ${part.index}`)

      const response = await this.fetchImpl(part.presignedUrl, {
        method: 'PUT',
        body: chunk.data as BodyInit
      })
      if (!response.ok) {
        throw new QQApiError(
          'NETWORK_ERROR',
          `分片 ${part.index} 上传失败：HTTP ${response.status}`,
          { status: response.status, endpointId: 'media.presigned' }
        )
      }

      await this.options.http.request<unknown>(partFinishEndpoint, {
        pathParams,
        body: {
          upload_id: session.uploadId,
          part_index: part.index,
          block_size: String(chunk.data.byteLength),
          md5: chunk.md5
        }
      })
    }

    return this.finishUpload({
      scene: input.scene,
      targetId: input.targetId,
      fileType: input.fileType,
      uploadId: session.uploadId
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/media.test.ts
pnpm --filter @arqqbot/adapter-qq typecheck
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/modules/media.ts packages/adapter-qq/test/media.test.ts
git commit -m "feat(adapter-qq): 增加富媒体上传模块"
```

---

## Task 10: 22 类事件归一化

**Files:**
- Create: `packages/adapter-qq/src/events/normalize.ts`
- Create: `packages/adapter-qq/test/event-normalize.test.ts`
- Modify: `packages/adapter-qq/src/message.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/event-normalize.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { normalizeEvent } from '../src/events/normalize'

const FIXTURES: Array<[string, Record<string, any>, string]> = [
  ['INTERACTION_CREATE', { id: 'interaction-1' }, 'qq/interaction'],
  ['SUBSCRIBE_MESSAGE_STATUS', { openid: 'user-1' }, 'qq/subscribe-status'],
  ['FRIEND_ADD', { openid: 'user-1' }, 'qq/friend-add'],
  ['FRIEND_DEL', { openid: 'user-1' }, 'qq/friend-del'],
  [
    'C2C_MESSAGE_CREATE',
    { id: 'm-1', content: 'hi', author: { user_openid: 'user-1' } },
    'qq/message'
  ],
  ['C2C_MSG_RECEIVE', { openid: 'user-1', message_id: 'm-1' }, 'qq/c2c-msg-receive'],
  ['C2C_MSG_REJECT', { openid: 'user-1', message_id: 'm-1' }, 'qq/c2c-msg-reject'],
  ['GROUP_ADD_ROBOT', { group_openid: 'g-1', op_member_openid: 'member-1' }, 'qq/group-add'],
  ['GROUP_DEL_ROBOT', { group_openid: 'g-1' }, 'qq/group-del'],
  [
    'GROUP_JOIN_REQUEST',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-join-request'
  ],
  ['GROUP_MSG_RECEIVE', { group_openid: 'g-1', message_id: 'm-1' }, 'qq/group-msg-receive'],
  ['GROUP_MSG_REJECT', { group_openid: 'g-1', message_id: 'm-1' }, 'qq/group-msg-reject'],
  [
    'GROUP_AT_MESSAGE_CREATE',
    { id: 'm-2', group_openid: 'g-1', content: '@bot hi', author: { member_openid: 'member-1' } },
    'qq/message'
  ],
  [
    'GROUP_MESSAGE_CREATE',
    { id: 'm-3', group_openid: 'g-1', content: 'hi', author: { member_openid: 'member-1' } },
    'qq/group-message'
  ],
  [
    'GROUP_MEMBER_ADD',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-member-add'
  ],
  [
    'GROUP_MEMBER_REMOVE',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-member-remove'
  ],
  ['GUILD_CREATE', { id: 'guild-1' }, 'qq/guild-create'],
  ['GUILD_UPDATE', { id: 'guild-1' }, 'qq/guild-update'],
  ['GUILD_DELETE', { id: 'guild-1' }, 'qq/guild-delete'],
  ['CHANNEL_CREATE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-create'],
  ['CHANNEL_UPDATE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-update'],
  ['CHANNEL_DELETE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-delete']
]

describe('normalizeEvent', () => {
  for (const [type, data, expected] of FIXTURES) {
    it(`归一化 ${type}`, () => {
      const event = normalizeEvent(type, data)
      expect(event, `事件未归一化：${type}`).toBeTruthy()
      expect(event?.event).toBe(expected)
    })
  }

  it('归一化群 @ 消息并保留兼容字段', () => {
    const event = normalizeEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: ' 你好',
      timestamp: '2026-11-01T10:00:00+08:00',
      author: { member_openid: 'member-1' },
      attachments: [
        { content_type: 'image/png', url: 'https://img.test/a.png', filename: 'a.png', size: 100 }
      ]
    })

    expect(event?.event).toBe('qq/message')
    expect(event?.message).toMatchObject({
      id: 'msg-1',
      scene: 'group',
      groupId: 'group-1',
      userId: 'member-1',
      content: '你好'
    })
    expect(event?.message?.attachments[0]?.contentType).toBe('image/png')
  })

  it('频道与私信消息使用独立事件', () => {
    const guild = normalizeEvent('AT_MESSAGE_CREATE', {
      id: 'gm-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      content: 'hi',
      author: { id: 'user-1', username: 'Alice' }
    })
    expect(guild?.event).toBe('qq/guild-message')
    expect(guild?.message).toMatchObject({
      scene: 'guild',
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1'
    })

    const dm = normalizeEvent('DIRECT_MESSAGE_CREATE', {
      id: 'dm-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      content: 'hi',
      author: { id: 'user-1' }
    })
    expect(dm?.event).toBe('qq/dm-message')
    expect(dm?.message).toMatchObject({ scene: 'dm', userId: 'user-1' })
  })

  it('领域事件附带规范化别名', () => {
    const group = normalizeEvent('GROUP_ADD_ROBOT', { group_openid: 'g-1' })
    expect(group?.payload).toMatchObject({ groupOpenid: 'g-1' })

    const channel = normalizeEvent('CHANNEL_CREATE', { id: 'c-1', guild_id: 'guild-1' })
    expect(channel?.payload).toMatchObject({ channelId: 'c-1', guildId: 'guild-1' })
  })

  it('未知事件返回 null', () => {
    expect(normalizeEvent('UNKNOWN_EVENT', {})).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-normalize.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现事件归一化**

新建 `packages/adapter-qq/src/events/normalize.ts`：

```ts
import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'

type Data = Record<string, any>

export interface QQNormalizedEvent {
  type: string
  event: QQDomainEventName
  payload: Record<string, unknown>
  message?: QQMessage
  raw: unknown
}

function normalizeAttachments(input: unknown): QQMessage['attachments'] {
  if (!Array.isArray(input)) return []
  return input.map((item) => {
    const attachment = item as Record<string, unknown>
    const result: QQMessage['attachments'][number] = {
      contentType: String(attachment.content_type ?? ''),
      url: String(attachment.url ?? '')
    }
    if (attachment.filename !== undefined) result.filename = String(attachment.filename)
    if (attachment.size !== undefined) result.size = Number(attachment.size)
    return result
  })
}

function messageEvent(
  type: string,
  data: Data
): { event: QQDomainEventName; message: QQMessage } | null {
  let scene: QQMessage['scene'] | undefined
  let event: QQDomainEventName | undefined

  if (type === 'GROUP_AT_MESSAGE_CREATE') {
    scene = 'group'
    event = 'qq/message'
  } else if (type === 'GROUP_MESSAGE_CREATE') {
    scene = 'group'
    event = 'qq/group-message'
  } else if (type === 'C2C_MESSAGE_CREATE') {
    scene = 'c2c'
    event = 'qq/message'
  } else if (type === 'AT_MESSAGE_CREATE' || type === 'MESSAGE_CREATE') {
    scene = 'guild'
    event = 'qq/guild-message'
  } else if (type === 'DIRECT_MESSAGE_CREATE') {
    scene = 'dm'
    event = 'qq/dm-message'
  }

  if (!scene || !event) return null

  const userId =
    scene === 'group'
      ? String(data.author?.member_openid ?? '')
      : scene === 'c2c'
        ? String(data.author?.user_openid ?? '')
        : String(data.author?.id ?? '')

  const groupId = scene === 'group' ? String(data.group_openid ?? '') : ''
  const guildId =
    scene === 'guild' || scene === 'dm' ? String(data.guild_id ?? '') : ''
  const channelId =
    scene === 'guild' || scene === 'dm' ? String(data.channel_id ?? '') : ''
  const authorName = data.author?.username ?? data.author?.name

  const message: QQMessage = {
    id: String(data.id ?? ''),
    scene,
    userId,
    content: String(data.content ?? '').trim(),
    mentions: [],
    attachments: normalizeAttachments(data.attachments),
    timestamp: String(data.timestamp ?? ''),
    raw: data
  }
  if (groupId) message.groupId = groupId
  if (guildId) message.guildId = guildId
  if (channelId) message.channelId = channelId
  message.author = {
    id: userId,
    ...(authorName !== undefined ? { name: String(authorName) } : {}),
    ...(data.author?.bot !== undefined ? { bot: Boolean(data.author.bot) } : {})
  }

  return { event, message }
}

const DOMAIN_EVENTS: Record<
  string,
  { event: QQDomainEventName; payload: (data: Data) => Record<string, unknown> }
> = {
  INTERACTION_CREATE: {
    event: 'qq/interaction',
    payload: (data) => ({ ...data, interactionId: String(data.id ?? '') })
  },
  SUBSCRIBE_MESSAGE_STATUS: {
    event: 'qq/subscribe-status',
    payload: (data) => ({ ...data })
  },
  FRIEND_ADD: {
    event: 'qq/friend-add',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? data.id ?? '')
    })
  },
  FRIEND_DEL: {
    event: 'qq/friend-del',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? data.id ?? '')
    })
  },
  C2C_MSG_RECEIVE: {
    event: 'qq/c2c-msg-receive',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? '')
    })
  },
  C2C_MSG_REJECT: {
    event: 'qq/c2c-msg-reject',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? '')
    })
  },
  GROUP_ADD_ROBOT: {
    event: 'qq/group-add',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      operatorOpenid: String(data.op_member_openid ?? '')
    })
  },
  GROUP_DEL_ROBOT: {
    event: 'qq/group-del',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      operatorOpenid: String(data.op_member_openid ?? '')
    })
  },
  GROUP_JOIN_REQUEST: {
    event: 'qq/group-join-request',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GROUP_MSG_RECEIVE: {
    event: 'qq/group-msg-receive',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? ''),
      memberOpenid: String(data.member_openid ?? '')
    })
  },
  GROUP_MSG_REJECT: {
    event: 'qq/group-msg-reject',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? ''),
      memberOpenid: String(data.member_openid ?? '')
    })
  },
  GROUP_MEMBER_ADD: {
    event: 'qq/group-member-add',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GROUP_MEMBER_REMOVE: {
    event: 'qq/group-member-remove',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GUILD_CREATE: {
    event: 'qq/guild-create',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  GUILD_UPDATE: {
    event: 'qq/guild-update',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  GUILD_DELETE: {
    event: 'qq/guild-delete',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  CHANNEL_CREATE: {
    event: 'qq/channel-create',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  },
  CHANNEL_UPDATE: {
    event: 'qq/channel-update',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  },
  CHANNEL_DELETE: {
    event: 'qq/channel-delete',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  }
}

export function normalizeEvent(type: string, data: Data): QQNormalizedEvent | null {
  const messageResult = messageEvent(type, data)
  if (messageResult) {
    return {
      type,
      event: messageResult.event,
      payload: {},
      message: messageResult.message,
      raw: data
    }
  }

  const domain = DOMAIN_EVENTS[type]
  if (!domain) return null

  return {
    type,
    event: domain.event,
    payload: domain.payload(data),
    raw: data
  }
}
```

- [ ] **Step 4: 运行事件测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-normalize.test.ts
```

预期：PASS，22 个 fixture 全部归一化。

- [ ] **Step 5: 让旧 normalizeQQEvent 委托新实现**

把 `packages/adapter-qq/src/message.ts` 替换为：

```ts
import type { QQMessage } from '@arqqbot/shared'
import { normalizeEvent } from './events/normalize'

export function normalizeQQEvent(
  eventName: string,
  data: Record<string, any>
): QQMessage | null {
  const normalized = normalizeEvent(eventName, data)
  return normalized?.event === 'qq/message' ? normalized.message ?? null : null
}

export class MessageDeduper {
  private readonly ids = new Set<string>()
  private readonly limit: number

  constructor(limit = 10_000) {
    this.limit = limit
  }

  seen(id: string): boolean {
    if (this.ids.has(id)) return true
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const first = this.ids.values().next().value
      if (typeof first === 'string') this.ids.delete(first)
    }
    return false
  }
}
```

- [ ] **Step 6: 运行消息归一化回归**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/message.test.ts test/event-normalize.test.ts
```

预期：PASS。`GUILD_CREATE` 仍返回 `null`，群 @ 与单聊消息字段保持。

- [ ] **Step 7: 提交**

```bash
git add packages/adapter-qq/src/events/normalize.ts packages/adapter-qq/test/event-normalize.test.ts packages/adapter-qq/src/message.ts
git commit -m "feat(adapter-qq): 归一化全部官方事件"
```

---

## Task 11: 事件路由

**Files:**
- Create: `packages/adapter-qq/src/events/router.ts`
- Create: `packages/adapter-qq/test/event-router.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/adapter-qq/test/event-router.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'
import { QQEventRouter } from '../src/events/router'
import { MessageDeduper } from '../src/message'

describe('QQEventRouter', () => {
  it('先发 raw-event，再发 qq/message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const onMessage = vi.fn()
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      deduper: new MessageDeduper(),
      onMessage
    })

    router.handle('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    })

    expect(emitted[0]?.event).toBe('qq/raw-event')
    expect(emitted[1]?.event).toBe('qq/message')
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('重复消息只分发一次 qq/message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      deduper: new MessageDeduper()
    })
    const data = {
      id: 'msg-1',
      group_openid: 'group-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    }

    router.handle('GROUP_AT_MESSAGE_CREATE', data)
    router.handle('GROUP_AT_MESSAGE_CREATE', data)

    expect(emitted.filter((item) => item.event === 'qq/raw-event')).toHaveLength(2)
    expect(emitted.filter((item) => item.event === 'qq/message')).toHaveLength(1)
  })

  it('领域事件携带规范化 payload', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload })
    })

    router.handle('GROUP_MEMBER_ADD', {
      group_openid: 'g-1',
      member_openid: 'member-1'
    })

    expect(emitted[1]).toMatchObject({
      event: 'qq/group-member-add',
      payload: { groupOpenid: 'g-1', memberOpenid: 'member-1' }
    })
  })

  it('群全量消息使用 qq/group-message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload })
    })

    router.handle('GROUP_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'g-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    })

    expect(emitted[1]?.event).toBe('qq/group-message')
  })

  it('未知事件只发 raw-event 并回调 onUnknown', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const onUnknown = vi.fn()
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      onUnknown
    })

    const result = router.handle('UNKNOWN_EVENT', { id: 'x' })

    expect(result).toBeNull()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.event).toBe('qq/raw-event')
    expect(onUnknown).toHaveBeenCalledWith('UNKNOWN_EVENT', { id: 'x' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-router.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现事件路由**

新建 `packages/adapter-qq/src/events/router.ts`：

```ts
import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'
import type { MessageDeduper } from '../message'
import { normalizeEvent, type QQNormalizedEvent } from './normalize'

export interface QQEventRouterOptions {
  emit(event: QQDomainEventName, payload: unknown): void
  deduper?: MessageDeduper
  onMessage?(message: QQMessage, event: QQDomainEventName): void
  onUnknown?(type: string, data: unknown): void
}

export class QQEventRouter {
  constructor(private readonly options: QQEventRouterOptions) {}

  handle(type: string, data: unknown): QQNormalizedEvent | null {
    this.options.emit('qq/raw-event', { type, data })

    const normalized = normalizeEvent(type, data as Record<string, any>)
    if (!normalized) {
      this.options.onUnknown?.(type, data)
      return null
    }

    if (normalized.message) {
      if (
        normalized.event === 'qq/message' &&
        this.options.deduper?.seen(normalized.message.id)
      ) {
        return normalized
      }
      this.options.onMessage?.(normalized.message, normalized.event)
      this.options.emit(normalized.event, normalized.message)
      return normalized
    }

    this.options.emit(normalized.event, normalized.payload)
    return normalized
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/event-router.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/adapter-qq/src/events/router.ts packages/adapter-qq/test/event-router.test.ts
git commit -m "feat(adapter-qq): 增加事件路由"
```

---

## Task 12: 门面集成与网关

**Files:**
- Modify: `packages/adapter-qq/src/gateway.ts`
- Modify: `packages/adapter-qq/test/gateway.test.ts`
- Modify: `packages/adapter-qq/src/service.ts`
- Create: `packages/adapter-qq/test/service.test.ts`

- [ ] **Step 1: 给网关增加 onClose 回调**

修改 `packages/adapter-qq/src/gateway.ts`：

在 `GatewayHandlers` 中新增：

```ts
  onClose?(): void
```

在 `handleClose` 的 READY 判断之后、重连定时器之前新增：

```ts
    this.options.handlers.onClose?.()
```

修改后 `handleClose` 片段应为：

```ts
  private handleClose(code: number): void {
    this.connected = false
    this.clearTimers()
    this.socket = undefined

    if (this.manualClose) return

    if (!this.ready || code === 4914) {
      const reason = !this.ready ? '网关在 READY 前断开' : '机器人未上线或鉴权失败'
      const error = new Error(reason)
      this.rejectReady?.(error)
      this.rejectReady = undefined
      this.resolveReady = undefined
      this.options.handlers.onError(error)
      return
    }

    this.options.handlers.onClose?.()

    const base = this.options.reconnectBaseMs ?? 1000
    const max = this.options.reconnectMaxMs ?? 60_000
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }
```

- [ ] **Step 2: 写网关 onClose 测试**

在 `packages/adapter-qq/test/gateway.test.ts` 的 `describe('GatewayClient')` 内追加：

```ts
  it('已就绪后断开触发 onClose', async () => {
    const socket = new FakeSocket()
    const onClose = vi.fn()
    const client = new GatewayClient({
      url: 'ws://fake',
      getToken: async () => 'token-1',
      intents: 1 << 25,
      handlers: { onDispatch: vi.fn(), onReady: vi.fn(), onError: vi.fn(), onClose },
      socketFactory: () => socket,
      reconnectBaseMs: 999_999,
      reconnectMaxMs: 999_999
    })

    const ready = client.connect()
    socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
    await Promise.resolve()
    await Promise.resolve()
    socket.emit('message', JSON.stringify({ op: 0, t: 'READY', d: { session_id: 'sess-1' } }))
    await ready

    socket.emit('close', 4000)
    expect(onClose).toHaveBeenCalledTimes(1)

    client.close()
  })
```

- [ ] **Step 3: 运行网关测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/gateway.test.ts
```

预期：PASS。

- [ ] **Step 4: 写失败的服务集成测试**

新建 `packages/adapter-qq/test/service.test.ts`：

```ts
import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import type { QQMessage } from '@arqqbot/shared'
import type { SocketLike } from '../src/gateway'
import { createAdapter } from '../src/index'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

class FakeSocket implements SocketLike {
  private handlers = new Map<string, (...args: any[]) => void>()
  sent: string[] = []
  closed = false

  on(event: string, listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close', 4000)
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.(...args)
  }
}

describe('QQAdapter 服务集成', () => {
  it('连接网关、分发事件并保持旧 send 兼容', async () => {
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('getAppAccessToken')) {
        return jsonResponse({ access_token: 'token-1', expires_in: 7200 })
      }
      if (href.includes('/gateway')) return jsonResponse({ url: 'ws://fake' })
      if (href.includes('/messages')) return jsonResponse({ id: 'reply-1' })
      return jsonResponse({})
    })

    const ctx = new Context()
    const handle = await createAdapter(ctx, {
      appId: 'app',
      appSecret: 'secret',
      env: 'sandbox',
      intents: ['public_messages'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      }
    })

    const messages: QQMessage[] = []
    ctx.on('qq/message', (message) => messages.push(message))

    const connecting = handle.connect()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const socket = sockets[0]!

    socket.emit('open')
    socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
    await Promise.resolve()
    await Promise.resolve()

    const identify = JSON.parse(socket.sent[0]!)
    expect(identify).toMatchObject({ op: 2, d: { intents: 1 << 25 } })

    socket.emit('message', JSON.stringify({ op: 0, t: 'READY', d: { session_id: 'sess-1' } }))
    await connecting

    socket.emit(
      'message',
      JSON.stringify({
        op: 0,
        s: 2,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          group_openid: 'group-1',
          content: 'hi',
          author: { member_openid: 'member-1' }
        }
      })
    )

    await Promise.resolve()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ scene: 'group', groupId: 'group-1' })

    const result = await handle.service!.send({
      scene: 'group',
      targetId: 'group-1',
      content: 'pong',
      msgId: 'msg-1'
    })
    expect(result.messageId).toBe('reply-1')

    await handle.disconnect()
    expect(socket.closed).toBe(true)
  })
})
```

- [ ] **Step 5: 运行服务测试确认失败**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/service.test.ts
```

预期：FAIL，`QQAdapter` 尚未实现 `message` / `media` / `request` / `capabilities`。

- [ ] **Step 6: 重写 service.ts**

把 `packages/adapter-qq/src/service.ts` 替换为：

```ts
import { Service, type Context } from 'cordis'
import type {
  InstanceEnv,
  QQDomainEventName,
  QQIntentName,
  QQMessage,
  QQRawRequest,
  QQSendInput,
  QQSendResult,
  QQService,
  QQStats
} from '@arqqbot/shared'
import { QQCapabilityRegistry } from './core/capability-registry'
import { findEndpoint } from './core/endpoint-catalog'
import { QQApiError as QQApiFailure } from './core/errors'
import { QQHttpClient } from './core/http-client'
import { DEFAULT_INTENTS, resolveIntents } from './core/intent-map'
import { QQEventRouter } from './events/router'
import { GatewayClient, type SocketFactory } from './gateway'
import { formatIncoming, previewContent } from './log-format'
import { MessageDeduper } from './message'
import { QQMediaModule } from './modules/media'
import { QQMessageModule } from './modules/messages'
import { QQSender } from './sender'
import { TokenManager } from './token'

const API_BASES: Record<InstanceEnv, string[]> = {
  production: ['https://api.bot.qq.com', 'https://api.sgroup.qq.com'],
  sandbox: ['https://api.bot.qq.com', 'https://sandbox.api.sgroup.qq.com']
}

export interface QQAdapterConfig {
  appId: string
  appSecret: string
  env: InstanceEnv
  intents?: number | QQIntentName[]
  fetchImpl?: typeof fetch
  socketFactory?: SocketFactory
  baseUrls?: string[]
}

function resolveAdapterIntents(input: number | QQIntentName[] | undefined): number {
  if (typeof input === 'number') return input
  return resolveIntents(input ?? DEFAULT_INTENTS)
}

export class QQAdapter extends Service implements QQService {
  readonly message: QQMessageModule
  readonly media: QQMediaModule
  readonly capabilities: QQCapabilityRegistry

  private readonly token: TokenManager
  private readonly http: QQHttpClient
  private readonly sender: QQSender
  private readonly router: QQEventRouter
  private readonly intentsMask: number
  private readonly deduper = new MessageDeduper()
  private readonly stats = { received: 0, sent: 0 }
  private readonly log: ReturnType<Context['logger']>
  private gateway?: GatewayClient

  constructor(ctx: Context, private readonly config: QQAdapterConfig) {
    super(ctx, 'qq')
    this.log = ctx.logger('qq-adapter')
    this.intentsMask = resolveAdapterIntents(config.intents)

    this.token = new TokenManager({
      appId: config.appId,
      appSecret: config.appSecret,
      fetchImpl: config.fetchImpl
    })

    this.capabilities = new QQCapabilityRegistry({
      env: config.env,
      intents: this.intentsMask
    })

    this.http = new QQHttpClient({
      token: this.token,
      baseUrls: config.baseUrls ?? API_BASES[config.env],
      fetchImpl: config.fetchImpl,
      logger: {
        info: (message) => this.log.info(message),
        warn: (message, error) => this.log.warn(message, error)
      }
    })

    this.message = new QQMessageModule({
      http: this.http,
      capabilities: this.capabilities,
      onSent: (input, result) => this.logSent(input, result)
    })

    this.media = new QQMediaModule({
      http: this.http,
      capabilities: this.capabilities,
      fetchImpl: config.fetchImpl
    })

    this.sender = new QQSender({ messages: this.message })

    this.router = new QQEventRouter({
      emit: (event, payload) => this.emit(event, payload),
      deduper: this.deduper,
      onMessage: (message, event) => this.logIncoming(message, event),
      onUnknown: (type) => this.log.info(`收到暂未处理的 QQ 事件：${type}`)
    })
  }

  async connect(): Promise<void> {
    const url = await this.resolveGatewayUrl()
    const gateway = new GatewayClient({
      url,
      getToken: () => this.token.get(),
      intents: this.intentsMask,
      socketFactory: this.config.socketFactory,
      handlers: {
        onDispatch: (event, data) => {
          this.router.handle(event, data)
        },
        onReady: () => {
          this.ctx.emit('qq/ready')
          this.log.info('QQ 网关已就绪')
        },
        onError: (error) => {
          this.ctx.emit('qq/error', error)
          this.log.error('QQ 网关错误', error)
        },
        onClose: () => {
          this.ctx.emit('qq/disconnect')
          this.log.warn('QQ 网关连接已断开')
        }
      }
    })

    await gateway.connect()
    this.gateway = gateway
  }

  async disconnect(): Promise<void> {
    this.gateway?.close()
    this.gateway = undefined
    this.ctx.emit('qq/disconnect')
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!this.gateway) throw new Error('QQ 适配器尚未连接')
    try {
      return await this.sender.send(input)
    } catch (error) {
      this.log.warn(`发送${input.scene === 'group' ? '群聊' : '单聊'}消息失败`, error)
      throw error
    }
  }

  request<T>(input: QQRawRequest): Promise<T> {
    return this.http.raw<T>(input)
  }

  getStats(): QQStats {
    return {
      connected: this.gateway?.connected ?? false,
      received: this.stats.received,
      sent: this.stats.sent
    }
  }

  private async resolveGatewayUrl(): Promise<string> {
    try {
      const result = await this.http.request<{ url?: unknown }>(findEndpoint('bot.gateway'))
      if (typeof result?.url === 'string') return result.url
      throw new QQApiFailure('SERVER_ERROR', '网关响应缺少 url', { endpointId: 'bot.gateway' })
    } catch (error) {
      const fallback = await this.http.raw<{ url?: unknown }>({
        method: 'GET',
        path: '/gateway/bot'
      })
      if (typeof fallback?.url === 'string') return fallback.url
      throw error
    }
  }

  private emit(event: QQDomainEventName, payload: unknown): void {
    ;(this.ctx.emit as unknown as (name: string, value: unknown) => void)(event, payload)
  }

  private logSent(input: Parameters<QQMessageModule['send']>[0], result: QQSendResult): void {
    const target =
      input.target.scene === 'group'
        ? `群 ${input.target.groupId}`
        : `用户 ${input.target.userId}`
    const preview =
      input.content.type === 'text' ? previewContent(input.content.text) : `[${input.content.type} 消息]`
    const receipt = result.messageId ? `，回执 ${result.messageId}` : ''
    this.log.info(
      `已发送${input.target.scene === 'group' ? '群聊' : '单聊'}消息（${target}${receipt}）：${preview}`
    )
    this.stats.sent += 1
  }

  private logIncoming(message: QQMessage, event: QQDomainEventName): void {
    if (event === 'qq/message') {
      this.stats.received += 1
      this.log.info(formatIncoming(message))
      return
    }
    this.log.info(`收到 ${event} 消息（消息 ${message.id}）`)
  }
}
```

- [ ] **Step 7: 运行服务测试确认通过**

```bash
pnpm --filter @arqqbot/adapter-qq exec vitest run test/service.test.ts test/gateway.test.ts
```

预期：PASS。若 `vi.waitFor` 不存在，改用：

```ts
await new Promise<void>((resolve) => setTimeout(resolve, 0))
```

并在循环中等待 `sockets.length === 1`。

- [ ] **Step 8: 运行适配器全量测试与类型检查**

```bash
pnpm --filter @arqqbot/adapter-qq test
pnpm --filter @arqqbot/adapter-qq typecheck
```

预期：全部 PASS。若类型检查提示 `QQAdapter` 未实现接口，检查 `message` / `media` / `request` / `capabilities` 字段是否与 shared 契约一致。

- [ ] **Step 9: 提交**

```bash
git add packages/adapter-qq/src/gateway.ts packages/adapter-qq/test/gateway.test.ts packages/adapter-qq/src/service.ts packages/adapter-qq/test/service.test.ts
git commit -m "feat(adapter-qq): 集成官方能力门面与事件路由"
```

---

## Task 13: 全仓回归与收尾

**Files:**
- 无新增文件

- [ ] **Step 1: 运行全仓测试**

```bash
pnpm -r test
```

预期：全部 PASS，包括：
- `packages/shared` 既有测试。
- `packages/adapter-qq` 既有 6 个测试文件 + 新增 9 个测试文件。
- `packages/runtime` bootstrap 测试。
- `packages/plugin-echo` echo 回归。

- [ ] **Step 2: 运行全仓类型检查**

```bash
pnpm -r typecheck
```

预期：全部 PASS。

- [ ] **Step 3: 人工核对验收项**

逐项确认：

1. `capabilities.list()` 的能力端点总数等于 47。
2. `ctx.qq.request()` 可调用任意 `/v2/...` 路径，仍携带 `Authorization: QQBot <token>`。
3. `ctx.qq.send()` 在群聊/单聊被动回复下与旧行为一致。
4. echo 插件测试通过，`qq/message` 只承载 c2c/group（群 @ 与单聊）。
5. 22 个官方事件全部有归一化 fixture。
6. 仓库中不存在 Webhook 代码路径。

- [ ] **Step 4: 最终提交**

```bash
git status
git add packages/shared packages/adapter-qq docs/qq-api-v2-endpoints.json
git commit -m "feat(adapter-qq): 完成官方能力内核第一阶段"
```

若前 12 个任务已分别提交，此步骤只应包含遗漏文件；`git status` 必须显示干净或仅剩计划文档。

---

## 自查结果

**Spec 覆盖：**
- 47 个 HTTP 端点：Task 4 目录 + 快照 + 覆盖测试。
- 22 个事件：Task 5 目录 + Task 10 fixture + Task 11 路由。
- 统一 token / HTTP / 错误 / 重试 / 日志：Task 2、Task 6。
- 能力注册表：Task 7。
- `ctx.qq` 门面、`message`、`media`、`request`、`capabilities`：Task 8、Task 9、Task 12。
- 兼容 `ctx.qq.send` / `qq/message` / echo：Task 8、Task 10、Task 12、Task 13。
- 端点未收录返回 `CAPABILITY_UNAVAILABLE`：Task 4 `findEndpoint`、Task 7 `assert`。
- 错误码语义（含 22009 配额）：Task 2。
- 非幂等请求不重试、401 刷新一次、GET 重试与域名回退：Task 6。

**未覆盖（留给 Plan 2）：** 群/频道/互动/菜单/面板/机器人的类型化方法；控制台能力页与 intents 持久化；主动消息授权与配额策略扩展。

**类型一致性：**
- 能力 ID 在 catalog、registry、message/media 模块中一致。
- endpoint ID 在 catalog、message/media 模块、snapshot 中一致。
- `QQSendMessageInput` / `QQMediaUploadInput` / `QQUploadSession` 在 shared 与模块中一致。
- `QQDomainEventName` 在 shared、normalize、router、service 中一致。
