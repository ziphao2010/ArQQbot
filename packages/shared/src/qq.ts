import type { QQIntentName, QQScene, QQSendResult } from './types'

export type { QQIntentName, QQSendResult }

export const QQ_INTENT_NAMES = [
  'public_messages',
  'interaction',
  'guilds',
  'guild_members',
  'guild_messages',
  'direct_message'
] as const satisfies readonly QQIntentName[]

export const QQ_DEFAULT_INTENTS: QQIntentName[] = ['public_messages']

export type QQHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QQApiErrorCode =
  | 'UNAUTHORIZED'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'

export type QQDomainEventName =
  | 'qq/raw-event'
  | 'qq/message'
  | 'qq/group-message'
  | 'qq/guild-message'
  | 'qq/dm-message'
  | 'qq/group-add'
  | 'qq/group-del'
  | 'qq/group-join-request'
  | 'qq/group-member-add'
  | 'qq/group-member-remove'
  | 'qq/group-msg-receive'
  | 'qq/group-msg-reject'
  | 'qq/friend-add'
  | 'qq/friend-del'
  | 'qq/c2c-msg-receive'
  | 'qq/c2c-msg-reject'
  | 'qq/interaction'
  | 'qq/subscribe-status'
  | 'qq/guild-create'
  | 'qq/guild-update'
  | 'qq/guild-delete'
  | 'qq/channel-create'
  | 'qq/channel-update'
  | 'qq/channel-delete'
  | 'qq/ready'
  | 'qq/error'
  | 'qq/disconnect'

export type QQSendTarget =
  | { scene: 'c2c'; userId: string }
  | { scene: 'group'; groupId: string }

export interface QQMarkdown {
  content: string
  [key: string]: unknown
}

export type QQKeyboard = Record<string, unknown>
export type QQArk = Record<string, unknown>
export type QQEmbed = Record<string, unknown>

export type QQMessageContent =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: QQMarkdown; keyboard?: QQKeyboard }
  | { type: 'ark'; ark: QQArk }
  | { type: 'embed'; embed: QQEmbed }
  | { type: 'media'; fileInfo: string }

export interface QQSendMessageInput {
  target: QQSendTarget
  content: QQMessageContent
  replyTo?: string
  eventId?: string
  msgSeq?: number
}

export interface QQStreamInput {
  target: QQSendTarget
  replyTo?: string
  eventId?: string
  msgSeq?: number
}

export interface QQStreamHandle {
  write(chunk: string): Promise<void>
  end(): Promise<void>
}

export type QQMediaFileType = 1 | 2 | 3 | 4

export interface QQMediaUploadInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  url: string
  fileData?: string
}

export interface QQUploadedMedia {
  fileInfo: string
  fileUuid?: string
  ttl?: number
}

export interface QQUploadPrepareInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  fileName: string
  fileSize: number
  md5: string
  sha1: string
  md5_10m: string
}

export interface QQUploadPartSpec {
  index: number
  presignedUrl: string
  blockSize: number
}

export interface QQUploadSession {
  uploadId: string
  blockSize: number
  parts: QQUploadPartSpec[]
  raw: unknown
}

export interface QQUploadFinishInput {
  scene: 'c2c' | 'group'
  targetId: string
  fileType: QQMediaFileType
  uploadId: string
}

export interface QQChunkedUploadInput extends QQUploadPrepareInput {
  chunks: Array<{ data: Uint8Array; md5: string }>
}

export interface QQRawRequest {
  method: QQHttpMethod
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface QQCapabilityInfo {
  id: string
  module: string
  available: boolean
  requiredIntents: string[]
  endpointCount: number
  reason?: string
}

export interface QQCapabilityRegistry {
  list(): QQCapabilityInfo[]
  has(id: string): boolean
}

export interface QQCapabilitySnapshot {
  instanceId: string
  intents: QQIntentName[]
  capabilities: QQCapabilityInfo[]
  running: boolean
  reason?: string
}

export interface QQGroupLifecyclePayload {
  groupOpenid: string
  [key: string]: unknown
}

export interface QQGroupMemberPayload {
  groupOpenid: string
  memberOpenid: string
  [key: string]: unknown
}

export interface QQGroupJoinRequestPayload {
  groupOpenid: string
  memberOpenid?: string
  [key: string]: unknown
}

export interface QQMessageAuditPayload {
  groupOpenid?: string
  userId?: string
  messageId?: string
  [key: string]: unknown
}

export interface QQFriendPayload {
  userId: string
  [key: string]: unknown
}

export interface QQInteractionPayload {
  interactionId: string
  [key: string]: unknown
}

export type QQSubscribeStatusPayload = Record<string, unknown>

export interface QQGuildPayload {
  guildId: string
  [key: string]: unknown
}

export interface QQChannelPayload {
  guildId: string
  channelId: string
  [key: string]: unknown
}

export type QQMessageScene = QQScene

export interface QQPageQuery {
  cursor?: string
  limit?: number
  [key: string]: string | number | boolean | undefined
}

export type QQGroupInfo = Record<string, unknown>
export type QQGroupBotState = Record<string, unknown>
export type QQMuteSetting = Record<string, unknown>

export interface QQGroupMember {
  member_openid: string
  username?: string
  member_role?: string
  bot?: boolean
  joined_at?: string
  union_openid?: string
  [key: string]: unknown
}

export interface QQGroupMembers {
  members: QQGroupMember[]
  next_cursor?: string
  [key: string]: unknown
}

export interface QQJoinRequest {
  join_request_id?: string
  risk_tips?: string
  union_openid?: string
  member_openid?: string
  username?: string
  apply_at?: string
  apply_source?: string
  invited_by?: string
  bot?: boolean
  verify_info?: Record<string, unknown>
  [key: string]: unknown
}

export interface QQJoinRequestList {
  list: QQJoinRequest[]
  next_cursor?: string
  [key: string]: unknown
}

export interface QQJoinStrategy {
  strategy_id?: string
  is_enable?: string
  expire_at?: string
  remark?: string
  group_openids?: string[]
  group_ids?: number[]
  [key: string]: unknown
}

export type QQBlacklistEntry = Record<string, unknown>

export interface QQBlacklistUpdate {
  op: 'add' | 'del'
  member_openids: string[]
  [key: string]: unknown
}

export interface QQMuteMember {
  op: string
  member_openid: string
  mute_expire_at?: string
  [key: string]: unknown
}

export interface QQMuteInput {
  members: QQMuteMember[]
  [key: string]: unknown
}

export type QQGuild = Record<string, unknown>

export interface QQChannel {
  id?: string
  guild_id?: string
  name?: string
  type?: number
  [key: string]: unknown
}

export interface QQChannelInput {
  name: string
  type: number
  [key: string]: unknown
}

export type QQMenu = Record<string, unknown>
export type QQPanel = Record<string, unknown>
export type QQPanelInput = Record<string, unknown>

export interface QQPanelTarget {
  op: 'add' | 'del'
  user_openids?: string[]
  group_openids?: string[]
  [key: string]: unknown
}

export interface QQInteractionResponse {
  code?: number
  [key: string]: unknown
}

export type QQBotInfo = Record<string, unknown>

export interface QQUrlLinkInput {
  callback_data?: string
  [key: string]: unknown
}
