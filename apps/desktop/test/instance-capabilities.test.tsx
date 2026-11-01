// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi, QQCapabilitySnapshot } from '@arqqbot/shared'
import { InstanceDetail } from '../src/renderer/src/pages/InstanceDetail'

const snapshot: QQCapabilitySnapshot = {
  instanceId: 'inst-1',
  intents: ['public_messages'],
  running: true,
  capabilities: [
    {
      id: 'group.info',
      module: 'group',
      available: true,
      requiredIntents: ['public_messages'],
      endpointCount: 1
    },
    {
      id: 'guild.get',
      module: 'guild',
      available: false,
      requiredIntents: ['guilds'],
      endpointCount: 1,
      reason: '缺少 intents：guilds'
    }
  ]
}

function makeApi(updateIntents = vi.fn(async () => undefined)): DesktopApi {
  return {
    instances: {
      status: vi.fn(async () => ({
        id: 'inst-1',
        state: 'running' as const,
        connected: true,
        sent: 0,
        received: 0
      }))
    },
    plugins: { list: vi.fn(async () => []) },
    logs: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      onEntry: vi.fn(() => () => undefined)
    },
    qq: {
      capabilities: vi.fn(async () => snapshot),
      updateIntents
    }
  } as unknown as DesktopApi
}

describe('InstanceDetail 能力页签', () => {
  it('展示模块能力并保存 intents', async () => {
    const updateIntents = vi.fn(async () => undefined)
    window.arqqbot = makeApi(updateIntents)

    const { unmount } = render(<InstanceDetail instanceId="inst-1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('实例详情')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '能力' }))
    await waitFor(() => expect(screen.getByText('WebSocket 与 intents')).toBeTruthy())

    expect(screen.getByText('群管理')).toBeTruthy()
    expect(screen.getAllByText('频道').length).toBeGreaterThan(0)
    expect(screen.getByText('guild.get')).toBeTruthy()
    expect(screen.getByText('缺少 intents：guilds')).toBeTruthy()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[2]!)
    fireEvent.click(screen.getByRole('button', { name: '保存 intents' }))

    await waitFor(() =>
      expect(updateIntents).toHaveBeenCalledWith('inst-1', ['public_messages', 'guilds'])
    )
    expect(screen.getByText('已保存，重启实例后生效')).toBeTruthy()
    unmount()
  })
})
