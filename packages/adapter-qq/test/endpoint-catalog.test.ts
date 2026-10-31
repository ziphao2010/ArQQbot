import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QQ_ENDPOINTS, buildPath } from '../src/core/endpoint-catalog'

interface SnapshotEntry {
  id: string
  method: string
  path: string
  category: string
  docsUrl: string
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../../docs/qq-api-v2-endpoints.json', import.meta.url), 'utf8')
) as { http: SnapshotEntry[] }

describe('QQ 端点目录', () => {
  it('快照包含 47 个 HTTP 接口', () => {
    expect(snapshot.http).toHaveLength(47)
    expect(new Set(snapshot.http.map((entry) => entry.id)).size).toBe(47)
  })

  it('快照与目录双向一致', () => {
    expect(QQ_ENDPOINTS).toHaveLength(47)
    expect(new Set(QQ_ENDPOINTS.map((endpoint) => endpoint.id)).size).toBe(47)

    for (const entry of snapshot.http) {
      const endpoint = QQ_ENDPOINTS.find((item) => item.id === entry.id)
      expect(endpoint, `快照端点缺少目录定义：${entry.id}`).toBeTruthy()
      expect(endpoint).toMatchObject({
        method: entry.method,
        path: entry.path,
        category: entry.category,
        docsUrl: entry.docsUrl
      })
    }

    for (const endpoint of QQ_ENDPOINTS) {
      expect(
        snapshot.http.some((entry) => entry.id === endpoint.id),
        `目录端点未写入快照：${endpoint.id}`
      ).toBe(true)
    }
  })

  it('路径参数替换并编码', () => {
    expect(
      buildPath('/v2/groups/{group_openid}/members/{member_openid}', {
        group_openid: 'g 1',
        member_openid: 'm/1'
      })
    ).toBe('/v2/groups/g%201/members/m%2F1')
  })

  it('缺少路径参数抛出 BAD_REQUEST', () => {
    expect(() => buildPath('/v2/groups/{group_openid}/info', {})).toThrow('缺少路径参数')
  })
})
