import type { Context } from 'cordis'
import type { QQMessage } from '@arqqbot/shared'

export interface Config {
  prefix: string
}

export const name = 'echo'
export const inject = ['qq']

export function apply(ctx: Context, config: Config): void {
  ctx.on('qq/message', async (message: QQMessage) => {
    if (message.scene !== 'group' && message.scene !== 'c2c') return
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
      ctx.logger('echo').warn('echo 插件发送失败', error)
    }
  })
}
