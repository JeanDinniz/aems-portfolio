import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import type { SubModule } from '@/types/accessProfile.types';

interface ProfileGuardProps {
    sub_module: SubModule;
    action?: 'view' | 'edit' | 'delete';
    children: ReactNode;
    fallback?: ReactNode;
}

/**
 * Renderiza children se o usuário tem permissão para o sub_module/action.
 * Owner sempre renderiza children.
 * Para role=user, verifica effectivePermissions do auth store.
 * Se sem permissão: renderiza fallback ou null.
 */
export function ProfileGuard({
    sub_module,
    action = 'view',
    children,
    fallback = null,
}: ProfileGuardProps) {
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);

    if (isOwnerFn()) return <>{children}</>;
    if (hasPermissionFn(sub_module, action)) return <>{children}</>;

    return <>{fallback}</>;
}
