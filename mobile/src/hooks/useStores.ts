import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { storesService } from '@/services/api/stores.service';
import { useStoreStore } from '@/stores/store.store';
import { useAuthStore } from '@/stores/auth.store';

/**
 * useStores (DATA-05) — adaptado de frontend/src/hooks/useStores.ts.
 *
 * Carrega as lojas e filtra as acessíveis conforme role/perfil, populando o
 * store de seleção. Owner vê todas; usuário vê as do perfil (store_ids) ou,
 * como fallback, a própria `store_id`.
 */
export function useStores() {
    const user = useAuthStore((s) => s.user);
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    const { availableStores, selectedStoreId, isMultiStore, selectStore, setAvailableStores } =
        useStoreStore();

    const { data: allStores = [] } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        enabled: !!user,
        staleTime: 1000 * 60 * 60, // lojas mudam pouco
    });

    useEffect(() => {
        if (!user || allStores.length === 0) return;

        if (user.role === 'owner') {
            setAvailableStores(allStores);
        } else {
            const permittedIds = (effectivePermissions?.store_ids ?? []).map(Number);
            const myStores =
                permittedIds.length > 0
                    ? allStores.filter((s) => permittedIds.includes(s.id))
                    : allStores.filter((s) => s.id === user.store_id);
            setAvailableStores(myStores);
        }
    }, [user, allStores, effectivePermissions, setAvailableStores]);

    return {
        stores: availableStores,
        selectedStoreId,
        isMultiStore,
        selectStore,
        allStores,
    };
}
