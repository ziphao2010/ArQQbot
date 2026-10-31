const LIMITS = {
  group: { windowMs: 5 * 60_000, max: 5 },
  c2c: { windowMs: 60 * 60_000, max: 4 }
} as const

interface Bucket {
  startedAt: number
  count: number
}

export class PassiveReplyQuota {
  private readonly buckets = new Map<string, Bucket>()
  private readonly seqs = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  consume(scene: 'group' | 'c2c', msgId: string): boolean {
    const limit = LIMITS[scene]
    const now = this.now()
    const existing = this.buckets.get(msgId)

    if (!existing || now - existing.startedAt >= limit.windowMs) {
      this.buckets.set(msgId, { startedAt: now, count: 1 })
      return true
    }

    if (existing.count >= limit.max) return false
    existing.count += 1
    return true
  }

  nextSeq(msgId: string): number {
    const next = (this.seqs.get(msgId) ?? 0) + 1
    this.seqs.set(msgId, next)
    return next
  }
}
