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
