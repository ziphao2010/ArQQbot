import path from 'node:path'
import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import {
  InstanceManager,
  PluginMarketplace,
  createFileCipher,
  createNodeWorkerFactory,
  createSecretCodec,
  loadOrCreateMasterKey
} from '@arqqbot/control'
import {
  createInstanceSchema,
  idSchema,
  pluginMarketEntrySchema,
  pluginMarketIndexUrlSchema,
  qqUpdateIntentsSchema,
  updateInstanceSchema,
  updatePluginConfigSchema
} from '@arqqbot/shared'
import { bearerToken, tokensEqual } from './auth'
import { TicketStore } from './tickets'
import { packageVersion } from './version'

export interface ServerOptions {
  host: string
  port: number
  dataDir: string
  token: string
  builtinPluginRoot: string
  workerEntry: string
  webRoot?: string
  loggerLevel?: string
  trustProxy?: boolean
}

export interface StartedServer {
  app: FastifyInstance
  manager: InstanceManager
  marketplace: PluginMarketplace
  url: string
}

function parseParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`缺少参数：${name}`)
  }
  return idSchema.parse(value)
}

function jsonError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } }
}

export async function createServer(options: ServerOptions): Promise<StartedServer> {
  const externalPluginRoot = path.join(options.dataDir, 'plugins')
  const masterKey = await loadOrCreateMasterKey(path.join(options.dataDir, 'master.key'))
  const secretCodec = createSecretCodec(createFileCipher(masterKey))
  const manager = new InstanceManager({
    rootDir: options.dataDir,
    builtinPluginRoot: options.builtinPluginRoot,
    externalPluginRoot,
    workerFactory: createNodeWorkerFactory(options.workerEntry),
    secretCodec
  })
  const marketplace = new PluginMarketplace({ rootDir: externalPluginRoot })
  await manager.init()

  const app = Fastify({
    logger: { level: options.loggerLevel ?? 'info' },
    bodyLimit: 1_000_000,
    trustProxy: Boolean(options.trustProxy)
  })
  const tickets = new TicketStore()

  await app.register(fastifyWebsocket)
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'"
    )
    return payload
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    if (request.url.startsWith('/api/health')) return
    const token = bearerToken(request.headers.authorization)
    if (!token || !tokensEqual(options.token, token)) {
      return reply.code(401).send(jsonError('UNAUTHORIZED', '无效或缺失访问 token'))
    }
  })

  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as Error & { statusCode?: number }
    if (err.name === 'ZodError') {
      return reply.code(400).send(jsonError('INVALID_INPUT', '请求参数不合法'))
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    reply.code(status).send(
      jsonError(status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED', err.message)
    )
  })

  app.get('/api/health', async () => ({
    ok: true,
    name: 'arqqbot-server',
    uptime: process.uptime(),
    version: packageVersion()
  }))

  app.get('/api/session', async () => ({ ok: true }))

  app.get('/api/instances', async () => manager.list())

  app.post('/api/instances', async (request, reply) => {
    const input = createInstanceSchema.parse(request.body)
    const created = await manager.create(input)
    return reply.code(201).send(created)
  })

  app.get('/api/instances/:id', async (request) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    const instances = await manager.list()
    const item = instances.find((instance) => instance.id === id)
    if (!item) throw Object.assign(new Error(`实例不存在：${id}`), { statusCode: 404 })
    return item
  })

  app.patch('/api/instances/:id', async (request) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    return manager.update(id, updateInstanceSchema.parse(request.body))
  })

  app.delete('/api/instances/:id', async (request, reply) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    await manager.remove(id)
    return reply.code(204).send()
  })

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(`/api/instances/:id/${action}`, async (request, reply) => {
      const id = parseParam((request.params as { id?: string }).id, 'id')
      await manager[action](id)
      return reply.code(204).send()
    })
  }

  app.get('/api/instances/:id/status', async (request) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    return manager.status(id)
  })

  app.get('/api/instances/:id/capabilities', async (request) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    return manager.capabilities(id)
  })

  app.put('/api/instances/:id/intents', async (request, reply) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    const parsed = qqUpdateIntentsSchema.omit({ instanceId: true }).parse(request.body)
    await manager.updateIntents(id, parsed.intents)
    return reply.code(204).send()
  })

  app.get('/api/instances/:id/plugins', async (request) => {
    const id = parseParam((request.params as { id?: string }).id, 'id')
    return manager.listPlugins(id)
  })

  for (const [action, enabled] of [
    ['enable', true],
    ['disable', false]
  ] as const) {
    app.post(`/api/instances/:id/plugins/:pluginId/${action}`, async (request, reply) => {
      const instanceId = parseParam((request.params as { id?: string }).id, 'id')
      const pluginId = parseParam((request.params as { pluginId?: string }).pluginId, 'pluginId')
      await manager.setPluginEnabled(instanceId, pluginId, enabled)
      return reply.code(204).send()
    })
  }

  app.put('/api/instances/:id/plugins/:pluginId/config', async (request, reply) => {
    const instanceId = parseParam((request.params as { id?: string }).id, 'id')
    const pluginId = parseParam((request.params as { pluginId?: string }).pluginId, 'pluginId')
    const parsed = updatePluginConfigSchema.omit({ instanceId: true, pluginId: true }).parse(request.body)
    await manager.updatePluginConfig(instanceId, pluginId, parsed.config)
    return reply.code(204).send()
  })

  app.get('/api/marketplace', async (request) => {
    const query = request.query as { indexUrl?: string }
    return marketplace.fetchIndex(pluginMarketIndexUrlSchema.parse(query.indexUrl))
  })

  app.post('/api/marketplace/install', async (request, reply) => {
    await marketplace.install(pluginMarketEntrySchema.parse(request.body))
    return reply.code(204).send()
  })

  app.post('/api/ws-ticket', async (request, reply) => {
    const body = request.body as { instanceId?: string } | undefined
    const instanceId = idSchema.parse(body?.instanceId)
    return reply.send({ ticket: tickets.create(instanceId) })
  })

  app.get('/ws/logs', { websocket: true }, (socket: WebSocket, request) => {
    const query = request.query as { ticket?: string }
    const instanceId = query.ticket ? tickets.consume(query.ticket) : undefined
    if (!instanceId) {
      socket.close(1008, 'invalid ticket')
      return
    }
    socket.send(JSON.stringify({ type: 'ready', instanceId }))
    const off = manager.subscribeLogs(instanceId, (entry) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'log', instanceId, entry }))
      }
    })
    socket.on('close', off)
  })

  const webRoot = options.webRoot
  if (webRoot && existsSync(path.join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: false
    })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
        return reply.code(404).send(jsonError('NOT_FOUND', '接口不存在'))
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.get('/', async () => ({
      name: 'arqqbot-server',
      message: 'Web 控制台未构建或未找到，请使用 --web-root 指定 apps/desktop/out/renderer-web'
    }))
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send(jsonError('NOT_FOUND', '资源不存在'))
    )
  }

  await app.listen({ host: options.host, port: options.port })
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address ? address.port : options.port
  const displayHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host
  return {
    app,
    manager,
    marketplace,
    url: `http://${displayHost}:${actualPort}`
  }
}

export async function closeServer(server: StartedServer): Promise<void> {
  await server.app.close()
  await server.manager.shutdown()
}
