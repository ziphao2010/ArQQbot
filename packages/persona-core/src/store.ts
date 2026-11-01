import { randomUUID } from 'node:crypto'
import { textSimilarity } from './keywords'
import type {
  MemoryItem,
  MemoryKind,
  PersonaDatabase,
  PersonaProfile,
  SessionState,
  UserImpression
} from './types'

export interface PersonaStorageAdapter {
  load(): Promise<PersonaDatabase | undefined>
  save(database: PersonaDatabase): Promise<void>
}

export function emptyDatabase(): PersonaDatabase {
  return { version: 1, personas: {}, sessions: {}, impressions: {} }
}

export function impressionKey(persona: string, userId: string): string {
  return `${persona}::${userId}`
}

export function createMemory(input: {
  text: string
  kind?: MemoryKind
  keywords?: string[]
  importance?: number
  source?: MemoryItem['source']
  now?: string
}): MemoryItem {
  const now = input.now ?? new Date().toISOString()
  return {
    id: randomUUID(),
    kind: input.kind ?? 'fact',
    text: input.text,
    keywords: input.keywords ?? [],
    importance: clampImportance(input.importance),
    createdAt: now,
    updatedAt: now,
    source: input.source ?? 'chat'
  }
}

export function clampImportance(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 3
  return Math.min(Math.max(Math.round(number), 1), 5)
}

export function mergeMemories(
  existing: MemoryItem[],
  incoming: MemoryItem[],
  cap: number
): MemoryItem[] {
  const result = [...existing]
  for (const item of incoming) {
    const index = result.findIndex((memory) => textSimilarity(memory.text, item.text) >= 0.86)
    if (index >= 0) {
      const current = result[index]!
      result[index] = {
        ...current,
        text: item.text.length >= current.text.length ? item.text : current.text,
        importance: Math.max(current.importance, item.importance),
        keywords: [...new Set([...current.keywords, ...item.keywords])],
        updatedAt: item.updatedAt
      }
    } else {
      result.push(item)
    }
  }

  result.sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance
    return b.updatedAt.localeCompare(a.updatedAt)
  })
  return result.slice(0, Math.max(cap, 1))
}

export class PersonaStore {
  private database?: PersonaDatabase
  private loading?: Promise<PersonaDatabase>

  constructor(private readonly adapter: PersonaStorageAdapter) {}

  async load(): Promise<PersonaDatabase> {
    if (this.database) return this.database
    if (!this.loading) {
      this.loading = this.adapter.load().then((value) => {
        this.database = value ?? emptyDatabase()
        if (!this.database.version) this.database.version = 1
        this.database.personas ??= {}
        this.database.sessions ??= {}
        this.database.impressions ??= {}
        return this.database
      })
    }
    return this.loading
  }

  get current(): PersonaDatabase {
    if (!this.database) throw new Error('人格数据库尚未加载')
    return this.database
  }

  async save(): Promise<void> {
    await this.adapter.save(this.current)
  }

  persona(name: string): PersonaProfile | undefined {
    return this.current.personas[name]
  }

  personas(): PersonaProfile[] {
    return Object.values(this.current.personas)
  }

  putPersona(persona: PersonaProfile): void {
    this.current.personas[persona.name] = persona
  }

  deletePersona(name: string): boolean {
    const existed = name in this.current.personas
    delete this.current.personas[name]
    for (const [key, session] of Object.entries(this.current.sessions)) {
      if (session.persona === name) delete this.current.sessions[key]
    }
    for (const [key, impression] of Object.entries(this.current.impressions)) {
      if (impression.persona === name) delete this.current.impressions[key]
    }
    return existed
  }

  session(key: string): SessionState {
    let session = this.current.sessions[key]
    if (!session) {
      session = {
        key,
        persona: '',
        userId: '',
        messages: [],
        summary: '',
        turnCount: 0,
        lastActiveAt: new Date().toISOString()
      }
      this.current.sessions[key] = session
    }
    return session
  }

  impression(persona: string, userId: string): UserImpression {
    const key = impressionKey(persona, userId)
    let impression = this.current.impressions[key]
    if (!impression) {
      impression = {
        persona,
        userId,
        summary: '',
        facts: [],
        interactionCount: 0,
        updatedAt: new Date().toISOString()
      }
      this.current.impressions[key] = impression
    }
    return impression
  }

  findImpression(persona: string, userId: string): UserImpression | undefined {
    return this.current.impressions[impressionKey(persona, userId)]
  }
}
