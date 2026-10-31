import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'
import type { MessageDeduper } from '../message'
import { normalizeEvent, type QQNormalizedEvent } from './normalize'

export interface QQEventRouterOptions {
  emit(event: QQDomainEventName, payload: unknown): void
  deduper?: MessageDeduper
  onMessage?(message: QQMessage, event: QQDomainEventName): void
  onUnknown?(type: string, data: unknown): void
}

export class QQEventRouter {
  constructor(private readonly options: QQEventRouterOptions) {}

  handle(type: string, data: unknown): QQNormalizedEvent | null {
    this.options.emit('qq/raw-event', { type, data })

    const normalized = normalizeEvent(type, data as Record<string, any>)
    if (!normalized) {
      this.options.onUnknown?.(type, data)
      return null
    }

    if (normalized.message) {
      if (
        normalized.event === 'qq/message' &&
        this.options.deduper?.seen(normalized.message.id)
      ) {
        return normalized
      }
      this.options.onMessage?.(normalized.message, normalized.event)
      this.options.emit(normalized.event, normalized.message)
      return normalized
    }

    this.options.emit(normalized.event, normalized.payload)
    return normalized
  }
}
