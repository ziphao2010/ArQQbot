import { useState } from 'react'
import { CreateInstance } from './pages/CreateInstance'
import { InstanceDetail } from './pages/InstanceDetail'
import { InstanceList } from './pages/InstanceList'

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; id: string }

export function App() {
  const [view, setView] = useState<View>({ kind: 'list' })

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="flex items-start justify-between px-10 pt-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ArQQBot</h1>
          <p className="mt-1 text-sm text-neutral-500">QQ 机器人实例管理器</p>
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
          <InstanceDetail instanceId={view.id} onBack={() => setView({ kind: 'list' })} />
        )}
      </main>
    </div>
  )
}
