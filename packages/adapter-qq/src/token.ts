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
    this.endpoint = options.endpoint ?? 'https://bots.qq.com/app/getAppAccessToken'
    this.refreshAheadMs = options.refreshAheadMs ?? 60_000
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

  private async refresh(): Promise<string> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: this.options.appId,
        appSecret: this.options.appSecret
      })
    })

    if (!response.ok) {
      throw new QQAuthError(`获取 access_token 失败：HTTP ${response.status}`, response.status)
    }

    const body = (await response.json()) as {
      access_token?: unknown
      expires_in?: unknown
    }

    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new QQAuthError('获取 access_token 失败：响应缺少 access_token 或 expires_in')
    }

    this.state = {
      value: body.access_token,
      expiresAt: this.nowFn() + body.expires_in * 1000
    }
    return body.access_token
  }
}
