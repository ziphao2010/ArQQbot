const CJK = /[\u4e00-\u9fff]/

export function extractKeywords(text: string, limit = 16): string[] {
  const lower = text.toLowerCase()
  const result: string[] = []

  for (const match of lower.matchAll(/[a-z0-9]{2,}/g)) {
    result.push(match[0])
  }

  for (const segment of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (segment.length <= 2) {
      result.push(segment)
      continue
    }
    for (let index = 0; index + 2 <= segment.length; index += 1) {
      result.push(segment.slice(index, index + 2))
    }
  }

  const seen = new Set<string>()
  const keywords: string[] = []
  for (const item of result) {
    if (item.length < 2 || seen.has(item)) continue
    seen.add(item)
    keywords.push(item)
    if (keywords.length >= limit) break
  }
  return keywords
}

export function keywordOverlap(query: string[], memory: string[]): number {
  if (query.length === 0 || memory.length === 0) return 0
  const memorySet = new Set(memory)
  let hits = 0
  for (const keyword of query) {
    if (memorySet.has(keyword)) hits += 1
  }
  return hits / query.length
}

export function isCjkText(text: string): boolean {
  return CJK.test(text)
}

export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:："'“”‘’()（）[\]【】<>《》\-—_]/g, '')
}

export function textSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a)
  const right = normalizeForCompare(b)
  if (left.length === 0 || right.length === 0) return 0
  if (left === right) return 1
  const leftKeys = new Set(extractKeywords(a, 32))
  const rightKeys = new Set(extractKeywords(b, 32))
  if (leftKeys.size === 0 || rightKeys.size === 0) return 0
  let intersection = 0
  for (const key of leftKeys) {
    if (rightKeys.has(key)) intersection += 1
  }
  const union = new Set([...leftKeys, ...rightKeys]).size
  return intersection / union
}
