import { describe, expect, it } from 'vitest'
import {
  PersonaEngine,
  PersonaStore,
  type ChatMessage,
  type PersonaDatabase,
  type PersonaStorageAdapter
} from '../src/index'

function memoryAdapter(): PersonaStorageAdapter {
  let data: PersonaDatabase | undefined
  return {
    async load() {
      return data
    },
    async save(database) {
      data = JSON.parse(JSON.stringify(database)) as PersonaDatabase
    }
  }
}

const distillJson = JSON.stringify({
  summary: '嘴硬心软的资深工程师',
  expression: '说话直接，先反问再给方案，句尾带“懂吧”',
  mental_models: ['先看约束条件再谈方案'],
  heuristics: ['估算先加 50% 缓冲'],
  values: ['不甩锅'],
  boundaries: ['不了解用户现在的团队'],
  self_memories: [
    { kind: 'event', text: '我在上一家公司带过一个差点延期的项目', importance: 4, keywords: ['项目', '延期'] },
    { kind: 'preference', text: '我讨厌开会不带结论的人', importance: 3 }
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
    { target: 'user', kind: 'event', text: '用户负责的项目下个月上线', importance: 4, keywords: ['项目', '上线'] },
    { target: 'persona', kind: 'fact', text: '我喜欢先问截止时间再谈方案', importance: 3 }
  ],
  impression_update: '这小子遇事会先来找我商量，说明还算信任我。'
})

function stubLlm(): (messages: ChatMessage[]) => Promise<string> {
  return async (messages) => {
    const system = messages[0]?.content ?? ''
    if (system.includes('人格蒸馏引擎')) return distillJson
    if (system.includes('记忆整理器')) return memoryJson
    return '先别急，截止时间是什么时候？把约束列出来，懂吧。'
  }
}

describe('PersonaEngine', () => {
  it('从语料蒸馏出人格、个人记忆与用户印象', async () => {
    const store = new PersonaStore(memoryAdapter())
    const engine = new PersonaEngine({ store, llm: stubLlm() })

    const { persona, impression } = await engine.distill('老陈', '他是我前同事，说话直接…', 'user-1')

    expect(persona.layers.summary).toBe('嘴硬心软的资深工程师')
    expect(persona.layers.expression).toContain('懂吧')
    expect(persona.selfMemories).toHaveLength(2)
    expect(impression?.summary).toContain('肯听劝')
    expect(impression?.facts[0]?.text).toContain('Q4')
  })

  it('对话使用人格档案与相关记忆，并写入会话', async () => {
    const store = new PersonaStore(memoryAdapter())
    const engine = new PersonaEngine({ store, llm: stubLlm(), config: { memoryEveryTurns: 0 } })

    await engine.distill('老陈', '语料', 'user-1')
    const result = await engine.chat({
      sessionKey: 'c2c:user-1',
      persona: '老陈',
      userId: 'user-1',
      text: '项目要延期了，Q4 那个项目怎么办'
    })

    expect(result.reply).toContain('约束')
    expect(result.session.messages).toHaveLength(2)
    expect(result.usedMemories[0]?.text).toMatch(/Q4|项目/)
  })

  it('达到轮数后整理记忆并更新印象，重复事实会去重', async () => {
    const store = new PersonaStore(memoryAdapter())
    const engine = new PersonaEngine({ store, llm: stubLlm(), config: { memoryEveryTurns: 1 } })

    await engine.distill('老陈', '语料', 'user-1')
    await engine.chat({ sessionKey: 'c2c:user-1', persona: '老陈', userId: 'user-1', text: '聊两句' })

    const overview = await engine.memoryOverview('老陈', 'user-1')
    expect(overview.impression?.summary).toContain('信任')
    expect(overview.impression?.facts.some((fact) => fact.text.includes('下个月上线'))).toBe(true)
    expect(engine.sessionState('c2c:user-1').summary).toContain('项目要延期')

    const sizeBefore = overview.impression?.facts.length ?? 0
    await engine.chat({ sessionKey: 'c2c:user-1', persona: '老陈', userId: 'user-1', text: '再想想' })
    const after = await engine.memoryOverview('老陈', 'user-1')
    expect(after.impression?.facts.length).toBe(sizeBefore)
  })

  it('忘记指定记忆后不再召回', async () => {
    const store = new PersonaStore(memoryAdapter())
    const engine = new PersonaEngine({ store, llm: stubLlm(), config: { memoryEveryTurns: 0 } })
    await engine.distill('老陈', '语料', 'user-1')

    const removed = await engine.forget('老陈', 'user-1', 'Q4')
    expect(removed).toBeGreaterThan(0)

    const preview = await engine.memoryOverview('老陈', 'user-1')
    expect(preview.impression?.facts.some((fact) => fact.text.includes('Q4'))).toBe(false)
  })

  it('人格包可以导出再导入', async () => {
    const store = new PersonaStore(memoryAdapter())
    const engine = new PersonaEngine({ store, llm: stubLlm() })
    await engine.distill('老陈', '语料', 'user-1')

    const bundle = await engine.exportBundle('老陈')
    expect(bundle.persona.name).toBe('老陈')
    expect(bundle.impressions).toHaveLength(1)

    const fresh = new PersonaEngine({ store: new PersonaStore(memoryAdapter()), llm: stubLlm() })
    await fresh.importBundle(bundle)
    expect(fresh.getPersona('老陈')?.layers.summary).toBe('嘴硬心软的资深工程师')
  })
})
