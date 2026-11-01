import { fork } from 'node:child_process'
import type { WorkerFactory, WorkerProcessLike } from './worker-supervisor'

export function createNodeWorkerFactory(entryPath: string): WorkerFactory {
  return {
    spawn(): WorkerProcessLike {
      const child = fork(entryPath, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })

      child.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
      child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))

      return {
        postMessage: (message) => child.send(message as Parameters<typeof child.send>[0]),
        on: (event: 'message' | 'exit', listener: (...args: any[]) => void) => {
          if (event === 'message') {
            child.on('message', listener as (message: unknown) => void)
          } else {
            child.on('exit', listener as (code: number) => void)
          }
        },
        kill: () => child.kill()
      }
    }
  }
}
