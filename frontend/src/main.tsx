import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { setupPWAUpdate } from './lib/pwa-update'

setupPWAUpdate()
// Aplica o tema escuro salvo antes do primeiro render — evita flash
try {
  if (localStorage.getItem('aems-dark-mode') === 'true') {
    document.documentElement.classList.add('dark')
  }
} catch {
  // localStorage indisponível — mantém o tema claro
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
