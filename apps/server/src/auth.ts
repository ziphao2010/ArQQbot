import { timingSafeEqual } from 'node:crypto'

export function tokensEqual(expected: string, actual: string): boolean {
  if (!expected || !actual) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim()
}
