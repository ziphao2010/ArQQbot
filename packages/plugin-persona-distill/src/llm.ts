import type { ChatMessage } from '@arqqbot/persona-core'

export interface LlmOptions {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class LlmError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

export class LlmClient {
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: LlmOptions) {
    this.endpoint = `${options.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30000
  }

  get configured(): boolean {
    return this.options.baseUrl.trim().length > 0 && this.options.apiKey.trim().length > 0
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.configured) {
      throw new LlmError('未配置模型接口：请先在实例的插件配置中填写接口地址与 API Key')
    }

    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey.trim()}`
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: this.options.temperature,
          stream: false
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new LlmError(`请求模型接口失败：${message}`)
    }

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw new LlmError(`模型接口返回 ${response.status}${detail ? `：${detail}` : ''}`, response.status)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new LlmError('模型返回内容不是合法 JSON')
    }

    const content = (data as CompletionResponse)?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new LlmError('模型返回内容为空')
    }
    return content.trim()
  }
}
