import type { QQMessage } from '@arqqbot/shared'
import { normalizeEvent } from './events/normalize'

export function normalizeQQEvent(
  eventName: string,
  data: Record<string, any>
): QQMessage | null {
  const normalized = normalizeEvent(eventName, data)
  return normalized?.event === 'qq/message' ? normalized.message ?? null : null
}

export class MessageDeduper {
  private readonly ids = new Set<string>()
  private readonly limit: number

  constructor(limit = 10_000) {
    this.limit = limit
  }

  seen(id: string): boolean {
    if (this.ids.has(id)) return true
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const first = this.ids.values().next().value
      if (typeof first === 'string') this.ids.delete(first)
    }
    return false
  }
}
