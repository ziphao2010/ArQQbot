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
