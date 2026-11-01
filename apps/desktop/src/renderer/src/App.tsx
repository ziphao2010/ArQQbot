import { useState } from 'react'
import { CreateInstance } from './pages/CreateInstance'
import { InstanceDetail } from './pages/InstanceDetail'
import { InstanceList } from './pages/InstanceList'
import { PluginMarket } from './pages/PluginMarket'
import { ThemeToggle } from './components/ThemeToggle'

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; id: string }
  | { kind: 'market' }

export function App() {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [marketReturn, setMarketReturn] = useState<View>({ kind: 'list' })

  function openMarket(): void {
    setMarketReturn(view.kind === 'market' ? { kind: 'list' } : view)
    setView({ kind: 'market' })
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] transition-colors duration-300">
      <header className="app-drag flex items-start justify-between px-10 pt-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ArQQBot</h1>
          <p className="mt-1 text-sm text-neutral-500">QQ 机器人实例管理器</p>
        </div>
        <div className="flex items-center gap-2">
          <nav className="app-no-drag flex gap-1 rounded-full bg-black/5 p-1">
            <button
              className={`rounded-full px-4 py-1.5 text-sm ${
                view.kind !== 'market' ? 'bg-white font-medium shadow-sm' : 'text-neutral-500'
              }`}
              onClick={() => setView({ kind: 'list' })}
            >
              实例
            </button>
            <button
              className={`rounded-full px-4 py-1.5 text-sm ${
                view.kind === 'market' ? 'bg-white font-medium shadow-sm' : 'text-neutral-500'
              }`}
              onClick={openMarket}
            >
              插件市场
            </button>
          </nav>
          <div className="app-no-drag flex items-center">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-10 py-8">
        {view.kind === 'list' && (
          <InstanceList
            onCreate={() => setView({ kind: 'create' })}
            onOpen={(id) => setView({ kind: 'detail', id })}
          />
        )}
        {view.kind === 'create' && (
          <CreateInstance
            onCancel={() => setView({ kind: 'list' })}
            onCreated={(id) => setView({ kind: 'detail', id })}
          />
        )}
        {view.kind === 'detail' && (
          <InstanceDetail
            instanceId={view.id}
            onBack={() => setView({ kind: 'list' })}
            onOpenMarket={openMarket}
          />
        )}
        {view.kind === 'market' && <PluginMarket onBack={() => setView(marketReturn)} />}
      </main>
    </div>
  )
}
