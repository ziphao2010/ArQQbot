import { describe, expect, it, vi } from 'vitest'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import type { QQHttpClient } from '../src/core/http-client'
import { QQBotModule } from '../src/modules/bot'
import { QQInteractionModule } from '../src/modules/interactions'
import { QQMenuModule } from '../src/modules/menus'
import { QQPanelModule } from '../src/modules/panels'

const PUBLIC_MESSAGES = 1 << 25
const GUILDS = 1 << 0
const INTERACTION = 1 << 26

function setup(
  result: unknown = {},
  intents: number = PUBLIC_MESSAGES | GUILDS | INTERACTION
): {
  request: ReturnType<typeof vi.fn>
  interactions: QQInteractionModule
  menus: QQMenuModule
  panels: QQPanelModule
  bot: QQBotModule
} {
  const request = vi.fn(async () => result)
  const http = { request } as unknown as QQHttpClient
  const capabilities = new QQCapabilityRegistry({ env: 'production', intents })
  return {
    request,
    interactions: new QQInteractionModule({ http, capabilities }),
    menus: new QQMenuModule({ http, capabilities }),
    panels: new QQPanelModule({ http, capabilities }),
    bot: new QQBotModule({ http, capabilities })
  }
}

function lastCall(request: ReturnType<typeof vi.fn>): {
  endpoint: { id: string; path: string }
  options: Record<string, unknown>
} {
  const call = request.mock.calls[request.mock.calls.length - 1]
  if (!call) throw new Error('未发起请求')
  return {
    endpoint: call[0] as { id: string; path: string },
    options: call[1] as Record<string, unknown>
  }
}

describe('QQInteractionModule', () => {
  it('respond 使用 interaction_id 路径并直接传入请求体', async () => {
    const { request, interactions } = setup()

    await interactions.respond('interaction-1', { code: 0 })

    expect(lastCall(request).endpoint.id).toBe('interaction.respond')
    expect(lastCall(request).endpoint.path).toBe('/interactions/{interaction_id}')
    expect(lastCall(request).options.pathParams).toEqual({ interaction_id: 'interaction-1' })
    expect(lastCall(request).options.body).toEqual({ code: 0 })
  })

  it('intents 不足时抛出 CAPABILITY_UNAVAILABLE', async () => {
    const { interactions } = setup({}, PUBLIC_MESSAGES)

    await expect(interactions.respond('interaction-1', { code: 0 })).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE'
    })
  })
})

describe('QQMenuModule', () => {
  it('get 使用 menu.get 端点', async () => {
    const { request, menus } = setup({ items: [{ name: '查天气' }] })

    const result = await menus.get()

    expect(lastCall(request).endpoint.id).toBe('menu.get')
    expect(lastCall(request).endpoint.path).toBe('/v2/menu')
    expect(result).toEqual({ items: [{ name: '查天气' }] })
  })

  it('set 直接传入菜单请求体', async () => {
    const { request, menus } = setup()
    const menu = { items: [{ name: '查天气', type: 'click' }] }

    await menus.set(menu)

    expect(lastCall(request).endpoint.id).toBe('menu.set')
    expect(lastCall(request).endpoint.path).toBe('/v2/menu')
    expect(lastCall(request).options.body).toEqual(menu)
  })
})

describe('QQPanelModule', () => {
  it('list 兼容对象与直接数组', async () => {
    const { request, panels } = setup()
    request.mockResolvedValueOnce({ panels: [{ id: 'panel-1' }] })
    request.mockResolvedValueOnce([{ id: 'panel-2' }])

    expect(await panels.list()).toEqual([{ id: 'panel-1' }])
    expect(lastCall(request).endpoint.id).toBe('panels.list')
    expect(lastCall(request).endpoint.path).toBe('/v2/panels')
    expect(await panels.list()).toEqual([{ id: 'panel-2' }])
  })

  it('create 发送面板请求体', async () => {
    const { request, panels } = setup({ panel_id: 'panel-1' })
    const input = { panel: { title: '指令面板' } }

    const result = await panels.create(input)

    expect(lastCall(request).endpoint.id).toBe('panels.create')
    expect(lastCall(request).endpoint.path).toBe('/v2/panels')
    expect(lastCall(request).options.body).toEqual(input)
    expect(result).toEqual({ panel_id: 'panel-1' })
  })

  it('get 与 delete 使用 panel_id 路径', async () => {
    const { request, panels } = setup({ panel_id: 'panel-1' })

    const result = await panels.get('panel-1')
    expect(lastCall(request).endpoint.id).toBe('panels.get')
    expect(lastCall(request).endpoint.path).toBe('/v2/panels/{panel_id}')
    expect(lastCall(request).options.pathParams).toEqual({ panel_id: 'panel-1' })
    expect(result).toEqual({ panel_id: 'panel-1' })

    await panels.delete('panel-1')
    expect(lastCall(request).endpoint.id).toBe('panels.delete')
    expect(lastCall(request).options.pathParams).toEqual({ panel_id: 'panel-1' })
  })

  it('update 发送局部面板请求体', async () => {
    const { request, panels } = setup({ panel_id: 'panel-1' })

    await panels.update('panel-1', { panel: { title: '新标题' } })

    expect(lastCall(request).endpoint.id).toBe('panels.update')
    expect(lastCall(request).endpoint.path).toBe('/v2/panels/{panel_id}')
    expect(lastCall(request).options.pathParams).toEqual({ panel_id: 'panel-1' })
    expect(lastCall(request).options.body).toEqual({ panel: { title: '新标题' } })
  })

  it('updateTarget 直接传入目标请求体', async () => {
    const { request, panels } = setup()
    const target = { op: 'add' as const, user_openids: ['user-1'], group_openids: ['group-1'] }

    await panels.updateTarget('panel-1', target)

    expect(lastCall(request).endpoint.id).toBe('panels.target')
    expect(lastCall(request).endpoint.path).toBe('/v2/panels/{panel_id}/target')
    expect(lastCall(request).options.pathParams).toEqual({ panel_id: 'panel-1' })
    expect(lastCall(request).options.body).toEqual(target)
  })
})

describe('QQBotModule', () => {
  it('me 使用 bot.me 端点', async () => {
    const { request, bot } = setup({ id: 'bot-1', username: '机器人' })

    const result = await bot.me()

    expect(lastCall(request).endpoint.id).toBe('bot.me')
    expect(lastCall(request).endpoint.path).toBe('/users/@me')
    expect(result).toEqual({ id: 'bot-1', username: '机器人' })
  })

  it('guilds 兼容对象与直接数组', async () => {
    const { request, bot } = setup()
    request.mockResolvedValueOnce({ guilds: [{ id: 'guild-1' }] })
    request.mockResolvedValueOnce([{ id: 'guild-2' }])

    expect(await bot.guilds()).toEqual([{ id: 'guild-1' }])
    expect(lastCall(request).endpoint.id).toBe('bot.guilds')
    expect(lastCall(request).endpoint.path).toBe('/users/@me/guilds')
    expect(await bot.guilds()).toEqual([{ id: 'guild-2' }])
  })

  it('gateway 解析 url 字符串', async () => {
    const { request, bot } = setup({ url: 'wss://gateway.example/ws' })

    expect(await bot.gateway()).toBe('wss://gateway.example/ws')
    expect(lastCall(request).endpoint.id).toBe('bot.gateway')
    expect(lastCall(request).endpoint.path).toBe('/gateway')
  })

  it('gateway 缺少 url 时抛出 SERVER_ERROR', async () => {
    const { bot } = setup({})

    await expect(bot.gateway()).rejects.toMatchObject({ code: 'SERVER_ERROR' })
  })

  it('generateUrlLink 从 data.url 解析并返回字符串', async () => {
    const { request, bot } = setup({ data: { url: 'https://example.com/link' } })
    const input = { callback_data: 'payload' }

    const url = await bot.generateUrlLink(input)

    expect(url).toBe('https://example.com/link')
    expect(lastCall(request).endpoint.id).toBe('bot.urlLink')
    expect(lastCall(request).endpoint.path).toBe('/v2/generate_url_link')
    expect(lastCall(request).options.body).toEqual(input)
  })

  it('generateUrlLink 缺少 url 时抛出 SERVER_ERROR', async () => {
    const { bot } = setup({ data: {} })

    await expect(bot.generateUrlLink({})).rejects.toMatchObject({ code: 'SERVER_ERROR' })
  })
})
