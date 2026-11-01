import type { ErrorInfo, WorkerEvent, WorkerRequest } from '@arqqbot/shared'
import { bootstrapInstance, type BootstrapResult } from './bootstrap'

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

function getParentPort(): ParentPortLike {
  const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort
  if (!port) throw new Error('Worker 必须通过 Electron utilityProcess 启动')
  return port
}

function toErrorInfo(error: unknown, code = 'WORKER_ERROR'): ErrorInfo {
  return {
    code,
    message: error instanceof Error ? error.message : String(error)
  }
}

async function main(): Promise<void> {
  const port = getParentPort()
  const post = (event: WorkerEvent): void => port.postMessage(event)
  let runtime: BootstrapResult | undefined
  let starting = false

  const respond = (requestId: string, error?: unknown): void => {
    if (error === undefined) {
      post({ type: 'response', requestId, ok: true })
    } else {
      post({ type: 'response', requestId, ok: false, error: toErrorInfo(error) })
    }
  }

  const respondResult = (requestId: string, result: unknown): void => {
    post({ type: 'response', requestId, ok: true, result })
  }

  port.on('message', (event) => {
    const request = event.data as WorkerRequest
    if (!request || typeof request !== 'object' || !('type' in request)) return

    if (request.type === 'start') {
      if (starting || runtime) {
        respond(request.requestId, new Error('实例已启动'))
        return
      }
      starting = true
      bootstrapInstance(request.config, { post })
        .then((result) => {
          runtime = result
          starting = false
          post({ type: 'ready' })
          post({ type: 'status', status: result.getStatus() })
          respond(request.requestId)
        })
        .catch((error) => {
          starting = false
          respond(request.requestId, error)
        })
      return
    }

    if (!runtime) {
      respond(request.requestId, new Error('实例尚未启动'))
      return
    }

    if (request.type === 'getStatus') {
      post({ type: 'status', status: runtime.getStatus() })
      respond(request.requestId)
      return
    }

    if (request.type === 'getCapabilities') {
      respondResult(request.requestId, runtime.adapter.service?.capabilities.list() ?? [])
      return
    }

    if (request.type === 'applyPluginConfig') {
      runtime.host
        .applyConfig(request.pluginId, request.config)
        .then(() => respond(request.requestId))
        .catch((error) => respond(request.requestId, error))
      return
    }

    if (request.type === 'setPluginEnabled') {
      runtime.host
        .setEnabled(request.pluginId, request.enabled)
        .then(() => respond(request.requestId))
        .catch((error) => respond(request.requestId, error))
      return
    }

    if (request.type === 'stop') {
      runtime
        .stop()
        .then(() => {
          post({ type: 'status', status: { ...runtime!.getStatus(), state: 'stopped' } })
          respond(request.requestId)
          setTimeout(() => process.exit(0), 50)
        })
        .catch((error) => respond(request.requestId, error))
    }
  })
}

void main()
