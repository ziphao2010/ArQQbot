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
