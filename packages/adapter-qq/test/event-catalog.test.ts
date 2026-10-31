import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QQ_EVENTS } from '../src/events/catalog'

interface EventSnapshotEntry {
  type: string
  intent: string
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../../docs/qq-api-v2-endpoints.json', import.meta.url), 'utf8')
) as { events: EventSnapshotEntry[] }

describe('QQ 事件目录', () => {
  it('快照包含 22 个事件', () => {
    expect(snapshot.events).toHaveLength(22)
    expect(new Set(snapshot.events.map((entry) => entry.type)).size).toBe(22)
  })

  it('事件目录与快照双向一致', () => {
    expect(QQ_EVENTS).toHaveLength(22)
    expect(new Set(QQ_EVENTS.map((event) => event.type)).size).toBe(22)

    for (const entry of snapshot.events) {
      const event = QQ_EVENTS.find((item) => item.type === entry.type)
      expect(event, `快照事件缺少目录定义：${entry.type}`).toBeTruthy()
      expect(event).toMatchObject({ intent: entry.intent })
    }

    for (const event of QQ_EVENTS) {
      expect(
        snapshot.events.some((entry) => entry.type === event.type),
        `目录事件未写入快照：${event.type}`
      ).toBe(true)
    }
  })
})
