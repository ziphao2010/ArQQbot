// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi, InstanceSummary } from '@arqqbot/shared'
import { InstanceList } from '../src/renderer/src/pages/InstanceList'

const summary: InstanceSummary = {
  id: 'inst-1',
  name: '测试实例',
  appId: '10001',
  env: 'sandbox',
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  state: 'running',
  requiresRestart: false
}

describe('InstanceList', () => {
  it('加载并渲染实例卡片', async () => {
    const api = {
      instances: { list: vi.fn(async () => [summary]) }
    } as unknown as DesktopApi
    window.arqqbot = api

    const { unmount } = render(<InstanceList onCreate={vi.fn()} onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('测试实例')).toBeTruthy())
    expect(screen.getByText('运行中')).toBeTruthy()
    unmount()
  })
})
