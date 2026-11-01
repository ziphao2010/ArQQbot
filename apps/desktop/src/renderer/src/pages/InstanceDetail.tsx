import { useEffect, useState } from 'react'
import type {
  InstanceStatus,
  LogEntry,
  LogLevel,
  PluginSummary,
  QQCapabilityInfo,
  QQCapabilitySnapshot,
  QQIntentName
} from '@arqqbot/shared'
import { SchemaForm } from '../components/SchemaForm'

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'plugins', label: '插件' },
  { id: 'capabilities', label: '能力' },
  { id: 'logs', label: '日志' }
] as const

const INTENT_OPTIONS: ReadonlyArray<{ id: QQIntentName; label: string; hint: string }> = [
  { id: 'public_messages', label: '群聊/单聊消息', hint: '群 @、单聊、好友与群成员事件' },
  { id: 'interaction', label: '互动回调', hint: '按钮互动、订阅状态' },
  { id: 'guilds', label: '频道', hint: '频道与子频道事件' },
  { id: 'guild_members', label: '频道成员', hint: '频道成员变更事件' },
  { id: 'guild_messages', label: '频道消息', hint: '频道消息事件' },
  { id: 'direct_message', label: '频道私信', hint: '频道私信事件' }
]

const MODULE_LABELS: Record<string, string> = {
  message: '消息',
  media: '富媒体',
  group: '群管理',
  guild: '频道',
  interaction: '互动',
  menu: '菜单',
  panels: '指令面板',
  bot: '机器人'
}

type TabId = (typeof TABS)[number]['id']

interface InstanceDetailProps {
  instanceId: string
  onBack(): void
  onOpenMarket?: () => void
}

export function InstanceDetail({ instanceId, onBack, onOpenMarket }: InstanceDetailProps) {
  const [tab, setTab] = useState<TabId>('overview')
  const [status, setStatus] = useState<InstanceStatus>()
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [capabilities, setCapabilities] = useState<QQCapabilitySnapshot>()
  const [intentDraft, setIntentDraft] = useState<QQIntentName[]>()
  const [intentMessage, setIntentMessage] = useState<string>()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [search, setSearch] = useState('')
  const [onlyMessages, setOnlyMessages] = useState(false)
  const [error, setError] = useState<string>()

  async function refresh(): Promise<void> {
    try {
      const [nextStatus, nextPlugins, nextCapabilities] = await Promise.all([
        window.arqqbot.instances.status(instanceId),
        window.arqqbot.plugins.list(instanceId),
        window.arqqbot.qq.capabilities(instanceId)
      ])
      setStatus(nextStatus)
      setPlugins(nextPlugins)
      setCapabilities(nextCapabilities)
      setIntentDraft((previous) => previous ?? nextCapabilities.intents)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    setCapabilities(undefined)
    setIntentDraft(undefined)
    setIntentMessage(undefined)
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [instanceId])

  useEffect(() => {
    window.arqqbot.logs.subscribe(instanceId)
    const off = window.arqqbot.logs.onEntry((payload) => {
      if (payload.instanceId !== instanceId) return
      setLogs((previous) => [...previous.slice(-499), payload.entry])
    })
    return () => {
      off()
      window.arqqbot.logs.unsubscribe(instanceId)
    }
  }, [instanceId])

  async function start(): Promise<void> {
    try {
      await window.arqqbot.instances.start(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function stop(): Promise<void> {
    try {
      await window.arqqbot.instances.stop(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function restart(): Promise<void> {
    try {
      await window.arqqbot.instances.restart(instanceId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function removeInstance(): Promise<void> {
    if (!window.confirm('删除该实例会移除本地配置与日志，确定继续？')) return
    try {
      await window.arqqbot.instances.remove(instanceId)
      onBack()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function toggleIntent(intent: QQIntentName): void {
    setIntentDraft((previous) => {
      const current = previous ?? capabilities?.intents ?? []
      return current.includes(intent)
        ? current.filter((item) => item !== intent)
        : [...current, intent]
    })
    setIntentMessage(undefined)
  }

  async function saveIntents(): Promise<void> {
    setIntentMessage(undefined)
    try {
      await window.arqqbot.qq.updateIntents(instanceId, intentDraft ?? capabilities?.intents ?? [])
      setIntentMessage('已保存，重启实例后生效')
      await refresh()
    } catch (cause) {
      setIntentMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function exportLogs(): void {
    const content = visibleLogs.map((entry) => JSON.stringify(entry)).join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'application/jsonl' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `logs-${instanceId}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const running = status?.state === 'running'
  const visibleLogs = logs.filter((entry) => {
    const levelMatches = level === 'all' || entry.level === level
    const keyword = search.trim().toLowerCase()
    const searchMatches =
      keyword.length === 0 ||
      entry.message.toLowerCase().includes(keyword) ||
      (entry.pluginId ?? '').toLowerCase().includes(keyword)
    const messageMatches =
      !onlyMessages ||
      entry.message.startsWith('收到') ||
      entry.message.startsWith('已发送')
    return levelMatches && searchMatches && messageMatches
  })

  const capabilityGroups: Record<string, QQCapabilityInfo[]> = {}
  for (const item of capabilities?.capabilities ?? []) {
    const bucket = capabilityGroups[item.module] ?? []
    bucket.push(item)
    capabilityGroups[item.module] = bucket
  }
  const selectedIntents = intentDraft ?? capabilities?.intents ?? []

  return (
    <section className="space-y-6">
      <button className="text-sm text-neutral-500" onClick={onBack}>
        ← 返回实例列表
      </button>

      <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">实例详情</h2>
            <p className="mt-1 font-mono text-xs text-neutral-400">{instanceId}</p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full bg-[#0071e3] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={running}
              onClick={start}
            >
              启动
            </button>
            <button
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={!running}
              onClick={stop}
            >
              停止
            </button>
            <button
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium"
              onClick={restart}
            >
              重启
            </button>
            <button
              className="rounded-full bg-red-50 px-4 py-2 text-sm font-medium text-red-600"
              onClick={removeInstance}
            >
              删除
            </button>
          </div>
        </div>
        {status?.lastError && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {status.lastError.code}：{status.lastError.message}
          </div>
        )}
        {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <nav className="flex gap-1 rounded-full bg-black/5 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === item.id ? 'bg-white font-medium shadow-sm' : 'text-neutral-500'
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="状态" value={status?.state ?? 'unknown'} />
          <StatCard label="连接" value={status?.connected ? '已连接' : '未连接'} />
          <StatCard label="收消息" value={String(status?.received ?? 0)} />
          <StatCard label="发消息" value={String(status?.sent ?? 0)} />
          <StatCard
            label="启动时间"
            value={status?.startedAt ? new Date(status.startedAt).toLocaleString('zh-CN') : '-'}
          />
        </div>
      )}

      {tab === 'plugins' && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">从插件市场安装</h3>
                <p className="mt-1 text-sm text-neutral-500">
                  云端发现和下载社区插件；安装后需重启实例并在本页启用
                </p>
              </div>
              {onOpenMarket && (
                <button
                  className="shrink-0 rounded-full bg-[#0071e3] px-4 py-2 text-sm font-medium text-white"
                  onClick={onOpenMarket}
                >
                  打开插件市场
                </button>
              )}
            </div>
          </div>
          {plugins.length === 0 && (
            <div className="rounded-3xl bg-white/70 p-8 text-sm text-neutral-500">
              未发现插件。请确认内置插件已构建并位于 `resources/plugins`。
            </div>
          )}
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              instanceId={instanceId}
              plugin={plugin}
              onChanged={() => void refresh()}
            />
          ))}
        </div>
      )}

      {tab === 'capabilities' && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">WebSocket 与 intents</h3>
                <p className="mt-1 text-sm text-neutral-500">
                  连接：{status?.connected ? '已连接' : '未连接'} · 已订阅{' '}
                  {selectedIntents.length} 项
                </p>
              </div>
              <button
                className="rounded-full bg-[#0071e3] px-4 py-2 text-sm font-medium text-white"
                onClick={saveIntents}
              >
                保存 intents
              </button>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {INTENT_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl bg-black/[0.03] p-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedIntents.includes(option.id)}
                    onChange={() => toggleIntent(option.id)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      {option.id} · {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {intentMessage && <p className="mt-3 text-xs text-neutral-500">{intentMessage}</p>}
          </div>

          {capabilities && !capabilities.running && (
            <div className="rounded-3xl bg-white/70 p-6 text-sm text-neutral-500 shadow-sm ring-1 ring-black/5">
              {capabilities.reason ?? '实例未运行，启动后可查看能力状态'}
            </div>
          )}

          {capabilities?.running && Object.keys(capabilityGroups).length === 0 && (
            <div className="rounded-3xl bg-white/70 p-6 text-sm text-neutral-500 shadow-sm ring-1 ring-black/5">
              暂无能力数据
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(capabilityGroups).map(([module, items]) => {
              const available = items.filter((item) => item.available).length
              const endpoints = items.reduce((sum, item) => sum + item.endpointCount, 0)
              return (
                <div
                  key={module}
                  className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{MODULE_LABELS[module] ?? module}</h3>
                    <span className="text-xs text-neutral-500">
                      {available}/{items.length} 可用 · {endpoints} 端点
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 rounded-2xl bg-black/[0.03] p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{item.id}</p>
                          {item.requiredIntents.length > 0 && (
                            <p className="mt-1 text-xs text-neutral-500">
                              需要 {item.requiredIntents.join('、')}
                            </p>
                          )}
                          {item.reason && (
                            <p className="mt-1 text-xs text-red-600">{item.reason}</p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                            item.available
                              ? 'bg-green-50 text-green-700'
                              : 'bg-red-50 text-red-600'
                          }`}
                        >
                          {item.available ? '可用' : '不可用'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as 'all' | LogLevel)}
            >
              <option value="all">全部级别</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <input
              className="w-56"
              placeholder="搜索日志"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={onlyMessages}
                onChange={(event) => setOnlyMessages(event.target.checked)}
              />
              只看消息
            </label>
            <button className="text-sm text-[#0071e3]" onClick={exportLogs}>
              导出 JSONL
            </button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-3xl bg-[#111113] p-4 font-mono text-xs text-neutral-300">
            {visibleLogs.length === 0 && <p className="text-neutral-500">暂无日志</p>}
            {visibleLogs.map((entry, index) => (
              <div key={`${entry.time}-${index}`} className="whitespace-pre-wrap py-0.5">
                <span className="text-neutral-500">{entry.time}</span>{' '}
                <span className={entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-300' : 'text-sky-300'}>
                  [{entry.level}]
                </span>{' '}
                {entry.pluginId && <span className="text-violet-300">[{entry.pluginId}] </span>}
                <span
                  className={
                    entry.message.startsWith('收到')
                      ? 'text-sky-200'
                      : entry.message.startsWith('已发送')
                        ? 'text-green-300'
                        : undefined
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}

function PluginCard({
  instanceId,
  plugin,
  onChanged
}: {
  instanceId: string
  plugin: PluginSummary
  onChanged(): void
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(plugin.config)
  const [message, setMessage] = useState<string>()

  async function toggle(): Promise<void> {
    setMessage(undefined)
    try {
      if (plugin.enabled) {
        await window.arqqbot.plugins.disable(instanceId, plugin.id)
      } else {
        await window.arqqbot.plugins.enable(instanceId, plugin.id)
      }
      onChanged()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function save(): Promise<void> {
    setMessage(undefined)
    try {
      await window.arqqbot.plugins.updateConfig(instanceId, plugin.id, config)
      setMessage('配置已保存')
      onChanged()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{plugin.displayName}</h3>
          <p className="mt-1 text-xs text-neutral-500">
            {plugin.id} · v{plugin.version} · {plugin.runtimeState}
          </p>
          {plugin.description && <p className="mt-2 text-sm text-neutral-600">{plugin.description}</p>}
        </div>
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            plugin.enabled ? 'bg-black/5' : 'bg-[#0071e3] text-white'
          }`}
          onClick={toggle}
        >
          {plugin.enabled ? '禁用' : '启用'}
        </button>
      </div>

      <div className="mt-5 border-t border-black/5 pt-5">
        <SchemaForm schema={plugin.schema} value={config} onChange={setConfig} />
        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium"
            onClick={save}
          >
            保存配置
          </button>
          {message && <span className="text-xs text-neutral-500">{message}</span>}
        </div>
      </div>
    </div>
  )
}
