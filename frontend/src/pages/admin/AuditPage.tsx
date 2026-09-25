import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldCheck, RefreshCw, Download, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AuditTable } from '@/components/features/audit/AuditTable';
import { AuditToolbar } from '@/components/features/audit/AuditToolbar';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { useAuth } from '@/hooks/useAuth';
import { storesService } from '@/services/api/stores.service';
import { inventoryService } from '@/services/api/inventory.service';
import { servicesService } from '@/services/api/services.service';
import auditService from '@/services/api/audit.service';
import { downloadBlob } from '@/utils/downloadBlob';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type { AuditLogFilters } from '@/types/audit';

function Pagination({
    page,
    totalPages,
    onPage,
}: {
    page: number;
    totalPages: number;
    onPage: (p: number) => void;
}) {
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
                Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => onPage(page - 1)}
                >
                    Anterior
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => onPage(page + 1)}
                >
                    Próxima
                </Button>
            </div>
        </div>
    );
}

export function AuditPage() {
    const { user } = useAuth();
    const [filters, setFilters] = useState<AuditLogFilters>({});
    const [isExporting, setIsExporting] = useState(false);

    const { data: storesList = [] } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        staleTime: 1000 * 60 * 60,
        enabled: !!user,
    });

    const { data: filmTypesData } = useQuery({
        queryKey: ['film-types-all'],
        queryFn: () => inventoryService.listFilmTypes({ limit: 200 }),
        staleTime: 1000 * 60 * 60,
        enabled: !!user,
    });

    const { data: servicesList = [] } = useQuery({
        queryKey: ['services-all'],
        queryFn: () => servicesService.getAll(),
        staleTime: 1000 * 60 * 60,
        enabled: !!user,
    });

    const storeMap = useMemo<Record<number, string>>(
        () => Object.fromEntries(storesList.map(s => [s.id, s.name])),
        [storesList]
    );

    const filmTypeMap = useMemo<Record<number, string>>(
        () => Object.fromEntries((filmTypesData?.items ?? []).map(ft => [ft.id, ft.name])),
        [filmTypesData]
    );

    const serviceMap = useMemo<Record<number, string>>(
        () => Object.fromEntries(
            servicesList.map(s => [s.id, s.code ? `${s.code} - ${s.name}` : s.name])
        ),
        [servicesList]
    );

    const query = useMemo<AuditLogFilters>(() => {
        const f: AuditLogFilters = { limit: 50 };
        if (filters.action) f.action = filters.action;
        if (filters.resource_type) f.resource_type = filters.resource_type;
        if (filters.resource_id !== undefined) f.resource_id = filters.resource_id;
        if (filters.user_name) f.user_name = filters.user_name;
        if (filters.start_date) f.start_date = new Date(filters.start_date).toISOString();
        if (filters.end_date) f.end_date = new Date(filters.end_date).toISOString();
        f.page = filters.page ?? 1;
        return f;
    }, [filters]);

    const { data, isLoading, isError, refetch } = useAuditLogs(query);

    const logs = data?.items ?? [];
    const pagination = data?.pagination;

    async function handleExport() {
        setIsExporting(true);
        try {
            const blob = await auditService.exportCsv(query);
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const filename = `auditoria-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
            downloadBlob(blob, filename);
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Erro ao exportar',
                description: getApiErrorMessage(err as Error, 'Falha ao gerar o CSV de auditoria.'),
            });
        } finally {
            setIsExporting(false);
        }
    }

    if (user && user.role !== 'owner') {
        return <Navigate to="/service-orders" replace />;
    }

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}>
                            Auditoria
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Trilha imutável de ações relevantes do sistema. Use os filtros para recortar sua investigação.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        disabled={isExporting}
                        className="gap-1.5"
                    >
                        {isExporting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4" />
                        )}
                        Exportar CSV
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => refetch()} title="Atualizar" aria-label="Atualizar">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <AuditToolbar
                filters={filters}
                onChange={(f) => setFilters(f)}
            />
            </div>

            {/* Erro */}
            {isError && (
                <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <span>Falha ao carregar os registros de auditoria.</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => refetch()}
                    >
                        Tentar novamente
                    </Button>
                </div>
            )}

            {/* Tabela */}
            <AuditTable data={logs} loading={isLoading} storeMap={storeMap} filmTypeMap={filmTypeMap} serviceMap={serviceMap} />

            {/* Paginação */}
            {pagination && (
                <Pagination
                    page={pagination.page}
                    totalPages={pagination.total_pages}
                    onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
                />
            )}
        </div>
    );
}
