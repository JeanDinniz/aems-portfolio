import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

type AllowedRole = 'owner' | 'user';

interface RoleGuardProps {
    allowedRoles: AllowedRole[];
    /** Quando true, também permite usuários com perfil galpão (is_galpon_profile=true) */
    allowGalponProfile?: boolean;
}

export function RoleGuard({ allowedRoles, allowGalponProfile }: RoleGuardProps) {
    const { user, isLoading, effectivePermissions } = useAuthStore();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    const hasRole = user && allowedRoles.includes(user.role as AllowedRole);
    const isGalpon = allowGalponProfile && effectivePermissions?.is_galpon_profile === true;

    if (!hasRole && !isGalpon) {
        return <Navigate to="/unauthorized" replace />;
    }

    return <Outlet />;
}
