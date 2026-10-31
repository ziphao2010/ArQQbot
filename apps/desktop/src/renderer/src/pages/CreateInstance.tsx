import { useState, type FormEvent } from 'react'
import type { InstanceEnv } from '@arqqbot/shared'

interface CreateInstanceProps {
  onCancel(): void
  onCreated(id: string): void
}

export function CreateInstance({ onCancel, onCreated }: CreateInstanceProps) {
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [env, setEnv] = useState<InstanceEnv>('sandbox')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const created = await window.arqqbot.instances.create({ name, appId, appSecret, env })
      onCreated(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="max-w-xl space-y-5 rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-black/5"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">新建实例</h2>
        <button type="button" className="text-sm text-neutral-500" onClick={onCancel}>
          取消
        </button>
      </div>

      <label className="block text-sm">
        <span className="font-medium">实例名称</span>
        <input
          className="mt-1 w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">AppID</span>
        <input
          className="mt-1 w-full font-mono"
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">AppSecret</span>
        <input
          type="password"
          className="mt-1 w-full"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-neutral-500">
          密钥会用系统加密保存，界面不会再次显示明文。
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium">环境</span>
        <select
          className="mt-1 w-full"
          value={env}
          onChange={(event) => setEnv(event.target.value as InstanceEnv)}
        >
          <option value="sandbox">沙箱</option>
          <option value="production">正式</option>
        </select>
      </label>

      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
      >
        {busy ? '创建中…' : '创建实例'}
      </button>
    </form>
  )
}
