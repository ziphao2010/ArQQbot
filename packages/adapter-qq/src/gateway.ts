import WebSocket from 'ws'

export interface SocketLike {
  on(event: string, listener: (...args: any[]) => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

export interface GatewayHandlers {
  onDispatch(event: string, data: unknown): void
  onReady(): void
  onError(error: Error): void
}

export interface GatewayOptions {
  url: string
  getToken: () => Promise<string>
  intents: number
  handlers: GatewayHandlers
  socketFactory?: SocketFactory
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

interface Payload {
  op: number
  s?: number
  t?: string
  d?: any
}

export class GatewayClient {
  connected = false

  private socket?: SocketLike
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private sessionId?: string
  private lastSeq = 0
  private attempts = 0
  private manualClose = false
  private ready = false
  private resolveReady?: () => void
  private rejectReady?: (error: Error) => void

  constructor(private readonly options: GatewayOptions) {}

  connect(): Promise<void> {
    this.manualClose = false
    this.ready = false
    return new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
      this.openSocket()
    })
  }

  close(): void {
    this.manualClose = true
    this.connected = false
    this.clearTimers()
    this.socket?.close(1000, 'manual close')
    this.socket = undefined
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = undefined
    this.reconnectTimer = undefined
  }

  private openSocket(): void {
    const socket = this.options.socketFactory
      ? this.options.socketFactory(this.options.url)
      : (new WebSocket(this.options.url) as unknown as SocketLike)
    this.socket = socket

    socket.on('open', () => undefined)
    socket.on('message', (raw: unknown) => this.handleMessage(raw))
    socket.on('error', (error: unknown) => {
      this.options.handlers.onError(error instanceof Error ? error : new Error(String(error)))
    })
    socket.on('close', (code: unknown) => this.handleClose(typeof code === 'number' ? code : 0))
  }

  private send(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload))
  }

  private handleMessage(raw: unknown): void {
    const text =
      typeof raw === 'string'
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : String(raw)

    let payload: Payload
    try {
      payload = JSON.parse(text) as Payload
    } catch {
      return
    }

    if (typeof payload.s === 'number') this.lastSeq = payload.s

    if (payload.op === 10) {
      const interval = payload.d?.heartbeat_interval
      if (typeof interval === 'number') this.startHeartbeat(interval)
      void this.identifyOrResume()
      return
    }

    if (payload.op === 11) return

    if (payload.op === 0) {
      if (payload.t === 'READY') {
        this.sessionId = payload.d?.session_id ?? this.sessionId
        this.connected = true
        this.ready = true
        this.attempts = 0
        this.resolveReady?.()
        this.resolveReady = undefined
        this.rejectReady = undefined
        this.options.handlers.onReady()
        return
      }
      if (payload.t) this.options.handlers.onDispatch(payload.t, payload.d)
      return
    }

    if (payload.op === 7) {
      this.socket?.close(4000, 'reconnect')
      return
    }

    if (payload.op === 9) {
      this.sessionId = undefined
      this.lastSeq = 0
      this.socket?.close(4000, 'invalid session')
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 1, d: this.lastSeq })
    }, intervalMs)
  }

  private async identifyOrResume(): Promise<void> {
    const token = `QQBot ${await this.options.getToken()}`
    if (this.sessionId) {
      this.send({
        op: 6,
        d: { token, session_id: this.sessionId, seq: this.lastSeq }
      })
      return
    }
    this.send({
      op: 2,
      d: { token, intents: this.options.intents, shard: [0, 1] }
    })
  }

  private handleClose(code: number): void {
    this.connected = false
    this.clearTimers()
    this.socket = undefined

    if (this.manualClose) return

    if (!this.ready || code === 4914) {
      const reason = !this.ready ? '网关在 READY 前断开' : '机器人未上线或鉴权失败'
      const error = new Error(reason)
      this.rejectReady?.(error)
      this.rejectReady = undefined
      this.resolveReady = undefined
      this.options.handlers.onError(error)
      return
    }

    const base = this.options.reconnectBaseMs ?? 1000
    const max = this.options.reconnectMaxMs ?? 60_000
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }
}
