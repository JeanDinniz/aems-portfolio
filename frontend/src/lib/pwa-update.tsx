import { registerSW } from 'virtual:pwa-register'
import { toast } from '@/hooks/use-toast'
import { hasPendingWork, onPendingWorkChange } from '@/lib/pendingWork'

const CHECK_INTERVAL_MS = 15_000
const RELOAD_DELAY_MS = 3_000

/**
 * Auto-update do PWA pós-deploy (elimina o Ctrl+F5).
 *
 * - Verifica o /sw.js a cada 15s e imediatamente ao voltar para a aba —
 *   um deploy é detectado em até ~15s com o sistema aberto.
 * - Ao detectar uma versão nova em "waiting", envia SKIP_WAITING e recarrega
 *   quando o novo service worker assume (evento 'controllerchange').
 *
 * Por que não confiar só no onNeedRefresh: o workbox só dispara o evento
 * 'waiting' (→ onNeedRefresh) quando ESTA aba instalou o SW novo. Se o SW novo
 * já estava esperando quando a aba carregou, ou foi instalado por outra aba
 * (evento 'externalwaiting'), o onNeedRefresh NÃO dispara e a versão nova fica
 * presa em "waiting" indefinidamente. Por isso tratamos registration.waiting
 * diretamente, no registro e a cada verificação.
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

    // Recarrega uma única vez quando o SW novo assume o controle da página.
    // Vale para qualquer caminho de ativação (SKIP_WAITING abaixo ou updateSW).
    let refreshing = false
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
    })

    // Garante que o aviso/reload seja agendado uma vez só.
    let refreshScheduled = false

    /**
     * Avisa e aplica a atualização. Se houver trabalho não salvo (ex.: O.S. em
     * digitação com fotos), NÃO recarrega automaticamente — avisa e deixa o
     * usuário atualizar quando quiser; assim que o formulário for salvo/fechado,
     * aplica sozinho.
     */
    const promptRefresh = (apply: () => void) => {
        if (refreshScheduled) return
        refreshScheduled = true

        if (hasPendingWork()) {
            toast({
                title: 'Nova versão disponível',
                description:
                    'Salve o que está fazendo. A atualização será aplicada ao concluir, ou toque em Atualizar agora.',
                duration: 1000 * 60 * 30,
                action: (
                    <button
                        onClick={apply}
                        className="rounded-md bg-[#F5A800] px-3 py-1.5 text-sm font-semibold text-black"
                    >
                        Atualizar agora
                    </button>
                ),
            })
            const unsubscribe = onPendingWorkChange(() => {
                if (!hasPendingWork()) {
                    unsubscribe()
                    apply()
                }
            })
            return
        }

        toast({
            title: 'Nova versão disponível',
            description: 'O sistema será atualizado em instantes...',
        })
        setTimeout(apply, RELOAD_DELAY_MS)
    }

    const updateSW = registerSW({
        immediate: true,
        onRegisteredSW(_url, registration) {
            if (!registration) return

            // Aplica a versão nova mandando SKIP_WAITING direto ao worker que
            // está esperando (o sw.js trata essa mensagem). O reload vem pelo
            // 'controllerchange'. Funciona inclusive para o caso externalwaiting.
            const applyWaiting = () => {
                registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
            }

            const handleWaiting = () => {
                if (registration.waiting) {
                    promptRefresh(applyWaiting)
                }
            }

            const check = () => registration.update().then(handleWaiting).catch(() => {})

            // Um SW novo já pode estar esperando no momento em que a aba carrega.
            handleWaiting()
            setInterval(check, CHECK_INTERVAL_MS)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') check()
            })
        },
        onNeedRefresh() {
            // Caminho padrão do workbox: SW novo instalado com ESTA aba aberta.
            promptRefresh(() => updateSW(true))
        },
    })
}
