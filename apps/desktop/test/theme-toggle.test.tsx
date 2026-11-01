// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../src/renderer/src/components/ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'theme-switching')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'theme-switching')
  })

  it('点击后经过颜色过渡切换为深色并持久化，再次点击恢复浅色', async () => {
    const { unmount } = render(<ThemeToggle />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('arqqbot.theme')).toBe('dark')
    expect(document.querySelector('.theme-reveal')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('arqqbot.theme')).toBe('light')

    unmount()
  })
})
