export class QQAuthError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'QQAuthError'
    this.status = status
  }
}

export interface TokenManagerOptions {
  appId: string
  appSecret: string
  fetchImpl?: typeof fetch
  now?: () => number
  endpoint?: string
  refreshAheadMs?: number
}

interface TokenState {
  value: string
  expiresAt: number
}

type SecretField = 'clientSecret' | 'appSecret'

export class TokenManager {
  private readonly fetchImpl: typeof fetch
  private readonly nowFn: () => number
  private readonly endpoint: string
  private readonly refreshAheadMs: number
  private state?: TokenState
  private pending?: Promise<string>

  constructor(private readonly options: TokenManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowFn = options.now ?? Date.now
    this.endpoint = options.endpoint ?? 'https://api.bot.qq.com/app/getAppAccessToken'
    this.refreshAheadMs = options.refreshAheadMs ?? 60_000
  }

  invalidate(): void {
    this.state = undefined
  }

  async get(): Promise<string> {
    if (this.state && this.state.expiresAt - this.refreshAheadMs > this.nowFn()) {
      return this.state.value
    }
    if (this.pending) return this.pending

    this.pending = this.refresh().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async request(endpoint: string, field: SecretField): Promise<string> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: this.options.appId,
        [field]: this.options.appSecret
      })
    })

    const raw = await response.text()
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      body = {}
    }

    if (!response.ok) {
      const code = body.code ?? body.errcode
      const message = body.message ?? body.msg
      const detail = [
        `HTTP ${response.status}`,
        code !== undefined ? `code=${String(code)}` : '',
        message !== undefined ? String(message) : ''
      ]
        .filter(Boolean)
        .join(' ')
      throw new QQAuthError(`获取 access_token 失败：${detail}`, response.status)
    }

    if (typeof body.access_token !== 'string') {
      const keys = Object.keys(body).join(',') || 'empty'
      throw new QQAuthError(
        `获取 access_token 失败：响应缺少 access_token（字段：${keys}）`,
        response.status
      )
    }

    const expiresIn = Number(body.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new QQAuthError(
        `获取 access_token 失败：expires_in 不合法（${String(body.expires_in)}）`,
        response.status
      )
    }

    this.state = {
      value: body.access_token,
      expiresAt: this.nowFn() + expiresIn * 1000
    }
    return body.access_token
  }

  private async refresh(): Promise<string> {
    const attempts: Array<{ endpoint: string; field: SecretField }> = [
      { endpoint: this.endpoint, field: 'clientSecret' },
      { endpoint: 'https://bots.qq.com/app/getAppAccessToken', field: 'appSecret' }
    ]
    let lastError: unknown

    for (const attempt of attempts) {
      try {
        return await this.request(attempt.endpoint, attempt.field)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new QQAuthError('获取 access_token 失败：未知错误')
  }
}
