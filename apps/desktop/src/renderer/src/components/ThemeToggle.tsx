import { useEffect, useRef, useState, type MouseEvent } from 'react'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'arqqbot.theme'
const DARK_BG = '#0b0b0f'
const LIGHT_BG = '#f5f5f7'
const SWITCH_DELAY_MS = 300
const ANIMATION_MS = 700

export function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    window.arqqbot?.window?.setTheme?.(theme)
  }, [theme])

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer)
      timersRef.current = []
      overlayRef.current?.remove()
      overlayRef.current = null
    }
  }, [])

  function toggleTheme(event: MouseEvent<HTMLButtonElement>): void {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    const rect = event.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    overlayRef.current?.remove()
    const overlay = document.createElement('div')
    overlay.className = 'theme-reveal'
    overlay.style.setProperty('--theme-x', `${x}px`)
    overlay.style.setProperty('--theme-y', `${y}px`)
    overlay.style.backgroundColor = next === 'dark' ? DARK_BG : LIGHT_BG
    document.body.appendChild(overlay)
    overlayRef.current = overlay

    timersRef.current.push(
      window.setTimeout(() => {
        document.documentElement.classList.toggle('dark', next === 'dark')
        window.localStorage.setItem(STORAGE_KEY, next)
        setTheme(next)
      }, SWITCH_DELAY_MS),
      window.setTimeout(() => {
        overlay.remove()
        if (overlayRef.current === overlay) overlayRef.current = null
      }, ANIMATION_MS)
    )
  }

  const dark = theme === 'dark'

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-neutral-600 transition-colors"
      aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
      onClick={toggleTheme}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}
