import { useState } from 'react';
import * as XLSXStyle from 'xlsx-js-style';
import { Plus, Download, UserCog, Loader2 } from 'lucide-react';
import { UsersTable } from '@/components/features/users/UsersTable';
import { UserFilters } from '@/components/features/users/UserFilters';
import { CreateUserDialog } from '@/components/features/users/CreateUserDialog';
import { useUsers } from '@/hooks/useUsers';
import { usersService } from '@/services/api/users.service';
import { useAuthStore } from '@/stores/auth.store';
import type { UserFilters as Filters } from '@/types/user.types';

export function UserManagementPage() {
    const [filters, setFilters] = useState<Filters>({});
    const [page, setPage] = useState(1);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('users', 'edit');
    const { users, total, isLoading } = useUsers(filters, page);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const result = await usersService.list(filters, 1, 500);

            const headers = ['Usuário', 'Cargo', 'Loja(s)', 'Status', 'Último login'];
            const dataRows = result.users.map((u) => [
                u.full_name,
                u.role === 'owner' ? 'Proprietário' : 'Usuário',
                u.store_name ?? (u.role === 'owner' ? 'Todas' : ''),
                u.is_active ? 'Ativo' : 'Inativo',
                u.last_login ? new Date(u.last_login).toLocaleDateString('pt-BR') : 'Nunca',
            ]);

            const ws = XLSXStyle.utils.aoa_to_sheet([headers, ...dataRows]);

            const headerStyle = (sz: number) => ({
                font: { bold: true, sz, name: 'Aptos Narrow' },
                fill: { patternType: 'solid', fgColor: { rgb: 'FFC000' } },
            });
            headers.forEach((_, col) => {
                const addr = XLSXStyle.utils.encode_cell({ r: 0, c: col });
                if (ws[addr]) ws[addr].s = headerStyle(col === 0 ? 12 : 11);
            });

            const wb = XLSXStyle.utils.book_new();
            XLSXStyle.utils.book_append_sheet(wb, ws, 'Usuários');
            XLSXStyle.writeFile(wb, 'usuarios.xlsx');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                            <UserCog className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1
                                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Gestão de Usuários
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                {total > 0 ? `${total} usuários cadastrados` : 'Gerenciar usuários e owners'}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                        {canEdit && (
                            <button
                                onClick={handleExport}
                                disabled={isExporting}
                                className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isExporting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                                Exportar
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={() => setCreateDialogOpen(true)}
                                className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-60"
                                style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            >
                                <Plus className="h-4 w-4" />
                                Novo Usuário
                            </button>
                        )}
                    </div>
                </div>

                {/* Filtros */}
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                    <UserFilters filters={filters} onFiltersChange={setFilters} />
                </div>
            </div>

            {/* Tabela */}
            <UsersTable
                users={users}
                isLoading={isLoading}
                page={page}
                pageSize={20}
                total={total}
                onPageChange={setPage}
            />

            {/* Dialog Criar */}
            <CreateUserDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
        </div>
    );
}
