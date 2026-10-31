import type { Context } from 'cordis'
import type { QQMessage } from '@arqqbot/shared'

declare module 'cordis' {
  interface Events {
    'qq/message': (message: QQMessage) => void
  }
}

export interface Config {
  prefix: string
}

export const name = 'echo'
export const inject = ['qq']

export function apply(ctx: Context, config: Config): void {
  ctx.on('qq/message', async (message: QQMessage) => {
    const targetId = message.scene === 'group' ? message.groupId : message.userId
    if (!targetId) return

    try {
      await ctx.qq.send({
        scene: message.scene,
        targetId,
        content: `${config.prefix}${message.content}`,
        msgId: message.id
      })
    } catch (error) {
      ctx.logger.warn('echo 插件发送失败', error, 'echo')
    }
  })
}
