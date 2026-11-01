import { z } from 'zod'
import { QQ_INTENT_NAMES } from './qq'

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
  pluginsMarketplace: 'plugins:marketplace',
  pluginsInstall: 'plugins:install',
  logsSubscribe: 'logs:subscribe',
  logsUnsubscribe: 'logs:unsubscribe',
  logsEntry: 'logs:entry',
  qqCapabilities: 'qq:capabilities',
  qqUpdateIntents: 'qq:update-intents'
} as const

const intentSchema = z.enum(QQ_INTENT_NAMES)

export const idSchema = z.string().min(1)

export const createInstanceSchema = z.object({
  name: z.string().trim().min(1).max(64),
  appId: z.string().trim().min(1),
  appSecret: z.string().min(1),
  env: z.enum(['sandbox', 'production']),
  intents: z.array(intentSchema).optional()
})

export const updateInstanceSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  appId: z.string().trim().min(1).optional(),
  appSecret: z.string().min(1).optional(),
  env: z.enum(['sandbox', 'production']).optional(),
  intents: z.array(intentSchema).optional()
})

export const qqUpdateIntentsSchema = z.object({
  instanceId: z.string().min(1),
  intents: z.array(intentSchema)
})

export const updatePluginConfigSchema = z.object({
  instanceId: z.string().min(1),
  pluginId: z.string().min(1),
  config: z.record(z.string(), z.unknown())
})

const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: '必须是 http/https 地址' }
  )

export const pluginMarketIndexUrlSchema = z.string().trim().max(2048).optional()

export const pluginMarketEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    packageName: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    repo: z.string().optional(),
    commit: z.string().optional(),
    downloadUrl: httpUrlSchema,
    homepage: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sha256: z.string().nullable().optional()
  })
  .passthrough()

export type CreateInstancePayload = z.infer<typeof createInstanceSchema>
export type UpdateInstancePayload = z.infer<typeof updateInstanceSchema>
export type UpdatePluginConfigPayload = z.infer<typeof updatePluginConfigSchema>
