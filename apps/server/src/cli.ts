import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LogEntry, PluginMarketEntry, PluginMarketSnapshot } from '@arqqbot/shared'
import { ApiClient } from './client'
import { closeServer, createServer } from './server'
import { readClientToken, resolveAccessToken } from './token'
import { packageVersion } from './version'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

interface GlobalOptions {
  url?: string
  token?: string
  dataDir?: string
  json?: boolean
}

function defaultDataDir(): string {
  return process.env.ARQQBOT_DATA_DIR?.trim() || path.join(os.homedir(), '.arqqbot')
}

function resolveDataDir(value?: string): string {
  return path.resolve(value?.trim() || defaultDataDir())
}

function pickExisting(candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

function splitList(value?: string): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

async function readStdin(): Promise<string> {
  let data = ''
  for await (const chunk of process.stdin) data += String(chunk)
  return data.trim()
}

function printJson(enabled: boolean, value: unknown): void {
  if (enabled) console.log(JSON.stringify(value, null, 2))
}

function formatLog(entry: LogEntry): string {
  const time = entry.time.replace('T', ' ').replace('Z', '')
  return `[${time}] ${entry.level.toUpperCase()} ${entry.message}`
}

async function clientFor(command: Command): Promise<{ client: ApiClient; json: boolean }> {
  const opts = command.optsWithGlobals<GlobalOptions>()
  const dataDir = resolveDataDir(opts.dataDir)
  const token = await readClientToken(dataDir, opts.token)
  return {
    client: new ApiClient({
      baseUrl: opts.url?.trim() || process.env.ARQQBOT_URL?.trim() || 'http://127.0.0.1:17800',
      token
    }),
    json: Boolean(opts.json)
  }
}

async function runServe(command: Command): Promise<void> {
  const opts = command.optsWithGlobals<GlobalOptions & {
    host?: string
    port?: string
    builtinPlugins?: string
    workerEntry?: string
    webRoot?: string
    logLevel?: string
    trustProxy?: boolean
    autostart?: boolean
  }>()
  const dataDir = resolveDataDir(opts.dataDir)
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const access = await resolveAccessToken(dataDir, opts.token)
  const builtinPluginRoot = opts.builtinPlugins
    ? path.resolve(opts.builtinPlugins)
    : pickExisting([
        path.resolve(moduleDir, 'builtin-plugins'),
        path.resolve(moduleDir, '../../../packages')
      ])
  const workerEntry = opts.workerEntry
    ? path.resolve(opts.workerEntry)
    : pickExisting([
        path.resolve(moduleDir, 'worker-entry.cjs'),
        path.resolve(moduleDir, '../../../packages/runtime/dist/worker-entry.cjs')
      ])
  const webRoot = opts.webRoot
    ? path.resolve(opts.webRoot)
    : pickExisting([
        path.resolve(moduleDir, 'web'),
        path.resolve(moduleDir, '../../../apps/desktop/out/renderer-web')
      ])

  const server = await createServer({
    host: opts.host?.trim() || process.env.ARQQBOT_HOST?.trim() || '127.0.0.1',
    port: Number(opts.port ?? process.env.ARQQBOT_PORT ?? 17800),
    dataDir,
    token: access.token,
    builtinPluginRoot,
    workerEntry,
    ...(existsSync(path.join(webRoot, 'index.html')) ? { webRoot } : {}),
    loggerLevel: opts.logLevel?.trim() || 'info',
    trustProxy: Boolean(opts.trustProxy)
  })

  const tokenForUrl = encodeURIComponent(access.token)
  console.error(`ArQQBot server: ${server.url}`)
  if (existsSync(path.join(webRoot, 'index.html'))) {
    console.error(`ArQQBot console: ${server.url}/#token=${tokenForUrl}`)
  } else {
    console.error(`Web 控制台未找到（${webRoot}），仅提供 HTTP API。先执行 pnpm --filter @arqqbot/desktop build:web`)
  }
  if (access.generated) {
    console.error(`访问 token 已生成并写入 ${access.file}`)
    console.error(`token: ${access.token}`)
  }
  const publicBind = ['0.0.0.0', '::', ''].includes(String(opts.host ?? '127.0.0.1'))
  if (publicBind && access.generated) {
    console.error('警告：正在监听公网地址，且使用自动生成的 token。请通过反向代理启用 HTTPS 并妥善保管 token')
  }

  if (opts.autostart) {
    for (const instance of await server.manager.list()) {
      if (instance.state === 'running') continue
      await server.manager
        .start(instance.id)
        .catch((error) => console.error(`实例 ${instance.name} 启动失败：${error instanceof Error ? error.message : String(error)}`))
    }
  }

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    await closeServer(server).catch((error) => console.error('关闭服务失败', error))
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

const program = new Command()
program
  .name('arqqbot')
  .description('ArQQBot 无头服务器与远程控制 CLI')
  .version(packageVersion())
  .option('--url <url>', '控制台 API 地址', process.env.ARQQBOT_URL || 'http://127.0.0.1:17800')
  .option('--token <token>', '访问 token（也可用 ARQQBOT_TOKEN）')
  .option('--data-dir <dir>', '数据目录', defaultDataDir())
  .option('--json', '输出 JSON', false)

program
  .command('serve')
  .description('启动无头服务器与 Web 控制台')
  .option('--host <host>', '监听地址', process.env.ARQQBOT_HOST || '127.0.0.1')
  .option('--port <port>', '监听端口', process.env.ARQQBOT_PORT || '17800')
  .option('--builtin-plugins <dir>', '内置插件目录')
  .option('--worker-entry <file>', 'Worker 入口文件')
  .option('--web-root <dir>', 'Web 控制台构建目录')
  .option('--log-level <level>', '日志级别', 'info')
  .option('--trust-proxy', '信任反向代理头', false)
  .option('--autostart', '启动后自动拉起所有实例', false)
  .action(async (_options, command: Command) => {
    await runServe(command)
  })

const instance = program.command('instance').description('实例管理')
instance
  .command('list')
  .description('列出实例')
  .action(async (_options, command: Command) => {
    const { client, json } = await clientFor(command)
    const data = await client.get<unknown>('/api/instances')
    if (json) printJson(true, data)
    else if (Array.isArray(data)) {
      for (const item of data as Array<{ id: string; name: string; state: string; appId: string }>) {
        console.log(`${item.id}\t${item.name}\t${item.state}\t${item.appId}`)
      }
    }
  })

instance
  .command('create')
  .description('创建实例')
  .requiredOption('--name <name>', '实例名称')
  .requiredOption('--app-id <id>', 'QQ AppID')
  .option('--env <env>', 'sandbox 或 production', 'sandbox')
  .option('--intents <list>', '逗号分隔的 intents')
  .option('--secret-stdin', '从标准输入读取 AppSecret', false)
  .action(async (options, command: Command) => {
    const { client, json } = await clientFor(command)
    const secret = options.secretStdin ? await readStdin() : process.env.ARQQBOT_APP_SECRET
    if (!secret) throw new Error('缺少 AppSecret：使用 --secret-stdin 或 ARQQBOT_APP_SECRET')
    const created = await client.post<unknown>('/api/instances', {
      name: options.name,
      appId: options.appId,
      appSecret: secret,
      env: options.env,
      ...(options.intents ? { intents: splitList(options.intents) } : {})
    })
    if (json) printJson(true, created)
    else console.log(`已创建实例：${(created as { id: string }).id}`)
  })

instance
  .command('update <id>')
  .description('更新实例')
  .option('--name <name>')
  .option('--app-id <id>')
  .option('--env <env>')
  .option('--intents <list>')
  .option('--secret-stdin', '从标准输入读取新 AppSecret', false)
  .action(async (id, options, command: Command) => {
    const { client, json } = await clientFor(command)
    const patch: Record<string, unknown> = {}
    if (options.name) patch.name = options.name
    if (options.appId) patch.appId = options.appId
    if (options.env) patch.env = options.env
    if (options.intents) patch.intents = splitList(options.intents)
    if (options.secretStdin) patch.appSecret = await readStdin()
    const updated = await client.patch<unknown>(`/api/instances/${encodeURIComponent(id)}`, patch)
    if (json) printJson(true, updated)
    else console.log(`已更新实例：${id}`)
  })

for (const [name, method] of [
  ['start', 'post'],
  ['stop', 'post'],
  ['restart', 'post'],
  ['remove', 'delete']
] as const) {
  instance
    .command(`${name} <id>`)
    .description(`${name} 实例`)
    .action(async (id, _options, command: Command) => {
      const { client, json } = await clientFor(command)
      if (method === 'post') {
        await client.post(`/api/instances/${encodeURIComponent(id)}/${name}`)
      } else {
        await client.delete(`/api/instances/${encodeURIComponent(id)}`)
      }
      if (!json) console.log(`已执行：${name} ${id}`)
    })
}

instance
  .command('status <id>')
  .description('查看实例状态')
  .action(async (id, _options, command: Command) => {
    const { client, json } = await clientFor(command)
    const data = await client.get<unknown>(`/api/instances/${encodeURIComponent(id)}/status`)
    if (json) printJson(true, data)
    else console.log(JSON.stringify(data))
  })

instance
  .command('capabilities <id>')
  .description('查看 QQ 能力状态')
  .action(async (id, _options, command: Command) => {
    const { client, json } = await clientFor(command)
    const data = await client.get<unknown>(`/api/instances/${encodeURIComponent(id)}/capabilities`)
    if (json) printJson(true, data)
    else console.log(JSON.stringify(data, null, 2))
  })

const plugin = program.command('plugin').description('插件管理')
plugin
  .command('list <instanceId>')
  .description('列出实例插件')
  .action(async (instanceId, _options, command: Command) => {
    const { client, json } = await clientFor(command)
    const data = await client.get<unknown>(`/api/instances/${encodeURIComponent(instanceId)}/plugins`)
    if (json) printJson(true, data)
    else if (Array.isArray(data)) {
      for (const item of data as Array<{ id: string; displayName: string; enabled: boolean; runtimeState: string }>) {
        console.log(`${item.id}\t${item.displayName}\t${item.enabled}\t${item.runtimeState}`)
      }
    }
  })

for (const action of ['enable', 'disable'] as const) {
  plugin
    .command(`${action} <instanceId> <pluginId>`)
    .description(`${action} 插件`)
    .action(async (instanceId, pluginId, _options, command: Command) => {
      const { client, json } = await clientFor(command)
      await client.post(
        `/api/instances/${encodeURIComponent(instanceId)}/plugins/${encodeURIComponent(pluginId)}/${action}`
      )
      if (!json) console.log(`已${action}：${pluginId}`)
    })
}

plugin
  .command('config <instanceId> <pluginId>')
  .description('更新插件配置')
  .requiredOption('--file <file>', 'JSON 配置文件')
  .action(async (instanceId, pluginId, options, command: Command) => {
    const { client, json } = await clientFor(command)
    const config = JSON.parse(await readFile(path.resolve(options.file), 'utf8')) as Record<string, unknown>
    await client.put(
      `/api/instances/${encodeURIComponent(instanceId)}/plugins/${encodeURIComponent(pluginId)}/config`,
      { config }
    )
    if (!json) console.log(`已更新插件配置：${pluginId}`)
  })

const market = program.command('market').description('插件市场')
market
  .command('search [query]')
  .description('搜索插件')
  .option('--index-url <url>', '自定义索引地址')
  .action(async (query, options, command: Command) => {
    const { client, json } = await clientFor(command)
    const pathWithQuery = options.indexUrl
      ? `/api/marketplace?indexUrl=${encodeURIComponent(options.indexUrl)}`
      : '/api/marketplace'
    const snapshot = await client.get<PluginMarketSnapshot>(pathWithQuery)
    if (snapshot.error) throw new Error(snapshot.error)
    const keyword = String(query ?? '').toLowerCase()
    const items = snapshot.plugins.filter((item) => {
      if (!keyword) return true
      return `${item.id} ${item.displayName} ${item.description}`.toLowerCase().includes(keyword)
    })
    if (json) printJson(true, items)
    else {
      for (const item of items) {
        console.log(`${item.id}\t${item.version}\t${item.displayName}\t${item.description}`)
      }
    }
  })

market
  .command('install <pluginId>')
  .description('安装插件')
  .option('--index-url <url>', '自定义索引地址')
  .action(async (pluginId, options, command: Command) => {
    const { client, json } = await clientFor(command)
    const pathWithQuery = options.indexUrl
      ? `/api/marketplace?indexUrl=${encodeURIComponent(options.indexUrl)}`
      : '/api/marketplace'
    const snapshot = await client.get<PluginMarketSnapshot>(pathWithQuery)
    if (snapshot.error) throw new Error(snapshot.error)
    const entry = snapshot.plugins.find((item) => item.id === pluginId)
    if (!entry) throw new Error(`索引中找不到插件：${pluginId}`)
    await client.post('/api/marketplace/install', entry satisfies PluginMarketEntry)
    if (!json) console.log(`已安装：${entry.displayName} (${entry.id})`)
  })

program
  .command('logs <instanceId>')
  .description('订阅实例日志')
  .option('--json', '输出 JSON', false)
  .action(async (instanceId, options, command: Command) => {
    const { client, json } = await clientFor(command)
    const outputJson = Boolean(options.json || json)
    const close = await client.subscribeLogs(instanceId, (entry) => {
      if (outputJson) console.log(JSON.stringify(entry))
      else console.log(formatLog(entry))
    })
    const stop = (): void => {
      close()
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })

program
  .command('health')
  .description('检查服务器健康状态')
  .action(async (_options, command: Command) => {
    const { client, json } = await clientFor(command)
    const data = await client.get<unknown>('/api/health')
    if (json) printJson(true, data)
    else console.log(JSON.stringify(data))
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
