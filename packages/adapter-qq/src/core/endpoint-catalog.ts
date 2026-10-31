import type { InstanceEnv, QQHttpMethod, QQIntentName } from '@arqqbot/shared'
import { QQApiError } from './errors'

export type QQModuleName =
  | 'message'
  | 'media'
  | 'menu'
  | 'panels'
  | 'interaction'
  | 'guild'
  | 'bot'
  | 'group'

export interface QQEndpointSpec {
  id: string
  method: QQHttpMethod
  path: string
  module: QQModuleName
  category: string
  capability: string
  environments: InstanceEnv[]
  requiredIntents: QQIntentName[]
  idempotent: boolean
  docsUrl: string
}

function docsSlug(path: string): string {
  return path
    .replace(/^\//, '')
    .replace(/[{}]/g, '')
    .replace(/@/g, '')
    .replace(/\//g, '_')
}

export function docsUrlFor(method: QQHttpMethod, path: string): string {
  return `https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/${docsSlug(path)}.${method.toLowerCase()}.html`
}

interface EndpointSeed {
  id: string
  method: QQHttpMethod
  path: string
  module: QQModuleName
  capability: string
  requiredIntents: QQIntentName[]
}

const ENDPOINT_SEEDS: EndpointSeed[] = [
  { id: 'c2c.message.send', method: 'POST', path: '/v2/users/{user_openid}/messages', module: 'message', capability: 'message.send', requiredIntents: [] },
  { id: 'c2c.message.recall', method: 'DELETE', path: '/v2/users/{user_openid}/messages/{message_id}', module: 'message', capability: 'message.recall', requiredIntents: [] },
  { id: 'c2c.message.stream', method: 'POST', path: '/v2/users/{user_openid}/stream_messages', module: 'message', capability: 'message.stream', requiredIntents: [] },
  { id: 'group.message.send', method: 'POST', path: '/v2/groups/{group_openid}/messages', module: 'message', capability: 'message.send', requiredIntents: [] },
  { id: 'group.message.recall', method: 'DELETE', path: '/v2/groups/{group_openid}/messages/{message_id}', module: 'message', capability: 'message.recall', requiredIntents: [] },
  { id: 'c2c.media.upload', method: 'POST', path: '/v2/users/{user_openid}/files', module: 'media', capability: 'media.upload', requiredIntents: ['public_messages'] },
  { id: 'group.media.upload', method: 'POST', path: '/v2/groups/{group_openid}/files', module: 'media', capability: 'media.upload', requiredIntents: ['public_messages'] },
  { id: 'c2c.media.prepare', method: 'POST', path: '/v2/users/{user_id}/upload_prepare', module: 'media', capability: 'media.prepareUpload', requiredIntents: ['public_messages'] },
  { id: 'group.media.prepare', method: 'POST', path: '/v2/groups/{group_id}/upload_prepare', module: 'media', capability: 'media.prepareUpload', requiredIntents: ['public_messages'] },
  { id: 'c2c.media.partFinish', method: 'POST', path: '/v2/users/{user_id}/upload_part_finish', module: 'media', capability: 'media.uploadPart', requiredIntents: ['public_messages'] },
  { id: 'group.media.partFinish', method: 'POST', path: '/v2/groups/{group_id}/upload_part_finish', module: 'media', capability: 'media.uploadPart', requiredIntents: ['public_messages'] },
  { id: 'menu.get', method: 'GET', path: '/v2/menu', module: 'menu', capability: 'menu.get', requiredIntents: [] },
  { id: 'menu.set', method: 'PUT', path: '/v2/menu', module: 'menu', capability: 'menu.set', requiredIntents: [] },
  { id: 'panels.list', method: 'GET', path: '/v2/panels', module: 'panels', capability: 'panels.list', requiredIntents: [] },
  { id: 'panels.create', method: 'POST', path: '/v2/panels', module: 'panels', capability: 'panels.create', requiredIntents: [] },
  { id: 'panels.get', method: 'GET', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.get', requiredIntents: [] },
  { id: 'panels.update', method: 'PUT', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.update', requiredIntents: [] },
  { id: 'panels.delete', method: 'DELETE', path: '/v2/panels/{panel_id}', module: 'panels', capability: 'panels.delete', requiredIntents: [] },
  { id: 'panels.target', method: 'PUT', path: '/v2/panels/{panel_id}/target', module: 'panels', capability: 'panels.target', requiredIntents: [] },
  { id: 'interaction.respond', method: 'PUT', path: '/interactions/{interaction_id}', module: 'interaction', capability: 'interaction.respond', requiredIntents: ['interaction'] },
  { id: 'guild.get', method: 'GET', path: '/guilds/{guild_id}', module: 'guild', capability: 'guild.get', requiredIntents: ['guilds'] },
  { id: 'guild.channels.list', method: 'GET', path: '/guilds/{guild_id}/channels', module: 'guild', capability: 'guild.channels.list', requiredIntents: ['guilds'] },
  { id: 'guild.channels.create', method: 'POST', path: '/guilds/{guild_id}/channels', module: 'guild', capability: 'guild.channels.create', requiredIntents: ['guilds'] },
  { id: 'guild.channel.get', method: 'GET', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.get', requiredIntents: ['guilds'] },
  { id: 'guild.channel.update', method: 'PATCH', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.update', requiredIntents: ['guilds'] },
  { id: 'guild.channel.delete', method: 'DELETE', path: '/channels/{channel_id}', module: 'guild', capability: 'guild.channel.delete', requiredIntents: ['guilds'] },
  { id: 'bot.me', method: 'GET', path: '/users/@me', module: 'bot', capability: 'bot.me', requiredIntents: [] },
  { id: 'bot.guilds', method: 'GET', path: '/users/@me/guilds', module: 'bot', capability: 'bot.guilds', requiredIntents: ['guilds'] },
  { id: 'bot.gateway', method: 'GET', path: '/gateway', module: 'bot', capability: 'bot.gateway', requiredIntents: [] },
  { id: 'bot.urlLink', method: 'POST', path: '/v2/generate_url_link', module: 'bot', capability: 'bot.urlLink', requiredIntents: [] },
  { id: 'group.info', method: 'GET', path: '/v2/groups/{group_openid}/info', module: 'group', capability: 'group.info', requiredIntents: ['public_messages'] },
  { id: 'group.botState', method: 'GET', path: '/v2/groups/{group_openid}/bot_state', module: 'group', capability: 'group.botState', requiredIntents: ['public_messages'] },
  { id: 'group.members.list', method: 'GET', path: '/v2/groups/{group_openid}/members', module: 'group', capability: 'group.members.list', requiredIntents: ['public_messages'] },
  { id: 'group.members.get', method: 'GET', path: '/v2/groups/{group_openid}/members/{member_openid}', module: 'group', capability: 'group.members.get', requiredIntents: ['public_messages'] },
  { id: 'group.members.remove', method: 'POST', path: '/v2/groups/{group_openid}/batch_remove_members', module: 'group', capability: 'group.members.remove', requiredIntents: ['public_messages'] },
  { id: 'group.joinRequests.list', method: 'GET', path: '/v2/groups/{group_openid}/join_request_list', module: 'group', capability: 'group.joinRequests.list', requiredIntents: ['public_messages'] },
  { id: 'group.joinRequests.approve', method: 'POST', path: '/v2/groups/{group_openid}/approval_join_request/{member_openid}', module: 'group', capability: 'group.joinRequests.approve', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.list', method: 'GET', path: '/v2/groups/join_approval_strategy', module: 'group', capability: 'group.joinStrategies.list', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.create', method: 'POST', path: '/v2/groups/join_approval_strategy', module: 'group', capability: 'group.joinStrategies.create', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.update', method: 'PATCH', path: '/v2/groups/join_approval_strategy/{strategy_id}', module: 'group', capability: 'group.joinStrategies.update', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.delete', method: 'DELETE', path: '/v2/groups/join_approval_strategy/{strategy_id}', module: 'group', capability: 'group.joinStrategies.delete', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.execute', method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/execute', module: 'group', capability: 'group.joinStrategies.execute', requiredIntents: ['public_messages'] },
  { id: 'group.joinStrategies.whitelist', method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users', module: 'group', capability: 'group.joinStrategies.whitelist', requiredIntents: ['public_messages'] },
  { id: 'group.blacklist.list', method: 'GET', path: '/v2/groups/{group_openid}/member_blacklist', module: 'group', capability: 'group.blacklist.list', requiredIntents: ['public_messages'] },
  { id: 'group.blacklist.update', method: 'POST', path: '/v2/groups/{group_openid}/member_blacklist', module: 'group', capability: 'group.blacklist.update', requiredIntents: ['public_messages'] },
  { id: 'group.mute.get', method: 'GET', path: '/v2/groups/{group_openid}/restrict_chat_setting', module: 'group', capability: 'group.mute.get', requiredIntents: ['public_messages'] },
  { id: 'group.mute.set', method: 'POST', path: '/v2/groups/{group_openid}/restrict_chat_setting', module: 'group', capability: 'group.mute.set', requiredIntents: ['public_messages'] }
]

export const QQ_ENDPOINTS: QQEndpointSpec[] = ENDPOINT_SEEDS.map((seed) => ({
  ...seed,
  category: seed.module,
  environments: ['sandbox', 'production'] satisfies InstanceEnv[],
  idempotent: seed.method === 'GET',
  docsUrl: docsUrlFor(seed.method, seed.path)
}))

const ENDPOINTS_BY_ID = new Map(QQ_ENDPOINTS.map((endpoint) => [endpoint.id, endpoint]))

export function findEndpoint(id: string): QQEndpointSpec {
  const endpoint = ENDPOINTS_BY_ID.get(id)
  if (!endpoint) throw new QQApiError('CAPABILITY_UNAVAILABLE', `端点未收录：${id}`)
  return endpoint
}

export function listEndpoints(module?: QQModuleName): QQEndpointSpec[] {
  return module ? QQ_ENDPOINTS.filter((endpoint) => endpoint.module === module) : QQ_ENDPOINTS
}

export function buildPath(
  pattern: string,
  params: Record<string, string | number> = {}
): string {
  return pattern.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new QQApiError('BAD_REQUEST', `缺少路径参数：${name}`)
    }
    return encodeURIComponent(String(value))
  })
}
