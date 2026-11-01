import { Context, Service } from 'cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Persona from '../src/index'
import type { QQMessageLike } from '../src/index'

class FakeQQ extends Service {
  sent: Array<{ scene: string; targetId: string; content: string; msgId?: string }> = []

  constructor(ctx: Context) {
    super(ctx, 'qq')
  }

  async send(input: { scene: string; targetId: string; content: string; msgId?: string }): Promise<{}> {
    this.sent.push(input)
    return {}
  }
}

class FakeStorage extends Service {
  private readonly data = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'storage')
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : (JSON.parse(raw) as T)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }
}

const MATERIAL =
  '他是我前同事，说话很直接，总先反问一句再给方案，最讨厌甩锅，做估算习惯加缓冲，遇到问题先拆约束条件'

const config: Persona.Config = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.7,
  ownerName: '阿远',
  immersion: 'strong',
  maxReplyLength: 600,
  maxRecentMessages: 12,
  memoryEnabled: true,
  memoryEveryTurns: 1,
  retrievalTopK: 8,
  contextBudgetChars: 6000,
  commandPrefix: '/'
}

const distillJson = JSON.stringify({
  summary: '嘴硬心软的资深工程师',
  expression: '说话直接，先反问再给方案，句尾带“懂吧”',
  mental_models: ['先看约束条件再谈方案'],
  heuristics: ['估算先加 50% 缓冲'],
  values: ['不甩锅'],
  boundaries: ['不了解现在的团队'],
  self_memories: [
    { kind: 'event', text: '我在上一家公司带过一个差点延期的项目', importance: 4, keywords: ['项目', '延期'] }
  ],
  catchphrases: ['懂吧'],
  user_impression: {
    summary: '这小子做事有点急，但肯听劝。',
    facts: [{ text: '用户最近在赶一个 Q4 项目', importance: 4, keywords: ['项目', 'q4'] }]
  }
})

const memoryJson = JSON.stringify({
  session_summary: '用户说项目要延期，老陈建议先拆约束条件。',
  memories: [
    { target: 'user', kind: 'event', text: '用户负责的项目下个月上线', importance: 4, keywords: ['项目', '上线'] }
  ],
  impression_update: '这小子遇事会先来找我商量。'
})

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<{ content?: string }>
      }
      const system = body.messages?.[0]?.content ?? ''
      let content = '先别急，截止时间是什么时候？把约束列出来，懂吧。'
      if (system.includes('人格蒸馏引擎')) content = distillJson
      else if (system.includes('记忆整理器')) content = memoryJson
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
  )
}

async function createContext(overrides: Partial<Persona.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(FakeQQ)
  await ctx.plugin(FakeStorage)
  await ctx.plugin(Persona, { ...config, ...overrides })
  return ctx
}

function message(content: string, scene: 'group' | 'c2c' = 'c2c'): QQMessageLike {
  return {
    id: `msg-${Math.random().toString(16).slice(2)}`,
    scene,
    userId: 'user-1',
    groupId: scene === 'group' ? 'group-1' : undefined,
    content,
    author: { name: '阿远' }
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

function replies(ctx: Context): string[] {
  return (ctx.qq as unknown as FakeQQ).sent.map((item) => item.content)
}

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('人格蒸馏插件', () => {
  it('蒸馏后带着个人记忆与用户印象对话', async () => {
    const ctx = await createContext()

    ctx.emit('qq/message', message('/蒸馏 老陈 他是我前同事，说话很直接，总先反问一句再给方案，最讨厌甩锅，做估算习惯加缓冲'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('开始蒸馏「老陈」')

    ctx.emit('qq/message', message('/完成'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('蒸馏完成')
    expect(replies(ctx).at(-1)).toContain('个人记忆：1 条')

    ctx.emit('qq/message', message('/用 老陈'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('已切换为「老陈」')

    ctx.emit('qq/message', message('Q4 那个项目要延期了，怎么办'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('约束')

    const qq = ctx.qq as unknown as FakeQQ
    expect(qq.sent.at(-1)).toMatchObject({ scene: 'c2c', targetId: 'user-1' })
    expect(qq.sent.at(-1)?.msgId).toBeDefined()
  })

  it('记忆整理后会写入长期印象，/记忆 可以查看', async () => {
    const ctx = await createContext()

    ctx.emit('qq/message', message(`/蒸馏 老陈 ${MATERIAL}`))
    await tick()
    ctx.emit('qq/message', message('/完成'))
    await tick()
    ctx.emit('qq/message', message('/用 老陈'))
    await tick()

    ctx.emit('qq/message', message('项目下个月上线，我有点慌'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('约束')

    ctx.emit('qq/message', message('/记忆 老陈'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('这小子遇事会先来找我商量')
    expect(replies(ctx).at(-1)).toContain('下个月上线')
  })

  it('/记住 与 /忘记 可手动管理关于用户的记忆', async () => {
    const ctx = await createContext()

    ctx.emit('qq/message', message(`/蒸馏 老陈 ${MATERIAL}`))
    await tick()
    ctx.emit('qq/message', message('/完成'))
    await tick()
    ctx.emit('qq/message', message('/用 老陈'))
    await tick()

    ctx.emit('qq/message', message('/记住 我对花生过敏'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('已记住')

    ctx.emit('qq/message', message('/记忆 老陈'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('花生过敏')

    ctx.emit('qq/message', message('/忘记 花生'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('已忘记')
  })

  it('/导出 输出人格包，/导入 可以恢复', async () => {
    const ctx = await createContext()

    ctx.emit('qq/message', message(`/蒸馏 老陈 ${MATERIAL}`))
    await tick()
    ctx.emit('qq/message', message('/完成'))
    await tick()

    ctx.emit('qq/message', message('/导出 老陈'))
    await tick()
    const bundle = replies(ctx).at(-1) ?? ''
    expect(bundle.startsWith('{')).toBe(true)

    ctx.emit('qq/message', message('/人格删除 老陈'))
    await tick()
    expect(replies(ctx).at(-1)).toContain('已删除人格')

    ctx.emit('qq/message', message(`/导入 ${bundle}`))
    await tick()
    expect(replies(ctx).at(-1)).toContain('已导入人格「老陈」')
  })

  it('群聊回复使用 groupId 且未启用人格时忽略普通聊天', async () => {
    const ctx = await createContext()

    ctx.emit('qq/message', message('大家好', 'group'))
    await tick()
    expect(replies(ctx)).toHaveLength(0)

    ctx.emit('qq/message', message('/蒸馏 老陈 他是前同事，说话直接，总先反问，最讨厌甩锅，做估算加缓冲', 'group'))
    await tick()
    expect((ctx.qq as unknown as FakeQQ).sent.at(-1)).toMatchObject({
      scene: 'group',
      targetId: 'group-1'
    })
  })

  it('未配置 API Key 时给出明确提示', async () => {
    const ctx = await createContext({ apiKey: '' })

    ctx.emit('qq/message', message('/蒸馏 老陈 他说话总先反问一句再给方案，最讨厌甩锅，做估算加缓冲'))
    await tick()
    ctx.emit('qq/message', message('/完成'))
    await tick()

    expect(replies(ctx).at(-1)).toContain('尚未配置模型接口')
  })
})
