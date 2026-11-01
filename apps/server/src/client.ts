import WebSocket from 'ws'
import type { LogEntry } from '@arqqbot/shared'

export interface ApiClientOptions {
  baseUrl: string
  token: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiClient {
  readonly baseUrl: string
  private readonly token: string

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      ...extra
    }
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body === undefined ? undefined : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (response.status === 204) return undefined as T
    const text = await response.text()
    const parsed = text ? (JSON.parse(text) as unknown) : undefined
    if (!response.ok) {
      const error = parsed as { error?: { code?: string; message?: string } } | undefined
      throw new ApiError(
        error?.error?.message ?? `HTTP ${response.status}`,
        response.status,
        error?.error?.code
      )
    }
    return parsed as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  async subscribeLogs(
    instanceId: string,
    onEntry: (entry: LogEntry) => void,
    onError?: (error: Error) => void
  ): Promise<() => void> {
    const { ticket } = await this.post<{ ticket: string }>('/api/ws-ticket', { instanceId })
    const wsUrl = this.baseUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsUrl}/ws/logs?ticket=${encodeURIComponent(ticket)}`)

    socket.on('message', (data) => {
      try {
        const event = JSON.parse(String(data)) as {
          type?: string
          instanceId?: string
          entry?: LogEntry
        }
        if (event.type === 'log' && event.entry) onEntry(event.entry)
      } catch {
        // 忽略非 JSON 消息
      }
    })
    socket.on('error', (error) => onError?.(error))
    socket.on('unexpected-response', (_request, response) => {
      onError?.(new Error(`日志连接失败：HTTP ${response.statusCode}`))
    })

    return () => socket.close()
  }
}
