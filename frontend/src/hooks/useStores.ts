import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { storesService } from '@/services/api/stores.service';
import { useStoreStore } from '@/stores/store.store';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';

export function useStores() {
    const { user } = useAuth();
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    const { availableStores, selectedStoreId, isMultiStore, selectStore, setAvailableStores } = useStoreStore();

    const { data: allStores = [] } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        enabled: !!user,
        staleTime: 1000 * 60 * 60, // 1 hour - stores don't change often
    });

    // Filter available stores based on user role and profile permissions
    useEffect(() => {
        if (!user || allStores.length === 0) return;

        if (user.role === 'owner') {
            setAvailableStores(allStores);
        } else {
            // Para não-owners: usa store_ids do perfil de acesso efetivo
            const permittedIds = (effectivePermissions?.store_ids ?? []).map(Number);
            const myStores = permittedIds.length > 0
                ? allStores.filter(s => permittedIds.includes(s.id))
                : allStores.filter(s => s.id === user.store_id); // fallback
            setAvailableStores(myStores);
        }
    }, [user, allStores, effectivePermissions, setAvailableStores]);

    return {
        stores: availableStores,
        selectedStoreId,
        isMultiStore,
        selectStore,
        allStores // exposed just in case needed for raw list
    };
}
