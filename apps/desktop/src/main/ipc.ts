import { ipcMain, type WebContents } from 'electron'
import {
  IPC_CHANNELS,
  createInstanceSchema,
  idSchema,
  qqUpdateIntentsSchema,
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

  ipcMain.handle(IPC_CHANNELS.qqCapabilities, (_event, id: unknown) =>
    manager.capabilities(idSchema.parse(id))
  )
  ipcMain.handle(IPC_CHANNELS.qqUpdateIntents, (_event, input: unknown) => {
    const parsed = qqUpdateIntentsSchema.parse(input)
    return manager.updateIntents(parsed.instanceId, parsed.intents)
  })

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
