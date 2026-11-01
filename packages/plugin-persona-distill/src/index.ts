import type { Context } from 'cordis'
import {
  PersonaEngine,
  PersonaStore,
  clipText,
  type Immersion,
  type PersonaBundle,
  type PersonaDatabase,
  type PersonaProfile
} from '@arqqbot/persona-core'
import { LlmClient } from './llm'

export interface Config {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  commandPrefix: string
  ownerName: string
  immersion: Immersion
  maxReplyLength: number
  maxRecentMessages: number
  memoryEnabled: boolean
  memoryEveryTurns: number
  retrievalTopK: number
  contextBudgetChars: number
}

export interface QQMessageLike {
  id: string
  scene: 'c2c' | 'group' | 'guild' | 'dm'
  userId: string
  groupId?: string
  content: string
  author?: { name?: string }
}

interface QQSendInputLike {
  scene: 'c2c' | 'group'
  targetId: string
  content: string
  msgId?: string
}

declare module 'cordis' {
  interface Context {
    qq: {
      send(input: QQSendInputLike): Promise<unknown>
    }
    storage: {
      get<T>(key: string): Promise<T | undefined>
      set(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<void>
    }
  }

  interface Events {
    'qq/message': (message: QQMessageLike) => void
  }
}

export const name = 'persona-distill'
export const inject = ['qq', 'storage']

const DB_KEY = 'persona:db'
const MAX_MATERIAL_CHARS = 20000
const MIN_MATERIAL_CHARS = 30
const MAX_SEND_CHARS = 4500

interface Collecting {
  name: string
  chunks: string[]
}

type Logger = { warn(message: string, error?: unknown): void }

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger(name)
  const prefix = (config.commandPrefix || '/').trim()

  const store = new PersonaStore({
    async load() {
      return ctx.storage.get<PersonaDatabase>(DB_KEY)
    },
    async save(database) {
      await ctx.storage.set(DB_KEY, database)
    }
  })

  const client = new LlmClient({
    baseUrl: config.baseUrl ?? '',
    apiKey: config.apiKey ?? '',
    model: config.model ?? 'deepseek-chat',
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.7
  })

  const engine = new PersonaEngine({
    store,
    llm: (messages) => client.chat(messages),
    config: {
      maxReplyLength: resolveReplyLimit(config),
      maxRecentMessages: resolveRecentLimit(config),
      memoryEveryTurns: config.memoryEnabled === false ? 0 : resolveMemoryTurns(config),
      retrievalTopK: resolveTopK(config),
      contextBudgetChars: resolveBudget(config),
      maxSelfMemories: 60,
      maxUserMemories: 80,
      immersion: config.immersion === 'balanced' ? 'balanced' : 'strong'
    },
    onError: (message, error) => logger.warn(message, error)
  })

  const collecting = new Map<string, Collecting>()
  const busy = new Set<string>()

  ctx.on('qq/message', (message) => {
    void handle(message).catch((error) => logger.warn('人格蒸馏插件处理消息失败', error))
  })

  async function handle(message: QQMessageLike): Promise<void> {
    if (message.scene !== 'group' && message.scene !== 'c2c') return
    const targetId = message.scene === 'group' ? message.groupId : message.userId
    if (!targetId) return

    const key = `${message.scene}:${targetId}`
    const text = message.content.trim()
    if (text.length === 0) return

    await engine.init()
    const reply = (content: string) => sendText(ctx, logger, message, content)

    const pending = collecting.get(key)
    if (pending && !text.startsWith(prefix)) {
      const total = appendMaterial(pending, text)
      if (total > MAX_MATERIAL_CHARS) {
        await reply(`语料已达 ${MAX_MATERIAL_CHARS} 字上限。发送 ${prefix}完成 开始提炼，${prefix}取消 放弃。`)
      } else {
        await reply(
          `已记录「${pending.name}」第 ${pending.chunks.length} 段语料（共 ${total} 字）。发送 ${prefix}完成 开始提炼。`
        )
      }
      return
    }

    if (text.startsWith(prefix)) {
      const body = text.slice(prefix.length).trim()
      const tokens = body.split(/\s+/)
      const command = tokens[0] ?? ''
      const args = tokens.slice(1)

      switch (command) {
        case '':
        case '帮助':
        case 'help':
          await reply(helpText(prefix))
          return

        case '蒸馏':
          await startDistill(key, args, reply)
          return

        case '完成':
          await finishDistill(key, message, reply)
          return

        case '取消':
          if (collecting.delete(key)) await reply('已取消本次蒸馏。')
          else await reply(`当前没有进行中的蒸馏。发送 ${prefix}蒸馏 名字 开始。`)
          return

        case '用':
        case '切换':
          await activate(key, args, prefix, reply)
          return

        case '退出':
          if (engine.sessionState(key).persona) {
            engine.sessionState(key).persona = ''
            await store.save()
            await reply('已退出人格对话。')
          } else {
            await reply('当前没有启用的人格。')
          }
          return

        case '重置':
          await engine.clearSession(key)
          await reply('已清空当前会话的聊天记忆。')
          return

        case '人格列表':
        case '列表':
          await reply(listText())
          return

        case '人格查看':
        case '查看':
          await reply(viewText(args, prefix))
          return

        case '人格删除':
        case '删除':
          await reply(await deleteText(args, prefix))
          return

        case '记忆':
          await reply(await memoryText(key, message, args))
          return

        case '记住':
          await reply(await rememberText(key, message, args))
          return

        case '忘记':
          await reply(await forgetText(key, message, args))
          return

        case '导出':
          await reply(await exportText(args, key, prefix))
          return

        case '导入':
          await reply(await importText(body.slice('导入'.length).trim()))
          return

        default:
          await reply(`未知命令。发送 ${prefix}帮助 查看用法。`)
          return
      }
    }

    await chat(key, message, text, reply)
  }

  function appendMaterial(pending: Collecting, text: string): number {
    pending.chunks.push(text)
    return pending.chunks.join('\n\n').length
  }

  async function startDistill(
    key: string,
    args: string[],
    reply: (content: string) => Promise<void>
  ): Promise<void> {
    const personaName = (args[0] ?? '').trim()
    if (!personaName) {
      await reply(`用法：${prefix}蒸馏 名字 [语料]\n例如：${prefix}蒸馏 前同事 他说话总是先反问…`)
      return
    }
    if (personaName.length > 20) {
      await reply('人格名字太长了，请控制在 20 字以内。')
      return
    }

    const inline = args.slice(1).join(' ').trim()
    collecting.set(key, { name: personaName, chunks: inline ? [inline] : [] })
    await reply(
      [
        `开始蒸馏「${personaName}」。`,
        '请继续发送你了解 TA 的语料：聊天记录、说话方式、做事风格、共同经历、性格描述等。',
        '第一次聊天会基于这些语料里的记忆开始。',
        `发送 ${prefix}完成 开始提炼，${prefix}取消 放弃。`
      ].join('\n')
    )
  }

  async function finishDistill(
    key: string,
    message: QQMessageLike,
    reply: (content: string) => Promise<void>
  ): Promise<void> {
    const pending = collecting.get(key)
    if (!pending) {
      await reply(`当前没有进行中的蒸馏。发送 ${prefix}蒸馏 名字 开始。`)
      return
    }

    const materials = pending.chunks.join('\n\n').trim()
    if (!client.configured) {
      await reply('尚未配置模型接口：请在实例的插件配置中填写接口地址与 API Key。')
      return
    }
    if (materials.length < MIN_MATERIAL_CHARS) {
      await reply(`语料太少（至少 ${MIN_MATERIAL_CHARS} 字），请再补充一些细节。`)
      return
    }

    collecting.delete(key)
    await reply(`正在提炼「${pending.name}」的人格与记忆，请稍候…`)
    try {
      const result = await engine.distill(pending.name, materials.slice(0, MAX_MATERIAL_CHARS), message.userId)
      const lines = [
        `「${result.persona.name}」蒸馏完成。`,
        result.persona.layers.summary ? `概括：${result.persona.layers.summary}` : '',
        `个人记忆：${result.persona.selfMemories.length} 条`,
        result.impression ? `对用户的印象：${result.impression.summary || '已建立'}` : '',
        `发送 ${prefix}用 ${result.persona.name} 开始对话。`
      ]
      await reply(lines.filter((line) => line.length > 0).join('\n'))
    } catch (error) {
      collecting.set(key, { name: pending.name, chunks: [materials] })
      logger.warn('蒸馏人格失败', error)
      await reply(`蒸馏失败：${errorText(error)}。语料已保留，可以补充后重发 ${prefix}完成。`)
    }
  }

  async function activate(
    key: string,
    args: string[],
    prefixValue: string,
    reply: (content: string) => Promise<void>
  ): Promise<void> {
    const personaName = args.join(' ').trim()
    if (!personaName) {
      const names = engine.listPersonas().map((persona) => persona.name)
      await reply(
        names.length > 0
          ? `用法：${prefixValue}用 名字\n可用人格：${names.join('、')}`
          : `还没有蒸馏出人格。发送 ${prefixValue}蒸馏 名字 开始。`
      )
      return
    }

    const persona = findPersona(personaName)
    if (!persona) {
      await reply(`没有找到「${personaName}」。发送 ${prefixValue}人格列表 查看已有人格。`)
      return
    }

    const session = engine.sessionState(key)
    session.persona = persona.name
    await store.save()
    await reply(`已切换为「${persona.name}」。直接发消息即可对话，发送 ${prefixValue}退出 结束。`)
  }

  function findPersona(name: string): PersonaProfile | undefined {
    const exact = engine.getPersona(name)
    if (exact) return exact
    const lower = name.toLowerCase()
    return engine.listPersonas().find((persona) => persona.name.toLowerCase() === lower)
  }

  function listText(): string {
    const personas = engine.listPersonas()
    if (personas.length === 0) return `还没有蒸馏出任何人格。发送 ${prefix}蒸馏 名字 开始。`
    const lines = personas.map((persona) => {
      const summary = persona.layers.summary ? ` — ${persona.layers.summary}` : ''
      return `- ${persona.name}（记忆 ${persona.selfMemories.length} 条）${summary}`
    })
    return `已蒸馏 ${personas.length} 个人格：\n${lines.join('\n')}`
  }

  function viewText(args: string[], prefixValue: string): string {
    const personaName = args.join(' ').trim()
    if (!personaName) return `用法：${prefixValue}人格查看 名字`
    const persona = findPersona(personaName)
    if (!persona) return `没有找到「${personaName}」。`
    return clipText(formatPersona(persona), MAX_SEND_CHARS)
  }

  async function deleteText(args: string[], prefixValue: string): Promise<string> {
    const personaName = args.join(' ').trim()
    if (!personaName) return `用法：${prefixValue}人格删除 名字`
    const persona = findPersona(personaName)
    if (!persona) return `没有找到「${personaName}」。`
    await engine.deletePersona(persona.name)
    return `已删除人格「${persona.name}」及其记忆。`
  }

  async function memoryText(
    key: string,
    message: QQMessageLike,
    args: string[]
  ): Promise<string> {
    const personaName = args.join(' ').trim() || engine.sessionState(key).persona
    if (!personaName) return '用法：/记忆 [人格名]（也可以先 /用 某个人格）'
    const persona = findPersona(personaName)
    if (!persona) return `没有找到「${personaName}」。`

    const overview = await engine.memoryOverview(persona.name, message.userId)
    const impression = overview.impression
    const session = engine.sessionState(key)
    const lines = [
      `「${persona.name}」的记忆`,
      `个人记忆：${overview.selfMemories.length} 条`,
      overview.selfMemories.slice(0, 5).map((memory) => `· ${memory.text}`).join('\n'),
      impression?.summary ? `对用户的印象：${impression.summary}` : '对用户的印象：暂无',
      impression?.facts.length
        ? `关于用户：\n${impression.facts.slice(0, 8).map((fact) => `· ${fact.text}`).join('\n')}`
        : '关于用户：暂无',
      session.summary ? `本会话摘要：${session.summary}` : ''
    ]
    return clipText(lines.filter((line) => line && line.length > 0).join('\n'), MAX_SEND_CHARS)
  }

  async function rememberText(
    key: string,
    message: QQMessageLike,
    args: string[]
  ): Promise<string> {
    const personaName = engine.sessionState(key).persona
    if (!personaName) return '请先 /用 一个人格，再告诉我要记住什么。'
    const text = args.join(' ').trim()
    if (!text) return '用法：/记住 要长期记住的事'
    await engine.remember(personaName, message.userId, text, 'user', 4)
    return `已记住：${text}`
  }

  async function forgetText(
    key: string,
    message: QQMessageLike,
    args: string[]
  ): Promise<string> {
    const personaName = engine.sessionState(key).persona
    if (!personaName) return '请先 /用 一个人格，再告诉我要忘记什么。'
    const query = args.join(' ').trim()
    if (!query) return '用法：/忘记 要删除的记忆关键词'
    const removed = await engine.forget(personaName, message.userId, query)
    return removed > 0 ? `已忘记 ${removed} 条相关记忆。` : '没有找到匹配的记忆。'
  }

  async function exportText(
    args: string[],
    key: string,
    prefixValue: string
  ): Promise<string> {
    const personaName = args.join(' ').trim() || engine.sessionState(key).persona
    if (!personaName) return `用法：${prefixValue}导出 [人格名]`
    const persona = findPersona(personaName)
    if (!persona) return `没有找到「${personaName}」。`
    const bundle = await engine.exportBundle(persona.name)
    const compact: PersonaBundle = {
      kind: 'arqqbot-persona',
      version: 1,
      persona: bundle.persona,
      impressions: bundle.impressions
    }
    const json = JSON.stringify(compact)
    if (json.length > MAX_SEND_CHARS) {
      return `人格包有 ${json.length} 字，超过单条消息上限。请先 /人格删除 冗余记忆，或分批导出。`
    }
    return json
  }

  async function importText(payload: string): Promise<string> {
    if (!payload) return '用法：/导入 {人格包 JSON}'
    let bundle: PersonaBundle
    try {
      bundle = JSON.parse(payload) as PersonaBundle
    } catch {
      return '导入失败：不是合法的 JSON。'
    }
    try {
      await engine.importBundle(bundle)
      return `已导入人格「${bundle.persona?.name ?? '未知'}」，发送 /用 ${bundle.persona?.name ?? ''} 开始对话。`
    } catch (error) {
      return `导入失败：${errorText(error)}`
    }
  }

  async function chat(
    key: string,
    message: QQMessageLike,
    text: string,
    reply: (content: string) => Promise<void>
  ): Promise<void> {
    const personaName = engine.sessionState(key).persona
    if (!personaName) {
      if (message.scene === 'c2c') await reply(`当前没有启用的人格。发送 ${prefix}帮助 查看用法。`)
      return
    }
    if (!client.configured) {
      await reply('尚未配置模型接口：请在实例的插件配置中填写接口地址与 API Key。')
      return
    }
    if (busy.has(key)) {
      await reply('上一条还在回复中，稍等一下。')
      return
    }

    busy.add(key)
    try {
      const result = await engine.chat({
        sessionKey: key,
        persona: personaName,
        userId: message.userId,
        text,
        userName: (config.ownerName || '').trim() || message.author?.name || '对方'
      })
      await reply(result.reply)
    } catch (error) {
      logger.warn('人格对话失败', error)
      await reply(`对话失败：${errorText(error)}`)
    } finally {
      busy.delete(key)
    }
  }
}

function formatPersona(persona: PersonaProfile): string {
  const layers = persona.layers
  const parts = [
    `「${persona.name}」人格档案`,
    layers.summary ? `概括：${layers.summary}` : '',
    layers.expression ? `表达 DNA：${layers.expression}` : '',
    layers.mentalModels.length ? `心智模型：\n${layers.mentalModels.map((item) => `- ${item}`).join('\n')}` : '',
    layers.heuristics.length ? `决策启发式：\n${layers.heuristics.map((item) => `- ${item}`).join('\n')}` : '',
    layers.values.length ? `价值观：\n${layers.values.map((item) => `- ${item}`).join('\n')}` : '',
    layers.boundaries.length ? `信息边界：\n${layers.boundaries.map((item) => `- ${item}`).join('\n')}` : '',
    `个人记忆：${persona.selfMemories.length} 条`
  ]
  return parts.filter((part) => part.length > 0).join('\n')
}

function helpText(prefix: string): string {
  return [
    '人格蒸馏 · 使用说明',
    `${prefix}蒸馏 名字 [语料]  开始蒸馏，可随后逐段发送语料`,
    `${prefix}完成  提炼人格与记忆`,
    `${prefix}取消  放弃本次蒸馏`,
    `${prefix}用 名字  切换当前会话的人格`,
    `${prefix}退出  退出人格对话`,
    `${prefix}人格列表  查看已有人格`,
    `${prefix}人格查看 名字  查看人格档案`,
    `${prefix}人格删除 名字  删除人格与记忆`,
    `${prefix}记忆 [名字]  查看个人记忆、对你的印象与会话摘要`,
    `${prefix}记住 内容  手动写入一条关于你的长期记忆`,
    `${prefix}忘记 关键词  删除匹配的记忆`,
    `${prefix}重置  清空本会话聊天记忆`,
    `${prefix}导出 [名字]  导出人格包 JSON`,
    `${prefix}导入 {JSON}  导入人格包`,
    '',
    '记忆分层：人格个人记忆（全局）+ 会话聊天记忆 + 对你的长期印象。'
  ].join('\n')
}

async function sendText(
  ctx: Context,
  logger: Logger,
  message: QQMessageLike,
  content: string
): Promise<void> {
  const targetId = message.scene === 'group' ? message.groupId : message.userId
  if (!targetId) return
  const scene: 'c2c' | 'group' = message.scene === 'group' ? 'group' : 'c2c'
  try {
    await ctx.qq.send({
      scene,
      targetId,
      content: clipText(content, MAX_SEND_CHARS),
      msgId: message.id
    })
  } catch (error) {
    logger.warn('发送消息失败', error)
  }
}

function resolveReplyLimit(config: Config): number {
  const value = typeof config.maxReplyLength === 'number' ? config.maxReplyLength : 600
  return Math.min(Math.max(value, 100), MAX_SEND_CHARS)
}

function resolveRecentLimit(config: Config): number {
  const value = typeof config.maxRecentMessages === 'number' ? config.maxRecentMessages : 12
  return Math.min(Math.max(value, 2), 40)
}

function resolveMemoryTurns(config: Config): number {
  const value = typeof config.memoryEveryTurns === 'number' ? config.memoryEveryTurns : 3
  return Math.min(Math.max(value, 1), 20)
}

function resolveTopK(config: Config): number {
  const value = typeof config.retrievalTopK === 'number' ? config.retrievalTopK : 8
  return Math.min(Math.max(value, 1), 20)
}

function resolveBudget(config: Config): number {
  const value = typeof config.contextBudgetChars === 'number' ? config.contextBudgetChars : 6000
  return Math.min(Math.max(value, 2000), 20000)
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}
