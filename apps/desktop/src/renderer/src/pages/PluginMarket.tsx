import { useEffect, useState } from 'react'
import type { PluginMarketEntry, PluginMarketSnapshot } from '@arqqbot/shared'

const STORAGE_KEY = 'arqqbot.marketIndexUrl'
const DEFAULT_INDEX_URL = 'https://raw.githubusercontent.com/ziphao2010/ArQQbot/master/plugins/index.json'

interface PluginMarketProps {
  onBack(): void
}

export function PluginMarket({ onBack }: PluginMarketProps) {
  const [snapshot, setSnapshot] = useState<PluginMarketSnapshot>()
  const [indexUrl, setIndexUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [installingId, setInstallingId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  async function load(url: string): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      setSnapshot(await window.arqqbot.plugins.marketplace(url.trim() || undefined))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(localStorage.getItem(STORAGE_KEY) ?? '')
  }, [])

  function refresh(): void {
    const normalized = indexUrl.trim()
    if (normalized) {
      localStorage.setItem(STORAGE_KEY, normalized)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    setMessage(undefined)
    void load(normalized)
  }

  async function install(entry: PluginMarketEntry): Promise<void> {
    setInstallingId(entry.id)
    setMessage(undefined)
    setError(undefined)
    try {
      await window.arqqbot.plugins.install(entry)
      await load(indexUrl)
      setMessage('已安装，重启实例后可在插件页启用')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setInstallingId(undefined)
    }
  }

  const keyword = search.trim().toLowerCase()
  const plugins = (snapshot?.plugins ?? []).filter((entry) => {
    if (keyword.length === 0) return true
    return (
      entry.displayName.toLowerCase().includes(keyword) ||
      entry.description.toLowerCase().includes(keyword) ||
      entry.id.toLowerCase().includes(keyword) ||
      (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(keyword))
    )
  })
  const activeError = error ?? snapshot?.error

  return (
    <section className="space-y-6">
      <button className="text-sm text-neutral-500" onClick={onBack}>
        ← 返回实例列表
      </button>

      <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">插件市场</h2>
            <p className="mt-1 text-sm text-neutral-500">
              从插件索引发现社区插件。安装只校验 manifest 与入口，不会自动启用。
            </p>
          </div>
          {snapshot?.installedIds && (
            <span className="shrink-0 text-xs text-neutral-500">
              已安装 {snapshot.installedIds.length} 个
            </span>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2 md:flex-row">
          <input
            className="flex-1 rounded-full bg-black/5 px-4 py-2 text-sm"
            placeholder={DEFAULT_INDEX_URL}
            value={indexUrl}
            onChange={(event) => setIndexUrl(event.target.value)}
          />
          <button
            className="rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={loading}
            onClick={refresh}
          >
            刷新
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="w-full rounded-full bg-black/5 px-4 py-2 text-sm md:w-72"
            placeholder="搜索插件名称、描述或标签"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {snapshot?.generatedAt && (
            <span className="text-xs text-neutral-400">
              索引更新于 {new Date(snapshot.generatedAt).toLocaleString('zh-CN')}
            </span>
          )}
        </div>

        {activeError && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{activeError}</div>
        )}
        {message && (
          <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-700">{message}</div>
        )}
      </div>

      {loading && !snapshot && (
        <div className="rounded-3xl bg-white/70 p-8 text-sm text-neutral-500 shadow-sm ring-1 ring-black/5">
          正在加载插件索引…
        </div>
      )}

      {!loading && snapshot && snapshot.plugins.length === 0 && (
        <div className="rounded-3xl bg-white/70 p-12 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-lg font-medium">索引中没有插件</p>
          <p className="mt-2 text-sm text-neutral-500">
            在 GitHub 仓库打上 topic <span className="font-mono">arqqbot-plugin</span>{' '}
            发布插件，或在上方填写自定义索引地址。
          </p>
        </div>
      )}

      {snapshot && snapshot.plugins.length > 0 && plugins.length === 0 && (
        <div className="rounded-3xl bg-white/70 p-8 text-sm text-neutral-500">
          没有匹配“{search}”的插件。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {plugins.map((entry) => {
          const installed = snapshot?.installedIds.includes(entry.id) ?? false
          const installing = installingId === entry.id
          return (
            <div
              key={entry.id}
              className="flex flex-col rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-black/5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{entry.displayName}</h3>
                  <p className="mt-1 font-mono text-xs text-neutral-400">
                    {entry.id} · v{entry.version}
                  </p>
                </div>
                <button
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                    installed
                      ? 'bg-black/5 text-neutral-500'
                      : 'bg-[#0071e3] text-white disabled:opacity-40'
                  }`}
                  disabled={installed || installing}
                  onClick={() => void install(entry)}
                >
                  {installed ? '已安装' : installing ? '安装中…' : '安装'}
                </button>
              </div>

              {entry.description && (
                <p className="mt-3 text-sm text-neutral-600">{entry.description}</p>
              )}

              {(entry.repo || entry.homepage) && (
                <div className="mt-3 flex gap-4 text-xs text-[#0071e3]">
                  {entry.repo && (
                    <a href={entry.repo} target="_blank" rel="noreferrer">
                      仓库
                    </a>
                  )}
                  {entry.homepage && (
                    <a href={entry.homepage} target="_blank" rel="noreferrer">
                      主页
                    </a>
                  )}
                </div>
              )}

              {entry.tags && entry.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-black/[0.04] px-3 py-1 text-xs text-neutral-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
