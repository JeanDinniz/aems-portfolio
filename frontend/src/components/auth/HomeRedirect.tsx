import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useMyPermissions } from '@/hooks/useMyPermissions';

export function HomeRedirect() {
    const user = useAuthStore((s) => s.user);
    const { isPending, data: permsData } = useMyPermissions();

    if (user?.role === 'owner') return <Navigate to="/service-orders" replace />;

    if (isPending) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    const perms = permsData?.permissions ?? [];
    const hasView = (sub: string) => perms.some((p) => p.sub_module === sub && p.can_view);

    if (hasView('service_orders')) return <Navigate to="/service-orders" replace />;
    if (hasView('scheduling'))     return <Navigate to="/scheduling" replace />;
    if (hasView('conference'))     return <Navigate to="/conference" replace />;
    if (hasView('fechamento'))     return <Navigate to="/fechamento" replace />;
    if (hasView('inventory'))      return <Navigate to="/estoque" replace />;

    return <Navigate to="/unauthorized" replace />;
}
