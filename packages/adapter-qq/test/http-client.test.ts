import { describe, expect, it, vi } from 'vitest'
import type { QQRawRequest } from '@arqqbot/shared'
import { QQHttpClient } from '../src/core/http-client'
import { findEndpoint } from '../src/core/endpoint-catalog'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeToken(fetchImpl: ReturnType<typeof vi.fn>): TokenManager {
  return new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
}

function makeTokenFetch(): ReturnType<typeof vi.fn> {
  let counter = 0
  return vi.fn(async () => {
    counter += 1
    return jsonResponse({ access_token: `token-${counter}`, expires_in: 7200 })
  })
}

describe('QQHttpClient', () => {
  it('携带鉴权头并解析 JSON', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-1' }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const result = await client.request<{ id: string }>(findEndpoint('group.message.send'), {
      pathParams: { group_openid: 'group-1' },
      body: { content: 'hi', msg_type: 0 }
    })

    expect(result.id).toBe('reply-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v2/groups/group-1/messages',
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('QQBot token-1')
    expect(JSON.parse(String(init.body))).toEqual({ content: 'hi', msg_type: 0 })
  })

  it('GET 网络错误时切换基础域名并重试', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://a.test', 'https://b.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 1
    })

    const result = await client.raw<{ ok: boolean }>({ method: 'GET', path: '/ping' })

    expect(result.ok).toBe(true)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://b.test/ping')
  })

  it('401 刷新 token 后重试一次', async () => {
    const tokenFetch = makeTokenFetch()
    const token = makeToken(tokenFetch)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ err_code: 11251, message: 'token 失效' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({ method: 'POST', path: '/v2/messages', body: {} })

    const headers = fetchImpl.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>
    )
    expect(headers[0]?.authorization).toBe('QQBot token-1')
    expect(headers[1]?.authorization).toBe('QQBot token-2')
    expect(tokenFetch).toHaveBeenCalledTimes(2)
  })

  it('非幂等 POST 对 500 不自动重试', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'boom' }, 500))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(
      client.raw({ method: 'POST', path: '/v2/send', body: { content: 'x' } })
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('raw 请求带 query 且校验 path', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({
      method: 'GET',
      path: '/v2/search',
      query: { keyword: '你好', limit: 10, online: true, skip: undefined }
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/search?keyword=%E4%BD%A0%E5%A5%BD&limit=10&online=true'
    )

    await expect(client.raw({ method: 'GET', path: 'v2/no-slash' })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
  })

  it('拒绝调用方覆盖鉴权头', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await client.raw({
      method: 'GET',
      path: '/ping',
      headers: { authorization: 'Bearer evil' }
    })

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('QQBot token-1')
  })

  it('mapHttpError 保留端点信息', async () => {
    const token = makeToken(makeTokenFetch())
    const fetchImpl = vi.fn(async () => jsonResponse({ err_code: 22009 }, 400))
    const client = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const request: QQRawRequest = { method: 'POST', path: '/v2/send' }

    await expect(client.raw(request)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      meta: { status: 400, platformCode: '22009', endpointId: 'raw' }
    })
  })
})
