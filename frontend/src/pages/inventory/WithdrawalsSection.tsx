import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Loader2, Undo2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useCanDelete } from '@/hooks/useMyPermissions';
import { getApiErrorMessage } from '@/lib/api-error';
import { useStoreStore } from '@/stores/store.store';
import { inventoryService } from '@/services/api/inventory.service';
import { employeesService } from '@/services/api/employees.service';
import { formatMeters, formatReceiptDate } from '@/utils/filmRoll';
import type { FilmType, FilmWithdrawal } from '@/services/api/inventory.service';

// Bobina em formato legível: "06/04/2026 · 15,0m" (a película já tem coluna própria)
function rollLabel(w: FilmWithdrawal): string {
    if (!w.roll_receipt_date) return w.roll_visual_id;
    const base = formatReceiptDate(w.roll_receipt_date);
    return w.roll_total_meters != null ? `${base} · ${formatMeters(w.roll_total_meters)}` : base;
}

function firstDayOfMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Aba "Saídas" do Estoque: lista as saídas avulsas de película com filtros
 * (período/loja/funcionário/tipo), totais por funcionário (base do desconto
 * mensal) e export Excel. Estorno com permissão inventory:can_delete.
 */
export function WithdrawalsSection({ filmTypes }: { filmTypes: FilmType[] }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { availableStores } = useStoreStore();
    const canDelete = useCanDelete('inventory');

    const [dateFrom, setDateFrom] = useState<string>(firstDayOfMonth());
    const [dateTo, setDateTo] = useState<string>(today());
    const [filterStoreId, setFilterStoreId] = useState<number | 'all'>('all');
    const [filterEmployeeId, setFilterEmployeeId] = useState<number | 'all'>('all');
    const [filterFilmTypeId, setFilterFilmTypeId] = useState<number | 'all'>('all');
    const [page, setPage] = useState(1);
    const [reverseTarget, setReverseTarget] = useState<FilmWithdrawal | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    const filters = useMemo(
        () => ({
            store_id: filterStoreId !== 'all' ? filterStoreId : undefined,
            employee_id: filterEmployeeId !== 'all' ? filterEmployeeId : undefined,
            film_type_id: filterFilmTypeId !== 'all' ? filterFilmTypeId : undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
        }),
        [filterStoreId, filterEmployeeId, filterFilmTypeId, dateFrom, dateTo]
    );

    const { data: listData, isLoading } = useQuery({
        queryKey: ['film-withdrawals', filters, page],
        queryFn: () => inventoryService.listWithdrawals({ ...filters, page, limit: 20 }),
        staleTime: 0,
    });

    const { data: summaryData } = useQuery({
        queryKey: ['film-withdrawals-summary', filters],
        queryFn: () => inventoryService.getWithdrawalsSummary(filters),
        staleTime: 0,
    });

    // Instaladores para o filtro (todas as lojas acessíveis, ativos —
    // saída de película é sempre para instalador, igual ao modal)
    const { data: employeesData } = useQuery({
        queryKey: ['employees-installers-all'],
        queryFn: () =>
            employeesService.list(
                { is_active: true, position: 'Instalador de Película' },
                1,
                500
            ),
        staleTime: 1000 * 60 * 5,
    });

    const reverseMutation = useMutation({
        mutationFn: (withdrawalId: number) => inventoryService.reverseWithdrawal(withdrawalId),
        onSuccess: (reversed) => {
            queryClient.invalidateQueries({ queryKey: ['film-withdrawals'] });
            queryClient.invalidateQueries({ queryKey: ['film-withdrawals-summary'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            toast({
                title: 'Saída estornada',
                description: `${formatMeters(reversed.meters)} devolvidos à bobina de ${reversed.film_type_name ?? 'película'}${reversed.tonality ? ` ${reversed.tonality}` : ''}`,
            });
        },
        onError: (err: unknown) => {
            toast({
                title: 'Erro ao estornar saída',
                description: getApiErrorMessage(err),
                variant: 'destructive',
            });
        },
        onSettled: () => setReverseTarget(null),
    });

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const blob = await inventoryService.exportWithdrawals(filters);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `saidas_pelicula_${today().replace(/-/g, '')}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast({
                title: 'Erro ao exportar',
                description: getApiErrorMessage(err),
                variant: 'destructive',
            });
        } finally {
            setIsExporting(false);
        }
    };

    const items = listData?.items ?? [];
    const totalPages = listData?.total_pages ?? 1;
    const summaryItems = summaryData?.items ?? [];

    const resetPage = () => setPage(1);

    return (
        <div className="space-y-4">
            {/* Filtros */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Período</span>
                        <div className="flex items-center gap-2">
                            <Input
                                type="date"
                                className="w-36"
                                value={dateFrom}
                                onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
                            />
                            <span className="text-xs text-muted-foreground">até</span>
                            <Input
                                type="date"
                                className="w-36"
                                value={dateTo}
                                onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
                            />
                        </div>
                    </div>

                    {availableStores.length > 1 && (
                        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loja</span>
                            <Select
                                value={filterStoreId.toString()}
                                onValueChange={(v) => { setFilterStoreId(v === 'all' ? 'all' : Number(v)); resetPage(); }}
                            >
                                <SelectTrigger className="w-full sm:w-40">
                                    <SelectValue placeholder="Loja" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as lojas</SelectItem>
                                    {availableStores.map((s) => (
                                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Funcionário</span>
                        <Select
                            value={filterEmployeeId.toString()}
                            onValueChange={(v) => { setFilterEmployeeId(v === 'all' ? 'all' : Number(v)); resetPage(); }}
                        >
                            <SelectTrigger className="w-full sm:w-48">
                                <SelectValue placeholder="Funcionário" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                {(employeesData?.employees ?? []).map((e) => (
                                    <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo</span>
                        <Select
                            value={filterFilmTypeId.toString()}
                            onValueChange={(v) => { setFilterFilmTypeId(v === 'all' ? 'all' : Number(v)); resetPage(); }}
                        >
                            <SelectTrigger className="w-full sm:w-44">
                                <SelectValue placeholder="Tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os tipos</SelectItem>
                                {filmTypes.map((ft) => (
                                    <SelectItem key={ft.id} value={ft.id.toString()}>{ft.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="ml-auto">
                        <Button variant="outline" onClick={handleExport} disabled={isExporting}>
                            {isExporting
                                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                : <Download className="h-4 w-4 mr-2" />
                            }
                            Exportar Excel
                        </Button>
                    </div>
                </div>
            </div>

            {/* Totais por funcionário */}
            {summaryItems.length > 0 && (
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        Totais por funcionário no período
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {summaryItems.map((s) => (
                            <div
                                key={s.employee_id}
                                className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                            >
                                <span className="font-medium">{s.employee_name}</span>
                                <span className="text-muted-foreground"> — {formatMeters(s.total_meters)} em {s.withdrawal_count} saída{s.withdrawal_count > 1 ? 's' : ''}</span>
                            </div>
                        ))}
                        <div className="rounded-lg border border-[#F5A800]/40 bg-[#F5A800]/10 px-3 py-2 text-sm font-semibold">
                            Total: {formatMeters(summaryData?.total_meters ?? 0)}
                        </div>
                    </div>
                </div>
            )}

            {/* Tabela */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {isLoading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : items.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10">
                        Nenhuma saída registrada no período
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Data</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Loja</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Funcionário</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Película</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Bobina</th>
                                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Metros</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Motivo</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Registrado por</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                                    {canDelete && <th className="px-4 py-2.5" />}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {items.map((w) => (
                                    <tr key={w.id} className={`hover:bg-muted/30 ${w.is_reversed ? 'opacity-60' : ''}`}>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {new Date(w.created_at).toLocaleDateString('pt-BR')}{' '}
                                            <span className="text-muted-foreground text-xs">
                                                {new Date(w.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5">{w.store_name ?? '—'}</td>
                                        <td className="px-4 py-2.5 font-medium">{w.employee_name ?? '—'}</td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {w.film_type_name ?? '—'}{w.tonality ? ` ${w.tonality}` : ''}
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap" title={w.roll_visual_id}>{rollLabel(w)}</td>
                                        <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{formatMeters(w.meters)}</td>
                                        <td className="px-4 py-2.5 max-w-[220px] truncate" title={w.reason ?? undefined}>{w.reason ?? '—'}</td>
                                        <td className="px-4 py-2.5">{w.created_by_name ?? '—'}</td>
                                        <td className="px-4 py-2.5">
                                            {w.is_reversed ? (
                                                <span
                                                    className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                                    title={w.reversed_by_name ? `Estornada por ${w.reversed_by_name}` : undefined}
                                                >
                                                    Estornada
                                                </span>
                                            ) : (
                                                <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                                    Ativa
                                                </span>
                                            )}
                                        </td>
                                        {canDelete && (
                                            <td className="px-4 py-2.5 text-right">
                                                {!w.is_reversed && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-destructive hover:text-destructive"
                                                        onClick={() => setReverseTarget(w)}
                                                    >
                                                        <Undo2 className="h-4 w-4 mr-1" />
                                                        Estornar
                                                    </Button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Paginação */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                            Página {page} de {totalPages} — {listData?.total ?? 0} saída{(listData?.total ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmação de estorno */}
            <AlertDialog open={reverseTarget !== null} onOpenChange={(o) => { if (!o) setReverseTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Estornar saída?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {reverseTarget && (
                                <>
                                    Os {formatMeters(reverseTarget.meters)} retirados para{' '}
                                    <strong>{reverseTarget.employee_name}</strong> serão devolvidos à bobina de{' '}
                                    {reverseTarget.film_type_name ?? 'película'}
                                    {reverseTarget.tonality ? ` ${reverseTarget.tonality}` : ''}
                                    {' '}({rollLabel(reverseTarget)}). A saída fica marcada como
                                    estornada e sai do total do funcionário. Bobina marcada como esgotada não é
                                    restaurada automaticamente.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={reverseMutation.isPending}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                if (reverseTarget) reverseMutation.mutate(reverseTarget.id);
                            }}
                            disabled={reverseMutation.isPending}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {reverseMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Estornar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
