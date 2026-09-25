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
import { parseRelatedUrl } from '@/utils/relatedUrl';

/** Shape do `content.data` do push (espelha o que o backend envia). */
export interface PushData {
    type?: string;
    notification_id?: number | string;
    /** Link do recurso (ex.: `"/estoque?roll=123"`) — enviado pelo backend. */
    related_url?: string | null;
    [key: string]: unknown;
}

export type PushDestination =
    | { screen: 'Tabs'; tab: 'ServiceOrders' | 'Scheduling' | 'Inventory' }
    | { screen: 'RollDetail'; id: number }
    | { screen: 'TimeClock' }
    | { screen: 'Notifications' };

/**
 * Decide o destino (rota + params) a partir do payload da push. Exportado para
 * teste. Ordem de prioridade:
 *  - `related_url` reconhecido (ex.: `?roll=<id>`) → detalhe do recurso (mais
 *    específico; abre a bobina no Estoque);
 *  - `time_clock_reminder` → tela `TimeClock` (lembrete de bater o ponto);
 *  - aba do módulo (via `Tabs`) quando o tipo tem destino;
 *  - tela `Notifications` como fallback.
 */
export function resolvePushDestination(data: PushData | undefined | null): PushDestination {
    // related_url é o mais específico: aponta o recurso exato da notificação.
    const related = parseRelatedUrl(data?.related_url);
    if (related?.type === 'roll') {
        return { screen: 'RollDetail', id: related.id };
    }
    // Lembrete de ponto: abre a tela de Ponto Eletrônico diretamente.
    if (data?.type === 'time_clock_reminder') {
        return { screen: 'TimeClock' };
    }
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
    if (dest.screen === 'RollDetail') {
        // Navegação aninhada: aba Estoque → tela de detalhe da bobina.
        navigationRef.navigate('Tabs', {
            screen: 'Inventory',
            params: { screen: 'RollDetail', params: { id: dest.id } },
        });
    } else if (dest.screen === 'Tabs') {
        navigationRef.navigate('Tabs', { screen: dest.tab });
    } else if (dest.screen === 'TimeClock') {
        navigationRef.navigate('TimeClock');
    } else {
        navigationRef.navigate('Notifications');
    }
}
