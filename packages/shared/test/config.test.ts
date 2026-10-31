import { describe, expect, it } from 'vitest'
import { validatePluginConfig } from '../src/config'
import { parsePluginManifest } from '../src/manifest'

const manifest = parsePluginManifest({
  name: 'arqqbot-plugin-ai-chat',
  version: '0.1.0',
  arqqbot: {
    id: 'ai-chat',
    displayName: 'AI 对话',
    description: '',
    schema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', default: 'https://api.openai.com/v1' },
        apiKey: { type: 'string', secret: true },
        model: { type: 'string', default: 'gpt-4o-mini' },
        maxContext: { type: 'number', default: 20, minimum: 1, maximum: 100 }
      },
      required: ['apiKey', 'model']
    },
    defaultConfig: {}
  }
})

describe('validatePluginConfig', () => {
  it('应用默认值并返回合法配置', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://api.openai.com/v1')
      expect(result.value.model).toBe('gpt-4o-mini')
      expect(result.value.maxContext).toBe(20)
    }
  })

  it('缺少必填字段时返回字段级错误', () => {
    const result = validatePluginConfig(manifest, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/apiKey')).toBe(true)
    }
  })

  it('类型错误时返回字段级错误', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test', model: 'x', maxContext: 'many' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/maxContext')).toBe(true)
    }
  })

  it('拒绝未知字段', () => {
    const result = validatePluginConfig(manifest, { apiKey: 'sk-test', model: 'x', extra: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((item) => item.path === '/' || item.path === '')).toBe(true)
    }
  })
})
