import type { QQApiErrorCode } from '@arqqbot/shared'

export interface QQApiErrorMeta {
  status?: number
  platformCode?: string
  endpointId?: string
}

export class QQApiError extends Error {
  readonly code: QQApiErrorCode
  readonly meta: QQApiErrorMeta

  constructor(code: QQApiErrorCode, message: string, meta: QQApiErrorMeta = {}) {
    super(message)
    this.name = 'QQApiError'
    this.code = code
    this.meta = meta
  }
}

const PLATFORM_CODE_MAP: Record<string, QQApiErrorCode> = {
  '22009': 'QUOTA_EXCEEDED',
  '11251': 'UNAUTHORIZED',
  '11253': 'PERMISSION_DENIED',
  '11282': 'PERMISSION_DENIED'
}

function mapStatus(status: number): QQApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return 'BAD_REQUEST'
}

export function mapHttpError(status: number, body: unknown, endpointId?: string): QQApiError {
  const record =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const rawCode = record.err_code ?? record.code
  const platformCode = rawCode === undefined ? undefined : String(rawCode)
  const rawMessage = record.message ?? record.msg
  const message = typeof rawMessage === 'string' ? rawMessage : `HTTP ${status}`
  const code = platformCode ? PLATFORM_CODE_MAP[platformCode] ?? mapStatus(status) : mapStatus(status)
  const detail = platformCode ? `${status} (${platformCode})：${message}` : `${status}：${message}`

  return new QQApiError(code, `QQ API ${detail}`, {
    status,
    ...(platformCode ? { platformCode } : {}),
    ...(endpointId ? { endpointId } : {})
  })
}
