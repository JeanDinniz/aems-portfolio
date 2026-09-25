import { useQuery } from '@tanstack/react-query'
import { servicesService } from '../services/api/services.service'
import type { ServiceItem } from '../services/api/services.service'
import { CATALOG_STALE_TIME, CATALOG_GC_TIME, servicesKey } from '@/lib/catalog-queries'

/**
 * Busca os serviços do departamento+marca e deduplica por code|name.
 * Extraído do hook para ser reutilizado TAL-E-QUAL pelo prefetch de hover
 * (lib/prefetch-order-edit.ts): se o prefetch usasse um fetch "cru" (sem o
 * dedup), a entrada de cache ficaria com um formato diferente do que este
 * hook produz, e quem lesse depois (useServices) receberia um array não
 * deduplicado sem perceber.
 */
export async function fetchServicesDeduped(department?: string, brandId?: number): Promise<ServiceItem[]> {
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
}

export function useServices(department?: string, brandId?: number) {
    return useQuery<ServiceItem[]>({
        queryKey: servicesKey(department, brandId),
        queryFn: () => fetchServicesDeduped(department, brandId),
        staleTime: CATALOG_STALE_TIME,
        gcTime: CATALOG_GC_TIME,
    });
}
