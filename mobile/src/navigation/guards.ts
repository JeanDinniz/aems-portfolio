import { useAuthStore } from '@/stores/auth.store';
import { useCanView, useCanEdit, useCanDelete } from '@/hooks/useMyPermissions';
import type { SubModule } from '@/types/accessProfile.types';

/**
 * Guards de navegação (AUTH-08). A autorização real é do backend; aqui apenas
 * espelhamos para UX (esconder/ desabilitar). Os hooks `useCanView/Edit/Delete`
 * já tratam Owner (sempre true) e estado de carregamento (libera p/ evitar flicker).
 *
 * M2 (auditoria): `useVisibleModules` é FAIL-CLOSED — enquanto as permissões não
 * chegam, um não-owner não vê módulos (antes via todos). Ele assina
 * `effectivePermissions` para recalcular quando os dados chegam.
 *
 * O consumo pleno (abas condicionais) vem no HOME-01 (Sprint 2); por ora a Home
 * placeholder usa `MODULE_GUARDS` para listar os módulos visíveis.
 */

export { useCanView, useCanEdit, useCanDelete };

/** Catálogo de módulos navegáveis com o submódulo de permissão correspondente. */
export interface ModuleGuard {
    key: string;
    label: string;
    sub_module: SubModule;
}

export const MODULE_GUARDS: ModuleGuard[] = [
    { key: 'service_orders', label: 'Ordens de Serviço', sub_module: 'service_orders' },
    { key: 'scheduling', label: 'Agendamentos', sub_module: 'scheduling' },
    { key: 'inventory', label: 'Estoque', sub_module: 'inventory' },
    { key: 'conference', label: 'Conferência', sub_module: 'conference' },
    { key: 'fechamento', label: 'Fechamento', sub_module: 'fechamento' },
];

/**
 * Hook que retorna os módulos visíveis ao usuário atual (Owner vê todos).
 * Chama os hooks de permissão de forma estável (ordem fixa do array).
 */
export function useVisibleModules(): ModuleGuard[] {
    const isOwner = useAuthStore((s) => s.isOwner);
    const hasPermission = useAuthStore((s) => s.hasPermission);
    // M2 (auditoria): assina effectivePermissions para RECALCULAR quando as
    // permissões chegarem. hasPermission é referência estável e, com o fail-closed,
    // sozinho não dispararia re-render — a lista ficaria vazia até outro update.
    useAuthStore((s) => s.effectivePermissions);
    const owner = isOwner();
    return MODULE_GUARDS.filter((m) => owner || hasPermission(m.sub_module, 'view'));
}

/** Flags de galpão (esconder toggles de galpão na UI quando aplicável). */
export function useGalponFlags(): { isGalponProfile: boolean; hideGalponOption: boolean } {
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    return {
        isGalponProfile: effectivePermissions?.is_galpon_profile ?? false,
        hideGalponOption: effectivePermissions?.hide_galpon_option ?? false,
    };
}
