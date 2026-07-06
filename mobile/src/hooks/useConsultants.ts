import { useQuery } from '@tanstack/react-query';

import { consultantsService } from '@/services/api/consultants.service';
import { useStoreStore } from '@/stores/store.store';
import type { ConsultantFilters } from '@/types/consultant.types';

/**
 * Consultores para picker de O.S.
 *
 * Regra de loja: o `store_id` explícito vindo do form (a O.S. tem `location_id`)
 * tem precedência; quando ausente, cai para a loja selecionada globalmente
 * (`selectedStoreId`). `null` = Todas as Lojas → não filtra por loja.
 *
 * Adaptado de frontend/src/hooks/useConsultants.ts (apenas leitura).
 */
export function useConsultants(filters?: ConsultantFilters, page = 1, pageSize = 200) {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const storeId = filters?.store_id ?? selectedStoreId ?? undefined;
    const effectiveFilters: ConsultantFilters = {
        is_active: true,
        ...filters,
        store_id: storeId,
    };

    const query = useQuery({
        queryKey: ['consultants', effectiveFilters, page, pageSize],
        queryFn: () => consultantsService.list(effectiveFilters, page, pageSize),
        staleTime: 1000 * 60 * 5,
    });

    return {
        ...query,
        consultants: query.data?.consultants ?? [],
        total: query.data?.total ?? 0,
    };
}
