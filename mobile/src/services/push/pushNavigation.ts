/**
 * pushNavigation (PUSH-02) — traduz o payload de um push tocado em navegação.
 *
 * O backend envia `data: { type, notification_id }`. Reusamos
 * `getNotificationTarget(type)` (mesma regra do deep link in-app, NOT-03):
 *  - tipo com aba destino → abre a aba do módulo (ServiceOrders/Scheduling/Inventory);
 *  - tipo sem destino (ou desconhecido) → abre a tela de Notificações.
 *
 * Separado do provider para ser testável puro (mapeamento data → ação), sem
 * montar componentes nem mockar listeners nativos.
 */
import { getNotificationTarget } from '@/constants/notifications';
import { navigationRef } from '@/navigation/navigationRef';

/** Shape do `content.data` do push (espelha o que o backend envia). */
export interface PushData {
    type?: string;
    notification_id?: number | string;
    [key: string]: unknown;
}

/**
 * Decide o destino (rota + params) a partir do `data.type`. Exportado para teste.
 * Retorna sempre uma ação válida do AppStack:
 *  - aba do módulo (via `Tabs`) quando há destino;
 *  - tela `Notifications` como fallback.
 */
export function resolvePushDestination(data: PushData | undefined | null):
    | { screen: 'Tabs'; tab: 'ServiceOrders' | 'Scheduling' | 'Inventory' }
    | { screen: 'Notifications' } {
    const target = getNotificationTarget(data?.type ?? '');
    if (target) {
        return { screen: 'Tabs', tab: target.tab };
    }
    return { screen: 'Notifications' };
}

/**
 * Navega de fato em resposta a um toque no push. No-op seguro se o
 * NavigationContainer ainda não estiver pronto (cold start em andamento).
 */
export function navigateFromPush(data: PushData | undefined | null): void {
    if (!navigationRef.isReady()) return;
    const dest = resolvePushDestination(data);
    if (dest.screen === 'Tabs') {
        navigationRef.navigate('Tabs', { screen: dest.tab });
    } else {
        navigationRef.navigate('Notifications');
    }
}
