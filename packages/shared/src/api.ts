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
