import { useQuery } from '@tanstack/react-query';

import { brandsService } from '@/services/api/brands.service';

/**
 * Lista de marcas (necessária para filtrar modelos/serviços por marca).
 * Marcas mudam pouco → staleTime alto.
 */
export function useBrands(params?: { is_active?: boolean }) {
    return useQuery({
        queryKey: ['brands', params?.is_active],
        queryFn: () => brandsService.list(params),
        select: (data) => data.items,
        staleTime: 1000 * 60 * 30,
    });
}
