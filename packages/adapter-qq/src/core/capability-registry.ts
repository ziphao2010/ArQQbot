import type { InstanceEnv, QQCapabilityInfo, QQIntentName } from '@arqqbot/shared'
import { QQ_ENDPOINTS, type QQEndpointSpec } from './endpoint-catalog'
import { QQApiError } from './errors'
import { QQ_INTENT_BITS } from './intent-map'

export interface QQCapabilityGuard {
  assert(id: string): void
}

export interface QQCapabilityRegistryOptions {
  env: InstanceEnv
  intents: number
  endpoints?: QQEndpointSpec[]
}

export class QQCapabilityRegistry implements QQCapabilityGuard {
  private readonly entries: QQCapabilityInfo[]

  constructor(options: QQCapabilityRegistryOptions) {
    const grouped = new Map<string, QQEndpointSpec[]>()

    for (const endpoint of options.endpoints ?? QQ_ENDPOINTS) {
      const bucket = grouped.get(endpoint.capability) ?? []
      bucket.push(endpoint)
      grouped.set(endpoint.capability, bucket)
    }

    this.entries = [...grouped.entries()].map(([id, endpoints]) => {
      const requiredIntents = [...new Set(endpoints.flatMap((endpoint) => endpoint.requiredIntents))]
      const environmentAvailable = endpoints.some((endpoint) =>
        endpoint.environments.includes(options.env)
      )
      const missing = requiredIntents.filter(
        (name) => (options.intents & (QQ_INTENT_BITS[name] ?? 0)) === 0
      )
      const available = environmentAvailable && missing.length === 0
      const reason = !environmentAvailable
        ? `当前环境 ${options.env} 不支持该能力`
        : missing.length > 0
          ? `缺少 intents：${missing.join('、')}`
          : undefined

      const info: QQCapabilityInfo = {
        id,
        module: endpoints[0]?.module ?? 'unknown',
        available,
        requiredIntents,
        endpointCount: endpoints.length
      }
      if (reason) info.reason = reason
      return info
    })
  }

  list(): QQCapabilityInfo[] {
    return this.entries.map((entry) => ({
      ...entry,
      requiredIntents: [...entry.requiredIntents]
    }))
  }

  has(id: string): boolean {
    return this.entries.find((entry) => entry.id === id)?.available ?? false
  }

  assert(id: string): void {
    const entry = this.entries.find((item) => item.id === id)
    if (!entry) throw new QQApiError('CAPABILITY_UNAVAILABLE', `能力未收录：${id}`)
    if (!entry.available) {
      throw new QQApiError(
        'CAPABILITY_UNAVAILABLE',
        `能力不可用：${id}（${entry.reason ?? '未知原因'}）`
      )
    }
  }
}
