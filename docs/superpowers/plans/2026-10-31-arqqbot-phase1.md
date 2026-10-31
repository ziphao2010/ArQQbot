# ArQQbot 第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task, or dispatch one subagent per task with review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 ArQQbot 第一阶段：可运行的 Cordis 插件运行时、QQ 官方适配器、Electron 多实例控制台、内置 echo 插件与 Windows 安装包。

**Architecture:** Electron 主进程负责实例注册、密钥加密、Worker 生命周期与日志落盘；每个运行实例是一个独立 `utilityProcess`，内部为 Cordis 插件树；QQ 适配器只负责官方接口，插件只消费统一消息对象。

**Tech Stack:** TypeScript、Electron、React、Cordis 4、pnpm workspaces、Vitest、Ajv、zod、ws、electron-vite、electron-builder、Tailwind CSS。

**Spec:** `docs/superpowers/specs/2026-10-31-arqqbot-design.md`

**Package layout:**

```text
packages/shared        # 类型、IPC 契约、manifest/配置校验、插件目录扫描
packages/runtime       # Cordis 启动、服务、插件宿主、Worker 入口
packages/adapter-qq    # Token、网关、消息归一化、去重、回复配额、ctx.qq 服务
packages/plugin-echo   # 内置示例插件
apps/desktop           # Electron 主进程、preload、React 渲染层
```

**依赖版本基线：`cordis@4.0.0-rc.12`（锁定）、`zod@^4.1.5`、`ajv@^8.17.1`、`ws@^8.18.3`。** 若安装时存在更新的补丁版本，只允许升级补丁号，不允许改主版本。

---

## Task 1: 初始化 Monorepo 与共享契约

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/services.ts`
- Create: `packages/shared/src/ipc.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: 写入仓库根配置**

`package.json`

```json
{
  "name": "arqqbot",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
allowBuilds:
  electron-winstaller: false
  esbuild: true
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`

```gitignore
node_modules/
dist/
out/
release/
coverage/
*.log
.env
.env.*
.DS_Store
```

- [ ] **Step 2: 写入 shared 包配置**

`packages/shared/package.json`

```json
{
  "name": "@arqqbot/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "cordis": "4.0.0-rc.12",
    "zod": "^4.1.5"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/shared/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写入共享类型**

`packages/shared/src/types.ts`

```ts
export type InstanceEnv = 'sandbox' | 'production'

export type InstanceRuntimeState =
  | 'created'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'crashed'

export type PluginRuntimeState =
  | 'discovered'
  | 'enabled'
  | 'activating'
  | 'active'
  | 'error'
  | 'disabled'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface InstanceRecord {
  id: string
  name: string
  appId: string
  secretRef: string
  env: InstanceEnv
  createdAt: string
  updatedAt: string
}

export interface InstanceSummary {
  id: string
  name: string
  appId: string
  env: InstanceEnv
  createdAt: string
  updatedAt: string
  state: InstanceRuntimeState
  requiresRestart: boolean
}

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface JsonSchema {
  type: JsonSchemaType
  title?: string
  description?: string
  default?: unknown
  enum?: Array<string | number>
  minimum?: number
  maximum?: number
  format?: 'password' | 'textarea' | 'select'
  secret?: boolean
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  displayName: string
  description: string
  schema: JsonSchema
  defaultConfig: Record<string, unknown>
}

export interface PluginRecord {
  id: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface PluginSummary {
  id: string
  displayName: string
  description: string
  version: string
  enabled: boolean
  runtimeState: PluginRuntimeState
  error?: string
  schema: JsonSchema
  config: Record<string, unknown>
  defaultConfig: Record<string, unknown>
}

export interface LogEntry {
  time: string
  level: LogLevel
  message: string
  pluginId?: string
  data?: unknown
}

export interface ErrorInfo {
  code: string
  message: string
  details?: unknown
}

export interface CreateInstanceInput {
  name: string
  appId: string
  appSecret: string
  env: InstanceEnv
}

export interface UpdateInstanceInput {
  name?: string
  appId?: string
  appSecret?: string
  env?: InstanceEnv
}

export interface InstanceStatus {
  id: string
  state: InstanceRuntimeState
  connected: boolean
  startedAt?: string
  sent: number
  received: number
  lastError?: ErrorInfo
}

export interface PluginCatalogItem {
  manifest: PluginManifest
  entryPath: string
  source: 'builtin' | 'external'
}

export interface WorkerStartConfig {
  instanceId: string
  appId: string
  appSecret: string
  env: InstanceEnv
  dataDir: string
  catalog: PluginCatalogItem[]
  plugins: PluginRecord[]
}

export type WorkerRequest =
  | { type: 'start'; requestId: string; config: WorkerStartConfig }
  | { type: 'stop'; requestId: string }
  | { type: 'applyPluginConfig'; requestId: string; pluginId: string; config: Record<string, unknown> }
  | { type: 'setPluginEnabled'; requestId: string; pluginId: string; enabled: boolean }
  | { type: 'getStatus'; requestId: string }

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'status'; status: InstanceStatus }
  | { type: 'log'; entry: LogEntry }
  | { type: 'pluginState'; pluginId: string; state: PluginRuntimeState; error?: string }
  | { type: 'response'; requestId: string; ok: true; result?: unknown }
  | { type: 'response'; requestId: string; ok: false; error: ErrorInfo }

export interface QQMessage {
  id: string
  scene: 'c2c' | 'group'
  userId: string
  groupId?: string
  content: string
  mentions: string[]
  attachments: Array<{ contentType: string; url: string; filename?: string; size?: number }>
  timestamp: string
  raw: unknown
}

export interface QQSendInput {
  scene: 'c2c' | 'group'
  targetId: string
  content: string
  msgId?: string
}

export interface QQSendResult {
  messageId?: string
}

export interface QQStats {
  connected: boolean
  received: number
  sent: number
}
```

- [ ] **Step 4: 写入服务契约与类型声明合并**

`packages/shared/src/services.ts`

```ts
import type {} from 'cordis'
import type { QQMessage, QQSendInput, QQSendResult, QQStats } from './types'

export interface QQService {
  send(input: QQSendInput): Promise<QQSendResult>
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

- [ ] **Step 5: 写入 IPC 契约**

`packages/shared/src/ipc.ts`

```ts
import { z } from 'zod'

export const IPC_CHANNELS = {
  instancesList: 'instances:list',
  instancesCreate: 'instances:create',
  instancesUpdate: 'instances:update',
  instancesRemove: 'instances:remove',
  instanceStart: 'instance:start',
  instanceStop: 'instance:stop',
  instanceRestart: 'instance:restart',
  instanceStatus: 'instance:status',
  pluginsList: 'plugins:list',
  pluginsEnable: 'plugins:enable',
  pluginsDisable: 'plugins:disable',
  pluginsUpdateConfig: 'plugins:update-config',
  logsSubscribe: 'logs:subscribe',
  logsUnsubscribe: 'logs:unsubscribe',
  logsEntry: 'logs:entry'
} as const

export const idSchema = z.string().min(1)

export const createInstanceSchema = z.object({
  name: z.string().trim().min(1).max(64),
  appId: z.string().trim().min(1),
  appSecret: z.string().min(1),
  env: z.enum(['sandbox', 'production'])
})

export const updateInstanceSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  appId: z.string().trim().min(1).optional(),
  appSecret: z.string().min(1).optional(),
  env: z.enum(['sandbox', 'production']).optional()
})

export const updatePluginConfigSchema = z.object({
  instanceId: z.string().min(1),
  pluginId: z.string().min(1),
  config: z.record(z.string(), z.unknown())
})

export type CreateInstancePayload = z.infer<typeof createInstanceSchema>
export type UpdateInstancePayload = z.infer<typeof updateInstanceSchema>
export type UpdatePluginConfigPayload = z.infer<typeof updatePluginConfigSchema>
```

`packages/shared/src/index.ts`

```ts
export * from './types'
export * from './services'
export * from './ipc'
```

- [ ] **Step 6: 安装依赖并类型检查**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/shared typecheck
```

Expected: `pnpm install --no-frozen-lockfile` 成功，`typecheck` 无输出并以退出码 0 结束。

- [ ] **Step 7: 提交**

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml packages/shared
git commit -m "chore: scaffold monorepo and shared contracts"
```

---

## Task 2: Manifest 与插件配置校验

**Files:**
- Create: `packages/shared/src/manifest.ts`
- Create: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/manifest.test.ts`
- Test: `packages/shared/test/config.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/shared/test/manifest.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { ManifestError, parsePluginManifest } from '../src/manifest'

const validPackage = {
  name: 'arqqbot-plugin-echo',
  version: '0.1.0',
  arqqbot: {
    id: 'echo',
    displayName: '回显插件',
    description: '把收到的消息原样回复',
    schema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', title: '前缀', default: '收到：' }
      }
    },
    defaultConfig: { prefix: '收到：' }
  }
}

describe('parsePluginManifest', () => {
  it('解析合法 manifest', () => {
    const manifest = parsePluginManifest(validPackage)
    expect(manifest).toMatchObject({
      id: 'echo',
      name: 'arqqbot-plugin-echo',
      version: '0.1.0',
      displayName: '回显插件'
    })
    expect(manifest.schema.type).toBe('object')
  })

  it('拒绝非法插件 id', () => {
    const invalid = { ...validPackage, arqqbot: { ...validPackage.arqqbot, id: 'Echo' } }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })

  it('拒绝不支持的 Schema 关键字', () => {
    const invalid = {
      ...validPackage,
      arqqbot: {
        ...validPackage.arqqbot,
        schema: { type: 'object', additionalProperties: true }
      }
    }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })

  it('拒绝非 object 顶层 Schema', () => {
    const invalid = {
      ...validPackage,
      arqqbot: { ...validPackage.arqqbot, schema: { type: 'string' } }
    }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })
})
```

`packages/shared/test/config.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { validatePluginConfig } from '../src/config'
import { parsePluginManifest } from '../src/manifest'

const manifest = parsePluginManifest({
  name: 'arqqbot-plugin-ai-chat',
  version: '0.1.0',
  arqqbot: {
    id: 'ai-chat',
    displayName: 'AI 对话',
    description: '',
    schema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', default: 'https://api.openai.com/v1' },
        apiKey: { type: 'string', secret: true },
        model: { type: 'string', default: 'gpt-4o-mini' },
        maxContext: { type: 'number', default: 20, minimum: 1, maximum: 100 }
      },
      required: ['apiKey', 'model']
    },
    defaultConfig: {}
  }
})

describe('validatePluginConfig', () => {
  it('应用默认值并返回合法配置', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://api.openai.com/v1')
      expect(result.value.model).toBe('gpt-4o-mini')
      expect(result.value.maxContext).toBe(20)
    }
  })

  it('缺少必填字段时返回字段级错误', () => {
    const result = validatePluginConfig(manifest, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/apiKey')).toBe(true)
    }
  })

  it('类型错误时返回字段级错误', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test', model: 'x', maxContext: 'many' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/maxContext')).toBe(true)
    }
  })

  it('拒绝未知字段', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test', model: 'x', extra: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/' || item.path === '')).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/shared test
```

Expected: FAIL，提示无法找到 `../src/manifest` 与 `../src/config`。

- [ ] **Step 3: 实现 manifest 解析**

`packages/shared/src/manifest.ts`

```ts
import { z } from 'zod'
import type { JsonSchema, PluginManifest } from './types'

const jsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
      title: z.string().optional(),
      description: z.string().optional(),
      default: z.unknown().optional(),
      enum: z.array(z.union([z.string(), z.number()])).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      format: z.enum(['password', 'textarea', 'select']).optional(),
      secret: z.boolean().optional(),
      properties: z.record(z.string(), jsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchemaSchema.optional()
    })
    .strict()
)

const arqqbotSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1),
    description: z.string().default(''),
    schema: jsonSchemaSchema.refine((value) => value.type === 'object', {
      message: '配置 Schema 顶层必须是 object'
    }),
    defaultConfig: z.record(z.string(), z.unknown()).default({})
  })
  .strict()

const packageSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    arqqbot: arqqbotSchema
  })
  .passthrough()

export class ManifestError extends Error {
  readonly issues?: unknown

  constructor(message: string, issues?: unknown) {
    super(message)
    this.name = 'ManifestError'
    this.issues = issues
  }
}

export function parsePluginManifest(pkg: unknown): PluginManifest {
  const result = packageSchema.safeParse(pkg)
  if (!result.success) {
    throw new ManifestError('插件 manifest 不合法', result.error.issues)
  }
  return {
    id: result.data.arqqbot.id,
    name: result.data.name,
    version: result.data.version,
    displayName: result.data.arqqbot.displayName,
    description: result.data.arqqbot.description,
    schema: result.data.arqqbot.schema,
    defaultConfig: result.data.arqqbot.defaultConfig
  }
}
```

- [ ] **Step 4: 实现配置校验**

`packages/shared/src/config.ts`

```ts
import Ajv from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { JsonSchema, PluginManifest } from './types'

export interface ConfigIssue {
  path: string
  message: string
}

export type ConfigValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ConfigIssue[] }

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false })

function toAjvSchema(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type }
  if (schema.default !== undefined) result.default = schema.default
  if (schema.enum) result.enum = schema.enum
  if (schema.minimum !== undefined) result.minimum = schema.minimum
  if (schema.maximum !== undefined) result.maximum = schema.maximum
  if (schema.required) result.required = schema.required
  if (schema.items) result.items = toAjvSchema(schema.items)
  if (schema.properties) {
    const properties: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(schema.properties)) {
      properties[key] = toAjvSchema(child)
    }
    result.properties = properties
  }
  result.additionalProperties = false
  return result
}

const validators = new WeakMap<PluginManifest, ValidateFunction>()

function compile(manifest: PluginManifest): ValidateFunction {
  const cached = validators.get(manifest)
  if (cached) return cached
  const validator = ajv.compile(toAjvSchema(manifest.schema))
  validators.set(manifest, validator)
  return validator
}

function toIssue(error: ErrorObject): ConfigIssue {
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: string }).missingProperty
    if (missing) {
      return { path: `${error.instancePath}/${missing}`, message: error.message ?? '配置不合法' }
    }
  }
  return {
    path: error.instancePath || '/',
    message: error.message ?? '配置不合法'
  }
}

export function validatePluginConfig(
  manifest: PluginManifest,
  input: Record<string, unknown>
): ConfigValidationResult {
  const value = structuredClone(input)
  const validate = compile(manifest)
  if (validate(value)) {
    return { ok: true, value: value as Record<string, unknown> }
  }
  return { ok: false, errors: (validate.errors ?? []).map(toIssue) }
}
```

- [ ] **Step 5: 导出新增模块**

`packages/shared/src/index.ts`

```ts
export * from './types'
export * from './services'
export * from './ipc'
export * from './manifest'
export * from './config'
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```powershell
pnpm --filter @arqqbot/shared test
pnpm --filter @arqqbot/shared typecheck
```

Expected: 8 个测试全部 PASS，类型检查退出码 0。

- [ ] **Step 7: 提交**

```powershell
git add packages/shared
git commit -m "feat(shared): validate plugin manifests and configs"
```

---

## Task 3: 插件目录扫描与运行时基础服务

**Files:**
- Create: `packages/shared/src/catalog.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/catalog.test.ts`
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/tsup.config.ts`
- Create: `packages/runtime/src/services/storage.ts`
- Test: `packages/runtime/test/storage.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/shared/test/catalog.test.ts`

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanPluginCatalog } from '../src/catalog'

async function writePlugin(root: string, dir: string, id: string) {
  const pluginDir = path.join(root, dir)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({
      name: `arqqbot-plugin-${id}`,
      version: '0.1.0',
      main: 'dist/index.js',
      arqqbot: {
        id,
        displayName: id,
        description: '',
        schema: { type: 'object', properties: {} },
        defaultConfig: {}
      }
    }),
    'utf8'
  )
}

describe('scanPluginCatalog', () => {
  it('扫描内置与外部插件并按 id 去重', async () => {
    const builtin = await mkdtemp(path.join(tmpdir(), 'arqqbot-builtin-'))
    const external = await mkdtemp(path.join(tmpdir(), 'arqqbot-external-'))
    await writePlugin(builtin, 'plugin-echo', 'echo')
    await writePlugin(external, 'plugin-echo-copy', 'echo')
    await writePlugin(external, 'plugin-weather', 'weather')

    const result = await scanPluginCatalog([
      { path: builtin, source: 'builtin' },
      { path: external, source: 'external' }
    ])

    expect(result.items.map((item) => item.manifest.id)).toEqual(['echo', 'weather'])
    expect(result.items[0]?.source).toBe('builtin')
    expect(result.items[1]?.source).toBe('external')
    expect(result.warnings[0]?.message).toContain('插件 id 重复')
  })

  it('跳过没有 arqqbot 字段的目录', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-empty-'))
    await mkdir(path.join(root, 'not-a-plugin'), { recursive: true })
    await writeFile(path.join(root, 'not-a-plugin', 'package.json'), '{"name":"x","version":"1.0.0"}')

    const result = await scanPluginCatalog([{ path: root, source: 'external' }])
    expect(result.items).toEqual([])
  })
})
```

`packages/runtime/test/storage.test.ts`

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { StorageService } from '../src/services/storage'

describe('StorageService', () => {
  it('读写与删除 JSON 数据', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arqqbot-storage-'))
    const ctx = new Context()
    await ctx.plugin(StorageService, { dir })

    await ctx.storage.set('session/group-1', { messages: ['hi'] })
    expect(await ctx.storage.get<{ messages: string[] }>('session/group-1')).toEqual({ messages: ['hi'] })

    await ctx.storage.delete('session/group-1')
    expect(await ctx.storage.get('session/group-1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/shared test
pnpm --filter @arqqbot/runtime test
```

Expected: shared 测试因缺少 `../src/catalog` 失败；runtime 目录尚不存在，命令失败。

- [ ] **Step 3: 实现插件目录扫描**

`packages/shared/src/catalog.ts`

```ts
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parsePluginManifest } from './manifest'
import type { PluginCatalogItem } from './types'

export interface CatalogRoot {
  path: string
  source: 'builtin' | 'external'
}

export interface CatalogWarning {
  path: string
  message: string
}

export interface CatalogResult {
  items: PluginCatalogItem[]
  warnings: CatalogWarning[]
}

export async function scanPluginCatalog(roots: CatalogRoot[]): Promise<CatalogResult> {
  const items: PluginCatalogItem[] = []
  const warnings: CatalogWarning[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    let names: string[]
    try {
      names = await readdir(root.path)
    } catch {
      continue
    }

    for (const name of names) {
      const pluginDir = path.join(root.path, name)
      const pkgPath = path.join(pluginDir, 'package.json')

      try {
        const pkgStat = await stat(pkgPath)
        if (!pkgStat.isFile()) continue

        const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
          arqqbot?: unknown
          main?: string
        }
        if (!pkg.arqqbot) continue

        const manifest = parsePluginManifest(pkg)
        if (seen.has(manifest.id)) {
          warnings.push({ path: pluginDir, message: `插件 id 重复，已跳过：${manifest.id}` })
          continue
        }

        seen.add(manifest.id)
        items.push({
          manifest,
          entryPath: path.resolve(pluginDir, pkg.main ?? 'dist/index.js'),
          source: root.source
        })
      } catch (error) {
        warnings.push({
          path: pluginDir,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  return { items, warnings }
}
```

`packages/shared/package.json` 修改 `exports` 与 `scripts`：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./node": "./src/catalog.ts"
  }
}
```

- [ ] **Step 4: 实现 runtime 包配置**

`packages/runtime/package.json`

```json
{
  "name": "@arqqbot/runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@arqqbot/shared": "workspace:*",
    "cordis": "4.0.0-rc.12"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsup": "^8.5.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/runtime/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`packages/runtime/tsup.config.ts`

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/worker-entry.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  bundle: true,
  noExternal: ['@arqqbot/adapter-qq', '@arqqbot/shared', 'cordis', 'ws'],
  external: ['electron', 'bufferutil', 'utf-8-validate']
})
```

`packages/runtime/src/services/storage.ts`

```ts
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Service, type Context } from 'cordis'

export interface StorageOptions {
  dir: string
}

export class StorageService extends Service {
  private readonly dir: string

  constructor(ctx: Context, options: StorageOptions) {
    super(ctx, 'storage')
    this.dir = options.dir
  }

  private filePath(key: string): string {
    return path.join(this.dir, `${Buffer.from(key).toString('base64url')}.json`)
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const content = await readFile(this.filePath(key), 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const file = this.filePath(key)
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(value), 'utf8')
    await rename(temp, file)
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
```

- [ ] **Step 5: 运行测试与类型检查**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/shared test
pnpm --filter @arqqbot/runtime test
pnpm --filter @arqqbot/shared typecheck
pnpm --filter @arqqbot/runtime typecheck
```

Expected: 所有测试 PASS；类型检查退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add packages/shared packages/runtime pnpm-lock.yaml
git commit -m "feat(runtime): add plugin catalog and storage service"
```

---

## Task 4: Cordis 插件宿主

**Files:**
- Create: `packages/runtime/src/plugin-host.ts`
- Test: `packages/runtime/test/plugin-host.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/runtime/test/plugin-host.test.ts`

```ts
import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import type { PluginCatalogItem, PluginRecord } from '@arqqbot/shared'
import { PluginHost } from '../src/plugin-host'

function makePlugin(log: string[], failOn?: string) {
  return (ctx: Context, config: { prefix: string }) => {
    if (failOn === config.prefix) throw new Error(`boom:${config.prefix}`)
    log.push(`apply:${config.prefix}`)
    ctx.effect(() => () => log.push(`dispose:${config.prefix}`))
  }
}

function entry(id: string, path: string): PluginCatalogItem {
  return {
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      displayName: id,
      description: '',
      schema: { type: 'object', properties: {} },
      defaultConfig: {}
    },
    entryPath: path,
    source: 'builtin'
  }
}

describe('PluginHost', () => {
  it('挂载启用插件，忽略禁用插件', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([
      ['a', entry('a', '/fake/a.js')],
      ['b', entry('b', '/fake/b.js')]
    ])
    const records: PluginRecord[] = [
      { id: 'a', enabled: true, config: { prefix: 'A' } },
      { id: 'b', enabled: false, config: { prefix: 'B' } }
    ]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async (path) => {
        if (path === '/fake/a.js') return makePlugin(log)
        return makePlugin(log)
      },
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    expect(log).toEqual(['apply:A'])
    expect(host.getState('a')).toBe('active')
    expect(host.getState('b')).toBe('disabled')
  })

  it('热重载配置时先销毁旧实例再挂载新实例', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([['a', entry('a', '/fake/a.js')]])
    const records: PluginRecord[] = [{ id: 'a', enabled: true, config: { prefix: 'A' } }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => makePlugin(log),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    await host.applyConfig('a', { prefix: 'B' })
    expect(log).toEqual(['apply:A', 'dispose:A', 'apply:B'])
    expect(host.getState('a')).toBe('active')
  })

  it('新配置失败时回滚旧配置并标记 error', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([['a', entry('a', '/fake/a.js')]])
    const records: PluginRecord[] = [{ id: 'a', enabled: true, config: { prefix: 'A' } }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => makePlugin(log, 'bad'),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    await expect(host.applyConfig('a', { prefix: 'bad' })).rejects.toThrow('boom:bad')
    expect(log).toEqual(['apply:A', 'dispose:A', 'apply:A'])
    expect(host.getState('a')).toBe('error')
    expect(host.getRecord('a')?.config).toEqual({ prefix: 'A' })
  })

  it('一个插件激活失败不影响其他插件', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([
      ['bad', entry('bad', '/fake/bad.js')],
      ['good', entry('good', '/fake/good.js')]
    ])
    const records: PluginRecord[] = [
      { id: 'bad', enabled: true, config: { prefix: 'bad' } },
      { id: 'good', enabled: true, config: { prefix: 'good' } }
    ]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async (path) =>
        path === '/fake/bad.js' ? makePlugin(log, 'bad') : makePlugin(log),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    expect(host.getState('bad')).toBe('error')
    expect(host.getState('good')).toBe('active')
    expect(log).toContain('apply:good')
  })

  it('挂载超时会标记 error', async () => {
    const ctx = new Context()
    const catalog = new Map([['slow', entry('slow', '/fake/slow.js')]])
    const records: PluginRecord[] = [{ id: 'slow', enabled: true, config: {} }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return () => undefined
      },
      mountTimeoutMs: 10
    })

    await host.mountAll()
    expect(host.getState('slow')).toBe('error')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/runtime test
```

Expected: FAIL，提示无法找到 `../src/plugin-host`。

- [ ] **Step 3: 实现插件宿主**

`packages/runtime/src/plugin-host.ts`

```ts
import type { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import type {
  PluginCatalogItem,
  PluginRecord,
  PluginRuntimeState
} from '@arqqbot/shared'

type DisposableFork = { dispose(): void | Promise<void> }
export type ModuleLoader = (entryPath: string) => Promise<unknown>

export interface PluginHostOptions {
  ctx: Context
  catalog: Map<string, PluginCatalogItem>
  records: PluginRecord[]
  loadModule?: ModuleLoader
  onState?: (pluginId: string, state: PluginRuntimeState, error?: string) => void
  mountTimeoutMs?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function resolvePlugin(module: unknown): unknown {
  if (typeof module === 'function') return module
  if (module && typeof module === 'object') {
    const record = module as Record<string, unknown>
    if (record.default) return record.default
    if (typeof record.apply === 'function') return module
  }
  throw new Error('插件入口必须导出 Cordis 插件')
}

export class PluginHost {
  private readonly ctx: Context
  private readonly catalog: Map<string, PluginCatalogItem>
  private readonly records: Map<string, PluginRecord>
  private readonly loadModule: ModuleLoader
  private readonly onState?: (pluginId: string, state: PluginRuntimeState, error?: string) => void
  private readonly mountTimeoutMs: number
  private readonly forks = new Map<string, DisposableFork>()
  private readonly states = new Map<string, PluginRuntimeState>()
  private readonly errors = new Map<string, string>()

  constructor(options: PluginHostOptions) {
    this.ctx = options.ctx
    this.catalog = options.catalog
    this.records = new Map(options.records.map((record) => [record.id, { ...record }]))
    this.loadModule = options.loadModule ?? (async (entryPath) => import(pathToFileURL(entryPath).href))
    this.onState = options.onState
    this.mountTimeoutMs = options.mountTimeoutMs ?? 5000
  }

  getState(pluginId: string): PluginRuntimeState | undefined {
    return this.states.get(pluginId)
  }

  getError(pluginId: string): string | undefined {
    return this.errors.get(pluginId)
  }

  getRecord(pluginId: string): PluginRecord | undefined {
    return this.records.get(pluginId)
  }

  private setState(pluginId: string, state: PluginRuntimeState, error?: string): void {
    this.states.set(pluginId, state)
    if (error === undefined) this.errors.delete(pluginId)
    else this.errors.set(pluginId, error)
    this.onState?.(pluginId, state, error)
  }

  private async mount(record: PluginRecord): Promise<void> {
    const catalogItem = this.catalog.get(record.id)
    if (!catalogItem) {
      const message = `未找到插件：${record.id}`
      this.setState(record.id, 'error', message)
      throw new Error(message)
    }

    this.setState(record.id, 'activating')
    let fork: DisposableFork | undefined
    try {
      const module = await withTimeout(
        this.loadModule(catalogItem.entryPath),
        this.mountTimeoutMs,
        `插件挂载超时：${record.id}`
      )
      const plugin = resolvePlugin(module)
      fork = this.ctx.plugin(plugin as never, record.config as never) as unknown as DisposableFork
      await withTimeout(Promise.resolve(fork), this.mountTimeoutMs, `插件挂载超时：${record.id}`)
      this.forks.set(record.id, fork)
      this.setState(record.id, 'active')
    } catch (error) {
      await fork?.dispose()
      const message = error instanceof Error ? error.message : String(error)
      this.setState(record.id, 'error', message)
      throw error
    }
  }

  async mountAll(): Promise<void> {
    for (const record of this.records.values()) {
      if (!record.enabled) {
        this.setState(record.id, 'disabled')
        continue
      }
      try {
        await this.mount(record)
      } catch {
        // 单个插件失败不阻断其他插件，错误已记录在状态中
      }
    }
  }

  async applyConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`未找到插件：${pluginId}`)

    const previous = record.config
    if (!record.enabled) {
      record.config = config
      return
    }

    const fork = this.forks.get(pluginId)
    await fork?.dispose()
    this.forks.delete(pluginId)
    record.config = config

    try {
      await this.mount(record)
    } catch (error) {
      record.config = previous
      try {
        await this.mount(record)
      } catch {
        // 回滚也失败时保留 error 状态
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setState(pluginId, 'error', message)
      throw error
    }
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`未找到插件：${pluginId}`)
    if (record.enabled === enabled) return

    if (!enabled) {
      const fork = this.forks.get(pluginId)
      await fork?.dispose()
      this.forks.delete(pluginId)
      record.enabled = false
      this.setState(pluginId, 'disabled')
      return
    }

    record.enabled = true
    try {
      await this.mount(record)
    } catch (error) {
      record.enabled = false
      throw error
    }
  }

  async disposeAll(): Promise<void> {
    for (const fork of this.forks.values()) await fork.dispose()
    this.forks.clear()
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
pnpm --filter @arqqbot/runtime test
```

Expected: 5 个插件宿主测试全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/runtime
git commit -m "feat(runtime): add Cordis plugin host with hot reload"
```

---

## Task 5: 内置 echo 插件

**Files:**
- Create: `packages/plugin-echo/package.json`
- Create: `packages/plugin-echo/tsconfig.json`
- Create: `packages/plugin-echo/src/index.ts`
- Test: `packages/plugin-echo/test/echo.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/plugin-echo/test/echo.test.ts`

```ts
import { Context, Service } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { QQMessage, QQSendInput, QQStats } from '@arqqbot/shared'
import * as Echo from '../src/index'

class FakeQQ extends Service {
  sent: QQSendInput[] = []

  constructor(ctx: Context) {
    super(ctx, 'qq')
  }

  async send(input: QQSendInput): Promise<{}> {
    this.sent.push(input)
    return {}
  }

  getStats(): QQStats {
    return { connected: true, received: 0, sent: this.sent.length }
  }
}

const message: QQMessage = {
  id: 'msg-1',
  scene: 'group',
  userId: 'member-1',
  groupId: 'group-1',
  content: '你好',
  mentions: [],
  attachments: [],
  timestamp: '2026-10-31T10:00:00+08:00',
  raw: {}
}

describe('echo plugin', () => {
  it('收到群消息后回复并携带 msgId', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeQQ)
    await ctx.plugin(Echo, { prefix: '收到：' })

    ctx.emit('qq/message', message)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const qq = ctx.qq as unknown as FakeQQ
    expect(qq.sent).toEqual([
      {
        scene: 'group',
        targetId: 'group-1',
        content: '收到：你好',
        msgId: 'msg-1'
      }
    ])
  })

  it('单聊消息使用 userId 作为目标', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeQQ)
    await ctx.plugin(Echo, { prefix: '' })

    ctx.emit('qq/message', { ...message, scene: 'c2c', groupId: undefined, userId: 'user-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const qq = ctx.qq as unknown as FakeQQ
    expect(qq.sent[0]).toMatchObject({ scene: 'c2c', targetId: 'user-1', content: '你好' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter arqqbot-plugin-echo test
```

Expected: 包尚不存在，命令失败。

- [ ] **Step 3: 实现插件包与 manifest**

`packages/plugin-echo/package.json`

```json
{
  "name": "arqqbot-plugin-echo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format esm --platform node --out-dir dist --external cordis",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "arqqbot": {
    "id": "echo",
    "displayName": "回显插件",
    "description": "把收到的消息加上前缀后回复，用于验证消息全链路",
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
  },
  "dependencies": {
    "@arqqbot/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "cordis": "4.0.0-rc.12",
    "tsup": "^8.5.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/plugin-echo/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 实现 echo 插件**

`packages/plugin-echo/src/index.ts`

```ts
import type { Context } from 'cordis'
import type { QQMessage } from '@arqqbot/shared'

export interface Config {
  prefix: string
}

export const name = 'echo'
export const inject = ['qq']

export function apply(ctx: Context, config: Config): void {
  ctx.on('qq/message', async (message: QQMessage) => {
    const targetId = message.scene === 'group' ? message.groupId : message.userId
    if (!targetId) return

    try {
      await ctx.qq.send({
        scene: message.scene,
        targetId,
        content: `${config.prefix}${message.content}`,
        msgId: message.id
      })
    } catch (error) {
      ctx.logger.warn('echo 插件发送失败', error, 'echo')
    }
  })
}
```

- [ ] **Step 5: 运行测试与类型检查**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter arqqbot-plugin-echo test
pnpm --filter arqqbot-plugin-echo typecheck
```

Expected: 2 个测试 PASS；类型检查退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add packages/plugin-echo pnpm-lock.yaml
git commit -m "feat(plugin-echo): add built-in echo plugin"
```

---

## Task 6: QQ 鉴权与 WebSocket 网关

**Files:**
- Create: `packages/adapter-qq/package.json`
- Create: `packages/adapter-qq/tsconfig.json`
- Create: `packages/adapter-qq/src/token.ts`
- Create: `packages/adapter-qq/src/gateway.ts`
- Test: `packages/adapter-qq/test/token.test.ts`
- Test: `packages/adapter-qq/test/gateway.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/adapter-qq/test/token.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import { QQAuthError, TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('TokenManager', () => {
  it('首次获取 token 并缓存', async () => {
    let now = 0
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })

    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now
    })

    expect(await manager.get()).toBe('token-1')
    now = 7_000_000
    expect(await manager.get()).toBe('token-1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('到期前刷新 token', async () => {
    let now = 0
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now
    })

    expect(await manager.get()).toBe('token-1')
    now = 7_200_000
    expect(await manager.get()).toBe('token-2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('非 200 响应抛出 QQAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'invalid app' }, 401))
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(manager.get()).rejects.toBeInstanceOf(QQAuthError)
  })

  it('响应缺少字段抛出 QQAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'x' }))
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(manager.get()).rejects.toBeInstanceOf(QQAuthError)
  })

  it('兼容字符串 expires_in 并使用 clientSecret 请求', async () => {
    let requestBody = ''
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? '')
      return jsonResponse({ access_token: 'token-1', expires_in: '7200' })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(await manager.get()).toBe('token-1')
    expect(requestBody).toContain('"clientSecret":"app-secret"')
  })
})
```

`packages/adapter-qq/test/gateway.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayClient, type SocketLike } from '../src/gateway'

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

afterEach(() => {
  vi.useRealTimers()
})

describe('GatewayClient', () => {
  it('完成 Hello、Identify、READY 并分发事件', async () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const onDispatch = vi.fn()
    const onReady = vi.fn()
    const onError = vi.fn()
    const client = new GatewayClient({
      url: 'ws://fake',
      getToken: async () => 'token-1',
      intents: 1 << 25,
      handlers: { onDispatch, onReady, onError },
      socketFactory: () => socket,
      reconnectBaseMs: 10,
      reconnectMaxMs: 20
    })

    const ready = client.connect()
    socket.emit('open')
    socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
    await Promise.resolve()
    await Promise.resolve()

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      op: 2,
      d: { token: 'QQBot token-1', intents: 1 << 25, shard: [0, 1] }
    })

    socket.emit('message', JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess-1' } }))
    await ready
    expect(client.connected).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ op: 1, d: 1 })

    socket.emit('message', JSON.stringify({ op: 0, s: 2, t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'm-1' } }))
    expect(onDispatch).toHaveBeenCalledWith('GROUP_AT_MESSAGE_CREATE', { id: 'm-1' })

    client.close()
    expect(socket.closed).toBe(true)
  })

  it('READY 前断开时拒绝 connect', async () => {
    const socket = new FakeSocket()
    const client = new GatewayClient({
      url: 'ws://fake',
      getToken: async () => 'token-1',
      intents: 1 << 25,
      handlers: { onDispatch: vi.fn(), onReady: vi.fn(), onError: vi.fn() },
      socketFactory: () => socket
    })

    const ready = client.connect()
    socket.emit('open')
    socket.emit('close', 4914)
    await expect(ready).rejects.toThrow('网关在 READY 前断开')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/adapter-qq test
```

Expected: FAIL，提示无法找到 `../src/token` 与 `../src/gateway`。

- [ ] **Step 3: 创建适配器包**

`packages/adapter-qq/package.json`

```json
{
  "name": "@arqqbot/adapter-qq",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@arqqbot/shared": "workspace:*",
    "cordis": "4.0.0-rc.12",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "@types/ws": "^8.18.1",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/adapter-qq/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 实现 TokenManager**

`packages/adapter-qq/src/token.ts`

```ts
export class QQAuthError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'QQAuthError'
    this.status = status
  }
}

export interface TokenManagerOptions {
  appId: string
  appSecret: string
  fetchImpl?: typeof fetch
  now?: () => number
  endpoint?: string
  refreshAheadMs?: number
}

interface TokenState {
  value: string
  expiresAt: number
}

type SecretField = 'clientSecret' | 'appSecret'

export class TokenManager {
  private readonly fetchImpl: typeof fetch
  private readonly nowFn: () => number
  private readonly endpoint: string
  private readonly refreshAheadMs: number
  private state?: TokenState
  private pending?: Promise<string>

  constructor(private readonly options: TokenManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowFn = options.now ?? Date.now
    this.endpoint = options.endpoint ?? 'https://api.bot.qq.com/app/getAppAccessToken'
    this.refreshAheadMs = options.refreshAheadMs ?? 60_000
  }

  async get(): Promise<string> {
    if (this.state && this.state.expiresAt - this.refreshAheadMs > this.nowFn()) {
      return this.state.value
    }
    if (this.pending) return this.pending

    this.pending = this.refresh().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async request(endpoint: string, field: SecretField): Promise<string> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: this.options.appId,
        [field]: this.options.appSecret
      })
    })

    const raw = await response.text()
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      body = {}
    }

    if (!response.ok) {
      const code = body.code ?? body.errcode
      const message = body.message ?? body.msg
      const detail = [
        `HTTP ${response.status}`,
        code !== undefined ? `code=${String(code)}` : '',
        message !== undefined ? String(message) : ''
      ]
        .filter(Boolean)
        .join(' ')
      throw new QQAuthError(`获取 access_token 失败：${detail}`, response.status)
    }

    if (typeof body.access_token !== 'string') {
      const keys = Object.keys(body).join(',') || 'empty'
      throw new QQAuthError(
        `获取 access_token 失败：响应缺少 access_token（字段：${keys}）`,
        response.status
      )
    }

    const expiresIn = Number(body.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new QQAuthError(
        `获取 access_token 失败：expires_in 不合法（${String(body.expires_in)}）`,
        response.status
      )
    }

    this.state = {
      value: body.access_token,
      expiresAt: this.nowFn() + expiresIn * 1000
    }
    return body.access_token
  }

  private async refresh(): Promise<string> {
    const attempts: Array<{ endpoint: string; field: SecretField }> = [
      { endpoint: this.endpoint, field: 'clientSecret' },
      { endpoint: 'https://bots.qq.com/app/getAppAccessToken', field: 'appSecret' }
    ]
    let lastError: unknown

    for (const attempt of attempts) {
      try {
        return await this.request(attempt.endpoint, attempt.field)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new QQAuthError('获取 access_token 失败：未知错误')
  }
}
```

- [ ] **Step 5: 实现 GatewayClient**

`packages/adapter-qq/src/gateway.ts`

```ts
import WebSocket from 'ws'

export interface SocketLike {
  on(event: string, listener: (...args: any[]) => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

export interface GatewayHandlers {
  onDispatch(event: string, data: unknown): void
  onReady(): void
  onError(error: Error): void
}

export interface GatewayOptions {
  url: string
  getToken: () => Promise<string>
  intents: number
  handlers: GatewayHandlers
  socketFactory?: SocketFactory
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

interface Payload {
  op: number
  s?: number
  t?: string
  d?: any
}

export class GatewayClient {
  connected = false

  private socket?: SocketLike
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private sessionId?: string
  private lastSeq = 0
  private attempts = 0
  private manualClose = false
  private ready = false
  private resolveReady?: () => void
  private rejectReady?: (error: Error) => void

  constructor(private readonly options: GatewayOptions) {}

  connect(): Promise<void> {
    this.manualClose = false
    this.ready = false
    return new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
      this.openSocket()
    })
  }

  close(): void {
    this.manualClose = true
    this.connected = false
    this.clearTimers()
    this.socket?.close(1000, 'manual close')
    this.socket = undefined
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = undefined
    this.reconnectTimer = undefined
  }

  private openSocket(): void {
    const socket = this.options.socketFactory
      ? this.options.socketFactory(this.options.url)
      : (new WebSocket(this.options.url) as unknown as SocketLike)
    this.socket = socket

    socket.on('open', () => undefined)
    socket.on('message', (raw: unknown) => this.handleMessage(raw))
    socket.on('error', (error: unknown) => {
      this.options.handlers.onError(error instanceof Error ? error : new Error(String(error)))
    })
    socket.on('close', (code: unknown) => this.handleClose(typeof code === 'number' ? code : 0))
  }

  private send(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload))
  }

  private handleMessage(raw: unknown): void {
    const text =
      typeof raw === 'string'
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : String(raw)

    let payload: Payload
    try {
      payload = JSON.parse(text) as Payload
    } catch {
      return
    }

    if (typeof payload.s === 'number') this.lastSeq = payload.s

    if (payload.op === 10) {
      const interval = payload.d?.heartbeat_interval
      if (typeof interval === 'number') this.startHeartbeat(interval)
      void this.identifyOrResume()
      return
    }

    if (payload.op === 11) return

    if (payload.op === 0) {
      if (payload.t === 'READY') {
        this.sessionId = payload.d?.session_id ?? this.sessionId
        this.connected = true
        this.ready = true
        this.attempts = 0
        this.resolveReady?.()
        this.resolveReady = undefined
        this.rejectReady = undefined
        this.options.handlers.onReady()
        return
      }
      if (payload.t) this.options.handlers.onDispatch(payload.t, payload.d)
      return
    }

    if (payload.op === 7) {
      this.socket?.close(4000, 'reconnect')
      return
    }

    if (payload.op === 9) {
      this.sessionId = undefined
      this.lastSeq = 0
      this.socket?.close(4000, 'invalid session')
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 1, d: this.lastSeq })
    }, intervalMs)
  }

  private async identifyOrResume(): Promise<void> {
    const token = `QQBot ${await this.options.getToken()}`
    if (this.sessionId) {
      this.send({
        op: 6,
        d: { token, session_id: this.sessionId, seq: this.lastSeq }
      })
      return
    }
    this.send({
      op: 2,
      d: { token, intents: this.options.intents, shard: [0, 1] }
    })
  }

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

    const base = this.options.reconnectBaseMs ?? 1000
    const max = this.options.reconnectMaxMs ?? 60_000
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }
}
```

- [ ] **Step 6: 运行测试与类型检查**

Run:

```powershell
pnpm --filter @arqqbot/adapter-qq test
pnpm --filter @arqqbot/adapter-qq typecheck
```

Expected: 7 个测试全部 PASS；类型检查退出码 0。

- [ ] **Step 7: 提交**

```powershell
git add packages/adapter-qq pnpm-lock.yaml
git commit -m "feat(adapter-qq): add token manager and websocket gateway"
```

---

## Task 7: QQ 消息归一化、去重、回复配额与发送

**Files:**
- Create: `packages/adapter-qq/src/message.ts`
- Create: `packages/adapter-qq/src/quota.ts`
- Create: `packages/adapter-qq/src/sender.ts`
- Create: `packages/adapter-qq/src/service.ts`
- Create: `packages/adapter-qq/src/index.ts`
- Test: `packages/adapter-qq/test/message.test.ts`
- Test: `packages/adapter-qq/test/quota.test.ts`
- Test: `packages/adapter-qq/test/sender.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/adapter-qq/test/message.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { MessageDeduper, normalizeQQEvent } from '../src/message'

describe('normalizeQQEvent', () => {
  it('归一化群聊 @ 消息', () => {
    const message = normalizeQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: ' 你好',
      timestamp: '2026-10-31T10:00:00+08:00',
      author: { member_openid: 'member-1' },
      attachments: [{ content_type: 'image/png', url: 'https://img.test/a.png', filename: 'a.png', size: 100 }]
    })

    expect(message).toMatchObject({
      id: 'msg-1',
      scene: 'group',
      groupId: 'group-1',
      userId: 'member-1',
      content: '你好'
    })
    expect(message?.attachments[0]?.contentType).toBe('image/png')
  })

  it('归一化单聊消息', () => {
    const message = normalizeQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-2',
      content: 'hi',
      timestamp: '2026-10-31T10:00:00+08:00',
      author: { user_openid: 'user-1' }
    })

    expect(message).toMatchObject({
      id: 'msg-2',
      scene: 'c2c',
      userId: 'user-1',
      content: 'hi'
    })
  })

  it('忽略未知事件', () => {
    expect(normalizeQQEvent('GUILD_CREATE', { id: 'x' })).toBeNull()
  })
})

describe('MessageDeduper', () => {
  it('识别重复消息 id', () => {
    const deduper = new MessageDeduper(2)
    expect(deduper.seen('a')).toBe(false)
    expect(deduper.seen('a')).toBe(true)
    expect(deduper.seen('b')).toBe(false)
    expect(deduper.seen('c')).toBe(false)
    expect(deduper.seen('a')).toBe(false)
  })
})
```

`packages/adapter-qq/test/quota.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { PassiveReplyQuota } from '../src/quota'

describe('PassiveReplyQuota', () => {
  it('群聊单条消息最多回复 5 次，5 分钟后重置', () => {
    let now = 0
    const quota = new PassiveReplyQuota(() => now)
    for (let index = 0; index < 5; index += 1) {
      expect(quota.consume('group', 'msg-1')).toBe(true)
    }
    expect(quota.consume('group', 'msg-1')).toBe(false)

    now = 5 * 60_000
    expect(quota.consume('group', 'msg-1')).toBe(true)
  })

  it('单聊单条消息最多回复 4 次', () => {
    const quota = new PassiveReplyQuota(() => 0)
    for (let index = 0; index < 4; index += 1) {
      expect(quota.consume('c2c', 'msg-2')).toBe(true)
    }
    expect(quota.consume('c2c', 'msg-2')).toBe(false)
  })

  it('msg_seq 从 1 递增', () => {
    const quota = new PassiveReplyQuota(() => 0)
    expect(quota.nextSeq('msg-1')).toBe(1)
    expect(quota.nextSeq('msg-1')).toBe(2)
    expect(quota.nextSeq('msg-2')).toBe(1)
  })
})
```

`packages/adapter-qq/test/sender.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import { QQSender } from '../src/sender'
import { TokenManager } from '../src/token'

function makeSender(fetchImpl: ReturnType<typeof vi.fn>, now = () => 0): QQSender {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch
  })
  return new QQSender({
    token,
    baseUrl: 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now
  })
}

describe('QQSender', () => {
  it('发送群聊被动回复并携带 msg_id 与 msg_seq', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const sender = makeSender(fetchImpl)

    const result = await sender.send({
      scene: 'group',
      targetId: 'group-1',
      content: '你好',
      msgId: 'msg-1'
    })

    expect(result.messageId).toBe('reply-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v2/groups/group-1/messages',
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: '你好',
      msg_type: 0,
      msg_id: 'msg-1',
      msg_seq: 1
    })
  })

  it('拒绝主动消息', async () => {
    const sender = makeSender(vi.fn())
    await expect(
      sender.send({ scene: 'group', targetId: 'group-1', content: 'x' })
    ).rejects.toMatchObject({ code: 'ACTIVE_MESSAGE_UNSUPPORTED' })
  })

  it('超出被动回复配额抛出 QUOTA_EXCEEDED', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply' }), { status: 200 })
    )
    const sender = makeSender(fetchImpl)

    for (let index = 0; index < 5; index += 1) {
      await sender.send({ scene: 'group', targetId: 'group-1', content: 'x', msgId: 'msg-1' })
    }
    await expect(
      sender.send({ scene: 'group', targetId: 'group-1', content: 'x', msgId: 'msg-1' })
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('长文本分段发送且每段递增 msg_seq', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply' }), { status: 200 })
    )
    const sender = new QQSender({
      token: new TokenManager({
        appId: 'app',
        appSecret: 'secret',
        fetchImpl: vi.fn(async () =>
          new Response(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }), {
            status: 200
          })
        ) as unknown as typeof fetch
      }),
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxTextLength: 3
    })

    await sender.send({
      scene: 'group',
      targetId: 'group-1',
      content: 'abcdefg',
      msgId: 'msg-1'
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    expect(bodies.map((body) => body.msg_seq)).toEqual([1, 2, 3])
    expect(bodies.map((body) => body.content)).toEqual(['abc', 'def', 'g'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/adapter-qq test
```

Expected: FAIL，提示无法找到 `../src/message`、`../src/quota`、`../src/sender`。

- [ ] **Step 3: 实现消息归一化与去重**

`packages/adapter-qq/src/message.ts`

```ts
import type { QQMessage } from '@arqqbot/shared'

interface AttachmentPayload {
  content_type?: string
  url?: string
  filename?: string
  size?: number
}

function normalizeAttachments(input: unknown): QQMessage['attachments'] {
  if (!Array.isArray(input)) return []
  return input.map((item) => {
    const attachment = item as AttachmentPayload
    const result: QQMessage['attachments'][number] = {
      contentType: attachment.content_type ?? '',
      url: attachment.url ?? ''
    }
    if (attachment.filename !== undefined) result.filename = attachment.filename
    if (attachment.size !== undefined) result.size = attachment.size
    return result
  })
}

export function normalizeQQEvent(eventName: string, data: Record<string, any>): QQMessage | null {
  if (eventName === 'GROUP_AT_MESSAGE_CREATE') {
    return {
      id: String(data.id ?? ''),
      scene: 'group',
      userId: String(data.author?.member_openid ?? ''),
      groupId: String(data.group_openid ?? ''),
      content: String(data.content ?? '').trim(),
      mentions: [],
      attachments: normalizeAttachments(data.attachments),
      timestamp: String(data.timestamp ?? ''),
      raw: data
    }
  }

  if (eventName === 'C2C_MESSAGE_CREATE') {
    return {
      id: String(data.id ?? ''),
      scene: 'c2c',
      userId: String(data.author?.user_openid ?? ''),
      content: String(data.content ?? '').trim(),
      mentions: [],
      attachments: normalizeAttachments(data.attachments),
      timestamp: String(data.timestamp ?? ''),
      raw: data
    }
  }

  return null
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

- [ ] **Step 4: 实现被动回复配额**

`packages/adapter-qq/src/quota.ts`

```ts
const LIMITS = {
  group: { windowMs: 5 * 60_000, max: 5 },
  c2c: { windowMs: 60 * 60_000, max: 4 }
} as const

interface Bucket {
  startedAt: number
  count: number
}

export class PassiveReplyQuota {
  private readonly buckets = new Map<string, Bucket>()
  private readonly seqs = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  consume(scene: 'group' | 'c2c', msgId: string): boolean {
    const limit = LIMITS[scene]
    const now = this.now()
    const existing = this.buckets.get(msgId)

    if (!existing || now - existing.startedAt >= limit.windowMs) {
      this.buckets.set(msgId, { startedAt: now, count: 1 })
      return true
    }

    if (existing.count >= limit.max) return false
    existing.count += 1
    return true
  }

  nextSeq(msgId: string): number {
    const next = (this.seqs.get(msgId) ?? 0) + 1
    this.seqs.set(msgId, next)
    return next
  }
}
```

- [ ] **Step 5: 实现发送器**

`packages/adapter-qq/src/sender.ts`

```ts
import type { QQSendInput, QQSendResult } from '@arqqbot/shared'
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
  token: TokenManager
  baseUrl: string
  fetchImpl?: typeof fetch
  now?: () => number
  maxTextLength?: number
}

function splitText(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]
  const chunks: string[] = []
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength))
  }
  return chunks
}

export class QQSender {
  private readonly fetchImpl: typeof fetch
  private readonly quota: PassiveReplyQuota
  private readonly maxTextLength: number

  constructor(private readonly options: QQSenderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.quota = new PassiveReplyQuota(options.now ?? Date.now)
    this.maxTextLength = options.maxTextLength ?? 5000
  }

  private endpoint(input: QQSendInput): string {
    const target = encodeURIComponent(input.targetId)
    return input.scene === 'group'
      ? `${this.options.baseUrl}/v2/groups/${target}/messages`
      : `${this.options.baseUrl}/v2/users/${target}/messages`
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!input.msgId) {
      throw new QQSendError('ACTIVE_MESSAGE_UNSUPPORTED', 'MVP 不支持主动消息')
    }

    const accessToken = await this.options.token.get()
    const chunks = splitText(input.content, this.maxTextLength)
    let messageId: string | undefined

    for (const chunk of chunks) {
      if (!this.quota.consume(input.scene, input.msgId)) {
        throw new QQSendError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }

      const response = await this.fetchImpl(this.endpoint(input), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `QQBot ${accessToken}`
        },
        body: JSON.stringify({
          content: chunk,
          msg_type: 0,
          msg_id: input.msgId,
          msg_seq: this.quota.nextSeq(input.msgId)
        })
      })

      const body = (await response.json().catch(() => ({}))) as { id?: unknown; message?: unknown }
      if (!response.ok) {
        const reason = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
        throw new QQSendError('QQ_API_ERROR', reason, response.status)
      }
      if (typeof body.id === 'string') messageId = body.id
    }

    return { messageId }
  }
}
```

- [ ] **Step 6: 实现 ctx.qq 服务**

`packages/adapter-qq/src/service.ts`

```ts
import { Service, type Context } from 'cordis'
import type {
  InstanceEnv,
  QQMessage,
  QQSendInput,
  QQSendResult,
  QQService,
  QQStats
} from '@arqqbot/shared'
import { GatewayClient } from './gateway'
import { MessageDeduper, normalizeQQEvent } from './message'
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
  intents?: number
}

export class QQAdapter extends Service implements QQService {
  private readonly token: TokenManager
  private sender?: QQSender
  private readonly deduper = new MessageDeduper()
  private readonly stats = { received: 0, sent: 0 }
  private baseUrl: string
  private gateway?: GatewayClient

  constructor(ctx: Context, private readonly config: QQAdapterConfig) {
    super(ctx, 'qq')
    this.baseUrl = API_BASES[config.env][0]!
    this.token = new TokenManager({
      appId: config.appId,
      appSecret: config.appSecret
    })
  }

  async connect(): Promise<void> {
    const accessToken = await this.token.get()
    let lastError: unknown

    for (const base of API_BASES[this.config.env]) {
      let gateway: GatewayClient | undefined
      try {
        const response = await fetch(`${base}/gateway/bot`, {
          headers: { authorization: `QQBot ${accessToken}` }
        })

        if (!response.ok) {
          throw new Error(`获取网关地址失败：HTTP ${response.status}`)
        }

        const body = (await response.json()) as { url?: unknown }
        if (typeof body.url !== 'string') {
          throw new Error('获取网关地址失败：响应缺少 url')
        }

        gateway = new GatewayClient({
          url: body.url,
          getToken: () => this.token.get(),
          intents: this.config.intents ?? 1 << 25,
          handlers: {
            onDispatch: (event, data) => this.handleDispatch(event, data),
            onReady: () => {
              this.ctx.emit('qq/ready')
              this.ctx.logger.info('QQ 网关已就绪')
            },
            onError: (error) => {
              this.ctx.emit('qq/error', error)
              this.ctx.logger.error('QQ 网关错误', error, 'adapter-qq')
            }
          }
        })

        await gateway.connect()
        this.baseUrl = base
        this.sender = new QQSender({ token: this.token, baseUrl: base })
        this.gateway = gateway
        return
      } catch (error) {
        gateway?.close()
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('获取网关地址失败')
  }

  async disconnect(): Promise<void> {
    this.gateway?.close()
    this.gateway = undefined
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!this.sender) throw new Error('QQ 适配器尚未连接')
    const result = await this.sender.send(input)
    this.stats.sent += 1
    return result
  }

  getStats(): QQStats {
    return {
      connected: this.gateway?.connected ?? false,
      received: this.stats.received,
      sent: this.stats.sent
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    const message: QQMessage | null = normalizeQQEvent(event, data as Record<string, any>)
    if (!message) return
    if (this.deduper.seen(message.id)) return
    this.stats.received += 1
    void this.ctx.parallel('qq/message', message).catch((error) => {
      this.ctx.logger.error('插件处理消息失败', error, 'adapter-qq')
    })
  }
}
```

- [ ] **Step 7: 实现插件入口与适配器句柄**

`packages/adapter-qq/src/index.ts`

```ts
import type { Context } from 'cordis'
import type { QQService } from '@arqqbot/shared'
import { QQAdapter, type QQAdapterConfig } from './service'

export const name = 'adapter-qq'
export const inject = ['logger']

export interface AdapterHandle {
  service?: QQService
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export function apply(ctx: Context, config: QQAdapterConfig): void {
  ctx.plugin(QQAdapter, config)
}

export async function createAdapter(ctx: Context, config: QQAdapterConfig): Promise<AdapterHandle> {
  await ctx.plugin(QQAdapter, config)
  const adapter = ctx.qq as unknown as QQAdapter
  return {
    service: ctx.qq,
    connect: () => adapter.connect(),
    disconnect: () => adapter.disconnect()
  }
}

export { QQAdapter }
export type { QQAdapterConfig }
```

- [ ] **Step 8: 运行测试与类型检查**

Run:

```powershell
pnpm --filter @arqqbot/adapter-qq test
pnpm --filter @arqqbot/adapter-qq typecheck
```

Expected: 18 个 adapter 测试全部 PASS；类型检查退出码 0。

- [ ] **Step 9: 提交**

```powershell
git add packages/adapter-qq
git commit -m "feat(adapter-qq): normalize messages and enforce passive reply quota"
```

---

## Task 8: Worker 启动流程与消息协议

**Files:**
- Create: `packages/runtime/src/bootstrap.ts`
- Create: `packages/runtime/src/worker-entry.ts`
- Create: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `packages/runtime/test/bootstrap.test.ts`

- [ ] **Step 1: 写失败的测试**

`packages/runtime/test/bootstrap.test.ts`

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PluginCatalogItem, WorkerEvent, WorkerStartConfig } from '@arqqbot/shared'
import type { QQService } from '@arqqbot/shared'
import { bootstrapInstance } from '../src/bootstrap'
import type { AdapterHandle } from '@arqqbot/adapter-qq'

function catalogItem(): PluginCatalogItem {
  return {
    manifest: {
      id: 'demo',
      name: 'demo',
      version: '0.1.0',
      displayName: 'Demo',
      description: '',
      schema: { type: 'object', properties: {} },
      defaultConfig: {}
    },
    entryPath: '/fake/demo.js',
    source: 'builtin'
  }
}

describe('bootstrapInstance', () => {
  it('启动适配器、挂载插件、上报日志并可停止', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-worker-'))
    const config: WorkerStartConfig = {
      instanceId: 'inst-1',
      appId: 'app',
      appSecret: 'secret',
      env: 'sandbox',
      dataDir,
      catalog: [catalogItem()],
      plugins: [{ id: 'demo', enabled: true, config: {} }]
    }

    const events: WorkerEvent[] = []
    const disconnect = vi.fn(async () => undefined)
    const service: QQService = {
      send: vi.fn(async () => ({})),
      getStats: () => ({ connected: true, received: 1, sent: 0 })
    }
    const adapter: AdapterHandle & { service: QQService } = {
      service,
      connect: vi.fn(async () => undefined),
      disconnect
    }

    const result = await bootstrapInstance(
      config,
      { post: (event) => events.push(event) },
      {
        createAdapter: async () => adapter,
        loadModule: async () => (ctx: any) => {
          ctx.on('dispose', () => undefined)
        }
      }
    )

    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === 'log')).toBe(true)
    expect(events.some((event) => event.type === 'pluginState')).toBe(true)
    expect(result.getStatus().state).toBe('running')
    expect(result.getStatus().connected).toBe(true)

    await result.stop()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(result.getStatus().state).toBe('stopped')
  })

  it('适配器连接失败时不挂载插件', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-worker-fail-'))
    const config: WorkerStartConfig = {
      instanceId: 'inst-2',
      appId: 'app',
      appSecret: 'bad',
      env: 'production',
      dataDir,
      catalog: [catalogItem()],
      plugins: [{ id: 'demo', enabled: true, config: {} }]
    }

    const connect = vi.fn(async () => {
      throw new Error('鉴权失败')
    })

    await expect(
      bootstrapInstance(config, { post: () => undefined }, {
        createAdapter: async () => ({
          connect,
          disconnect: vi.fn(async () => undefined)
        })
      })
    ).rejects.toThrow('鉴权失败')
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/runtime test
```

Expected: FAIL，提示无法找到 `../src/bootstrap`。

- [ ] **Step 3: 声明适配器依赖并实现启动流程**

先把 `packages/runtime/package.json` 的 `dependencies` 改为：

```json
{
  "dependencies": {
    "@arqqbot/adapter-qq": "workspace:*",
    "@arqqbot/shared": "workspace:*",
    "cordis": "4.0.0-rc.12"
  }
}
```

`packages/runtime/src/bootstrap.ts`

```ts
import { Context } from 'cordis'
import path from 'node:path'
import type {
  InstanceStatus,
  PluginRuntimeState,
  WorkerStartConfig
} from '@arqqbot/shared'
import { createAdapter, type AdapterHandle } from '@arqqbot/adapter-qq'
import { StorageService } from './services/storage'
import { PluginHost, type ModuleLoader } from './plugin-host'

export interface BootstrapBridge {
  post(event: unknown): void
}

export interface BootstrapDeps {
  createAdapter?: (ctx: Context, config: {
    appId: string
    appSecret: string
    env: WorkerStartConfig['env']
  }) => Promise<AdapterHandle>
  loadModule?: ModuleLoader
}

export interface BootstrapResult {
  ctx: Context
  host: PluginHost
  adapter: AdapterHandle
  getStatus(): InstanceStatus
  stop(): Promise<void>
}

export async function bootstrapInstance(
  config: WorkerStartConfig,
  bridge: BootstrapBridge,
  deps: BootstrapDeps = {}
): Promise<BootstrapResult> {
  const ctx = new Context()
  const forks: Array<{ dispose(): void }> = []
  const startedAt = new Date().toISOString()

  interface LoggerExporter {
    export(message: {
      ts: number
      type: 'error' | 'info' | 'warn' | 'debug'
      name?: string
      args: unknown[]
    }): void
  }

  const loggerService = ctx.logger as unknown as {
    exporter(exporter: LoggerExporter): () => void
  }
  const stopLogger = loggerService.exporter({
    export(message) {
      bridge.post({
        type: 'log',
        entry: {
          time: new Date(message.ts).toISOString(),
          level: message.type,
          message: message.args.map((arg) => String(arg)).join(' '),
          ...(message.name ? { pluginId: message.name } : {})
        }
      })
    }
  })
  ctx.logger.info('实例开始启动')

  forks.push(await ctx.plugin(StorageService, {
    dir: path.join(config.dataDir, 'storage')
  }))

  const adapterConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    env: config.env
  }

  const adapter = deps.createAdapter
    ? await deps.createAdapter(ctx, adapterConfig)
    : await createAdapter(ctx, adapterConfig)

  await adapter.connect()

  const catalog = new Map(config.catalog.map((item) => [item.manifest.id, item]))
  const records = config.catalog.map((item) => {
    const existing = config.plugins.find((record) => record.id === item.manifest.id)
    return existing ?? { id: item.manifest.id, enabled: false, config: item.manifest.defaultConfig }
  })
  for (const record of config.plugins) {
    if (!catalog.has(record.id)) records.push(record)
  }

  const host = new PluginHost({
    ctx,
    catalog,
    records,
    loadModule: deps.loadModule,
    onState: (pluginId: string, state: PluginRuntimeState, error?: string) => {
      bridge.post({ type: 'pluginState', pluginId, state, error })
    }
  })
  await host.mountAll()

  let state: InstanceStatus['state'] = 'running'
  let lastError: InstanceStatus['lastError']

  const getStatus = (): InstanceStatus => {
    const stats = adapter.service?.getStats() ?? {
      connected: false,
      received: 0,
      sent: 0
    }
    return {
      id: config.instanceId,
      state,
      connected: stats.connected,
      startedAt,
      sent: stats.sent,
      received: stats.received,
      ...(lastError ? { lastError } : {})
    }
  }

  const statusTimer = setInterval(() => {
    bridge.post({ type: 'status', status: getStatus() })
  }, 5000)

  return {
    ctx,
    host,
    adapter,
    getStatus,
    async stop() {
      state = 'stopping'
      clearInterval(statusTimer)
      await host.disposeAll()
      await adapter.disconnect()
      stopLogger()
      for (const fork of forks) await fork.dispose()
      state = 'stopped'
    }
  }
}
```

- [ ] **Step 4: 实现 Worker 入口**

`packages/runtime/src/worker-entry.ts`

```ts
import type { ErrorInfo, WorkerEvent, WorkerRequest } from '@arqqbot/shared'
import { bootstrapInstance, type BootstrapResult } from './bootstrap'

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

function getParentPort(): ParentPortLike {
  const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort
  if (!port) throw new Error('Worker 必须通过 Electron utilityProcess 启动')
  return port
}

function toErrorInfo(error: unknown, code = 'WORKER_ERROR'): ErrorInfo {
  return {
    code,
    message: error instanceof Error ? error.message : String(error)
  }
}

async function main(): Promise<void> {
  const port = getParentPort()
  const post = (event: WorkerEvent): void => port.postMessage(event)
  let runtime: BootstrapResult | undefined
  let starting = false

  const respond = (requestId: string, error?: unknown): void => {
    if (error === undefined) {
      post({ type: 'response', requestId, ok: true })
    } else {
      post({ type: 'response', requestId, ok: false, error: toErrorInfo(error) })
    }
  }

  port.on('message', (event) => {
    const request = event.data as WorkerRequest
    if (!request || typeof request !== 'object' || !('type' in request)) return

    if (request.type === 'start') {
      if (starting || runtime) {
        respond(request.requestId, new Error('实例已启动'))
        return
      }
      starting = true
      bootstrapInstance(request.config, { post })
        .then((result) => {
          runtime = result
          starting = false
          post({ type: 'ready' })
          post({ type: 'status', status: result.getStatus() })
          respond(request.requestId)
        })
        .catch((error) => {
          starting = false
          respond(request.requestId, error)
        })
      return
    }

    if (!runtime) {
      respond(request.requestId, new Error('实例尚未启动'))
      return
    }

    if (request.type === 'getStatus') {
      post({ type: 'status', status: runtime.getStatus() })
      respond(request.requestId)
      return
    }

    if (request.type === 'applyPluginConfig') {
      runtime.host
        .applyConfig(request.pluginId, request.config)
        .then(() => respond(request.requestId))
        .catch((error) => respond(request.requestId, error))
      return
    }

    if (request.type === 'setPluginEnabled') {
      runtime.host
        .setEnabled(request.pluginId, request.enabled)
        .then(() => respond(request.requestId))
        .catch((error) => respond(request.requestId, error))
      return
    }

    if (request.type === 'stop') {
      runtime
        .stop()
        .then(() => {
          post({ type: 'status', status: { ...runtime!.getStatus(), state: 'stopped' } })
          respond(request.requestId)
          setTimeout(() => process.exit(0), 50)
        })
        .catch((error) => respond(request.requestId, error))
    }
  })
}

void main()
```

- [ ] **Step 5: 导出 runtime 公共接口**

`packages/runtime/src/index.ts`

```ts
export { bootstrapInstance } from './bootstrap'
export type { BootstrapBridge, BootstrapDeps, BootstrapResult } from './bootstrap'
export { PluginHost } from './plugin-host'
export { LoggerService } from './services/logger'
export { StorageService } from './services/storage'
```

- [ ] **Step 6: 运行测试与类型检查**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/runtime test
pnpm --filter @arqqbot/runtime typecheck
```

Expected: 8 个 runtime 测试全部 PASS；类型检查退出码 0。

- [ ] **Step 7: 构建 Worker 产物**

Run:

```powershell
pnpm --filter @arqqbot/runtime build
```

Expected: 生成 `packages/runtime/dist/worker-entry.cjs`，退出码 0。

- [ ] **Step 8: 提交**

```powershell
git add packages/runtime
git commit -m "feat(runtime): add worker bootstrap and parent port protocol"
```

---

## Task 9: Electron 主进程、实例存储与 Worker 监督

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/desktop/src/main/instance-store.ts`
- Create: `apps/desktop/src/main/secrets.ts`
- Create: `apps/desktop/src/main/worker-supervisor.ts`
- Create: `apps/desktop/src/main/instance-manager.ts`
- Create: `apps/desktop/src/main/electron-worker-factory.ts`
- Create: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/test/instance-store.test.ts`
- Test: `apps/desktop/test/secrets.test.ts`
- Test: `apps/desktop/test/worker-supervisor.test.ts`

- [ ] **Step 1: 写失败的测试**

`apps/desktop/test/instance-store.test.ts`

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { InstanceStore } from '../src/main/instance-store'

describe('InstanceStore', () => {
  it('创建、更新、读写插件配置与删除实例', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-store-'))
    const store = new InstanceStore(root)
    await store.init()

    const created = await store.create({
      name: '测试实例',
      appId: '10001',
      secretRef: 'cipher',
      env: 'sandbox'
    })

    expect((await store.list()).map((item) => item.id)).toEqual([created.id])
    expect(await store.get(created.id)).toMatchObject({ name: '测试实例', env: 'sandbox' })

    await store.update(created.id, { name: '改名后' })
    expect((await store.get(created.id))?.name).toBe('改名后')

    await store.writePlugins(created.id, [
      { id: 'echo', enabled: true, config: { prefix: '收到：' } }
    ])
    expect(await store.readPlugins(created.id)).toEqual([
      { id: 'echo', enabled: true, config: { prefix: '收到：' } }
    ])

    await store.remove(created.id)
    expect(await store.list()).toEqual([])
  })

  it('损坏的 instance.json 会备份为 .bak 并返回 undefined', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-corrupt-'))
    const store = new InstanceStore(root)
    await store.init()
    const created = await store.create({
      name: '损坏实例',
      appId: '10002',
      secretRef: 'cipher',
      env: 'production'
    })

    const file = path.join(root, 'instances', created.id, 'instance.json')
    await writeFile(file, '{ invalid json', 'utf8')

    expect(await store.get(created.id)).toBeUndefined()
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{ invalid json')
  })
})
```

`apps/desktop/test/secrets.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@arqqbot/shared'
import {
  SECRET_MASK,
  createSecretCodec,
  decryptSecrets,
  encryptSecrets,
  maskSecrets,
  redact,
  mergeSecretInput
} from '../src/main/secrets'

const schema: JsonSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', secret: true },
    model: { type: 'string' }
  }
}

const codec = createSecretCodec({
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (buffer) => buffer.toString().replace('enc:', '')
})

describe('secrets', () => {
  it('加密后落盘、解密后还原', () => {
    const encrypted = encryptSecrets(schema, { apiKey: 'sk-test', model: 'gpt' }, codec)
    expect(encrypted.apiKey).toMatchObject({ $secret: expect.any(String) })
    expect(decryptSecrets(schema, encrypted, codec)).toEqual({ apiKey: 'sk-test', model: 'gpt' })
  })

  it('对 UI 返回掩码', () => {
    expect(maskSecrets(schema, { apiKey: 'sk-test', model: 'gpt' })).toEqual({
      apiKey: SECRET_MASK,
      model: 'gpt'
    })
  })

  it('输入为掩码时保留原密钥', () => {
    expect(
      mergeSecretInput(schema, { apiKey: SECRET_MASK, model: 'gpt-4o' }, { apiKey: 'sk-test', model: 'gpt' })
    ).toEqual({ apiKey: 'sk-test', model: 'gpt-4o' })
  })

  it('日志数据中的敏感字段被脱敏', () => {
    expect(
      redact({
        apiKey: 'sk-test',
        nested: { authorization: 'Bearer token', token: 'abc' },
        message: 'ok'
      })
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', token: '[REDACTED]' },
      message: 'ok'
    })
  })
})
```

`apps/desktop/test/worker-supervisor.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerStartConfig } from '@arqqbot/shared'
import { WorkerSupervisor, type WorkerProcessLike } from '../src/main/worker-supervisor'

class FakeWorker implements WorkerProcessLike {
  private handlers = new Map<string, (...args: any[]) => void>()
  sent: WorkerRequest[] = []

  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest)
  }

  on(event: 'message' | 'exit', listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener)
  }

  kill(): void {
    this.emit('exit', 1)
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.(...args)
  }
}

const config: WorkerStartConfig = {
  instanceId: 'inst-1',
  appId: 'app',
  appSecret: 'secret',
  env: 'sandbox',
  dataDir: 'C:/temp/arqqbot-data',
  catalog: [],
  plugins: []
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkerSupervisor', () => {
  it('发送 start 请求并处理响应、日志、状态与退出', async () => {
    const worker = new FakeWorker()
    const events: string[] = []
    const supervisor = new WorkerSupervisor({ spawn: () => worker }, {
      onLog: () => events.push('log'),
      onStatus: () => events.push('status'),
      onPluginState: () => events.push('plugin'),
      onExit: (code) => events.push(`exit:${code}`)
    })

    const starting = supervisor.start(config)
    await Promise.resolve()
    expect(worker.sent[0]).toMatchObject({ type: 'start', requestId: '1', config })
    worker.emit('message', { type: 'response', requestId: '1', ok: true })
    await starting

    worker.emit('message', { type: 'log', entry: { time: 'x', level: 'info', message: 'hi' } })
    worker.emit('message', {
      type: 'status',
      status: { id: 'inst-1', state: 'running', connected: true, sent: 0, received: 0 }
    })
    worker.emit('message', { type: 'pluginState', pluginId: 'echo', state: 'active' })
    worker.emit('exit', 0)

    expect(events).toEqual(['log', 'status', 'plugin', 'exit:0'])
    expect(await supervisor.getStatus().catch(() => undefined)).toBeUndefined()
  })

  it('Worker 无响应时请求超时', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const supervisor = new WorkerSupervisor({ spawn: () => worker }, {
      onLog: vi.fn(),
      onStatus: vi.fn(),
      onPluginState: vi.fn(),
      onExit: vi.fn()
    })

    const starting = supervisor.start(config)
    const expectation = expect(starting).rejects.toThrow('Worker 响应超时')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/desktop test
```

Expected: FAIL，提示无法找到 `../src/main/instance-store`、`../src/main/secrets`、`../src/main/worker-supervisor`。

- [ ] **Step 3: 创建桌面应用配置**

`apps/desktop/package.json`

```json
{
  "name": "@arqqbot/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@arqqbot/shared": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-tabs": "^1.1.13",
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "zustand": "^5.0.8"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.13",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.12",
    "@types/react-dom": "^19.1.9",
    "@vitejs/plugin-react": "^5.0.2",
    "electron": "latest",
    "electron-builder": "^26.0.12",
    "electron-vite": "^4.0.0",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4.1.13",
    "typescript": "^5.9.2",
    "vite": "^7.3.7",
    "vitest": "^3.2.4"
  }
}
```

`apps/desktop/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "noEmit": true
  },
  "include": ["src", "test", "electron.vite.config.ts"]
}
```

`apps/desktop/electron.vite.config.ts`

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
```

- [ ] **Step 4: 补充渲染层 API 契约**

`packages/shared/src/api.ts`

```ts
import type {
  CreateInstanceInput,
  InstanceStatus,
  InstanceSummary,
  LogEntry,
  PluginSummary,
  UpdateInstanceInput
} from './types'

export interface DesktopApi {
  instances: {
    list(): Promise<InstanceSummary[]>
    create(input: CreateInstanceInput): Promise<InstanceSummary>
    update(id: string, input: UpdateInstanceInput): Promise<InstanceSummary>
    remove(id: string): Promise<void>
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    restart(id: string): Promise<void>
    status(id: string): Promise<InstanceStatus>
  }
  plugins: {
    list(instanceId: string): Promise<PluginSummary[]>
    enable(instanceId: string, pluginId: string): Promise<void>
    disable(instanceId: string, pluginId: string): Promise<void>
    updateConfig(instanceId: string, pluginId: string, config: Record<string, unknown>): Promise<void>
  }
  logs: {
    subscribe(instanceId: string): void
    unsubscribe(instanceId: string): void
    onEntry(callback: (payload: { instanceId: string; entry: LogEntry }) => void): () => void
  }
}
```

`packages/shared/src/index.ts` 末尾追加：

```ts
export * from './api'
```

- [ ] **Step 5: 实现实例存储**

`apps/desktop/src/main/instance-store.ts`

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InstanceEnv, InstanceRecord, PluginRecord } from '@arqqbot/shared'

interface IndexFile {
  instances: string[]
}

export class InstanceStore {
  constructor(private readonly rootDir: string) {}

  private indexFile(): string {
    return path.join(this.rootDir, 'instances.json')
  }

  private instanceDir(id: string): string {
    return path.join(this.rootDir, 'instances', id)
  }

  private instanceFile(id: string): string {
    return path.join(this.instanceDir(id), 'instance.json')
  }

  private pluginsFile(id: string): string {
    return path.join(this.instanceDir(id), 'plugins.json')
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await mkdir(path.join(this.rootDir, 'instances'), { recursive: true })
    try {
      await readFile(this.indexFile(), 'utf8')
    } catch {
      await this.writeJson(this.indexFile(), { instances: [] } satisfies IndexFile)
    }
  }

  private async readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
    await rename(temp, file)
  }

  private async readIndex(): Promise<IndexFile> {
    const index = await this.readJson<IndexFile>(this.indexFile())
    return index ?? { instances: [] }
  }

  async list(): Promise<InstanceRecord[]> {
    const index = await this.readIndex()
    const records: InstanceRecord[] = []
    for (const id of index.instances) {
      const record = await this.get(id)
      if (record) records.push(record)
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async get(id: string): Promise<InstanceRecord | undefined> {
    const file = this.instanceFile(id)
    try {
      return await this.readJson<InstanceRecord>(file)
    } catch {
      await rename(file, `${file}.bak`).catch(() => undefined)
      return undefined
    }
  }

  async create(input: {
    name: string
    appId: string
    secretRef: string
    env: InstanceEnv
  }): Promise<InstanceRecord> {
    const now = new Date().toISOString()
    const record: InstanceRecord = {
      id: randomUUID(),
      name: input.name,
      appId: input.appId,
      secretRef: input.secretRef,
      env: input.env,
      createdAt: now,
      updatedAt: now
    }
    await this.writeJson(this.instanceFile(record.id), record)
    await this.writeJson(this.pluginsFile(record.id), [])
    const index = await this.readIndex()
    index.instances.push(record.id)
    await this.writeJson(this.indexFile(), index)
    return record
  }

  async update(
    id: string,
    patch: Partial<Pick<InstanceRecord, 'name' | 'appId' | 'secretRef' | 'env'>>
  ): Promise<InstanceRecord> {
    const record = await this.get(id)
    if (!record) throw new Error(`实例不存在：${id}`)
    Object.assign(record, patch, { updatedAt: new Date().toISOString() })
    await this.writeJson(this.instanceFile(id), record)
    return record
  }

  async remove(id: string): Promise<void> {
    const index = await this.readIndex()
    index.instances = index.instances.filter((item) => item !== id)
    await this.writeJson(this.indexFile(), index)
    await rm(this.instanceDir(id), { recursive: true, force: true })
  }

  async readPlugins(id: string): Promise<PluginRecord[]> {
    return (await this.readJson<PluginRecord[]>(this.pluginsFile(id))) ?? []
  }

  async writePlugins(id: string, records: PluginRecord[]): Promise<void> {
    await this.writeJson(this.pluginsFile(id), records)
  }
}
```

- [ ] **Step 6: 实现密钥加解密与掩码**

`apps/desktop/src/main/secrets.ts`

```ts
import type { JsonSchema } from '@arqqbot/shared'

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(buffer: Buffer): string
}

export const SECRET_MASK = '******'

interface SecretBox {
  $secret: string
}

export function createSecretCodec(engine: SafeStorageLike): SecretCodec {
  return {
    encrypt(value) {
      if (!engine.isEncryptionAvailable()) throw new Error('系统加密不可用')
      return engine.encryptString(value).toString('base64')
    },
    decrypt(value) {
      return engine.decryptString(Buffer.from(value, 'base64'))
    }
  }
}

function isSecretBox(value: unknown): value is SecretBox {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$secret' in value &&
    typeof (value as SecretBox).$secret === 'string'
  )
}

function walk(
  schema: JsonSchema,
  value: unknown,
  mode: 'mask' | 'encrypt' | 'decrypt',
  codec?: SecretCodec
): unknown {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null) return value
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    const properties = schema.properties ?? {}

    for (const [key, childSchema] of Object.entries(properties)) {
      const child = input[key]
      if (childSchema.secret) {
        if (mode === 'mask') output[key] = SECRET_MASK
        else if (mode === 'encrypt') {
          output[key] = child === undefined || child === '' ? child : { $secret: codec!.encrypt(String(child)) }
        } else {
          output[key] = isSecretBox(child) ? codec!.decrypt(child.$secret) : child
        }
      } else {
        output[key] = walk(childSchema, child, mode, codec)
      }
    }

    for (const key of Object.keys(input)) {
      if (!properties[key]) output[key] = input[key]
    }
    return output
  }

  if (schema.type === 'array' && schema.items) {
    if (!Array.isArray(value)) return value
    return value.map((item) => walk(schema.items!, item, mode, codec))
  }

  return value
}

export function maskSecrets(schema: JsonSchema, config: Record<string, unknown>): Record<string, unknown> {
  return walk(schema, config, 'mask') as Record<string, unknown>
}

export function encryptSecrets(
  schema: JsonSchema,
  config: Record<string, unknown>,
  codec: SecretCodec
): Record<string, unknown> {
  return walk(schema, config, 'encrypt', codec) as Record<string, unknown>
}

export function decryptSecrets(
  schema: JsonSchema,
  config: Record<string, unknown>,
  codec: SecretCodec
): Record<string, unknown> {
  return walk(schema, config, 'decrypt', codec) as Record<string, unknown>
}

export function mergeSecretInput(
  schema: JsonSchema,
  incoming: Record<string, unknown>,
  existingDecrypted: Record<string, unknown>
): Record<string, unknown> {
  if (schema.type !== 'object') return incoming
  const output: Record<string, unknown> = { ...incoming }

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    if (childSchema.secret) {
      const current = incoming[key]
      if (current === undefined || current === '' || current === SECRET_MASK) {
        output[key] = existingDecrypted[key]
      }
    } else if (childSchema.type === 'object') {
      output[key] = mergeSecretInput(
        childSchema,
        (incoming[key] ?? {}) as Record<string, unknown>,
        (existingDecrypted[key] ?? {}) as Record<string, unknown>
      )
    }
  }

  return output
}

const SENSITIVE_KEY = /api[-_]?key|secret|token|authorization|password/i

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child)
    }
    return output
  }
  return value
}
```

- [ ] **Step 7: 实现 Worker 监督器**

`apps/desktop/src/main/worker-supervisor.ts`

```ts
import type {
  InstanceStatus,
  LogEntry,
  PluginRuntimeState,
  WorkerEvent,
  WorkerRequest,
  WorkerStartConfig
} from '@arqqbot/shared'

export interface WorkerProcessLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): void
}

export interface WorkerFactory {
  spawn(): WorkerProcessLike
}

export interface SupervisorCallbacks {
  onLog(entry: LogEntry): void
  onStatus(status: InstanceStatus): void
  onPluginState(pluginId: string, state: PluginRuntimeState, error?: string): void
  onExit(code: number, expected: boolean): void
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class WorkerSupervisor {
  private process?: WorkerProcessLike
  private readonly pending = new Map<string, PendingRequest>()
  private requestCounter = 0
  private stopping = false
  private lastStatus?: InstanceStatus

  constructor(
    private readonly factory: WorkerFactory,
    private readonly callbacks: SupervisorCallbacks
  ) {}

  private nextId(): string {
    this.requestCounter += 1
    return String(this.requestCounter)
  }

  private async open(): Promise<void> {
    const child = this.factory.spawn()
    this.process = child
    child.on('message', (message) => this.handleMessage(message as WorkerEvent))
    child.on('exit', (code) => this.handleExit(code))
  }

  private request(request: WorkerRequest, timeoutMs = 10_000): Promise<unknown> {
    const child = this.process
    if (!child) return Promise.reject(new Error('Worker 未启动'))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('Worker 响应超时'))
      }, timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timer })
      child.postMessage(request)
    })
  }

  async start(config: WorkerStartConfig): Promise<void> {
    await this.open()
    await this.request({ type: 'start', requestId: this.nextId(), config })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (!this.process) return
    try {
      await this.request({ type: 'stop', requestId: this.nextId() }, 5000)
    } catch {
      this.process.kill()
    }
  }

  async applyPluginConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    await this.request({
      type: 'applyPluginConfig',
      requestId: this.nextId(),
      pluginId,
      config
    })
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.request({
      type: 'setPluginEnabled',
      requestId: this.nextId(),
      pluginId,
      enabled
    })
  }

  async getStatus(): Promise<InstanceStatus> {
    await this.request({ type: 'getStatus', requestId: this.nextId() })
    if (!this.lastStatus) throw new Error('Worker 未上报状态')
    return this.lastStatus
  }

  dispose(): void {
    this.process?.kill()
    this.process = undefined
  }

  private handleMessage(event: WorkerEvent): void {
    if (event.type === 'response') {
      const pending = this.pending.get(event.requestId)
      if (!pending) return
      this.pending.delete(event.requestId)
      clearTimeout(pending.timer)
      if (event.ok) pending.resolve(event.result)
      else pending.reject(Object.assign(new Error(event.error.message), { code: event.error.code }))
      return
    }

    if (event.type === 'log') {
      this.callbacks.onLog(event.entry)
      return
    }

    if (event.type === 'status') {
      this.lastStatus = event.status
      this.callbacks.onStatus(event.status)
      return
    }

    if (event.type === 'pluginState') {
      this.callbacks.onPluginState(event.pluginId, event.state, event.error)
    }
  }

  private handleExit(code: number): void {
    const expected = this.stopping
    this.process = undefined
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Worker 已退出，请求未完成：${requestId}`))
    }
    this.pending.clear()
    this.callbacks.onExit(code, expected)
  }
}
```

- [ ] **Step 8: 实现实例管理器**

`apps/desktop/src/main/instance-manager.ts`

```ts
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  CreateInstanceInput,
  InstanceRecord,
  InstanceRuntimeState,
  InstanceStatus,
  InstanceSummary,
  LogEntry,
  PluginCatalogItem,
  PluginRecord,
  PluginRuntimeState,
  PluginSummary,
  UpdateInstanceInput
} from '@arqqbot/shared'
import { scanPluginCatalog } from '@arqqbot/shared/node'
import { validatePluginConfig } from '@arqqbot/shared'
import { InstanceStore } from './instance-store'
import {
  decryptSecrets,
  encryptSecrets,
  mergeSecretInput,
  maskSecrets,
  redact,
  type SecretCodec
} from './secrets'
import { WorkerSupervisor, type WorkerFactory } from './worker-supervisor'

export interface InstanceManagerOptions {
  rootDir: string
  builtinPluginRoot: string
  externalPluginRoot: string
  workerFactory: WorkerFactory
  secretCodec: SecretCodec
}

interface PluginRuntimeInfo {
  state: PluginRuntimeState
  error?: string
}

export class InstanceManager {
  readonly store: InstanceStore
  private readonly states = new Map<string, InstanceRuntimeState>()
  private readonly lastStatus = new Map<string, InstanceStatus>()
  private readonly pluginStates = new Map<string, Map<string, PluginRuntimeInfo>>()
  private readonly supervisors = new Map<string, WorkerSupervisor>()
  private readonly logListeners = new Map<string, Set<(entry: LogEntry) => void>>()
  private readonly requiresRestart = new Set<string>()
  private readonly failedStarts = new Set<string>()

  constructor(private readonly options: InstanceManagerOptions) {
    this.store = new InstanceStore(options.rootDir)
  }

  async init(): Promise<void> {
    await this.store.init()
    await mkdir(this.options.externalPluginRoot, { recursive: true })
  }

  private stateOf(id: string): InstanceRuntimeState {
    return this.states.get(id) ?? 'stopped'
  }

  private summary(record: InstanceRecord): InstanceSummary {
    return {
      id: record.id,
      name: record.name,
      appId: record.appId,
      env: record.env,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: this.stateOf(record.id),
      requiresRestart: this.requiresRestart.has(record.id)
    }
  }

  async list(): Promise<InstanceSummary[]> {
    const records = await this.store.list()
    return records.map((record) => this.summary(record))
  }

  async create(input: CreateInstanceInput): Promise<InstanceSummary> {
    const record = await this.store.create({
      name: input.name,
      appId: input.appId,
      secretRef: this.options.secretCodec.encrypt(input.appSecret),
      env: input.env
    })
    this.states.set(record.id, 'stopped')
    return this.summary(record)
  }

  async update(id: string, input: UpdateInstanceInput): Promise<InstanceSummary> {
    const patch: Partial<Pick<InstanceRecord, 'name' | 'appId' | 'secretRef' | 'env'>> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.appId !== undefined) patch.appId = input.appId
    if (input.env !== undefined) patch.env = input.env
    if (input.appSecret !== undefined) patch.secretRef = this.options.secretCodec.encrypt(input.appSecret)

    const record = await this.store.update(id, patch)
    if (input.appId !== undefined || input.env !== undefined || input.appSecret !== undefined) {
      this.requiresRestart.add(id)
    }
    return this.summary(record)
  }

  async remove(id: string): Promise<void> {
    await this.stop(id)
    await this.store.remove(id)
    this.states.delete(id)
    this.lastStatus.delete(id)
    this.pluginStates.delete(id)
    this.requiresRestart.delete(id)
    this.logListeners.delete(id)
  }

  private async scanCatalog(): Promise<PluginCatalogItem[]> {
    const result = await scanPluginCatalog([
      { path: this.options.builtinPluginRoot, source: 'builtin' },
      { path: this.options.externalPluginRoot, source: 'external' }
    ])
    return result.items
  }

  async start(id: string): Promise<void> {
    const record = await this.store.get(id)
    if (!record) throw new Error(`实例不存在：${id}`)
    if (this.supervisors.has(id)) return

    this.states.set(id, 'starting')
    this.pluginStates.delete(id)
    this.failedStarts.delete(id)
    const catalog = await this.scanCatalog()
    const savedPlugins = await this.store.readPlugins(id)
    const plugins = savedPlugins.map((record) => {
      const item = catalog.find((entry) => entry.manifest.id === record.id)
      return item
        ? {
            ...record,
            config: decryptSecrets(item.manifest.schema, record.config, this.options.secretCodec)
          }
        : { ...record }
    })
    const supervisor = new WorkerSupervisor(this.options.workerFactory, {
      onLog: (entry) => this.handleLog(id, entry),
      onStatus: (status) => this.handleStatus(status),
      onPluginState: (pluginId, state, error) => this.handlePluginState(id, pluginId, state, error),
      onExit: (code, expected) => this.handleExit(id, code, expected)
    })
    this.supervisors.set(id, supervisor)

    try {
      await supervisor.start({
        instanceId: id,
        appId: record.appId,
        appSecret: this.options.secretCodec.decrypt(record.secretRef),
        env: record.env,
        dataDir: path.join(this.options.rootDir, 'instances', id, 'data'),
        catalog,
        plugins
      })
      this.states.set(id, 'running')
      this.requiresRestart.delete(id)
    } catch (error) {
      this.supervisors.delete(id)
      this.failedStarts.add(id)
      supervisor.dispose()
      this.states.set(id, 'error')
      const message = error instanceof Error ? error.message : String(error)
      this.lastStatus.set(id, {
        id,
        state: 'error',
        connected: false,
        sent: 0,
        received: 0,
        lastError: { code: 'START_FAILED', message }
      })
      throw error
    }
  }

  async stop(id: string): Promise<void> {
    const supervisor = this.supervisors.get(id)
    if (!supervisor) {
      this.states.set(id, 'stopped')
      return
    }
    this.states.set(id, 'stopping')
    try {
      await supervisor.stop()
    } finally {
      this.supervisors.delete(id)
      this.states.set(id, 'stopped')
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  async status(id: string): Promise<InstanceStatus> {
    const status = this.lastStatus.get(id)
    if (status) return { ...status, state: this.stateOf(id) }
    return {
      id,
      state: this.stateOf(id),
      connected: false,
      sent: 0,
      received: 0
    }
  }

  async listPlugins(instanceId: string): Promise<PluginSummary[]> {
    const catalog = await this.scanCatalog()
    const records = await this.store.readPlugins(instanceId)
    const recordMap = new Map(records.map((record) => [record.id, record]))
    const runtime = this.pluginStates.get(instanceId)
    const result: PluginSummary[] = []

    for (const item of catalog) {
      const manifest = item.manifest
      const record = recordMap.get(manifest.id)
      const decrypted = record
        ? decryptSecrets(manifest.schema, record.config, this.options.secretCodec)
        : {}
      const runtimeInfo = runtime?.get(manifest.id)
      const runtimeState: PluginRuntimeState =
        runtimeInfo?.state ?? (record?.enabled ? 'enabled' : 'disabled')
      const summary: PluginSummary = {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        enabled: record?.enabled ?? false,
        runtimeState,
        schema: manifest.schema,
        config: maskSecrets(manifest.schema, decrypted),
        defaultConfig: manifest.defaultConfig
      }
      if (runtimeInfo?.error) summary.error = runtimeInfo.error
      result.push(summary)
    }

    return result
  }

  async updatePluginConfig(
    instanceId: string,
    pluginId: string,
    input: Record<string, unknown>
  ): Promise<void> {
    const catalog = await this.scanCatalog()
    const item = catalog.find((entry) => entry.manifest.id === pluginId)
    if (!item) throw new Error(`插件不存在：${pluginId}`)

    const records = await this.store.readPlugins(instanceId)
    const record = records.find((entry) => entry.id === pluginId)
    const existingEncrypted = record?.config ?? item.manifest.defaultConfig
    const existingDecrypted = decryptSecrets(item.manifest.schema, existingEncrypted, this.options.secretCodec)
    const merged = mergeSecretInput(item.manifest.schema, input, existingDecrypted)
    const validation = validatePluginConfig(item.manifest, merged)
    if (!validation.ok) {
      const message = validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')
      throw new Error(`配置不合法：${message}`)
    }

    const encrypted = encryptSecrets(item.manifest.schema, validation.value, this.options.secretCodec)
    const nextRecord: PluginRecord = {
      id: pluginId,
      enabled: record?.enabled ?? false,
      config: encrypted
    }
    const nextRecords = record
      ? records.map((entry) => (entry.id === pluginId ? nextRecord : entry))
      : [...records, nextRecord]

    const supervisor = this.supervisors.get(instanceId)
    if (supervisor) {
      await supervisor.applyPluginConfig(pluginId, validation.value)
    }
    await this.store.writePlugins(instanceId, nextRecords)
  }

  async setPluginEnabled(instanceId: string, pluginId: string, enabled: boolean): Promise<void> {
    const catalog = await this.scanCatalog()
    const item = catalog.find((entry) => entry.manifest.id === pluginId)
    if (!item) throw new Error(`插件不存在：${pluginId}`)

    const records = await this.store.readPlugins(instanceId)
    const record = records.find((entry) => entry.id === pluginId)
    const nextRecord: PluginRecord = {
      id: pluginId,
      enabled,
      config: record?.config ?? item.manifest.defaultConfig
    }
    const nextRecords = record
      ? records.map((entry) => (entry.id === pluginId ? nextRecord : entry))
      : [...records, nextRecord]

    const supervisor = this.supervisors.get(instanceId)
    if (supervisor) await supervisor.setPluginEnabled(pluginId, enabled)
    await this.store.writePlugins(instanceId, nextRecords)

    if (!supervisor) {
      const runtime = this.pluginStates.get(instanceId) ?? new Map<string, PluginRuntimeInfo>()
      runtime.set(pluginId, { state: enabled ? 'enabled' : 'disabled' })
      this.pluginStates.set(instanceId, runtime)
    }
  }

  subscribeLogs(instanceId: string, listener: (entry: LogEntry) => void): () => void {
    const listeners = this.logListeners.get(instanceId) ?? new Set()
    listeners.add(listener)
    this.logListeners.set(instanceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.logListeners.delete(instanceId)
    }
  }

  async shutdown(): Promise<void> {
    for (const supervisor of this.supervisors.values()) {
      await supervisor.stop().catch(() => supervisor.dispose())
    }
    this.supervisors.clear()
  }

  private handleLog(instanceId: string, entry: LogEntry): void {
    const safeEntry: LogEntry = {
      ...entry,
      ...(entry.data !== undefined ? { data: redact(entry.data) } : {})
    }
    const day = safeEntry.time.slice(0, 10)
    const dir = path.join(this.options.rootDir, 'instances', instanceId, 'logs')
    mkdir(dir, { recursive: true })
      .then(() => appendFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify(safeEntry)}\n`, 'utf8'))
      .catch(() => undefined)
    this.logListeners.get(instanceId)?.forEach((listener) => listener(safeEntry))
  }

  private handleStatus(status: InstanceStatus): void {
    this.lastStatus.set(status.id, status)
    if (status.state === 'running' || status.state === 'error' || status.state === 'stopped') {
      this.states.set(status.id, status.state)
    }
  }

  private handlePluginState(
    instanceId: string,
    pluginId: string,
    state: PluginRuntimeState,
    error?: string
  ): void {
    const runtime = this.pluginStates.get(instanceId) ?? new Map<string, PluginRuntimeInfo>()
    runtime.set(pluginId, { state, ...(error ? { error } : {}) })
    this.pluginStates.set(instanceId, runtime)
  }

  private handleExit(instanceId: string, code: number, expected: boolean): void {
    this.supervisors.delete(instanceId)
    this.pluginStates.delete(instanceId)
    if (this.failedStarts.has(instanceId)) {
      this.failedStarts.delete(instanceId)
      return
    }
    const previous = this.lastStatus.get(instanceId)
    const state: InstanceRuntimeState = expected ? 'stopped' : 'crashed'
    this.states.set(instanceId, state)
    this.lastStatus.set(instanceId, {
      id: instanceId,
      state,
      connected: false,
      sent: previous?.sent ?? 0,
      received: previous?.received ?? 0,
      ...(expected
        ? {}
        : {
            lastError: {
              code: 'WORKER_CRASHED',
              message: `Worker 意外退出，退出码 ${code}`
            }
          })
    })
  }
}
```

- [ ] **Step 9: 实现 Electron 进程工厂、IPC 与主进程**

`apps/desktop/src/main/electron-worker-factory.ts`

```ts
import { utilityProcess } from 'electron'
import type { WorkerFactory, WorkerProcessLike } from './worker-supervisor'

export function createElectronWorkerFactory(entryPath: string): WorkerFactory {
  return {
    spawn(): WorkerProcessLike {
      const child = utilityProcess.fork(entryPath, [], {
        serviceName: 'ArQQBot Worker',
        stdio: 'pipe'
      })
      return {
        postMessage: (message) => child.postMessage(message),
        on: (event: 'message' | 'exit', listener: (...args: any[]) => void) => {
          if (event === 'message') {
            child.on('message', listener as (message: unknown) => void)
          } else {
            child.on('exit', listener as (code: number) => void)
          }
        },
        kill: () => child.kill()
      }
    }
  }
}
```

`apps/desktop/src/main/ipc.ts`

```ts
import { ipcMain, type WebContents } from 'electron'
import {
  IPC_CHANNELS,
  createInstanceSchema,
  idSchema,
  updateInstanceSchema,
  updatePluginConfigSchema
} from '@arqqbot/shared'
import type { InstanceManager } from './instance-manager'

export function registerIpc(manager: InstanceManager): void {
  const subscriptions = new Map<number, () => void>()

  ipcMain.handle(IPC_CHANNELS.instancesList, () => manager.list())
  ipcMain.handle(IPC_CHANNELS.instancesCreate, (_event, input: unknown) =>
    manager.create(createInstanceSchema.parse(input))
  )
  ipcMain.handle(IPC_CHANNELS.instancesUpdate, (_event, id: unknown, input: unknown) =>
    manager.update(idSchema.parse(id), updateInstanceSchema.parse(input))
  )
  ipcMain.handle(IPC_CHANNELS.instancesRemove, (_event, id: unknown) =>
    manager.remove(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.instanceStart, (_event, id: unknown) =>
    manager.start(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.instanceStop, (_event, id: unknown) =>
    manager.stop(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.instanceRestart, (_event, id: unknown) =>
    manager.restart(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.instanceStatus, (_event, id: unknown) =>
    manager.status(idSchema.parse(id))
  )

  ipcMain.handle(IPC_CHANNELS.pluginsList, (_event, id: unknown) =>
    manager.listPlugins(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.pluginsEnable, (_event, id: unknown, pluginId: unknown) =>
    manager.setPluginEnabled(idSchema.parse(id), idSchema.parse(pluginId), true)
  )
  ipcMain.handle(IPC_CHANNELS.pluginsDisable, (_event, id: unknown, pluginId: unknown) =>
    manager.setPluginEnabled(idSchema.parse(id), idSchema.parse(pluginId), false)
  )
  ipcMain.handle(IPC_CHANNELS.pluginsUpdateConfig, (_event, input: unknown) => {
    const parsed = updatePluginConfigSchema.parse(input)
    return manager.updatePluginConfig(parsed.instanceId, parsed.pluginId, parsed.config)
  })

  ipcMain.on(IPC_CHANNELS.logsSubscribe, (event, instanceId: unknown) => {
    const parsedInstanceId = idSchema.parse(instanceId)
    const sender = event.sender
    subscriptions.get(sender.id)?.()
    const off = manager.subscribeLogs(parsedInstanceId, (entry) => {
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.logsEntry, { instanceId: parsedInstanceId, entry })
      }
    })
    subscriptions.set(sender.id, off)
    sender.once('destroyed', () => {
      off()
      subscriptions.delete(sender.id)
    })
  })

  ipcMain.on(IPC_CHANNELS.logsUnsubscribe, (event) => {
    const sender: WebContents = event.sender
    subscriptions.get(sender.id)?.()
    subscriptions.delete(sender.id)
  })
}
```

`apps/desktop/src/main/index.ts`

```ts
import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'node:path'
import { InstanceManager } from './instance-manager'
import { createElectronWorkerFactory } from './electron-worker-factory'
import { createSecretCodec } from './secrets'
import { registerIpc } from './ipc'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let manager: InstanceManager | undefined

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'ArQQBot',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f5f5f7',
      symbolColor: '#1d1d1f',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  const appPath = app.getAppPath()
  const builtinPluginRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'plugins')
    : path.resolve(appPath, '../../packages')
  const externalPluginRoot = path.join(app.getPath('userData'), 'plugins')
  const workerEntryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'worker/worker-entry.cjs')
    : path.resolve(appPath, '../../packages/runtime/dist/worker-entry.cjs')

  manager = new InstanceManager({
    rootDir: app.getPath('userData'),
    builtinPluginRoot,
    externalPluginRoot,
    workerFactory: createElectronWorkerFactory(workerEntryPath),
    secretCodec: createSecretCodec(safeStorage)
  })

  await manager.init()
  registerIpc(manager)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void manager?.shutdown()
})
```

`apps/desktop/src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@arqqbot/shared'
import type { DesktopApi } from '@arqqbot/shared'
import type { LogEntry } from '@arqqbot/shared'

const api: DesktopApi = {
  instances: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.instancesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.instancesCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.instancesUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.instancesRemove, id),
    start: (id) => ipcRenderer.invoke(IPC_CHANNELS.instanceStart, id),
    stop: (id) => ipcRenderer.invoke(IPC_CHANNELS.instanceStop, id),
    restart: (id) => ipcRenderer.invoke(IPC_CHANNELS.instanceRestart, id),
    status: (id) => ipcRenderer.invoke(IPC_CHANNELS.instanceStatus, id)
  },
  plugins: {
    list: (instanceId) => ipcRenderer.invoke(IPC_CHANNELS.pluginsList, instanceId),
    enable: (instanceId, pluginId) =>
      ipcRenderer.invoke(IPC_CHANNELS.pluginsEnable, instanceId, pluginId),
    disable: (instanceId, pluginId) =>
      ipcRenderer.invoke(IPC_CHANNELS.pluginsDisable, instanceId, pluginId),
    updateConfig: (instanceId, pluginId, config) =>
      ipcRenderer.invoke(IPC_CHANNELS.pluginsUpdateConfig, { instanceId, pluginId, config })
  },
  logs: {
    subscribe: (instanceId) => ipcRenderer.send(IPC_CHANNELS.logsSubscribe, instanceId),
    unsubscribe: (instanceId) => ipcRenderer.send(IPC_CHANNELS.logsUnsubscribe, instanceId),
    onEntry: (callback) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { instanceId: string; entry: LogEntry }
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.logsEntry, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.logsEntry, listener)
    }
  }
}

contextBridge.exposeInMainWorld('arqqbot', api)
```

- [ ] **Step 10: 安装依赖并运行测试**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @arqqbot/runtime build
pnpm --filter @arqqbot/desktop test
pnpm --filter @arqqbot/desktop typecheck
```

Expected: 8 个桌面测试全部 PASS；类型检查退出码 0。

- [ ] **Step 11: 提交**

```powershell
git add apps/desktop packages/shared pnpm-lock.yaml
git commit -m "feat(desktop): manage instances and supervise workers"
```

---

## Task 10: React 渲染层

**Files:**
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/src/renderer/src/index.css`
- Create: `apps/desktop/src/renderer/src/env.d.ts`
- Create: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/pages/InstanceList.tsx`
- Create: `apps/desktop/src/renderer/src/pages/CreateInstance.tsx`
- Create: `apps/desktop/src/renderer/src/pages/InstanceDetail.tsx`
- Create: `apps/desktop/src/renderer/src/components/SchemaForm.tsx`
- Test: `apps/desktop/test/schema-form.test.tsx`
- Test: `apps/desktop/test/instance-list.test.tsx`

- [ ] **Step 1: 写失败的测试**

`apps/desktop/test/schema-form.test.tsx`

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JsonSchema } from '@arqqbot/shared'
import { SchemaForm } from '../src/renderer/src/components/SchemaForm'

const schema: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: '名称' },
    count: { type: 'number', title: '数量', minimum: 0, maximum: 10 },
    enabled: { type: 'boolean', title: '启用' }
  },
  required: ['name']
}

describe('SchemaForm', () => {
  it('根据 Schema 渲染字段并在输入时回调新配置', () => {
    const onChange = vi.fn()
    render(<SchemaForm schema={schema} value={{}} onChange={onChange} />)

    expect(screen.getByText('名称 *')).toBeTruthy()
    expect(screen.getByText('数量')).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'echo' } })
    expect(onChange).toHaveBeenCalledWith({ name: 'echo' })

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ count: 3 })
  })
})
```

`apps/desktop/test/instance-list.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi, InstanceSummary } from '@arqqbot/shared'
import { InstanceList } from '../src/renderer/src/pages/InstanceList'

const summary: InstanceSummary = {
  id: 'inst-1',
  name: '测试实例',
  appId: '10001',
  env: 'sandbox',
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  state: 'running',
  requiresRestart: false
}

describe('InstanceList', () => {
  it('加载并渲染实例卡片', async () => {
    const api = {
      instances: { list: vi.fn(async () => [summary]) }
    } as unknown as DesktopApi
    window.arqqbot = api

    const { unmount } = render(<InstanceList onCreate={vi.fn()} onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('测试实例')).toBeTruthy())
    expect(screen.getByText('运行中')).toBeTruthy()
    unmount()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @arqqbot/desktop test
```

Expected: FAIL，提示无法找到 `../src/renderer/src/components/SchemaForm`。

- [ ] **Step 3: 创建渲染层入口与样式**

`apps/desktop/src/renderer/index.html`

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http:;"
    />
    <title>ArQQBot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`apps/desktop/src/renderer/src/env.d.ts`

```ts
/// <reference types="vite/client" />
import type { DesktopApi } from '@arqqbot/shared'

declare global {
  interface Window {
    arqqbot: DesktopApi
  }
}

export {}
```

`apps/desktop/src/renderer/src/index.css`

```css
@import "tailwindcss";

:root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1d1d1f;
  background: #f5f5f7;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
select,
textarea {
  font: inherit;
}

input,
select,
textarea {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.8);
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: rgba(0, 113, 227, 0.5);
  box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.12);
}
```

- [ ] **Step 4: 实现 SchemaForm**

`apps/desktop/src/renderer/src/components/SchemaForm.tsx`

```tsx
import type { JsonSchema } from '@arqqbot/shared'

interface SchemaFormProps {
  schema: JsonSchema
  value: Record<string, unknown>
  onChange(value: Record<string, unknown>): void
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  if (schema.type !== 'object') return <></>

  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])

  function setField(key: string, fieldValue: unknown): void {
    onChange({ ...value, [key]: fieldValue })
  }

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, field]) => {
        const title = field.title ?? key
        const current = value[key] ?? field.default
        const label = (
          <span className="text-sm font-medium text-neutral-800">
            {title}
            {required.has(key) ? ' *' : ''}
          </span>
        )
        const description = field.description ? (
          <span className="mt-1 block text-xs text-neutral-500">{field.description}</span>
        ) : null

        if (field.type === 'object') {
          return (
            <div key={key} className="rounded-2xl border border-black/5 bg-white/60 p-4">
              <p className="mb-3 text-sm font-medium text-neutral-800">{title}</p>
              <SchemaForm
                schema={field}
                value={(current ?? {}) as Record<string, unknown>}
                onChange={(next) => setField(key, next)}
              />
              {description}
            </div>
          )
        }

        if (field.enum) {
          return (
            <label key={key} className="block">
              {label}
              <select
                className="mt-1 w-full"
                value={String(current ?? '')}
                onChange={(event) => {
                  const option = field.enum?.find((item) => String(item) === event.target.value)
                  setField(key, option ?? event.target.value)
                }}
              >
                {field.enum.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
              {description}
            </label>
          )
        }

        if (field.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(current)}
                onChange={(event) => setField(key, event.target.checked)}
              />
              {label}
              {description}
            </label>
          )
        }

        if (field.type === 'number') {
          return (
            <label key={key} className="block">
              {label}
              <input
                type="number"
                className="mt-1 w-full"
                min={field.minimum}
                max={field.maximum}
                value={current === undefined ? '' : Number(current)}
                onChange={(event) =>
                  setField(key, event.target.value === '' ? undefined : Number(event.target.value))
                }
              />
              {description}
            </label>
          )
        }

        if (field.type === 'array') {
          return (
            <label key={key} className="block">
              {label}
              <textarea
                className="mt-1 w-full font-mono text-xs"
                rows={4}
                value={JSON.stringify(current ?? [], null, 2)}
                onChange={(event) => {
                  try {
                    setField(key, JSON.parse(event.target.value))
                  } catch {
                    // 输入未完成时保持原值，合法 JSON 后立即写回
                  }
                }}
              />
              {description}
            </label>
          )
        }

        const isTextarea = field.format === 'textarea'
        return (
          <label key={key} className="block">
            {label}
            {isTextarea ? (
              <textarea
                className="mt-1 w-full"
                rows={4}
                value={String(current ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            ) : (
              <input
                type={field.format === 'password' ? 'password' : 'text'}
                className="mt-1 w-full"
                value={String(current ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            )}
            {description}
          </label>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: 实现应用外壳与实例列表**

`apps/desktop/src/renderer/src/App.tsx`

```tsx
import { useState } from 'react'
import { CreateInstance } from './pages/CreateInstance'
import { InstanceDetail } from './pages/InstanceDetail'
import { InstanceList } from './pages/InstanceList'

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; id: string }

export function App() {
  const [view, setView] = useState<View>({ kind: 'list' })

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="flex items-start justify-between px-10 pt-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ArQQBot</h1>
          <p className="mt-1 text-sm text-neutral-500">QQ 机器人实例管理器</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-10 py-8">
        {view.kind === 'list' && (
          <InstanceList
            onCreate={() => setView({ kind: 'create' })}
            onOpen={(id) => setView({ kind: 'detail', id })}
          />
        )}
        {view.kind === 'create' && (
          <CreateInstance
            onCancel={() => setView({ kind: 'list' })}
            onCreated={(id) => setView({ kind: 'detail', id })}
          />
        )}
        {view.kind === 'detail' && (
          <InstanceDetail instanceId={view.id} onBack={() => setView({ kind: 'list' })} />
        )}
      </main>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/pages/InstanceList.tsx`

```tsx
import { useEffect, useState } from 'react'
import type { InstanceSummary } from '@arqqbot/shared'

const STATE_TEXT: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  crashed: '崩溃',
  error: '错误',
  starting: '启动中',
  stopping: '停止中',
  created: '已创建'
}

const STATE_COLOR: Record<string, string> = {
  running: 'bg-green-500',
  crashed: 'bg-red-500',
  error: 'bg-red-500',
  starting: 'bg-amber-500',
  stopping: 'bg-amber-500'
}

interface InstanceListProps {
  onCreate(): void
  onOpen(id: string): void
}

export function InstanceList({ onCreate, onOpen }: InstanceListProps) {
  const [items, setItems] = useState<InstanceSummary[]>([])
  const [error, setError] = useState<string>()

  async function refresh(): Promise<void> {
    try {
      setItems(await window.arqqbot.instances.list())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [])

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">实例</h2>
        <button
          className="rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white shadow-sm"
          onClick={onCreate}
        >
          新建实例
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!error && items.length === 0 && (
        <div className="rounded-3xl bg-white/70 p-12 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-lg font-medium">还没有实例</p>
          <p className="mt-2 text-sm text-neutral-500">点击“新建实例”绑定第一个 QQ 机器人。</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            className="rounded-3xl bg-white/70 p-6 text-left shadow-sm ring-1 ring-black/5 backdrop-blur transition hover:shadow-md"
            onClick={() => onOpen(item.id)}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <span className="text-xs text-neutral-500">
                {item.env === 'sandbox' ? '沙箱' : '正式'}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-neutral-600">
              <span
                className={`h-2 w-2 rounded-full ${STATE_COLOR[item.state] ?? 'bg-neutral-400'}`}
              />
              {STATE_TEXT[item.state] ?? item.state}
              {item.requiresRestart && (
                <span className="ml-2 text-amber-600">需重启生效</span>
              )}
            </div>
            <div className="mt-2 font-mono text-xs text-neutral-400">{item.appId}</div>
          </button>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 6: 实现创建实例向导**

`apps/desktop/src/renderer/src/pages/CreateInstance.tsx`

```tsx
import { useState, type FormEvent } from 'react'
import type { InstanceEnv } from '@arqqbot/shared'

interface CreateInstanceProps {
  onCancel(): void
  onCreated(id: string): void
}

export function CreateInstance({ onCancel, onCreated }: CreateInstanceProps) {
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [env, setEnv] = useState<InstanceEnv>('sandbox')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const created = await window.arqqbot.instances.create({ name, appId, appSecret, env })
      onCreated(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="max-w-xl space-y-5 rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-black/5"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">新建实例</h2>
        <button type="button" className="text-sm text-neutral-500" onClick={onCancel}>
          取消
        </button>
      </div>

      <label className="block text-sm">
        <span className="font-medium">实例名称</span>
        <input
          className="mt-1 w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">AppID</span>
        <input
          className="mt-1 w-full font-mono"
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">AppSecret</span>
        <input
          type="password"
          className="mt-1 w-full"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-neutral-500">
          密钥会用系统加密保存，界面不会再次显示明文。
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium">环境</span>
        <select
          className="mt-1 w-full"
          value={env}
          onChange={(event) => setEnv(event.target.value as InstanceEnv)}
        >
          <option value="sandbox">沙箱</option>
          <option value="production">正式</option>
        </select>
      </label>

      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
      >
        {busy ? '创建中…' : '创建实例'}
      </button>
    </form>
  )
}
```

- [ ] **Step 7: 实现实例详情**

`apps/desktop/src/renderer/src/pages/InstanceDetail.tsx`

```tsx
import { useEffect, useState } from 'react'
import type { InstanceStatus, LogEntry, LogLevel, PluginSummary } from '@arqqbot/shared'
import { SchemaForm } from '../components/SchemaForm'

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'plugins', label: '插件' },
  { id: 'logs', label: '日志' }
] as const

type TabId = (typeof TABS)[number]['id']

interface InstanceDetailProps {
  instanceId: string
  onBack(): void
}

export function InstanceDetail({ instanceId, onBack }: InstanceDetailProps) {
  const [tab, setTab] = useState<TabId>('overview')
  const [status, setStatus] = useState<InstanceStatus>()
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string>()

  async function refresh(): Promise<void> {
    try {
      const [nextStatus, nextPlugins] = await Promise.all([
        window.arqqbot.instances.status(instanceId),
        window.arqqbot.plugins.list(instanceId)
      ])
      setStatus(nextStatus)
      setPlugins(nextPlugins)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [instanceId])

  useEffect(() => {
    window.arqqbot.logs.subscribe(instanceId)
    const off = window.arqqbot.logs.onEntry((payload) => {
      if (payload.instanceId !== instanceId) return
      setLogs((previous) => [...previous.slice(-499), payload.entry])
    })
    return () => {
      off()
      window.arqqbot.logs.unsubscribe(instanceId)
    }
  }, [instanceId])

  async function start(): Promise<void> {
    try {
      await window.arqqbot.instances.start(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function stop(): Promise<void> {
    try {
      await window.arqqbot.instances.stop(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function restart(): Promise<void> {
    try {
      await window.arqqbot.instances.restart(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function removeInstance(): Promise<void> {
    if (!window.confirm('删除该实例会移除本地配置与日志，确定继续？')) return
    try {
      await window.arqqbot.instances.remove(instanceId)
      onBack()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function exportLogs(): void {
    const content = visibleLogs.map((entry) => JSON.stringify(entry)).join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'application/jsonl' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `logs-${instanceId}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const running = status?.state === 'running'
  const visibleLogs = logs.filter((entry) => {
    const levelMatches = level === 'all' || entry.level === level
    const keyword = search.trim().toLowerCase()
    const searchMatches =
      keyword.length === 0 ||
      entry.message.toLowerCase().includes(keyword) ||
      (entry.pluginId ?? '').toLowerCase().includes(keyword)
    return levelMatches && searchMatches
  })

  return (
    <section className="space-y-6">
      <button className="text-sm text-neutral-500" onClick={onBack}>
        ← 返回实例列表
      </button>

      <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">实例详情</h2>
            <p className="mt-1 font-mono text-xs text-neutral-400">{instanceId}</p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full bg-[#0071e3] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={running}
              onClick={start}
            >
              启动
            </button>
            <button
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={!running}
              onClick={stop}
            >
              停止
            </button>
            <button
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium"
              onClick={restart}
            >
              重启
            </button>
            <button
              className="rounded-full bg-red-50 px-4 py-2 text-sm font-medium text-red-600"
              onClick={removeInstance}
            >
              删除
            </button>
          </div>
        </div>
        {status?.lastError && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {status.lastError.code}：{status.lastError.message}
          </div>
        )}
        {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <nav className="flex gap-1 rounded-full bg-black/5 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === item.id ? 'bg-white font-medium shadow-sm' : 'text-neutral-500'
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="状态" value={status?.state ?? 'unknown'} />
          <StatCard label="连接" value={status?.connected ? '已连接' : '未连接'} />
          <StatCard label="收消息" value={String(status?.received ?? 0)} />
          <StatCard label="发消息" value={String(status?.sent ?? 0)} />
          <StatCard
            label="启动时间"
            value={status?.startedAt ? new Date(status.startedAt).toLocaleString('zh-CN') : '-'}
          />
        </div>
      )}

      {tab === 'plugins' && (
        <div className="space-y-4">
          {plugins.length === 0 && (
            <div className="rounded-3xl bg-white/70 p-8 text-sm text-neutral-500">
              未发现插件。请确认内置插件已构建并位于 `resources/plugins`。
            </div>
          )}
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              instanceId={instanceId}
              plugin={plugin}
              onChanged={() => void refresh()}
            />
          ))}
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as 'all' | LogLevel)}
            >
              <option value="all">全部级别</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <input
              className="w-56"
              placeholder="搜索日志"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="text-sm text-[#0071e3]" onClick={exportLogs}>
              导出 JSONL
            </button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-3xl bg-[#111113] p-4 font-mono text-xs text-neutral-300">
            {visibleLogs.length === 0 && <p className="text-neutral-500">暂无日志</p>}
            {visibleLogs.map((entry, index) => (
              <div key={`${entry.time}-${index}`} className="whitespace-pre-wrap py-0.5">
                <span className="text-neutral-500">{entry.time}</span>{' '}
                <span className={entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-300' : 'text-sky-300'}>
                  [{entry.level}]
                </span>{' '}
                {entry.pluginId && <span className="text-violet-300">[{entry.pluginId}] </span>}
                {entry.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}

function PluginCard({
  instanceId,
  plugin,
  onChanged
}: {
  instanceId: string
  plugin: PluginSummary
  onChanged(): void
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(plugin.config)
  const [message, setMessage] = useState<string>()

  async function toggle(): Promise<void> {
    setMessage(undefined)
    try {
      if (plugin.enabled) {
        await window.arqqbot.plugins.disable(instanceId, plugin.id)
      } else {
        await window.arqqbot.plugins.enable(instanceId, plugin.id)
      }
      onChanged()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function save(): Promise<void> {
    setMessage(undefined)
    try {
      await window.arqqbot.plugins.updateConfig(instanceId, plugin.id, config)
      setMessage('配置已保存')
      onChanged()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{plugin.displayName}</h3>
          <p className="mt-1 text-xs text-neutral-500">
            {plugin.id} · v{plugin.version} · {plugin.runtimeState}
          </p>
          {plugin.description && <p className="mt-2 text-sm text-neutral-600">{plugin.description}</p>}
        </div>
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            plugin.enabled ? 'bg-black/5' : 'bg-[#0071e3] text-white'
          }`}
          onClick={toggle}
        >
          {plugin.enabled ? '禁用' : '启用'}
        </button>
      </div>

      <div className="mt-5 border-t border-black/5 pt-5">
        <SchemaForm schema={plugin.schema} value={config} onChange={setConfig} />
        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium"
            onClick={save}
          >
            保存配置
          </button>
          {message && <span className="text-xs text-neutral-500">{message}</span>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: 运行测试与类型检查**

Run:

```powershell
pnpm --filter @arqqbot/desktop test
pnpm --filter @arqqbot/desktop typecheck
```

Expected: 10 个桌面测试全部 PASS；类型检查退出码 0。

- [ ] **Step 9: 手动启动验证**

Run:

```powershell
pnpm --filter @arqqbot/runtime build
pnpm --filter arqqbot-plugin-echo build
pnpm --filter @arqqbot/desktop dev
```

Expected: Electron 窗口打开，显示“还没有实例”空状态；创建实例后进入详情页，插件页显示 `echo` 插件。

- [ ] **Step 10: 提交**

```powershell
git add apps/desktop
git commit -m "feat(desktop): add React console for instances and plugins"
```

---

## Task 11: Windows 打包与验收

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `package.json`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: 配置打包脚本**

根 `package.json` 的 `scripts` 改为：

```json
{
  "scripts": {
    "build": "pnpm --filter arqqbot-plugin-echo build && pnpm --filter @arqqbot/runtime build && pnpm --filter @arqqbot/desktop build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "package:win": "pnpm build && pnpm --filter @arqqbot/desktop exec electron-builder --win nsis"
  }
}
```

`apps/desktop/package.json` 增加脚本：

```json
{
  "scripts": {
    "package:win": "electron-builder --win nsis"
  }
}
```

- [ ] **Step 2: 创建 electron-builder 配置**

`apps/desktop/electron-builder.yml`

```yaml
appId: com.arqqbot.desktop
productName: ArQQBot
directories:
  output: release
files:
  - out/**
  - package.json
  - "!**/node_modules/**"
extraResources:
  - from: ../../packages/plugin-echo/package.json
    to: plugins/plugin-echo/package.json
  - from: ../../packages/plugin-echo/dist
    to: plugins/plugin-echo/dist
  - from: ../../packages/runtime/dist/worker-entry.cjs
    to: worker/worker-entry.cjs
asar: true
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

- [ ] **Step 3: 构建安装包**

Run:

```powershell
pnpm package:win
```

Expected: `apps/desktop/release/` 下生成 `ArQQBot Setup 0.1.0.exe`，命令退出码 0。

- [ ] **Step 4: 手工验收**

在干净的 Windows 环境安装并依次验证：

1. 安装包可正常安装与启动，首次启动显示空实例列表。
2. 新建实例，填写沙箱 AppID/AppSecret，重启应用后实例仍在，界面不回显明文密钥。
3. 启用 `echo` 插件并启动实例，日志显示“QQ 网关已就绪”。
4. 在沙箱群聊 @ 机器人发送“你好”，收到“收到：你好”。
5. 修改 `echo` 插件前缀为“回显：”并保存，日志出现插件热重载，后续回复使用新前缀。
6. 重复触发同一条消息事件不会重复回复；连续回复超过 5 次返回配额错误日志。
7. 用任务管理器结束该实例的 Worker 进程，界面状态变为“崩溃”，另一个实例不受影响；点击重启可恢复。
8. 删除实例后，`%APPDATA%/ArQQBot/instances/<id>` 目录被移除。
9. 日志页可过滤、导出 JSONL，导出内容不包含 AppSecret 或 API Key 明文。

- [ ] **Step 5: 提交**

```powershell
git add package.json apps/desktop
git commit -m "build: package ArQQBot for Windows"
```

---

## 计划自检

- **规格覆盖**：实例管理（Task 9）、插件规范与热重载（Task 2、4）、QQ 适配器（Task 6、7）、Worker 隔离（Task 8、9）、日志与界面（Task 9、10）、打包验收（Task 11）。
- **类型一致性**：`PluginRecord`、`PluginSummary`、`AdapterHandle`、`WorkerRequest/WorkerEvent` 在所有任务中保持同一命名与字段。
- **已知顺序依赖**：Task 3 的 runtime 包不依赖适配器；Task 8 才把 `@arqqbot/adapter-qq` 加入 runtime 依赖。Task 9 启动前必须先构建 runtime Worker 产物。

---

## 运行期修复记录（2026-11-01）

真实沙箱联调后补充了以下修复，均已在代码中生效：

1. **Worker 打包**：tsup 默认会把 `dependencies` 外置，导致 Worker 运行时去加载 `@arqqbot/adapter-qq` 的 `.ts` 源码。新增 `packages/runtime/tsup.config.ts`，通过 `noExternal` 把 `@arqqbot/adapter-qq`、`@arqqbot/shared`、`cordis`、`ws` 内联进 `worker-entry.cjs`。
2. **QQ 接口版本**：当前开放平台 token 地址为 `https://api.bot.qq.com/app/getAppAccessToken`，请求字段为 `clientSecret`，且 `expires_in` 实际返回字符串。适配器改为新接口优先、旧接口回退，并统一转换有效期；API 域名优先 `api.bot.qq.com`，失败回退 `api.sgroup.qq.com` / `sandbox.api.sgroup.qq.com`。
3. **消息收发日志**：适配器记录 `收到群聊/单聊消息`、`已发送群聊/单聊消息` 与 `收到暂未处理的 QQ 事件`；控制台日志页新增“只看消息”，收发消息分别着色。
4. **测试数量更新**：新增 `log-format` 测试与 token 字符串有效期测试，全仓测试总数由 47 增至 52。
5. **分析文档**：新增 `docs/qq-bot-invocation-and-use-cases.md`，记录触发条件、场景矩阵、平台约束与排障顺序。

