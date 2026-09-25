import { useQuery } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';

interface DuplicateCheckParams {
    plate: string;
    service_date: string;
    department: string;
    service_ids: number[];
    is_return?: boolean;
    /** Ao editar: ignora o próprio agendamento na checagem (evita autoacusação). */
    exclude_appointment_id?: number | null;
    /** Ao editar: ignora a própria O.S. gerada pelo agendamento. */
    exclude_service_order_id?: number | null;
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
            params.exclude_appointment_id ?? null,
            params.exclude_service_order_id ?? null,
        ],
        queryFn: () => serviceOrdersService.checkDuplicate(params),
        enabled,
        staleTime: 1000 * 30,
    });
}
