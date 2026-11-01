import { randomBytes } from 'node:crypto'

interface TicketRecord {
  instanceId: string
  expiresAt: number
}

const DEFAULT_TTL_MS = 30_000

export class TicketStore {
  private readonly records = new Map<string, TicketRecord>()

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  create(instanceId: string): string {
    this.prune()
    const ticket = randomBytes(24).toString('base64url')
    this.records.set(ticket, {
      instanceId,
      expiresAt: Date.now() + this.ttlMs
    })
    return ticket
  }

  consume(ticket: string): string | undefined {
    const record = this.records.get(ticket)
    if (!record) return undefined
    this.records.delete(ticket)
    if (record.expiresAt < Date.now()) return undefined
    return record.instanceId
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, record] of this.records) {
      if (record.expiresAt < now) this.records.delete(key)
    }
  }
}
