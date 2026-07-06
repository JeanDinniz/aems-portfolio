import { useQuery } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';

interface DuplicateCheckParams {
    plate: string;
    service_date: string;
    department: string;
    service_ids: number[];
    is_return?: boolean;
}

export function useDuplicateCheck(params: DuplicateCheckParams) {
    // Retorno/retrabalho é exceção legítima — não verifica nem alerta duplicidade.
    const enabled = Boolean(
        params.plate &&
        params.service_date &&
        params.department &&
        params.service_ids.length > 0 &&
        !params.is_return
    );

    return useQuery({
        queryKey: [
            'duplicate-check',
            params.plate,
            params.service_date,
            params.department,
            [...params.service_ids].sort((a, b) => a - b),
            params.is_return ?? false,
        ],
        queryFn: () => serviceOrdersService.checkDuplicate(params),
        enabled,
        staleTime: 1000 * 30,
    });
}
