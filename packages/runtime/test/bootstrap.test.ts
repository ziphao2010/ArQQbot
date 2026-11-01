import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PluginCatalogItem, WorkerEvent, WorkerStartConfig } from '@arqqbot/shared'
import type { QQService } from '@arqqbot/shared'
import { bootstrapInstance } from '../src/bootstrap'
import type { AdapterHandle } from '@arqqbot/adapter-qq'

function catalogItem(): PluginCatalogItem {
  return {
    manifest: {
      id: 'demo',
      name: 'demo',
      version: '0.1.0',
      displayName: 'Demo',
      description: '',
      schema: { type: 'object', properties: {} },
      defaultConfig: {}
    },
    entryPath: '/fake/demo.js',
    source: 'builtin'
  }
}

describe('bootstrapInstance', () => {
  it('启动适配器、挂载插件、上报日志并可停止', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-worker-'))
    const config: WorkerStartConfig = {
      instanceId: 'inst-1',
      appId: 'app',
      appSecret: 'secret',
      env: 'sandbox',
      dataDir,
      catalog: [catalogItem()],
      plugins: [{ id: 'demo', enabled: true, config: {} }]
    }

    const events: WorkerEvent[] = []
    const disconnect = vi.fn(async () => undefined)
    const service: QQService = {
      send: vi.fn(async () => ({})),
      message: {
        send: vi.fn(async () => ({})),
        reply: vi.fn(async () => ({})),
        sendStream: vi.fn(async () => ({
          write: async () => undefined,
          end: async () => undefined
        })),
        recall: vi.fn(async () => undefined)
      },
      media: {
        upload: vi.fn(async () => ({ fileInfo: '' })),
        uploadChunked: vi.fn(async () => ({ fileInfo: '' })),
        prepareUpload: vi.fn(async () => ({
          uploadId: '',
          blockSize: 0,
          parts: [],
          raw: {}
        })),
        finishUpload: vi.fn(async () => ({ fileInfo: '' }))
      },
      group: {
        info: vi.fn(async () => ({})),
        botState: vi.fn(async () => ({})),
        members: vi.fn(async () => ({ members: [] })),
        member: vi.fn(async () => ({ member_openid: '' })),
        removeMembers: vi.fn(async () => undefined),
        joinRequests: vi.fn(async () => ({ list: [] })),
        approveJoinRequest: vi.fn(async () => undefined),
        createJoinStrategy: vi.fn(async () => ({})),
        updateJoinStrategy: vi.fn(async () => ({})),
        executeJoinStrategy: vi.fn(async () => undefined),
        setJoinStrategyWhitelist: vi.fn(async () => undefined),
        listJoinStrategies: vi.fn(async () => []),
        deleteJoinStrategy: vi.fn(async () => undefined),
        blacklist: vi.fn(async () => []),
        updateBlacklist: vi.fn(async () => undefined),
        muteSetting: vi.fn(async () => ({})),
        setMute: vi.fn(async () => undefined)
      },
      guild: {
        get: vi.fn(async () => ({})),
        channels: vi.fn(async () => []),
        channel: vi.fn(async () => ({})),
        createChannel: vi.fn(async () => ({})),
        updateChannel: vi.fn(async () => ({})),
        deleteChannel: vi.fn(async () => undefined)
      },
      interaction: {
        respond: vi.fn(async () => undefined)
      },
      menu: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined)
      },
      panels: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({})),
        get: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => undefined),
        updateTarget: vi.fn(async () => undefined)
      },
      bot: {
        me: vi.fn(async () => ({})),
        guilds: vi.fn(async () => []),
        gateway: vi.fn(async () => ''),
        generateUrlLink: vi.fn(async () => '')
      },
      request: vi.fn() as unknown as QQService['request'],
      capabilities: {
        list: () => [],
        has: () => false
      },
      getStats: () => ({ connected: true, received: 1, sent: 0 })
    }
    const adapter: AdapterHandle & { service: QQService } = {
      service,
      connect: vi.fn(async () => undefined),
      disconnect
    }

    const result = await bootstrapInstance(
      config,
      { post: (event) => events.push(event) },
      {
        createAdapter: async () => adapter,
        loadModule: async () => (ctx: any) => {
          ctx.on('dispose', () => undefined)
        }
      }
    )

    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === 'log')).toBe(true)
    expect(events.some((event) => event.type === 'pluginState')).toBe(true)
    expect(result.getStatus().state).toBe('running')
    expect(result.getStatus().connected).toBe(true)

    await result.stop()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(result.getStatus().state).toBe('stopped')
  })

  it('适配器连接失败时不挂载插件', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-worker-fail-'))
    const config: WorkerStartConfig = {
      instanceId: 'inst-2',
      appId: 'app',
      appSecret: 'bad',
      env: 'production',
      dataDir,
      catalog: [catalogItem()],
      plugins: [{ id: 'demo', enabled: true, config: {} }]
    }

    const connect = vi.fn(async () => {
      throw new Error('鉴权失败')
    })

    await expect(
      bootstrapInstance(config, { post: () => undefined }, {
        createAdapter: async () => ({
          connect,
          disconnect: vi.fn(async () => undefined)
        })
      })
    ).rejects.toThrow('鉴权失败')
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
