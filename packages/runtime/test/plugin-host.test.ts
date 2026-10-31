import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import type { PluginCatalogItem, PluginRecord } from '@arqqbot/shared'
import { PluginHost } from '../src/plugin-host'

function makePlugin(log: string[], failOn?: string) {
  return (ctx: Context, config: { prefix: string }) => {
    if (failOn === config.prefix) throw new Error(`boom:${config.prefix}`)
    log.push(`apply:${config.prefix}`)
    ctx.effect(() => () => log.push(`dispose:${config.prefix}`))
  }
}

function entry(id: string, path: string): PluginCatalogItem {
  return {
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      displayName: id,
      description: '',
      schema: { type: 'object', properties: {} },
      defaultConfig: {}
    },
    entryPath: path,
    source: 'builtin'
  }
}

describe('PluginHost', () => {
  it('挂载启用插件，忽略禁用插件', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([
      ['a', entry('a', '/fake/a.js')],
      ['b', entry('b', '/fake/b.js')]
    ])
    const records: PluginRecord[] = [
      { id: 'a', enabled: true, config: { prefix: 'A' } },
      { id: 'b', enabled: false, config: { prefix: 'B' } }
    ]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async (path) => {
        if (path === '/fake/a.js') return makePlugin(log)
        return makePlugin(log)
      },
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    expect(log).toEqual(['apply:A'])
    expect(host.getState('a')).toBe('active')
    expect(host.getState('b')).toBe('disabled')
  })

  it('热重载配置时先销毁旧实例再挂载新实例', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([['a', entry('a', '/fake/a.js')]])
    const records: PluginRecord[] = [{ id: 'a', enabled: true, config: { prefix: 'A' } }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => makePlugin(log),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    await host.applyConfig('a', { prefix: 'B' })
    expect(log).toEqual(['apply:A', 'dispose:A', 'apply:B'])
    expect(host.getState('a')).toBe('active')
  })

  it('新配置失败时回滚旧配置并标记 error', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([['a', entry('a', '/fake/a.js')]])
    const records: PluginRecord[] = [{ id: 'a', enabled: true, config: { prefix: 'A' } }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => makePlugin(log, 'bad'),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    await expect(host.applyConfig('a', { prefix: 'bad' })).rejects.toThrow('boom:bad')
    expect(log).toEqual(['apply:A', 'dispose:A', 'apply:A'])
    expect(host.getState('a')).toBe('error')
    expect(host.getRecord('a')?.config).toEqual({ prefix: 'A' })
  })

  it('一个插件激活失败不影响其他插件', async () => {
    const log: string[] = []
    const ctx = new Context()
    const catalog = new Map([
      ['bad', entry('bad', '/fake/bad.js')],
      ['good', entry('good', '/fake/good.js')]
    ])
    const records: PluginRecord[] = [
      { id: 'bad', enabled: true, config: { prefix: 'bad' } },
      { id: 'good', enabled: true, config: { prefix: 'good' } }
    ]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async (path) =>
        path === '/fake/bad.js' ? makePlugin(log, 'bad') : makePlugin(log),
      mountTimeoutMs: 1000
    })

    await host.mountAll()
    expect(host.getState('bad')).toBe('error')
    expect(host.getState('good')).toBe('active')
    expect(log).toContain('apply:good')
  })

  it('挂载超时会标记 error', async () => {
    const ctx = new Context()
    const catalog = new Map([['slow', entry('slow', '/fake/slow.js')]])
    const records: PluginRecord[] = [{ id: 'slow', enabled: true, config: {} }]
    const host = new PluginHost({
      ctx,
      catalog,
      records,
      loadModule: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return () => undefined
      },
      mountTimeoutMs: 10
    })

    await host.mountAll()
    expect(host.getState('slow')).toBe('error')
  })
})
