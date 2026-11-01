import type { QQInteractionResponse } from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'

export interface QQInteractionModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

export class QQInteractionModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQInteractionModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async respond(interactionId: string, payload: QQInteractionResponse): Promise<void> {
    this.capabilities?.assert('interaction.respond')
    await this.http.request<unknown>(findEndpoint('interaction.respond'), {
      pathParams: { interaction_id: interactionId },
      body: payload
    })
  }
}
