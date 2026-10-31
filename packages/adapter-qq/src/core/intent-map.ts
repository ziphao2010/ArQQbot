import type { QQIntentName } from '@arqqbot/shared'

export const QQ_INTENT_BITS: Record<QQIntentName, number> = {
  guilds: 1 << 0,
  guild_members: 1 << 1,
  guild_messages: 1 << 9,
  direct_message: 1 << 12,
  public_messages: 1 << 25,
  interaction: 1 << 26
}

export const DEFAULT_INTENTS: QQIntentName[] = ['public_messages']

export function resolveIntents(names: QQIntentName[]): number {
  return names.reduce((mask, name) => {
    const bit = QQ_INTENT_BITS[name]
    if (bit === undefined) throw new Error(`未知 intent：${name}`)
    return mask | bit
  }, 0)
}

export function decodeIntents(mask: number): QQIntentName[] {
  return (Object.keys(QQ_INTENT_BITS) as QQIntentName[]).filter(
    (name) => (mask & QQ_INTENT_BITS[name]) !== 0
  )
}

export function hasIntents(mask: number, required: QQIntentName[]): boolean {
  return required.every((name) => (mask & (QQ_INTENT_BITS[name] ?? 0)) !== 0)
}
