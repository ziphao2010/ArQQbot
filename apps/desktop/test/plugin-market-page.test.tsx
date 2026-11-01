// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, PluginMarketEntry, PluginMarketSnapshot } from '@arqqbot/shared'
import { PluginMarket } from '../src/renderer/src/pages/PluginMarket'

const entry: PluginMarketEntry = {
  id: 'example',
  packageName: 'arqqbot-plugin-example',
  displayName: '示例插件',
  description: '最小可运行的插件示例',
  version: '0.1.0',
  repo: 'https://github.com/owner/arqqbot-plugin-example',
  homepage: 'https://github.com/owner/arqqbot-plugin-example#readme',
  downloadUrl: 'https://example.com/plugin-example.tar.gz',
  tags: ['arqqbot-plugin'],
  sha256: null
}

const snapshot: PluginMarketSnapshot = {
  indexUrl: 'https://example.com/index.json',
  generatedAt: '2026-11-01T00:00:00.000Z',
  plugins: [entry],
  installedIds: []
}

describe('PluginMarket', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('加载索引并安装插件', async () => {
    const marketplace = vi.fn(async () => snapshot)
    const install = vi.fn(async () => undefined)
    window.arqqbot = {
      plugins: { marketplace, install }
    } as unknown as DesktopApi

    const { unmount } = render(<PluginMarket onBack={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('示例插件')).toBeTruthy())
    expect(screen.getByText(/v0\.1\.0/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => expect(install).toHaveBeenCalledWith(entry))
    await waitFor(() =>
      expect(screen.getByText('已安装，重启实例后可在插件页启用')).toBeTruthy()
    )

    unmount()
  })
})
