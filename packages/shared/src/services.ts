import type {} from 'cordis'
import type { QQMessage, QQSendInput, QQSendResult, QQStats } from './types'

export interface QQService {
  send(input: QQSendInput): Promise<QQSendResult>
  getStats(): QQStats
}

export interface StorageServiceContract {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

declare module 'cordis' {
  interface Events {
    'qq/message': (message: QQMessage) => void
    'qq/ready': () => void
    'qq/error': (error: Error) => void
    'qq/disconnect': () => void
  }

  interface Context {
    qq: QQService
    storage: StorageServiceContract
  }
}
