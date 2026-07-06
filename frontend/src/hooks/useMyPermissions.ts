import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { accessProfilesService } from '@/services/api/access-profiles.service';
import type { SubModule } from '@/types/accessProfile.types';

/**
 * Busca as permissões efetivas do usuário logado via /users/me/permissions.
 * Owner não dispara a query — tem acesso total a tudo.
 * Salva o resultado no auth store para uso síncrono em helpers como hasPermission().
 */
export function useMyPermissions() {
    const user = useAuthStore((s) => s.user);
    const setEffectivePermissions = useAuthStore((s) => s.setEffectivePermissions);
    const isOwner = user?.role === 'owner';

    const query = useQuery({
        queryKey: ['my-permissions', user?.id],
        queryFn: () => accessProfilesService.getMyPermissions(),
        enabled: !!user && !isOwner,
        staleTime: 60 * 1000, // 1 minuto — revalida ao focar a janela
    });

    // Sync into store whenever data changes
    useEffect(() => {
        if (query.data) {
            setEffectivePermissions(query.data);
        }
    }, [query.data, setEffectivePermissions]);

    return query;
}

/**
 * Retorna true se o usuário pode visualizar o módulo.
 * Owner sempre retorna true.
 * Usuários sem permissões configuradas recebem acesso negado,
 * exceto enquanto a query ainda está carregando (retorna true para evitar flicker).
 */
export function useCanView(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    // Allow while loading to prevent blank screens
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
