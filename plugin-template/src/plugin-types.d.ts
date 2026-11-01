export interface QQMessage {
  id: string
  scene: 'c2c' | 'group' | 'guild' | 'dm'
  userId: string
  groupId?: string
  guildId?: string
  channelId?: string
  content: string
}

export interface QQSendInput {
  scene: 'c2c' | 'group'
  targetId: string
  content: string
  msgId?: string
}

export interface QQSendResult {
  messageId?: string
}

export interface QQService {
  send(input: QQSendInput): Promise<QQSendResult>
}

declare module 'cordis' {
  interface Context {
    qq: QQService
  }

  interface Events {
    'qq/message': (message: QQMessage) => void
  }
}
