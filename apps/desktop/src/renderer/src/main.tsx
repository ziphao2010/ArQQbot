import './bridge'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { WebTokenGate } from './components/WebTokenGate'
import { readInitialTheme } from './components/ThemeToggle'
import { isWebConsole } from './bridge'
import './index.css'

document.documentElement.classList.toggle('dark', readInitialTheme() === 'dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isWebConsole && !window.arqqbot ? <WebTokenGate /> : <App />}
  </React.StrictMode>
)
