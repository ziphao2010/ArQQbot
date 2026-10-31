import { describe, expect, it } from 'vitest'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQ_ENDPOINTS } from '../src/core/endpoint-catalog'
import { resolveIntents } from '../src/core/intent-map'

describe('QQCapabilityRegistry', () => {
  it('按 intents 计算能力可用性', () => {
    const registry = new QQCapabilityRegistry({
      env: 'production',
      intents: resolveIntents(['public_messages'])
    })

    expect(registry.has('message.send')).toBe(true)
    expect(registry.has('group.info')).toBe(true)
    expect(registry.has('interaction.respond')).toBe(false)
    expect(registry.has('guild.get')).toBe(false)

    const interaction = registry.list().find((item) => item.id === 'interaction.respond')
    expect(interaction?.reason).toContain('interaction')

    const guild = registry.list().find((item) => item.id === 'guild.get')
    expect(guild?.reason).toContain('guilds')
  })

  it('能力列表覆盖全部 47 个端点', () => {
    const registry = new QQCapabilityRegistry({
      env: 'sandbox',
      intents: resolveIntents(['public_messages', 'interaction', 'guilds'])
    })
    expect(registry.list().reduce((sum, item) => sum + item.endpointCount, 0)).toBe(
      QQ_ENDPOINTS.length
    )
  })

  it('环境不支持时给出原因', () => {
    const endpoint = QQ_ENDPOINTS.find((item) => item.id === 'group.info')!
    const registry = new QQCapabilityRegistry({
      env: 'sandbox',
      intents: resolveIntents(['public_messages']),
      endpoints: [{ ...endpoint, environments: ['production'] }]
    })

    expect(registry.has('group.info')).toBe(false)
    expect(registry.list()[0]?.reason).toContain('sandbox')
  })

  it('assert 抛出 CAPABILITY_UNAVAILABLE', () => {
    const registry = new QQCapabilityRegistry({
      env: 'production',
      intents: resolveIntents(['public_messages'])
    })

    expect(() => registry.assert('interaction.respond')).toThrow('能力不可用')
    expect(() => registry.assert('not.exists')).toThrow('能力未收录')
  })
})
