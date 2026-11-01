import type {
  CreateInstanceInput,
  DesktopApi,
  InstanceStatus,
  InstanceSummary,
  LogEntry,
  PluginMarketEntry,
  PluginMarketSnapshot,
  PluginSummary,
  QQCapabilitySnapshot,
  QQIntentName,
  UpdateInstanceInput
} from '@arqqbot/shared'

const TOKEN_KEY = 'arqqbot.token'

/**
 * Web 控制台与无头服务端同源部署，token 优先从 URL hash（#token=...）读取，
 * 读取后写入 sessionStorage 并从地址栏抹掉，避免 token 留在浏览器历史与代理日志里。
 */
export function readWebToken(): string {
  if (typeof window === 'undefined') return ''
  const { hash } = window.location
  const fromHash = hash.startsWith('#token=') ? decodeURIComponent(hash.slice('#token='.length)) : ''
  if (fromHash) {
    window.sessionStorage.setItem(TOKEN_KEY, fromHash)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return fromHash
  }
  return window.sessionStorage.getItem(TOKEN_KEY) ?? ''
}

export function saveWebToken(token: string): void {
  window.sessionStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearWebToken(): void {
  window.sessionStorage.removeItem(TOKEN_KEY)
}

export function hasWebToken(): boolean {
  return readWebToken().length > 0
}

export class HttpApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'HttpApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readWebToken()
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  const response = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

  if (response.status === 401) {
    clearWebToken()
    window.location.reload()
    throw new HttpApiError('访问 token 无效或已失效，请重新输入 token', 401)
  }
  if (response.status === 204) return undefined as T

  const text = await response.text()
  const parsed = text ? (JSON.parse(text) as unknown) : undefined
  if (!response.ok) {
    const error = parsed as { error?: { message?: string } } | undefined
    throw new HttpApiError(error?.error?.message ?? `请求失败：HTTP ${response.status}`, response.status)
  }
  return parsed as T
}

export function createHttpApi(): DesktopApi {
  const listeners = new Set<(payload: { instanceId: string; entry: LogEntry }) => void>()
  let socket: WebSocket | undefined
  let currentInstanceId: string | undefined
  let generation = 0

  function closeStream(): void {
    generation += 1
    socket?.close()
    socket = undefined
    currentInstanceId = undefined
  }

  function openStream(instanceId: string): void {
    if (currentInstanceId === instanceId && socket) return
    closeStream()
    currentInstanceId = instanceId
    const current = generation

    void request<{ ticket: string }>('POST', '/api/ws-ticket', { instanceId })
      .then(({ ticket }) => {
        if (current !== generation) return
        const url = new URL('/ws/logs', window.location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('ticket', ticket)
        const next = new WebSocket(url.toString())
        socket = next
        next.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data)) as {
              type?: string
              instanceId?: string
              entry?: LogEntry
            }
            if (payload.type !== 'log' || !payload.entry || !payload.instanceId) return
            for (const listener of listeners) {
              listener({ instanceId: payload.instanceId, entry: payload.entry })
            }
          } catch {
            // 忽略非 JSON 消息
          }
        }
      })
      .catch(() => {
        // 日志流失败不影响控制台主流程，可由页面提示重试
      })
  }

  return {
    instances: {
      list: () => request<InstanceSummary[]>('GET', '/api/instances'),
      create: (input: CreateInstanceInput) =>
        request<InstanceSummary>('POST', '/api/instances', input),
      update: (id: string, input: UpdateInstanceInput) =>
        request<InstanceSummary>('PATCH', `/api/instances/${encodeURIComponent(id)}`, input),
      remove: (id: string) => request<void>('DELETE', `/api/instances/${encodeURIComponent(id)}`),
      start: (id: string) => request<void>('POST', `/api/instances/${encodeURIComponent(id)}/start`),
      stop: (id: string) => request<void>('POST', `/api/instances/${encodeURIComponent(id)}/stop`),
      restart: (id: string) =>
        request<void>('POST', `/api/instances/${encodeURIComponent(id)}/restart`),
      status: (id: string) =>
        request<InstanceStatus>('GET', `/api/instances/${encodeURIComponent(id)}/status`)
    },
    plugins: {
      list: (instanceId: string) =>
        request<PluginSummary[]>('GET', `/api/instances/${encodeURIComponent(instanceId)}/plugins`),
      enable: (instanceId: string, pluginId: string) =>
        request<void>(
          'POST',
          `/api/instances/${encodeURIComponent(instanceId)}/plugins/${encodeURIComponent(pluginId)}/enable`
        ),
      disable: (instanceId: string, pluginId: string) =>
        request<void>(
          'POST',
          `/api/instances/${encodeURIComponent(instanceId)}/plugins/${encodeURIComponent(pluginId)}/disable`
        ),
      updateConfig: (instanceId: string, pluginId: string, config: Record<string, unknown>) =>
        request<void>(
          'PUT',
          `/api/instances/${encodeURIComponent(instanceId)}/plugins/${encodeURIComponent(pluginId)}/config`,
          { config }
        ),
      marketplace: (indexUrl?: string) =>
        request<PluginMarketSnapshot>(
          'GET',
          indexUrl ? `/api/marketplace?indexUrl=${encodeURIComponent(indexUrl)}` : '/api/marketplace'
        ),
      install: (entry: PluginMarketEntry) =>
        request<void>('POST', '/api/marketplace/install', entry)
    },
    logs: {
      subscribe: (instanceId: string) => openStream(instanceId),
      unsubscribe: () => closeStream(),
      onEntry: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      }
    },
    qq: {
      capabilities: (instanceId: string) =>
        request<QQCapabilitySnapshot>(
          'GET',
          `/api/instances/${encodeURIComponent(instanceId)}/capabilities`
        ),
      updateIntents: (instanceId: string, intents: QQIntentName[]) =>
        request<void>('PUT', `/api/instances/${encodeURIComponent(instanceId)}/intents`, { intents })
    },
    window: {
      setTheme: async () => {
        // Web 模式下主题由浏览器侧处理
      }
    }
  }
}
