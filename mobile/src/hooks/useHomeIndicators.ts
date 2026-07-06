import { useQuery } from '@tanstack/react-query';

import { schedulingService } from '@/services/api/scheduling.service';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { useStoreStore } from '@/stores/store.store';
import { useCanView } from '@/hooks/useMyPermissions';
import type { TodaySummary, SchedulingStoreSummary } from '@/types/scheduling.types';

/**
 * Indicadores da Home (grade 2×2). Deriva de endpoints NÃO-gated (resumo de
 * agendamento + total de O.S.), pois a Home é exibida a todos os perfis — os
 * endpoints de /analytics são restritos a Owner/galpão e não servem aqui.
 *
 * Cada indicador é gated pela permissão do módulo correspondente (`enabled`):
 * - Ordens em Atraso / Agendamentos Hoje / Veículos Previstos → `scheduling`
 * - O.S do Mês → `service_orders`
 * Sem permissão (ou carregando/erro) → valor `undefined` → a tela mostra "—".
 *
 * Respeita a loja selecionada globalmente (`selectedStoreId`; null = todas).
 */

/** Data local (YYYY-MM-DD) sem passar por UTC (evita shift de fuso). */
function isoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export interface HomeIndicators {
    /** Agendamentos atrasados (status de exibição `atrasado`). */
    overdue?: number;
    /** Agendamentos de hoje (board de hoje, exclui cancelados). */
    todayCount?: number;
    /** O.S. com data de serviço no mês corrente. */
    osThisMonth?: number;
    /** Veículos previstos nos próximos 14 dias (exclui cancelados). */
    forecast14d?: number;
    isLoading: boolean;
}

function sumForStore<T extends { store_id: number }>(
    rows: T[] | undefined,
    selectedStoreId: number | null,
    pick: (row: T) => number
): number | undefined {
    if (!rows) return undefined;
    const filtered =
        selectedStoreId === null ? rows : rows.filter((r) => r.store_id === selectedStoreId);
    return filtered.reduce((acc, r) => acc + pick(r), 0);
}

export function useHomeIndicators(): HomeIndicators {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const canScheduling = useCanView('scheduling');
    const canOS = useCanView('service_orders');

    const now = new Date();
    const today = isoDay(now);
    const monthStart = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const in14 = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14));

    // Board de hoje (atrasado + hoje). getTodaySummary aceita store_id (null = todas).
    const todayQuery = useQuery<TodaySummary>({
        queryKey: ['scheduling-summary', selectedStoreId],
        queryFn: () => schedulingService.getTodaySummary(selectedStoreId),
        enabled: canScheduling,
        staleTime: 60_000,
    });

    // Previsão 14 dias: resumo por loja no intervalo (retorna todas as lojas).
    const forecastQuery = useQuery<SchedulingStoreSummary[]>({
        queryKey: ['scheduling-store-summary', { date_from: today, date_to: in14 }],
        queryFn: () => schedulingService.getStoreSummary({ date_from: today, date_to: in14 }),
        enabled: canScheduling,
        staleTime: 60_000,
    });

    // O.S. do mês: só o total interessa (limit 1). store_id da loja selecionada.
    const osMonthQuery = useQuery({
        queryKey: ['service-orders', 'home-month', selectedStoreId, monthStart, today],
        queryFn: () =>
            serviceOrdersService.getAll(
                {
                    store_id: selectedStoreId ?? undefined,
                    date_from: monthStart,
                    date_to: today,
                },
                0,
                1
            ),
        enabled: canOS,
        staleTime: 60_000,
    });

    const overdue = canScheduling ? todayQuery.data?.atrasado : undefined;

    const todayCount = canScheduling
        ? todayQuery.data
            ? todayQuery.data.agendado +
              todayQuery.data.atencao +
              todayQuery.data.em_execucao +
              todayQuery.data.atrasado +
              todayQuery.data.finalizado
            : undefined
        : undefined;

    const forecast14d = canScheduling
        ? sumForStore(
              forecastQuery.data,
              selectedStoreId,
              (r) => r.total - r.cancelado
          )
        : undefined;

    const osThisMonth = canOS ? osMonthQuery.data?.total : undefined;

    const isLoading =
        (canScheduling && (todayQuery.isLoading || forecastQuery.isLoading)) ||
        (canOS && osMonthQuery.isLoading);

    return { overdue, todayCount, osThisMonth, forecast14d, isLoading };
}
