import type { InstanceEnv, QQIntentName } from '@arqqbot/shared'

export interface QQEventSpec {
  type: string
  intent: QQIntentName
  environments: InstanceEnv[]
}

const EVENT_SEEDS: Array<[string, QQIntentName]> = [
  ['INTERACTION_CREATE', 'interaction'],
  ['SUBSCRIBE_MESSAGE_STATUS', 'interaction'],
  ['FRIEND_ADD', 'public_messages'],
  ['FRIEND_DEL', 'public_messages'],
  ['C2C_MESSAGE_CREATE', 'public_messages'],
  ['C2C_MSG_RECEIVE', 'public_messages'],
  ['C2C_MSG_REJECT', 'public_messages'],
  ['GROUP_ADD_ROBOT', 'public_messages'],
  ['GROUP_DEL_ROBOT', 'public_messages'],
  ['GROUP_JOIN_REQUEST', 'public_messages'],
  ['GROUP_MSG_RECEIVE', 'public_messages'],
  ['GROUP_MSG_REJECT', 'public_messages'],
  ['GROUP_AT_MESSAGE_CREATE', 'public_messages'],
  ['GROUP_MESSAGE_CREATE', 'public_messages'],
  ['GROUP_MEMBER_ADD', 'public_messages'],
  ['GROUP_MEMBER_REMOVE', 'public_messages'],
  ['GUILD_CREATE', 'guilds'],
  ['GUILD_UPDATE', 'guilds'],
  ['GUILD_DELETE', 'guilds'],
  ['CHANNEL_CREATE', 'guilds'],
  ['CHANNEL_UPDATE', 'guilds'],
  ['CHANNEL_DELETE', 'guilds']
]

export const QQ_EVENTS: QQEventSpec[] = EVENT_SEEDS.map(([type, intent]) => ({
  type,
  intent,
  environments: ['sandbox', 'production']
}))
