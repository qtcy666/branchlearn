import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SplashScreen } from './components/SplashScreen'
import './styles/tokens.css'
import './styles/global.css'
import './styles/today.css'
import './styles/share.css'
import './styles/polish.css'
import './styles/feedback.css'
import './styles/hero.css'
import './styles/canvas.css'
import './styles/workspace.css'
import './styles/landing.css'
import './styles/ai.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('找不到 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <SplashScreen />
    <App />
  </StrictMode>,
)
