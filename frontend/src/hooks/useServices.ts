import { useQuery } from '@tanstack/react-query';
import { servicesService } from '../services/api/services.service';
import type { ServiceItem } from '../services/api/services.service';

export function useServices(department?: string, brandId?: number) {
    return useQuery<ServiceItem[]>({
        queryKey: ['services', department, brandId],
        queryFn: async () => {
            const result = await servicesService.list({
                department,
                brand_id: brandId,
                is_active: true,
                limit: 100,
            });
            // Deduplica por code|name; exclusividade de cortesia é do serviço
            // lógico, então qualquer duplicata com a flag marca o item mantido.
            const byKey = new Map<string, ServiceItem>();
            for (const s of result.items) {
                const key = `${s.code ?? ''}|${s.name}`;
                const existing = byKey.get(key);
                if (!existing) {
                    byKey.set(key, s);
                } else if (s.is_courtesy_only && !existing.is_courtesy_only) {
                    byKey.set(key, { ...existing, is_courtesy_only: true });
                }
            }
            return Array.from(byKey.values());
        },
        staleTime: 1000 * 60 * 5,
    });
}
