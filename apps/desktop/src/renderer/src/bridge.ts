import { createHttpApi, hasWebToken } from './http-api'

// 桌面端由 preload 注入 window.arqqbot；端口模式回退到同源 HTTP/WebSocket API。
export const isWebConsole = typeof window !== 'undefined' && !window.arqqbot

if (isWebConsole && hasWebToken()) {
  window.arqqbot = createHttpApi()
}
