import { useState } from 'react';
import { Plus, Download, UserCheck } from 'lucide-react';
import { ConsultantsTable } from '@/components/features/consultants/ConsultantsTable';
import { ConsultantFilters } from '@/components/features/consultants/ConsultantFilters';
import { CreateConsultantDialog } from '@/components/features/consultants/CreateConsultantDialog';
import { useConsultants } from '@/hooks/useConsultants';
import { useAuthStore } from '@/stores/auth.store';
import apiClient from '@/services/api/client';
import type { ConsultantFilters as Filters } from '@/types/consultant.types';

export function ConsultantManagementPage() {
    const [filters, setFilters] = useState<Filters>({});
    const [page, setPage] = useState(1);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('consultants', 'edit');
    const { consultants, total, isLoading } = useConsultants(filters, page);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const response = await apiClient.get('/consultants/export', {
                params: {
                    store_id: filters.store_id,
                    is_active: filters.is_active,
                    search: filters.search,
                },
                responseType: 'blob',
            });
            const url = URL.createObjectURL(new Blob([response.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'consultores.xlsx';
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            // silencioso — botão volta ao estado normal
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
                            <UserCheck className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1
                                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Gestão de Consultores
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">Gerenciar consultores das concessionárias</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                        {canEdit && (
                            <button
                                onClick={handleExport}
                                disabled={isExporting}
                                className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="h-4 w-4" />
                                {isExporting ? 'Exportando...' : 'Exportar'}
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={() => setCreateDialogOpen(true)}
                                className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-60"
                                style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            >
                                <Plus className="h-4 w-4" />
                                Novo Consultor
                            </button>
                        )}
                    </div>
                </div>

                {/* Filtros */}
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                    <ConsultantFilters filters={filters} onFiltersChange={setFilters} />
                </div>
            </div>

            {/* Tabela */}
            <ConsultantsTable
                consultants={consultants}
                isLoading={isLoading}
                page={page}
                pageSize={20}
                total={total}
                onPageChange={setPage}
            />

            {/* Dialog Criar */}
            <CreateConsultantDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
        </div>
    );
}
