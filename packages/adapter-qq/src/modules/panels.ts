import type { QQPanel, QQPanelInput, QQPanelTarget } from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'

export interface QQPanelModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

function asPanels(input: unknown): QQPanel[] {
  if (Array.isArray(input)) return input as QQPanel[]
  if (input && typeof input === 'object') {
    const value = (input as Record<string, unknown>).panels
    if (Array.isArray(value)) return value as QQPanel[]
  }
  return []
}

export class QQPanelModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQPanelModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async list(): Promise<QQPanel[]> {
    this.capabilities?.assert('panels.list')
    const result = await this.http.request<unknown>(findEndpoint('panels.list'))
    return asPanels(result)
  }

  async create(input: QQPanelInput): Promise<QQPanel> {
    this.capabilities?.assert('panels.create')
    return this.http.request<QQPanel>(findEndpoint('panels.create'), { body: input })
  }

  async get(id: string): Promise<QQPanel> {
    this.capabilities?.assert('panels.get')
    return this.http.request<QQPanel>(findEndpoint('panels.get'), {
      pathParams: { panel_id: id }
    })
  }

  async update(id: string, input: Partial<QQPanelInput>): Promise<QQPanel> {
    this.capabilities?.assert('panels.update')
    return this.http.request<QQPanel>(findEndpoint('panels.update'), {
      pathParams: { panel_id: id },
      body: input
    })
  }

  async delete(id: string): Promise<void> {
    this.capabilities?.assert('panels.delete')
    await this.http.request<unknown>(findEndpoint('panels.delete'), {
      pathParams: { panel_id: id }
    })
  }

  async updateTarget(id: string, target: QQPanelTarget): Promise<void> {
    this.capabilities?.assert('panels.target')
    await this.http.request<unknown>(findEndpoint('panels.target'), {
      pathParams: { panel_id: id },
      body: target
    })
  }
}
