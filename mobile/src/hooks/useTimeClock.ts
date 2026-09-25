import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { timeClockService } from '@/services/api/time-clock.service';
import { useAuthStore } from '@/stores/auth.store';
import * as punchQueue from '@/services/time-clock/punchQueue';
import type { PunchQueueItem } from '@/services/time-clock/punchQueue';
import type {
    EnrollFacePayload,
    MyMirrorPeriod,
    PunchPayload,
    TimeClockMirrorFilters,
} from '@/types/time-clock.types';

/**
 * Hooks do Ponto Eletrônico (TanStack Query v5).
 *
 * - `useTimeClockMe`: estado do funcionário logado + batidas. Só dispara logado.
 *   É por usuário (não injeta `store_id`). `staleTime` curto porque a lista muda
 *   a cada batida; a mutation invalida esta chave para refletir na hora.
 * - `usePunch`: registra a batida e invalida `['time-clock','me']`. O feedback
 *   (Toast/haptics) e o tratamento de 409/422 ficam na tela — a mutation apenas
 *   propaga o erro.
 */

const TIME_CLOCK_ME_KEY = ['time-clock', 'me'] as const;

export function useTimeClockMe() {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    return useQuery({
        queryKey: TIME_CLOCK_ME_KEY,
        queryFn: () => timeClockService.me(),
        enabled: isAuthenticated,
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 2,
    });
}

export function usePunch() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: PunchPayload) => timeClockService.punch(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: TIME_CLOCK_ME_KEY });
        },
    });
}

/**
 * Cadastro do rosto de referência (enrollment). O embedding é gerado no aparelho
 * ANTES de chamar a mutation. Ao concluir, invalida `['time-clock','me']` para
 * refletir `face_enrolled: true` na tela do Ponto. O feedback (Toast) fica na tela.
 */
export function useEnrollFace() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (payload: EnrollFacePayload) => timeClockService.enrollFace(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: TIME_CLOCK_ME_KEY });
        },
    });
}

/**
 * Espelho de Ponto (admin): lista paginada de batidas por loja/data.
 * `keepPreviousData` evita "piscar" a lista ao trocar de página. `staleTime`
 * curto porque o dia corrente muda com novas batidas.
 */
export function useTimeClockMirror(params: TimeClockMirrorFilters) {
    return useQuery({
        queryKey: ['time-clock', 'mirror', params],
        queryFn: () => timeClockService.list(params),
        placeholderData: keepPreviousData,
        staleTime: 1000 * 30,
    });
}

/**
 * Autoatendimento "Meu Espelho" (`GET /time-clock/me/mirror`): as batidas do
 * próprio funcionário nas últimas 24h ou no mês corrente. Só dispara logado.
 * A chave inclui o `period` para alternar 24h/Mês sem misturar caches.
 */
export function useMyMirror(period: MyMirrorPeriod) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    return useQuery({
        queryKey: ['time-clock', 'me', 'mirror', period],
        queryFn: () => timeClockService.myMirror(period),
        enabled: isAuthenticated,
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 2,
    });
}

/**
 * Fila offline de batidas (autoatendimento). Assina o `punchQueue`, mantém o
 * ciclo de vida (foreground + reconexão) ativo enquanto o hook estiver montado
 * e drena a fila ao montar. Devolve os itens pendentes + a contagem para a UI.
 */
export function usePunchQueue() {
    const [items, setItems] = useState<PunchQueueItem[]>(() => punchQueue.getItems());

    useEffect(() => {
        // Liga foreground/reconexão e tenta drenar o que sobrou de sessões passadas.
        punchQueue.startLifecycle();
        const unsubscribe = punchQueue.subscribe(setItems);
        void punchQueue.processQueue();
        return () => {
            unsubscribe();
        };
    }, []);

    return {
        items,
        pendingCount: items.length,
        retry: punchQueue.retry,
        remove: punchQueue.remove,
    };
}
