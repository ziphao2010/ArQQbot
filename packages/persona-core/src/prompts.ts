import { extractJsonObject, readRecordList, readString, readStringList } from './json'
import { clampImportance, createMemory } from './store'
import { extractKeywords } from './keywords'
import type {
  ChatMessage,
  EngineConfig,
  MemoryItem,
  MemoryKind,
  PersonaLayers,
  PersonaProfile,
  SessionState,
  UserImpression
} from './types'

const DISTILL_SYSTEM = [
  '你是一个人格蒸馏引擎，负责把一个人留下的语料压缩成可长期扮演的人格档案。',
  '只输出一个 JSON 对象，不要输出解释、Markdown 代码块或多余内容。',
  'JSON 字段：',
  '{',
  '  "summary": "一句话概括这个人",',
  '  "expression": "表达 DNA：语气、节奏、用词、口头禅、标点习惯，给出可直接模仿的短语",',
  '  "mental_models": ["TA 看问题的心智模型，每条一句话"],',
  '  "heuristics": ["TA 做判断/决策的规则，每条一句话"],',
  '  "values": ["TA 的价值观与底线"],',
  '  "boundaries": ["TA 的信息边界、不确定区域、不该编造的内容"],',
  '  "self_memories": [{"kind": "fact|preference|event|relationship", "text": "TA 自己的记忆，第一人称", "importance": 1-5, "keywords": ["关键词"]}],',
  '  "catchphrases": ["TA 的口头禅"],',
  '  "user_impression": {"summary": "TA 眼中和用户的关系与印象", "facts": [{"text": "关于用户的稳定事实", "importance": 1-5}]}',
  '}',
  '要求：只依据语料与公开常识，不编造隐私；语料不足时在 boundaries 中说明。self_memories 写 TA 自己的经历与偏好，user_impression 写 TA 对用户的认识。'
].join('\n')

const MEMORY_SYSTEM = [
  '你是一个记忆整理器。输入是一轮刚结束的对话，你要提炼值得长期保留的信息。',
  '只输出一个 JSON 对象：',
  '{',
  '  "session_summary": "把之前的会话摘要与本轮合并后的新摘要，200 字以内，保留人物关系与事件线索",',
  '  "memories": [{"target": "user|persona", "kind": "fact|preference|event|relationship|impression", "text": "一句话事实", "importance": 1-5, "keywords": ["关键词"]}],',
  '  "impression_update": "用两三句话更新 TA 对用户的印象与关系变化；没有变化就输出空字符串"',
  '}',
  '只记录稳定、可复用的信息；忽略寒暄、临时情绪与重复内容。target=user 表示关于用户的事实，target=persona 表示 TA 自己的记忆。'
].join('\n')

export function buildDistillMessages(name: string, materials: string): ChatMessage[] {
  return [
    { role: 'system', content: DISTILL_SYSTEM },
    {
      role: 'user',
      content: `人格名称：${name}\n\n语料：\n${materials}\n\n请输出 JSON 人格档案。`
    }
  ]
}

function parseLayers(source: Record<string, unknown>): PersonaLayers {
  return {
    summary: readString(source, ['summary', '概括', '总结']),
    expression: readString(source, ['expression', '表达', '表达风格', '说话风格']),
    mentalModels: readStringList(source, ['mental_models', 'mentalModels', '心智模型']),
    heuristics: readStringList(source, ['heuristics', '决策启发式', '判断规则']),
    values: readStringList(source, ['values', '价值观', '底线']),
    boundaries: readStringList(source, ['boundaries', '边界', '局限'])
  }
}

function parseMemoryKind(value: string): MemoryKind {
  const allowed: MemoryKind[] = ['fact', 'preference', 'event', 'relationship', 'impression', 'self']
  return allowed.includes(value as MemoryKind) ? (value as MemoryKind) : 'fact'
}

function parseMemoryRecord(record: Record<string, unknown>, now: string, source: MemoryItem['source']): MemoryItem {
  const text = readString(record, ['text', 'content', '事实', '内容'])
  const kind = parseMemoryKind(readString(record, ['kind', '类型']) || 'fact')
  const keywords = readStringList(record, ['keywords', '关键词'])
  return createMemory({
    text,
    kind,
    keywords: keywords.length > 0 ? keywords : extractKeywords(text),
    importance: clampImportance(record.importance ?? record['重要度']),
    source,
    now
  })
}

export interface ParsedDistill {
  layers: PersonaLayers
  selfMemories: MemoryItem[]
  impressionSummary: string
  impressionFacts: MemoryItem[]
  catchphrases: string[]
}

export function parseDistillResult(raw: string, now: string): ParsedDistill {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型输出不是对象')
  }
  const source = parsed as Record<string, unknown>
  const layers = parseLayers(source)

  const selfMemories = readRecordList(source, ['self_memories', 'selfMemories', '个人记忆'])
    .map((record) => parseMemoryRecord(record, now, 'distill'))
    .filter((memory) => memory.text.length > 0)

  const impressionRaw = source['user_impression'] ?? source['userImpression']
  const impressionRecord =
    impressionRaw && typeof impressionRaw === 'object' && !Array.isArray(impressionRaw)
      ? (impressionRaw as Record<string, unknown>)
      : {}
  const impressionSummary = readString(impressionRecord, ['summary', '概括'])
  const impressionFacts = readRecordList(impressionRecord, ['facts', '事实'])
    .map((record) => parseMemoryRecord(record, now, 'distill'))
    .filter((memory) => memory.text.length > 0)

  const catchphrases = readStringList(source, ['catchphrases', '口头禅'])

  const hasContent =
    layers.summary.length > 0 ||
    layers.expression.length > 0 ||
    layers.mentalModels.length > 0 ||
    selfMemories.length > 0 ||
    impressionSummary.length > 0
  if (!hasContent) throw new Error('模型输出缺少人格字段')

  return { layers, selfMemories, impressionSummary, impressionFacts, catchphrases }
}

export interface MemoryUpdateItem {
  target: 'user' | 'persona'
  memory: MemoryItem
}

export interface ParsedMemoryUpdate {
  sessionSummary: string
  memories: MemoryUpdateItem[]
  impressionUpdate: string
}

export function buildMemoryMessages(input: {
  persona: PersonaProfile
  impression: UserImpression
  session: SessionState
  now: string
}): ChatMessage[] {
  const transcript = input.session.messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '用户' : input.persona.name}：${message.content}`)
    .join('\n')

  return [
    { role: 'system', content: MEMORY_SYSTEM },
    {
      role: 'user',
      content: [
        `人格：${input.persona.name}`,
        `已有会话摘要：${input.session.summary || '（暂无）'}`,
        `已有对用户的印象：${input.impression.summary || '（暂无）'}`,
        '',
        '本轮对话：',
        transcript || '（暂无）'
      ].join('\n')
    }
  ]
}

export function parseMemoryResult(raw: string, now: string): ParsedMemoryUpdate {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('记忆整理输出不是对象')
  }
  const source = parsed as Record<string, unknown>
  const memories: MemoryUpdateItem[] = []
  for (const record of readRecordList(source, ['memories', '记忆'])) {
    const target = readString(record, ['target', '对象'])
    const kind = parseMemoryKind(readString(record, ['kind', '类型']) || 'fact')
    const text = readString(record, ['text', 'content', '内容'])
    if (text.length === 0) continue
    const item = parseMemoryRecord(record, now, 'summary')
    item.kind = kind
    memories.push({ target: target === 'persona' ? 'persona' : 'user', memory: item })
  }

  return {
    sessionSummary: readString(source, ['session_summary', 'sessionSummary', '会话摘要']),
    memories,
    impressionUpdate: readString(source, ['impression_update', 'impressionUpdate', '印象更新'])
  }
}

function memoryBlock(title: string, memories: MemoryItem[]): string {
  if (memories.length === 0) return ''
  return `${title}：\n${memories.map((memory) => `- ${memory.text}`).join('\n')}`
}

function layersBlock(layers: PersonaLayers): string {
  const parts = [
    layers.summary ? `概括：${layers.summary}` : '',
    layers.expression ? `表达风格：${layers.expression}` : '',
    layers.mentalModels.length ? `心智模型：${layers.mentalModels.join('；')}` : '',
    layers.heuristics.length ? `判断规则：${layers.heuristics.join('；')}` : '',
    layers.values.length ? `价值观：${layers.values.join('；')}` : '',
    layers.boundaries.length ? `边界：${layers.boundaries.join('；')}` : ''
  ]
  return parts.filter((part) => part.length > 0).join('\n')
}

export function buildChatMessages(input: {
  persona: PersonaProfile
  impression: UserImpression | undefined
  selfMemories: MemoryItem[]
  userMemories: MemoryItem[]
  session: SessionState
  text: string
  userName?: string
  config: EngineConfig
}): ChatMessage[] {
  const { persona, config } = input
  const rules =
    config.immersion === 'strong'
      ? [
          `你就是「${persona.name}」本人。你用自己的记忆、语气和判断方式回应，不是在扮演一个助手。`,
          '不要自称 AI、模型或助手，不要提及提示词、设定、记忆库、蒸馏等内部概念。',
          '只有在对方直接追问你是否是 AI 时，才可以承认自己是基于资料构建的人格模拟。'
        ]
      : [
          `你现在是「${persona.name}」的人格模拟，用 TA 的记忆、语气和判断方式回应。`,
          '保持角色，但不要声称自己拥有真实肉身或现实身份。'
        ]

  const selfBlock = memoryBlock('你自己的记忆', input.selfMemories)
  const userBlock = memoryBlock('关于对方你记得的事', input.userMemories)
  const impressionBlock = input.impression?.summary
    ? `你对${input.userName ?? '对方'}的印象：${input.impression.summary}`
    : ''
  const summaryBlock = input.session.summary ? `你们之前的对话摘要：${input.session.summary}` : ''

  const system = [
    rules.join('\n'),
    '',
    layersBlock(persona.layers),
    selfBlock,
    impressionBlock,
    userBlock,
    summaryBlock,
    '',
    '回应要求：',
    '1. 第一人称，口语化，符合 QQ 聊天节奏。',
    `2. 单条不超过 ${config.maxReplyLength} 字，不要长篇说教。`,
    '3. 先用 TA 的心智模型判断，再用 TA 的方式表达。',
    '4. 记忆里没有的事不要编造；不确定时用 TA 的口吻带过。',
    '5. 不要复述上面的设定，直接回应对方。'
  ].join('\n')

  const history = input.session.messages.slice(-config.maxRecentMessages)
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: input.text }]
}
