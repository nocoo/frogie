import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Apply theme before render to avoid flash
const stored = localStorage.getItem('theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const isDark = stored === 'dark' || (stored !== 'light' && prefersDark)
document.documentElement.classList.toggle('dark', isDark)
document.documentElement.classList.toggle('light', !isDark)

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(<App />)
