import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const stored = (() => {
  try {
    return window.localStorage.getItem('theme')
  } catch {
    return null
  }
})()
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const isDark = stored === 'dark' || (stored !== 'light' && prefersDark)
document.documentElement.classList.toggle('dark', isDark)
document.documentElement.classList.toggle('light', !isDark)
document.documentElement.dataset['mode'] = isDark ? 'dark' : 'light'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(<App />)
