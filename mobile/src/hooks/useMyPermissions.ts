import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/auth.store';
import { accessProfilesService } from '@/services/api/access-profiles.service';
import type { SubModule } from '@/types/accessProfile.types';

/**
 * useMyPermissions (DATA-05) — adaptado de frontend/src/hooks/useMyPermissions.ts.
 *
 * Busca permissões efetivas via /users/me/permissions e sincroniza no auth store
 * para uso síncrono em `hasPermission()`. Owner não dispara a query (acesso total).
 */
export function useMyPermissions() {
    const user = useAuthStore((s) => s.user);
    const setEffectivePermissions = useAuthStore((s) => s.setEffectivePermissions);
    const isOwner = user?.role === 'owner';

    const query = useQuery({
        queryKey: ['my-permissions', user?.id],
        queryFn: () => accessProfilesService.getMyPermissions(),
        enabled: !!user && !isOwner,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        if (query.data) {
            setEffectivePermissions(query.data);
        }
    }, [query.data, setEffectivePermissions]);

    return query;
}

/** Permite ver o submódulo. Owner: sempre; durante carregamento: libera (evita flicker). */
export function useCanView(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    if (isLoading) return true;
    return hasPermissionFn(sub_module, 'view');
}

export function useCanEdit(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    if (isLoading) return true;
    return hasPermissionFn(sub_module, 'edit');
}

export function useCanDelete(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    if (isLoading) return true;
    return hasPermissionFn(sub_module, 'delete');
}
