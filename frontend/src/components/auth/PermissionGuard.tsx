import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import type { SubModule } from '@/types/accessProfile.types';

interface PermissionGuardProps {
    subModule: SubModule;
}

const Spinner = () => (
    <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
    </div>
);

export function PermissionGuard({ subModule }: PermissionGuardProps) {
    const { user, isLoading } = useAuthStore();
    // React Query deduplica a requisição — sem chamada extra à API se já em cache
    const { isPending: permsPending, data: permsData } = useMyPermissions();

    if (isLoading) return <Spinner />;

    // Owner sempre tem acesso total
    if (user?.role === 'owner') return <Outlet />;

    // Aguardar query de permissões resolver antes de decidir acesso
    if (permsPending) return <Spinner />;

    // Para não-owners: verifica can_view no sub-módulo específico
    // Usa permsData diretamente (disponível no mesmo render que isPending vira false),
    // evitando race condition com o useEffect que sincroniza para o Zustand.
    const perm = permsData?.permissions.find((p) => p.sub_module === subModule);
    if (!perm?.can_view) {
        return <Navigate to="/unauthorized" replace />;
    }

    return <Outlet />;
}
