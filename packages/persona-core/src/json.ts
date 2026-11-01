export function extractJsonObject(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    return JSON.parse(text)
  } catch {
    // 继续尝试截取第一个完整对象
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      // 落到下方统一报错
    }
  }

  throw new Error('模型输出不是合法 JSON')
}

export function readString(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

export function readStringList(source: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
        .split(/\n|；|;/)
        .map((item) => item.replace(/^[-*]\s*/, '').trim())
        .filter((item) => item.length > 0)
    }
  }
  return []
}

export function readRecordList(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown>[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    }
  }
  return []
}

export function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0))}…`
}
