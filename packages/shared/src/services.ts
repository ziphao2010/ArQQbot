import type {} from 'cordis'
import type { QQMessage, QQSendInput, QQSendResult, QQStats } from './types'
import type {
  QQCapabilityRegistry,
  QQChannelPayload,
  QQChunkedUploadInput,
  QQFriendPayload,
  QQGuildPayload,
  QQGroupJoinRequestPayload,
  QQGroupLifecyclePayload,
  QQGroupMemberPayload,
  QQInteractionPayload,
  QQMediaUploadInput,
  QQMessageAuditPayload,
  QQMessageContent,
  QQUploadFinishInput,
  QQUploadPrepareInput,
  QQUploadSession,
  QQUploadedMedia,
  QQRawRequest,
  QQSendMessageInput,
  QQStreamHandle,
  QQStreamInput,
  QQSubscribeStatusPayload
} from './qq'

export interface QQService {
  send(input: QQSendInput): Promise<QQSendResult>
  message: {
    send(input: QQSendMessageInput): Promise<QQSendResult>
    reply(source: QQMessage, content: QQMessageContent): Promise<QQSendResult>
    sendStream(input: QQStreamInput): Promise<QQStreamHandle>
    recall(scene: 'c2c' | 'group', targetId: string, messageId: string): Promise<void>
  }
  media: {
    upload(input: QQMediaUploadInput): Promise<QQUploadedMedia>
    uploadChunked(input: QQChunkedUploadInput): Promise<QQUploadedMedia>
    prepareUpload(input: QQUploadPrepareInput): Promise<QQUploadSession>
    finishUpload(input: QQUploadFinishInput): Promise<QQUploadedMedia>
  }
  request<T>(input: QQRawRequest): Promise<T>
  capabilities: QQCapabilityRegistry
  getStats(): QQStats
}

export interface StorageServiceContract {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

declare module 'cordis' {
  interface Events {
    'qq/message': (message: QQMessage) => void
    'qq/group-message': (message: QQMessage) => void
    'qq/guild-message': (message: QQMessage) => void
    'qq/dm-message': (message: QQMessage) => void
    'qq/raw-event': (event: { type: string; data: unknown }) => void
    'qq/group-add': (event: QQGroupLifecyclePayload) => void
    'qq/group-del': (event: QQGroupLifecyclePayload) => void
    'qq/group-join-request': (event: QQGroupJoinRequestPayload) => void
    'qq/group-member-add': (event: QQGroupMemberPayload) => void
    'qq/group-member-remove': (event: QQGroupMemberPayload) => void
    'qq/group-msg-receive': (event: QQMessageAuditPayload) => void
    'qq/group-msg-reject': (event: QQMessageAuditPayload) => void
    'qq/friend-add': (event: QQFriendPayload) => void
    'qq/friend-del': (event: QQFriendPayload) => void
    'qq/c2c-msg-receive': (event: QQMessageAuditPayload) => void
    'qq/c2c-msg-reject': (event: QQMessageAuditPayload) => void
    'qq/interaction': (event: QQInteractionPayload) => void
    'qq/subscribe-status': (event: QQSubscribeStatusPayload) => void
    'qq/guild-create': (event: QQGuildPayload) => void
    'qq/guild-update': (event: QQGuildPayload) => void
    'qq/guild-delete': (event: QQGuildPayload) => void
    'qq/channel-create': (event: QQChannelPayload) => void
    'qq/channel-update': (event: QQChannelPayload) => void
    'qq/channel-delete': (event: QQChannelPayload) => void
    'qq/ready': () => void
    'qq/error': (error: Error) => void
    'qq/disconnect': () => void
  }

  interface Context {
    qq: QQService
    storage: StorageServiceContract
  }
}
