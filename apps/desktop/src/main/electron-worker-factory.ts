import { utilityProcess } from 'electron'
import type { WorkerFactory, WorkerProcessLike } from './worker-supervisor'

export function createElectronWorkerFactory(entryPath: string): WorkerFactory {
  return {
    spawn(): WorkerProcessLike {
      const child = utilityProcess.fork(entryPath, [], {
        serviceName: 'ArQQBot Worker',
        stdio: 'pipe'
      })
      return {
        postMessage: (message) => child.postMessage(message),
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
