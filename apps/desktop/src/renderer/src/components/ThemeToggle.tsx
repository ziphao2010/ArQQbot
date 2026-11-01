import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'arqqbot.theme'
const TRANSITION_MS = 350

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

  useEffect(() => {
    window.arqqbot?.window?.setTheme?.(theme)
  }, [theme])

  function toggleTheme(): void {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement

    root.classList.add('theme-switching')
    void root.offsetWidth
    root.classList.toggle('dark', next === 'dark')
    window.localStorage.setItem(STORAGE_KEY, next)
    setTheme(next)

    window.setTimeout(() => root.classList.remove('theme-switching'), TRANSITION_MS)
  }

  const dark = theme === 'dark'

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-neutral-600 transition-colors"
      aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
      onClick={() => toggleTheme()}
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
