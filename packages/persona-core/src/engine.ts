import { clipText } from './json'
import { extractKeywords, keywordOverlap } from './keywords'
import {
  buildChatMessages,
  buildDistillMessages,
  buildMemoryMessages,
  parseDistillResult,
  parseMemoryResult
} from './prompts'
import { createMemory, mergeMemories, PersonaStore } from './store'
import {
  DEFAULT_ENGINE_CONFIG,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type DistillResult,
  type EngineConfig,
  type MemoryItem,
  type MemorySummaryInput,
  type PersonaBundle,
  type PersonaProfile,
  type SessionState,
  type UserImpression
} from './types'

export type LlmCall = (messages: ChatMessage[]) => Promise<string>

export interface PersonaEngineOptions {
  store: PersonaStore
  llm: LlmCall
  config?: Partial<EngineConfig>
  now?: () => Date
  onError?: (message: string, error?: unknown) => void
}

function scoreMemory(memory: MemoryItem, queryKeywords: string[], nowMs: number): number {
  const memoryKeywords =
    memory.keywords.length > 0 ? memory.keywords : extractKeywords(memory.text)
  const overlap = keywordOverlap(queryKeywords, memoryKeywords)
  const updated = Date.parse(memory.updatedAt || memory.createdAt)
  const ageDays = Number.isFinite(updated) ? Math.max((nowMs - updated) / 86_400_000, 0) : 0
  const recency = 1 / (1 + ageDays / 30)
  return overlap * 0.65 + (memory.importance / 5) * 0.25 + recency * 0.1
}

function rankMemories(
  memories: MemoryItem[],
  queryKeywords: string[],
  topK: number,
  nowMs: number
): MemoryItem[] {
  return [...memories]
    .sort((a, b) => scoreMemory(b, queryKeywords, nowMs) - scoreMemory(a, queryKeywords, nowMs))
    .slice(0, Math.max(topK, 0))
}

export class PersonaEngine {
  private readonly store: PersonaStore
  private readonly llm: LlmCall
  private readonly config: EngineConfig
  private readonly now: () => Date
  private readonly onError?: (message: string, error?: unknown) => void

  constructor(options: PersonaEngineOptions) {
    this.store = options.store
    this.llm = options.llm
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...options.config }
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError
  }

  async init(): Promise<void> {
    await this.store.load()
  }

  listPersonas(): PersonaProfile[] {
    return this.store.personas().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  getPersona(name: string): PersonaProfile | undefined {
    return this.store.persona(name)
  }

  async distill(name: string, materials: string, userId = '__owner__'): Promise<DistillResult> {
    await this.init()
    const now = this.now().toISOString()
    const answer = await this.llm(buildDistillMessages(name, materials))
    const parsed = parseDistillResult(answer, now)

    const expression =
      parsed.catchphrases.length > 0
        ? [parsed.layers.expression, `口头禅：${parsed.catchphrases.join('、')}`]
            .filter((part) => part.length > 0)
            .join('；')
        : parsed.layers.expression

    const existing = this.store.persona(name)
    const selfMemories = mergeMemories(
      existing?.selfMemories ?? [],
      parsed.selfMemories,
      this.config.maxSelfMemories
    )
    const persona: PersonaProfile = {
      name,
      layers: { ...parsed.layers, expression },
      selfMemories,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sourceChars: materials.length
    }
    this.store.putPersona(persona)

    let impression: UserImpression | undefined
    if (parsed.impressionSummary.length > 0 || parsed.impressionFacts.length > 0) {
      impression = this.store.impression(name, userId)
      impression.summary = parsed.impressionSummary || impression.summary
      impression.facts = mergeMemories(
        impression.facts,
        parsed.impressionFacts,
        this.config.maxUserMemories
      )
      impression.updatedAt = now
    }

    await this.store.save()
    return { persona, impression }
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    await this.init()
    const persona = this.store.persona(input.persona)
    if (!persona) throw new Error(`没有找到人格「${input.persona}」`)

    const session = this.store.session(input.sessionKey)
    session.persona = input.persona
    session.userId = input.userId

    const impression = this.store.impression(input.persona, input.userId)
    const nowMs = this.now().getTime()
    const queryKeywords = extractKeywords(input.text)

    let selfMemories = rankMemories(
      persona.selfMemories,
      queryKeywords,
      this.config.retrievalTopK,
      nowMs
    )
    let userMemories = rankMemories(
      impression.facts,
      queryKeywords,
      this.config.retrievalTopK,
      nowMs
    )

    let messages = buildChatMessages({
      persona,
      impression,
      selfMemories,
      userMemories,
      session,
      text: input.text,
      userName: input.userName,
      config: this.config
    })

    // 上下文预算：超限时逐轮裁剪召回记忆
    for (let attempt = 0; attempt < 3 && messages[0]!.content.length > this.config.contextBudgetChars; attempt += 1) {
      selfMemories = selfMemories.slice(0, Math.ceil(selfMemories.length / 2))
      userMemories = userMemories.slice(0, Math.ceil(userMemories.length / 2))
      messages = buildChatMessages({
        persona,
        impression,
        selfMemories,
        userMemories,
        session,
        text: input.text,
        userName: input.userName,
        config: this.config
      })
    }

    const raw = await this.llm(messages)
    const reply = clipText(raw.trim(), this.config.maxReplyLength)

    session.messages.push(
      { role: 'user', content: input.text },
      { role: 'assistant', content: reply }
    )
    if (session.messages.length > this.config.maxRecentMessages) {
      session.messages = session.messages.slice(-this.config.maxRecentMessages)
    }
    session.turnCount += 1
    session.lastActiveAt = this.now().toISOString()
    impression.interactionCount += 1
    impression.updatedAt = session.lastActiveAt

    await this.store.save()

    if (this.config.memoryEveryTurns > 0 && session.turnCount % this.config.memoryEveryTurns === 0) {
      try {
        await this.updateMemory({ persona: input.persona, userId: input.userId, sessionKey: input.sessionKey })
      } catch (error) {
        this.onError?.('更新人格记忆失败', error)
      }
    }

    return { reply, session, usedMemories: [...selfMemories, ...userMemories] }
  }

  async updateMemory(input: MemorySummaryInput): Promise<void> {
    await this.init()
    const persona = this.store.persona(input.persona)
    if (!persona) return
    const session = this.store.session(input.sessionKey)
    const impression = this.store.impression(input.persona, input.userId)

    const now = this.now().toISOString()
    const answer = await this.llm(
      buildMemoryMessages({ persona, impression, session, now })
    )
    const parsed = parseMemoryResult(answer, now)

    if (parsed.sessionSummary.length > 0) session.summary = parsed.sessionSummary

    const personaMemories: MemoryItem[] = []
    const userMemories: MemoryItem[] = []
    for (const item of parsed.memories) {
      if (item.target === 'persona') personaMemories.push(item.memory)
      else userMemories.push(item.memory)
    }

    persona.selfMemories = mergeMemories(
      persona.selfMemories,
      personaMemories,
      this.config.maxSelfMemories
    )
    persona.updatedAt = now
    impression.facts = mergeMemories(impression.facts, userMemories, this.config.maxUserMemories)
    if (parsed.impressionUpdate.length > 0) impression.summary = parsed.impressionUpdate
    impression.updatedAt = now

    await this.store.save()
  }

  async memoryOverview(persona: string, userId: string): Promise<{
    impression?: UserImpression
    selfMemories: MemoryItem[]
  }> {
    await this.init()
    const profile = this.store.persona(persona)
    return {
      impression: this.store.findImpression(persona, userId),
      selfMemories: profile?.selfMemories ?? []
    }
  }

  async clearSession(sessionKey: string): Promise<void> {
    await this.init()
    const session = this.store.session(sessionKey)
    session.messages = []
    session.turnCount = 0
    session.summary = ''
    await this.store.save()
  }

  async forget(persona: string, userId: string, query: string): Promise<number> {
    await this.init()
    const profile = this.store.persona(persona)
    if (!profile) return 0
    const keywords = extractKeywords(query)
    const matches = (memory: MemoryItem): boolean => {
      if (memory.text.includes(query)) return true
      const memoryKeywords = memory.keywords.length > 0 ? memory.keywords : extractKeywords(memory.text)
      return keywordOverlap(keywords, memoryKeywords) >= 0.5
    }

    const before = profile.selfMemories.length
    const impression = this.store.findImpression(persona, userId)
    const beforeUser = impression?.facts.length ?? 0

    profile.selfMemories = profile.selfMemories.filter((memory) => !matches(memory))
    if (impression) impression.facts = impression.facts.filter((memory) => !matches(memory))

    await this.store.save()
    return before - profile.selfMemories.length + beforeUser - (impression?.facts.length ?? 0)
  }

  async deletePersona(name: string): Promise<boolean> {
    await this.init()
    const existed = this.store.deletePersona(name)
    if (existed) await this.store.save()
    return existed
  }

  async exportBundle(name: string): Promise<PersonaBundle> {
    await this.init()
    const persona = this.store.persona(name)
    if (!persona) throw new Error(`没有找到人格「${name}」`)
    const impressions = Object.values(this.store.current.impressions).filter(
      (impression) => impression.persona === name
    )
    const sessions = Object.values(this.store.current.sessions).filter(
      (session) => session.persona === name
    )
    return { kind: 'arqqbot-persona', version: 1, persona, impressions, sessions }
  }

  async importBundle(bundle: PersonaBundle): Promise<void> {
    await this.init()
    if (bundle.kind !== 'arqqbot-persona') throw new Error('不是有效的 ArQQbot 人格包')
    const now = this.now().toISOString()
    const persona: PersonaProfile = {
      ...bundle.persona,
      selfMemories: (bundle.persona.selfMemories ?? []).map((memory) => ({
        ...memory,
        keywords: memory.keywords?.length ? memory.keywords : extractKeywords(memory.text)
      })),
      updatedAt: now
    }
    if (persona.selfMemories.some((memory) => memory.text.length === 0)) {
      throw new Error('人格包中存在空记忆')
    }
    this.store.putPersona(persona)
    for (const impression of bundle.impressions ?? []) {
      this.store.current.impressions[`${impression.persona}::${impression.userId}`] = impression
    }
    for (const session of bundle.sessions ?? []) {
      this.store.current.sessions[session.key] = session
    }
    await this.store.save()
  }

  /** 手动添加一条记忆（用于导入或纠正） */
  async remember(
    persona: string,
    userId: string,
    text: string,
    target: 'user' | 'persona' = 'user',
    importance = 4
  ): Promise<void> {
    await this.init()
    const item = createMemory({
      text,
      keywords: extractKeywords(text),
      importance,
      source: 'manual',
      now: this.now().toISOString()
    })
    if (target === 'persona') {
      const profile = this.store.persona(persona)
      if (!profile) throw new Error(`没有找到人格「${persona}」`)
      profile.selfMemories = mergeMemories(profile.selfMemories, [item], this.config.maxSelfMemories)
    } else {
      const impression = this.store.impression(persona, userId)
      impression.facts = mergeMemories(impression.facts, [item], this.config.maxUserMemories)
    }
    await this.store.save()
  }

  sessionState(sessionKey: string): SessionState {
    return this.store.session(sessionKey)
  }
}
