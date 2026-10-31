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
