import { describe, expect, it, vi } from 'vitest'
import { QQAuthError, TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('TokenManager', () => {
  it('首次获取 token 并缓存', async () => {
    let now = 0
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })

    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now
    })

    expect(await manager.get()).toBe('token-1')
    now = 7_000_000
    expect(await manager.get()).toBe('token-1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('到期前刷新 token', async () => {
    let now = 0
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now
    })

    expect(await manager.get()).toBe('token-1')
    now = 7_200_000
    expect(await manager.get()).toBe('token-2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('非 200 响应抛出 QQAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'invalid app' }, 401))
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(manager.get()).rejects.toBeInstanceOf(QQAuthError)
  })

  it('响应缺少字段抛出 QQAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'x' }))
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(manager.get()).rejects.toBeInstanceOf(QQAuthError)
  })

  it('invalidate 后重新获取 token', async () => {
    let counter = 0
    const fetchImpl = vi.fn(async () => {
      counter += 1
      return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0
    })

    expect(await manager.get()).toBe('token-1')
    manager.invalidate()
    expect(await manager.get()).toBe('token-2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('兼容字符串 expires_in 并使用 clientSecret 请求', async () => {
    let requestBody = ''
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? '')
      return jsonResponse({ access_token: 'token-1', expires_in: '7200' })
    })
    const manager = new TokenManager({
      appId: 'app-id',
      appSecret: 'app-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(await manager.get()).toBe('token-1')
    expect(requestBody).toContain('"clientSecret":"app-secret"')
  })
})
