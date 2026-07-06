import { useQuery } from '@tanstack/react-query';

import { servicesService } from '@/services/api/services.service';
import type { ServiceItem } from '@/services/api/services.service';

/**
 * Lista serviços ativos para pickers (Criar O.S.), opcionalmente filtrados por
 * departamento e marca. Espelha frontend/src/hooks/useServices.ts:
 * dedup por `code|name` e staleTime de 5 min.
 */
export function useServices(department?: string, brandId?: number) {
    return useQuery<ServiceItem[]>({
        // Só busca com departamento definido — sem depto, nenhum serviço é listado.
        enabled: !!department,
        queryKey: ['services', department, brandId],
        queryFn: async () => {
            const result = await servicesService.list({
                department,
                brand_id: brandId,
                is_active: true,
                limit: 100,
            });
            const seen = new Set<string>();
            return result.items.filter((s) => {
                const key = `${s.code ?? ''}|${s.name}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },
        staleTime: 1000 * 60 * 5,
    });
}
