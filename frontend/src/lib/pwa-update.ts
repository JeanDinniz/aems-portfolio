import { registerSW } from 'virtual:pwa-register'
import { toast } from '@/hooks/use-toast'

const CHECK_INTERVAL_MS = 15_000
const RELOAD_DELAY_MS = 3_000

/**
 * Auto-update do PWA pós-deploy (elimina o Ctrl+F5).
 *
 * - Verifica o /sw.js a cada 15s e imediatamente ao voltar para a aba —
 *   um deploy é detectado em até ~15s com o sistema aberto.
 * - Ao detectar versão nova: toast de aviso e reload automático em ~3s
 *   (updateServiceWorker(true) envia SKIP_WAITING e recarrega quando o
 *   novo service worker assume).
 *
 * Em desenvolvimento o PWA está desligado (devOptions.enabled=false);
 * aqui apenas desregistramos SWs órfãos e limpamos caches antigos.
 */
export function setupPWAUpdate() {
    if (import.meta.env.DEV) {
        // Um SW órfão (sobra de build de produção servido nesta mesma porta)
        // intercepta os fetches do dev server e polui o console com erros.
        navigator.serviceWorker
            ?.getRegistrations()
            .then((regs) => regs.forEach((r) => r.unregister()))
            .catch(() => {})
        if ('caches' in window) {
            caches.keys()
                .then((keys) => keys.forEach((k) => caches.delete(k)))
                .catch(() => {})
        }
        return
    }

    const updateSW = registerSW({
        immediate: true,
        onRegisteredSW(_url, registration) {
            if (!registration) return
            const check = () => registration.update().catch(() => {})
            setInterval(check, CHECK_INTERVAL_MS)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') check()
            })
        },
        onNeedRefresh() {
            toast({
                title: 'Nova versão disponível',
                description: 'O sistema será atualizado em instantes...',
            })
            setTimeout(() => updateSW(true), RELOAD_DELAY_MS)
        },
    })
}
