// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { closeServer, createServer } from '../src/server'

const tempDirs: string[] = []
const TOKEN = 'test-token-0123456789abcdef'

async function startServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-server-'))
  tempDirs.push(dataDir)
  const server = await createServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    token: TOKEN,
    builtinPluginRoot: path.resolve(process.cwd(), '../../packages'),
    workerEntry: path.resolve(process.cwd(), '../../packages/runtime/dist/worker-entry.cjs'),
    loggerLevel: 'silent'
  })
  return { server, dataDir }
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
}

describe('headless server', () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  it('健康检查公开，API 需要 token，实例 CRUD 与插件列表可用', async () => {
    const { server, dataDir } = await startServer()
    try {
      const health = await fetch(`${server.url}/api/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toMatchObject({ ok: true })

      const unauthorized = await fetch(`${server.url}/api/instances`)
      expect(unauthorized.status).toBe(401)

      const createdResponse = await fetch(`${server.url}/api/instances`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: '测试实例',
          appId: '123456',
          appSecret: 'secret-value',
          env: 'sandbox'
        })
      })
      expect(createdResponse.status).toBe(201)
      const created = (await createdResponse.json()) as { id: string }

      const list = (await (
        await fetch(`${server.url}/api/instances`, { headers: authHeaders() })
      ).json()) as Array<{ id: string }>
      expect(list.map((item) => item.id)).toContain(created.id)

      const index = JSON.parse(
        await readFile(path.join(dataDir, 'instances.json'), 'utf8')
      ) as { instances: string[] }
      expect(index.instances).toContain(created.id)

      const record = JSON.parse(
        await readFile(path.join(dataDir, 'instances', created.id, 'instance.json'), 'utf8')
      ) as Record<string, unknown>
      expect(record).toBeTruthy()
      expect(JSON.stringify(record)).not.toContain('secret-value')

      const plugins = (await (
        await fetch(`${server.url}/api/instances/${created.id}/plugins`, {
          headers: authHeaders()
        })
      ).json()) as Array<{ id: string }>
      expect(plugins.some((plugin) => plugin.id === 'echo')).toBe(true)

      const removed = await fetch(`${server.url}/api/instances/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN}` }
      })
      expect(removed.status).toBe(204)

      const afterRemove = (await (
        await fetch(`${server.url}/api/instances`, { headers: authHeaders() })
      ).json()) as Array<{ id: string }>
      expect(afterRemove.map((item) => item.id)).not.toContain(created.id)
    } finally {
      await closeServer(server)
    }
  })

  it('WebSocket 日志使用一次性 ticket', async () => {
    const { server } = await startServer()
    try {
      const ticketResponse = await fetch(`${server.url}/api/ws-ticket`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ instanceId: 'demo' })
      })
      expect(ticketResponse.status).toBe(200)
      const { ticket } = (await ticketResponse.json()) as { ticket: string }

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(
          `${server.url.replace(/^http/, 'ws')}/ws/logs?ticket=${encodeURIComponent(ticket)}`
        )
        const timer = setTimeout(() => {
          socket.close()
          reject(new Error('等待 ready 超时'))
        }, 5_000)
        socket.on('message', (data) => {
          const event = JSON.parse(String(data)) as { type?: string }
          if (event.type === 'ready') {
            clearTimeout(timer)
            socket.close()
            resolve()
          }
        })
        socket.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      const reused = await fetch(`${server.url}/api/ws-ticket`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ instanceId: 'demo' })
      })
      expect(reused.status).toBe(200)
    } finally {
      await closeServer(server)
    }
  })
})
