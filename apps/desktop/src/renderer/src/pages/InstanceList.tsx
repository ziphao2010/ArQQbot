import { useEffect, useState } from 'react'
import type { InstanceSummary } from '@arqqbot/shared'

const STATE_TEXT: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  crashed: '崩溃',
  error: '错误',
  starting: '启动中',
  stopping: '停止中',
  created: '已创建'
}

const STATE_COLOR: Record<string, string> = {
  running: 'bg-green-500',
  crashed: 'bg-red-500',
  error: 'bg-red-500',
  starting: 'bg-amber-500',
  stopping: 'bg-amber-500'
}

interface InstanceListProps {
  onCreate(): void
  onOpen(id: string): void
}

export function InstanceList({ onCreate, onOpen }: InstanceListProps) {
  const [items, setItems] = useState<InstanceSummary[]>([])
  const [error, setError] = useState<string>()

  async function refresh(): Promise<void> {
    try {
      setItems(await window.arqqbot.instances.list())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [])

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">实例</h2>
        <button
          className="rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white shadow-sm"
          onClick={onCreate}
        >
          新建实例
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!error && items.length === 0 && (
        <div className="rounded-3xl bg-white/70 p-12 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-lg font-medium">还没有实例</p>
          <p className="mt-2 text-sm text-neutral-500">点击“新建实例”绑定第一个 QQ 机器人。</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            className="rounded-3xl bg-white/70 p-6 text-left shadow-sm ring-1 ring-black/5 backdrop-blur transition hover:shadow-md"
            onClick={() => onOpen(item.id)}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <span className="text-xs text-neutral-500">
                {item.env === 'sandbox' ? '沙箱' : '正式'}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-neutral-600">
              <span
                className={`h-2 w-2 rounded-full ${STATE_COLOR[item.state] ?? 'bg-neutral-400'}`}
              />
              {STATE_TEXT[item.state] ?? item.state}
              {item.requiresRestart && (
                <span className="ml-2 text-amber-600">需重启生效</span>
              )}
            </div>
            <div className="mt-2 font-mono text-xs text-neutral-400">{item.appId}</div>
          </button>
        ))}
      </div>
    </section>
  )
}
