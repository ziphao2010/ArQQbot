import type { QQScene, QQSendResult } from './types'

export type { QQSendResult }

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

export type QQIntentName =
  | 'public_messages'
  | 'interaction'
  | 'guilds'
  | 'guild_members'
  | 'guild_messages'
  | 'direct_message'

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
