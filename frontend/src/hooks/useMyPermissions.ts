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
 * Checker de permissão REATIVO (fonte da verdade para exibição/UX).
 *
 * `store.hasPermission` é fail-closed (nega enquanto as permissões não chegam) e
 * é uma referência ESTÁVEL — selecioná-la sozinha não re-renderiza o componente
 * quando `effectivePermissions` é sincronizado. Este hook assina
 * `effectivePermissions`, garantindo o re-render (e o recálculo) assim que os
 * dados chegam. Use SEMPRE este hook em vez de `useAuthStore((s) => s.hasPermission)`.
 */
export function useHasPermission() {
    // Assina o slice para re-renderizar quando as permissões chegarem/mudarem.
    useAuthStore((s) => s.effectivePermissions);
    return useAuthStore((s) => s.hasPermission);
}

/**
 * Retorna true se o usuário pode visualizar o módulo.
 * Owner sempre retorna true.
 * Usuários sem permissões configuradas recebem acesso negado,
 * exceto enquanto a query ainda está carregando (retorna true para evitar flicker).
 */
export function useCanView(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermission = useHasPermission();
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    // Allow while loading to prevent blank screens
    if (isLoading) return true;

    return hasPermission(sub_module, 'view');
}

export function useCanEdit(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermission = useHasPermission();
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    if (isLoading) return true;

    return hasPermission(sub_module, 'edit');
}

export function useCanDelete(sub_module: SubModule): boolean {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermission = useHasPermission();
    const { isLoading } = useMyPermissions();

    if (isOwnerFn()) return true;
    if (isLoading) return true;

    return hasPermission(sub_module, 'delete');
}

/**
 * Departamentos que o usuário pode ver no módulo de Agendamentos.
 * Lista vazia = sem restrição (vê todos). Owner nunca é restrito.
 */
export function useSchedulingDepartments(): string[] {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    useMyPermissions();

    if (isOwnerFn()) return [];
    return effectivePermissions?.scheduling_departments ?? [];
}
