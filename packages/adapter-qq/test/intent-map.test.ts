import { describe, expect, it } from 'vitest'
import type { QQIntentName } from '@arqqbot/shared'
import {
  DEFAULT_INTENTS,
  QQ_INTENT_BITS,
  decodeIntents,
  hasIntents,
  resolveIntents
} from '../src/core/intent-map'

describe('intent-map', () => {
  it('位值唯一且默认只开启群聊/单聊消息', () => {
    const bits = Object.values(QQ_INTENT_BITS)
    expect(new Set(bits).size).toBe(bits.length)
    expect(resolveIntents(DEFAULT_INTENTS)).toBe(1 << 25)
  })

  it('名称与位掩码可往返', () => {
    const names: QQIntentName[] = ['guilds', 'public_messages', 'interaction']
    const mask = resolveIntents(names)
    expect(decodeIntents(mask).sort()).toEqual([...names].sort())
  })

  it('hasIntents 检查全部必需 intent', () => {
    const mask = resolveIntents(['public_messages'])
    expect(hasIntents(mask, ['public_messages'])).toBe(true)
    expect(hasIntents(mask, ['public_messages', 'interaction'])).toBe(false)
  })

  it('未知 intent 抛出错误', () => {
    expect(() => resolveIntents(['unknown' as QQIntentName])).toThrow('未知 intent')
  })
})
