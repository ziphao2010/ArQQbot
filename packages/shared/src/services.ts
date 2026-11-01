import type {} from 'cordis'
import type { QQMessage, QQSendInput, QQSendResult, QQStats } from './types'
import type {
  QQBlacklistEntry,
  QQBlacklistUpdate,
  QQBotInfo,
  QQCapabilityRegistry,
  QQChannel,
  QQChannelInput,
  QQChannelPayload,
  QQChunkedUploadInput,
  QQFriendPayload,
  QQGuild,
  QQGuildPayload,
  QQGroupBotState,
  QQGroupInfo,
  QQGroupJoinRequestPayload,
  QQGroupLifecyclePayload,
  QQGroupMember,
  QQGroupMemberPayload,
  QQGroupMembers,
  QQInteractionPayload,
  QQInteractionResponse,
  QQJoinRequestList,
  QQJoinStrategy,
  QQMediaUploadInput,
  QQMenu,
  QQMessageAuditPayload,
  QQMessageContent,
  QQMuteInput,
  QQMuteSetting,
  QQPageQuery,
  QQPanel,
  QQPanelInput,
  QQPanelTarget,
  QQUploadFinishInput,
  QQUploadPrepareInput,
  QQUploadSession,
  QQUploadedMedia,
  QQRawRequest,
  QQSendMessageInput,
  QQStreamHandle,
  QQStreamInput,
  QQSubscribeStatusPayload,
  QQUrlLinkInput
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
  group: {
    info(groupOpenid: string): Promise<QQGroupInfo>
    botState(groupOpenid: string): Promise<QQGroupBotState>
    members(groupOpenid: string, query?: QQPageQuery): Promise<QQGroupMembers>
    member(groupOpenid: string, memberOpenid: string): Promise<QQGroupMember>
    removeMembers(groupOpenid: string, memberOpenids: string[]): Promise<void>
    joinRequests(groupOpenid: string, query?: QQPageQuery): Promise<QQJoinRequestList>
    approveJoinRequest(groupOpenid: string, memberOpenid: string, approve: boolean): Promise<void>
    createJoinStrategy(input: QQJoinStrategy): Promise<QQJoinStrategy>
    updateJoinStrategy(id: string, input: Partial<QQJoinStrategy>): Promise<QQJoinStrategy>
    executeJoinStrategy(id: string): Promise<void>
    setJoinStrategyWhitelist(id: string, userIds: string[]): Promise<void>
    listJoinStrategies(): Promise<QQJoinStrategy[]>
    deleteJoinStrategy(id: string): Promise<void>
    blacklist(groupOpenid: string): Promise<QQBlacklistEntry[]>
    updateBlacklist(groupOpenid: string, input: QQBlacklistUpdate): Promise<void>
    muteSetting(groupOpenid: string): Promise<QQMuteSetting>
    setMute(groupOpenid: string, input: QQMuteInput): Promise<void>
  }
  guild: {
    get(guildId: string): Promise<QQGuild>
    channels(guildId: string): Promise<QQChannel[]>
    channel(channelId: string): Promise<QQChannel>
    createChannel(guildId: string, input: QQChannelInput): Promise<QQChannel>
    updateChannel(channelId: string, input: Partial<QQChannelInput>): Promise<QQChannel>
    deleteChannel(channelId: string): Promise<void>
  }
  interaction: {
    respond(interactionId: string, payload: QQInteractionResponse): Promise<void>
  }
  menu: {
    get(): Promise<QQMenu>
    set(menu: QQMenu): Promise<void>
  }
  panels: {
    list(): Promise<QQPanel[]>
    create(input: QQPanelInput): Promise<QQPanel>
    get(id: string): Promise<QQPanel>
    update(id: string, input: Partial<QQPanelInput>): Promise<QQPanel>
    delete(id: string): Promise<void>
    updateTarget(id: string, target: QQPanelTarget): Promise<void>
  }
  bot: {
    me(): Promise<QQBotInfo>
    guilds(): Promise<QQGuild[]>
    gateway(): Promise<string>
    generateUrlLink(input: QQUrlLinkInput): Promise<string>
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
