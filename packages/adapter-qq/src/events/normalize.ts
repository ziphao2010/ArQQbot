import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'

type Data = Record<string, any>

export interface QQNormalizedEvent {
  type: string
  event: QQDomainEventName
  payload: Record<string, unknown>
  message?: QQMessage
  raw: unknown
}

function normalizeAttachments(input: unknown): QQMessage['attachments'] {
  if (!Array.isArray(input)) return []
  return input.map((item) => {
    const attachment = item as Record<string, unknown>
    const result: QQMessage['attachments'][number] = {
      contentType: String(attachment.content_type ?? ''),
      url: String(attachment.url ?? '')
    }
    if (attachment.filename !== undefined) result.filename = String(attachment.filename)
    if (attachment.size !== undefined) result.size = Number(attachment.size)
    return result
  })
}

function messageEvent(
  type: string,
  data: Data
): { event: QQDomainEventName; message: QQMessage } | null {
  let scene: QQMessage['scene'] | undefined
  let event: QQDomainEventName | undefined

  if (type === 'GROUP_AT_MESSAGE_CREATE') {
    scene = 'group'
    event = 'qq/message'
  } else if (type === 'GROUP_MESSAGE_CREATE') {
    scene = 'group'
    event = 'qq/group-message'
  } else if (type === 'C2C_MESSAGE_CREATE') {
    scene = 'c2c'
    event = 'qq/message'
  } else if (type === 'AT_MESSAGE_CREATE' || type === 'MESSAGE_CREATE') {
    scene = 'guild'
    event = 'qq/guild-message'
  } else if (type === 'DIRECT_MESSAGE_CREATE') {
    scene = 'dm'
    event = 'qq/dm-message'
  }

  if (!scene || !event) return null

  const userId =
    scene === 'group'
      ? String(data.author?.member_openid ?? '')
      : scene === 'c2c'
        ? String(data.author?.user_openid ?? '')
        : String(data.author?.id ?? '')

  const groupId = scene === 'group' ? String(data.group_openid ?? '') : ''
  const guildId =
    scene === 'guild' || scene === 'dm' ? String(data.guild_id ?? '') : ''
  const channelId =
    scene === 'guild' || scene === 'dm' ? String(data.channel_id ?? '') : ''
  const authorName = data.author?.username ?? data.author?.name

  const message: QQMessage = {
    id: String(data.id ?? ''),
    scene,
    userId,
    content: String(data.content ?? '').trim(),
    mentions: [],
    attachments: normalizeAttachments(data.attachments),
    timestamp: String(data.timestamp ?? ''),
    raw: data
  }
  if (groupId) message.groupId = groupId
  if (guildId) message.guildId = guildId
  if (channelId) message.channelId = channelId
  message.author = {
    id: userId,
    ...(authorName !== undefined ? { name: String(authorName) } : {}),
    ...(data.author?.bot !== undefined ? { bot: Boolean(data.author.bot) } : {})
  }

  return { event, message }
}

const DOMAIN_EVENTS: Record<
  string,
  { event: QQDomainEventName; payload: (data: Data) => Record<string, unknown> }
> = {
  INTERACTION_CREATE: {
    event: 'qq/interaction',
    payload: (data) => ({ ...data, interactionId: String(data.id ?? '') })
  },
  SUBSCRIBE_MESSAGE_STATUS: {
    event: 'qq/subscribe-status',
    payload: (data) => ({ ...data })
  },
  FRIEND_ADD: {
    event: 'qq/friend-add',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? data.id ?? '')
    })
  },
  FRIEND_DEL: {
    event: 'qq/friend-del',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? data.id ?? '')
    })
  },
  C2C_MSG_RECEIVE: {
    event: 'qq/c2c-msg-receive',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? '')
    })
  },
  C2C_MSG_REJECT: {
    event: 'qq/c2c-msg-reject',
    payload: (data) => ({
      ...data,
      userId: String(data.openid ?? data.user_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? '')
    })
  },
  GROUP_ADD_ROBOT: {
    event: 'qq/group-add',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      operatorOpenid: String(data.op_member_openid ?? '')
    })
  },
  GROUP_DEL_ROBOT: {
    event: 'qq/group-del',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      operatorOpenid: String(data.op_member_openid ?? '')
    })
  },
  GROUP_JOIN_REQUEST: {
    event: 'qq/group-join-request',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GROUP_MSG_RECEIVE: {
    event: 'qq/group-msg-receive',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? ''),
      memberOpenid: String(data.member_openid ?? '')
    })
  },
  GROUP_MSG_REJECT: {
    event: 'qq/group-msg-reject',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      messageId: String(data.message_id ?? data.id ?? ''),
      memberOpenid: String(data.member_openid ?? '')
    })
  },
  GROUP_MEMBER_ADD: {
    event: 'qq/group-member-add',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GROUP_MEMBER_REMOVE: {
    event: 'qq/group-member-remove',
    payload: (data) => ({
      ...data,
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? data.user_openid ?? '')
    })
  },
  GUILD_CREATE: {
    event: 'qq/guild-create',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  GUILD_UPDATE: {
    event: 'qq/guild-update',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  GUILD_DELETE: {
    event: 'qq/guild-delete',
    payload: (data) => ({ ...data, guildId: String(data.id ?? '') })
  },
  CHANNEL_CREATE: {
    event: 'qq/channel-create',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  },
  CHANNEL_UPDATE: {
    event: 'qq/channel-update',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  },
  CHANNEL_DELETE: {
    event: 'qq/channel-delete',
    payload: (data) => ({
      ...data,
      guildId: String(data.guild_id ?? ''),
      channelId: String(data.id ?? '')
    })
  }
}

export function normalizeEvent(type: string, data: Data): QQNormalizedEvent | null {
  const messageResult = messageEvent(type, data)
  if (messageResult) {
    return {
      type,
      event: messageResult.event,
      payload: {},
      message: messageResult.message,
      raw: data
    }
  }

  const domain = DOMAIN_EVENTS[type]
  if (!domain) return null

  return {
    type,
    event: domain.event,
    payload: domain.payload(data),
    raw: data
  }
}
