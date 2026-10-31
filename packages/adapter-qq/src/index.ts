import type { Context } from 'cordis'
import type { QQService } from '@arqqbot/shared'
import { QQAdapter, type QQAdapterConfig } from './service'

export const name = 'adapter-qq'
export const inject = ['logger']

export interface AdapterHandle {
  service?: QQService
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export function apply(ctx: Context, config: QQAdapterConfig): void {
  ctx.plugin(QQAdapter, config)
}

export async function createAdapter(ctx: Context, config: QQAdapterConfig): Promise<AdapterHandle> {
  await ctx.plugin(QQAdapter, config)
  const adapter = ctx.qq as unknown as QQAdapter
  return {
    service: ctx.qq,
    connect: () => adapter.connect(),
    disconnect: () => adapter.disconnect()
  }
}

export { QQAdapter }
export type { QQAdapterConfig }
