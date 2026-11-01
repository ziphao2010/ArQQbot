import { useState } from 'react'
import { saveWebToken } from '../http-api'

export function WebTokenGate() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const value = token.trim()
    if (!value) {
      setError('请输入服务端访问 token')
      return
    }
    saveWebToken(value)
    window.location.reload()
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-6">
      <form
        className="w-full max-w-sm rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-black/5 backdrop-blur"
        onSubmit={submit}
      >
        <h1 className="text-2xl font-semibold tracking-tight">ArQQBot 控制台</h1>
        <p className="mt-2 text-sm text-neutral-500">
          这是无头服务端的远程控制台，请输入服务端启动时输出的访问 token。
        </p>
        <input
          className="mt-6 w-full"
          type="password"
          placeholder="访问 token"
          value={token}
          autoFocus
          onChange={(event) => {
            setToken(event.target.value)
            setError('')
          }}
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          className="mt-5 w-full rounded-full bg-[#0071e3] px-4 py-2.5 text-sm font-medium text-white"
          type="submit"
        >
          进入控制台
        </button>
        <p className="mt-4 text-xs text-neutral-400">
          token 保存在当前浏览器会话中，关闭标签页后失效。也可以在地址后追加
          {' '}
          <code>#token=...</code>
          {' '}
          直接进入。
        </p>
      </form>
    </div>
  )
}
