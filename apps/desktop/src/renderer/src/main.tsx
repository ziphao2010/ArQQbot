import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { readInitialTheme } from './components/ThemeToggle'
import './index.css'

document.documentElement.classList.toggle('dark', readInitialTheme() === 'dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
