import { useQuery } from '@tanstack/react-query';

import { suppliersService } from '@/services/api/suppliers.service';

/**
 * Lista fornecedores ativos para o picker da entrada de bobina (INV-04).
 * Espelha frontend/src/hooks/useSuppliers.ts (subset de leitura).
 */
export function useSuppliers() {
    return useQuery({
        queryKey: ['suppliers'],
        queryFn: () => suppliersService.list({ is_active: true }),
        select: (data) => data.items,
        staleTime: 1000 * 60 * 5,
    });
}
