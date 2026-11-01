export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type Immersion = 'strong' | 'balanced'

export type MemoryKind = 'fact' | 'preference' | 'event' | 'relationship' | 'impression' | 'self'

export type MemoryTarget = 'user' | 'persona'

export interface MemoryItem {
  id: string
  kind: MemoryKind
  text: string
  keywords: string[]
  importance: number
  createdAt: string
  updatedAt: string
  source: 'distill' | 'chat' | 'summary' | 'manual' | 'import'
}

export interface PersonaLayers {
  summary: string
  expression: string
  mentalModels: string[]
  heuristics: string[]
  values: string[]
  boundaries: string[]
}

export interface PersonaProfile {
  name: string
  layers: PersonaLayers
  selfMemories: MemoryItem[]
  createdAt: string
  updatedAt: string
  sourceChars: number
}

export interface SessionState {
  key: string
  persona: string
  userId: string
  messages: ChatMessage[]
  summary: string
  turnCount: number
  lastActiveAt: string
}

export interface UserImpression {
  persona: string
  userId: string
  summary: string
  facts: MemoryItem[]
  interactionCount: number
  updatedAt: string
}

export interface PersonaDatabase {
  version: 1
  personas: Record<string, PersonaProfile>
  sessions: Record<string, SessionState>
  impressions: Record<string, UserImpression>
}

export interface EngineConfig {
  maxReplyLength: number
  maxRecentMessages: number
  memoryEveryTurns: number
  retrievalTopK: number
  contextBudgetChars: number
  maxSelfMemories: number
  maxUserMemories: number
  immersion: Immersion
}

export interface ChatInput {
  sessionKey: string
  persona: string
  userId: string
  text: string
  userName?: string
}

export interface ChatResult {
  reply: string
  session: SessionState
  usedMemories: MemoryItem[]
}

export interface DistillResult {
  persona: PersonaProfile
  impression?: UserImpression
}

export interface MemorySummaryInput {
  persona: string
  userId: string
  sessionKey: string
}

export interface PersonaBundle {
  kind: 'arqqbot-persona'
  version: 1
  persona: PersonaProfile
  impressions: UserImpression[]
  sessions?: SessionState[]
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxReplyLength: 600,
  maxRecentMessages: 12,
  memoryEveryTurns: 3,
  retrievalTopK: 8,
  contextBudgetChars: 6000,
  maxSelfMemories: 60,
  maxUserMemories: 80,
  immersion: 'strong'
}
