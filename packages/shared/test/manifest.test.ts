import { describe, expect, it } from 'vitest'
import { ManifestError, parsePluginManifest } from '../src/manifest'

const validPackage = {
  name: 'arqqbot-plugin-echo',
  version: '0.1.0',
  arqqbot: {
    id: 'echo',
    displayName: '回显插件',
    description: '把收到的消息原样回复',
    schema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', title: '前缀', default: '收到：' }
      }
    },
    defaultConfig: { prefix: '收到：' }
  }
}

describe('parsePluginManifest', () => {
  it('解析合法 manifest', () => {
    const manifest = parsePluginManifest(validPackage)
    expect(manifest).toMatchObject({
      id: 'echo',
      name: 'arqqbot-plugin-echo',
      version: '0.1.0',
      displayName: '回显插件'
    })
    expect(manifest.schema.type).toBe('object')
  })

  it('拒绝非法插件 id', () => {
    const invalid = { ...validPackage, arqqbot: { ...validPackage.arqqbot, id: 'Echo' } }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })

  it('拒绝不支持的 Schema 关键字', () => {
    const invalid = {
      ...validPackage,
      arqqbot: {
        ...validPackage.arqqbot,
        schema: { type: 'object', additionalProperties: true }
      }
    }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })

  it('拒绝非 object 顶层 Schema', () => {
    const invalid = {
      ...validPackage,
      arqqbot: { ...validPackage.arqqbot, schema: { type: 'string' } }
    }
    expect(() => parsePluginManifest(invalid)).toThrow(ManifestError)
  })
})
