import type { QQMenu } from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'

export interface QQMenuModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

export class QQMenuModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQMenuModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async get(): Promise<QQMenu> {
    this.capabilities?.assert('menu.get')
    return this.http.request<QQMenu>(findEndpoint('menu.get'))
  }

  async set(menu: QQMenu): Promise<void> {
    this.capabilities?.assert('menu.set')
    await this.http.request<unknown>(findEndpoint('menu.set'), { body: menu })
  }
}
