import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '@/stores/auth.store';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStores } from '@/hooks/useStores';

export function MainLayout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { user } = useAuthStore();
    // Pré-carrega permissões aqui — garante que estejam disponíveis
    // antes de qualquer PermissionGuard nas rotas filhas
    useMyPermissions();
    // Inicializa availableStores globalmente para todas as páginas
    useStores();
    // Conexão WebSocket em tempo real
    useWebSocket();

    if (user?.must_change_password) {
        return <Navigate to="/change-password" replace />;
    }

    return (
        <div className="h-screen flex overflow-hidden bg-[#F5F5F5] dark:bg-[#111111]">
            {/* Sidebar — in-flow on desktop (pushes content), fixed overlay on mobile */}
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Main Content — sidebar is in-flow on desktop, no offset needed */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <Header onMenuClick={() => setSidebarOpen(true)} />
                <main className="flex-1 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
