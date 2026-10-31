/// <reference types="vite/client" />
import type { DesktopApi } from '@arqqbot/shared'

declare global {
  interface Window {
    arqqbot: DesktopApi
  }
}

export {}
