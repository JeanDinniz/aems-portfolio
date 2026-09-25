import { useState } from 'react';
import { Truck, Plus, FileDown, Loader2, ChevronLeft, ChevronRight, Film, Wrench, Trash2, Building2, Ban, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/hooks/use-toast';
import { useStores } from '@/hooks/useStores';
import { useMaterialRequests, useCancelMaterialRequest } from '@/hooks/useMaterialRequests';
import { materialRequestsService } from '@/services/api/materialRequests.service';
import { MaterialRequestDialog } from '@/components/features/material-requests/MaterialRequestDialog';
import { RollYieldView } from '@/components/features/material-requests/RollYieldView';
import { useHasPermission } from '@/hooks/useMyPermissions';
import type { MaterialRequest, MaterialPurchaseLineItem } from '@/types/materialRequest.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

const PAGE_SIZE = 20;

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
    return (
        <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
        </div>
    );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-[#F5A800]/10 flex items-center justify-center">
                <Truck className="w-7 h-7 text-[#F5A800]" />
            </div>
            <p className="text-base font-medium text-[#111111] dark:text-white">
                Nenhum pedido encontrado
            </p>
            <p className="text-sm text-[#666666] dark:text-zinc-400">
                Ajuste os filtros ou crie um novo pedido de material.
            </p>
        </div>
    );
}

// ─── Request Card ─────────────────────────────────────────────────────────────

interface RequestCardProps {
    request: MaterialRequest;
    canCancel: boolean;
    canEdit: boolean;
    onCancel: (request: MaterialRequest) => void;
    onEdit: (request: MaterialRequest) => void;
}

function RequestCard({ request, canCancel, canEdit, onCancel, onEdit }: RequestCardProps) {
    const isCancelled = request.status === 'cancelled';
    return (
        <div className={
            'border rounded-xl p-4 transition-colors space-y-3 ' +
            (isCancelled
                ? 'border-[#E8E8E8] dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#181818] opacity-70'
                : 'border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#1C1C1C] hover:border-[#F5A800]/50')
        }>
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ' +
                        (isCancelled ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-[#F5A800]/10')
                    }>
                        {isCancelled
                            ? <Ban className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                            : <Truck className="w-4 h-4 text-[#F5A800]" />
                        }
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-[#111111] dark:text-white">
                                {formatDateBR(request.request_date)}
                            </span>
                            {isCancelled && (
                                <Badge variant="secondary" className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 border-0">
                                    Cancelado
                                </Badge>
                            )}
                            {request.is_galpon && (
                                <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded-full">
                                    Galpão
                                </span>
                            )}
                            {request.source === 'planilha' && (
                                <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-1.5 py-0.5 rounded-full">
                                    Histórico
                                </span>
                            )}
                            {!isCancelled && request.edited_at && (
                                <Badge
                                    variant="secondary"
                                    className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-0"
                                >
                                    Editado
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-zinc-400 mt-0.5 flex-wrap">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span>{request.store_name ?? `Loja ${request.store_id}`}</span>
                            {request.created_by_name && (
                                <>
                                    <span className="text-[#D1D1D1] dark:text-zinc-600">•</span>
                                    <span>{request.created_by_name}</span>
                                </>
                            )}
                        </div>
                        {!isCancelled && request.edited_at && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">
                                editado em {formatDateBR(request.edited_at.slice(0, 10))}
                                {request.edited_by_name ? ` por ${request.edited_by_name}` : ''}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    {canEdit && !isCancelled && request.source !== 'planilha' && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(request)}
                            className="h-8 w-8 text-[#666666] hover:text-[#F5A800] hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            aria-label="Editar pedido"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                    {canCancel && !isCancelled && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onCancel(request)}
                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            aria-label="Cancelar pedido"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Cancellation reason */}
            {isCancelled && request.cancellation_reason && (
                <p className="text-xs text-zinc-500 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded-md px-3 py-1.5">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Motivo: </span>
                    {request.cancellation_reason}
                </p>
            )}

            {/* Notes */}
            {request.notes && (
                <p className="text-xs text-[#666666] dark:text-zinc-400 italic">
                    {request.notes}
                </p>
            )}

            {/* Items */}
            <div className="space-y-2">
                {/* Film items */}
                {request.film_items.length > 0 && (
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <Film className="h-3 w-3" />
                            <span>Películas ({request.film_items.length})</span>
                        </div>
                        <div className="pl-4 space-y-0.5">
                            {request.film_items.map((item, idx) => (
                                <div key={idx} className="text-xs text-[#444444] dark:text-zinc-300 flex items-center gap-1 flex-wrap">
                                    <span className="font-medium">{item.film_type_name}</span>
                                    {item.tonality && (
                                        <span className="text-[#666666] dark:text-zinc-400">
                                            — {item.tonality}
                                        </span>
                                    )}
                                    <span className="text-[#666666] dark:text-zinc-400">
                                        · {item.total_meters}m
                                    </span>
                                    {item.nfe_number && (
                                        <span className="text-[#888888] dark:text-zinc-500">
                                            · NF: {item.nfe_number}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Tool items */}
                {request.tool_items.length > 0 && (
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                            <Wrench className="h-3 w-3" />
                            <span>Ferramentas / Insumos ({request.tool_items.length})</span>
                        </div>
                        <div className="pl-4 space-y-0.5">
                            {request.tool_items.map((item) => (
                                <div key={item.id} className="text-xs text-[#444444] dark:text-zinc-300 flex items-center gap-1 flex-wrap">
                                    <span className="font-medium">{item.name}</span>
                                    <span className="text-[#666666] dark:text-zinc-400">
                                        × {item.quantity}
                                    </span>
                                    {item.nfe_number && (
                                        <span className="text-[#888888] dark:text-zinc-500">
                                            · NF: {item.nfe_number}
                                        </span>
                                    )}
                                    {item.notes && (
                                        <span className="text-[#888888] dark:text-zinc-500 italic">
                                            — {item.notes}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Purchase lines (histórico importado da planilha) */}
                <PurchaseLinesSection
                    lines={request.purchase_lines.filter((p) => p.kind === 'film')}
                    label="Películas (compra)"
                    icon="film"
                />
                <PurchaseLinesSection
                    lines={request.purchase_lines.filter((p) => p.kind === 'tool')}
                    label="Ferramentas (compra)"
                    icon="wrench"
                />
            </div>
        </div>
    );
}

function formatBRL(v: string | null): string | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function PurchaseLinesSection({
    lines,
    label,
    icon,
}: {
    lines: MaterialPurchaseLineItem[];
    label: string;
    icon: 'film' | 'wrench';
}) {
    if (lines.length === 0) return null;
    const Icon = icon === 'film' ? Film : Wrench;
    const color = icon === 'film' ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400';
    return (
        <div className="space-y-1">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${color}`}>
                <Icon className="h-3 w-3" />
                <span>{label} ({lines.length})</span>
            </div>
            <div className="pl-4 space-y-0.5">
                {lines.map((p) => {
                    const brl = formatBRL(p.cost);
                    const qty = p.quantity != null ? Number(p.quantity) : null;
                    return (
                        <div key={p.id} className="text-xs text-[#444444] dark:text-zinc-300 flex items-center gap-1 flex-wrap">
                            <span className="font-medium">{p.material_name}</span>
                            {p.tonality && (
                                <span className="text-[#666666] dark:text-zinc-400">— {p.tonality}</span>
                            )}
                            {qty != null && (
                                <span className="text-[#666666] dark:text-zinc-400">
                                    · {qty}{p.kind === 'film' ? 'm' : ''}
                                </span>
                            )}
                            {p.supplier && (
                                <span className="text-[#888888] dark:text-zinc-500">· {p.supplier}</span>
                            )}
                            {p.nfe_number && (
                                <span className="text-[#888888] dark:text-zinc-500">· NF: {p.nfe_number}</span>
                            )}
                            {brl && (
                                <span className="text-[#888888] dark:text-zinc-500">· {brl}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MaterialRequestsPage() {
    const { allStores } = useStores();
    const hasPermission = useHasPermission();
    const canCancel = hasPermission('material_requests', 'delete');
    const canEdit = hasPermission('material_requests', 'edit');

    // Filtros locais (padrão: mês atual)
    const today = new Date();
    const defaultDateFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultDateTo = today.toISOString().split('T')[0];

    const [storeFilter, setStoreFilter] = useState<string>('');
    const [dateFrom, setDateFrom] = useState<string>(defaultDateFrom);
    const [dateTo, setDateTo] = useState<string>(defaultDateTo);
    const [page, setPage] = useState(1);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRequest, setEditingRequest] = useState<MaterialRequest | null>(null);
    const [confirmCancel, setConfirmCancel] = useState<MaterialRequest | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [view, setView] = useState<'pedidos' | 'rendimento'>('pedidos');

    const queryParams = {
        store_id: storeFilter ? Number(storeFilter) : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        limit: PAGE_SIZE,
    };

    const { data, isLoading } = useMaterialRequests(queryParams);
    const cancelMutation = useCancelMaterialRequest();

    const requests = data?.items ?? [];
    const pagination = data?.pagination;
    const totalPages = pagination?.total_pages ?? 1;
    const total = pagination?.total ?? 0;

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const blob = await materialRequestsService.exportExcel({
                store_id: storeFilter ? Number(storeFilter) : undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pedidos_material.xlsx';
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao exportar',
                description: 'Não foi possível gerar o Excel.',
            });
        } finally {
            setIsExporting(false);
        }
    };

    const handleCancelConfirm = () => {
        if (!confirmCancel || !cancelReason.trim()) return;
        cancelMutation.mutate(
            { id: confirmCancel.id, reason: cancelReason.trim() },
            {
                onSuccess: () => { setConfirmCancel(null); setCancelReason(''); },
                onError: () => { setConfirmCancel(null); setCancelReason(''); },
            },
        );
    };

    const handlePageChange = (newPage: number) => {
        setPage(Math.max(1, Math.min(newPage, totalPages)));
    };

    // Reset page on filter change
    const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
        setter(v);
        setPage(1);
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Truck className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Pedidos de Material
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Registro de pedidos de películas, ferramentas e insumos.
                        </p>
                    </div>
                </div>
                {view === 'pedidos' && (
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExport}
                            disabled={isExporting || isLoading}
                            className="gap-1.5"
                        >
                            {isExporting
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <FileDown className="h-4 w-4" />
                            }
                            Exportar Excel
                        </Button>
                        <Button
                            onClick={() => { setEditingRequest(null); setDialogOpen(true); }}
                            className="font-semibold gap-1.5"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Plus className="h-4 w-4" />
                            Novo Pedido
                        </Button>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[#E8E8E8] dark:border-[#333333]">
                {([
                    { key: 'pedidos', label: 'Pedidos' },
                    { key: 'rendimento', label: 'Rendimento das Bobinas' },
                ] as const).map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setView(t.key)}
                        className={
                            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
                            (view === t.key
                                ? 'border-[#F5A800] text-[#111111] dark:text-white'
                                : 'border-transparent text-[#888888] dark:text-zinc-500 hover:text-[#111111] dark:hover:text-zinc-300')
                        }
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {view === 'rendimento' ? (
                <RollYieldView />
            ) : (
            <>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                {/* Loja */}
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <Label className="text-xs text-[#666666] dark:text-zinc-400">Loja</Label>
                    <Select
                        value={storeFilter || '__all__'}
                        onValueChange={handleFilterChange((v) => setStoreFilter(v === '__all__' ? '' : v))}
                    >
                        <SelectTrigger className="h-9 bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">Todas as lojas</SelectItem>
                            {allStores.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Data de */}
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-[#666666] dark:text-zinc-400">De</Label>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                        className="h-9 rounded-md border border-[#D1D1D1] bg-white dark:bg-[#252525] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-zinc-300 focus:outline-none focus:border-[#F5A800]"
                    />
                </div>

                {/* Data até */}
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-[#666666] dark:text-zinc-400">Até</Label>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                        className="h-9 rounded-md border border-[#D1D1D1] bg-white dark:bg-[#252525] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-zinc-300 focus:outline-none focus:border-[#F5A800]"
                    />
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <SkeletonRows />
            ) : requests.length === 0 ? (
                <EmptyState />
            ) : (
                <>
                    {/* Total count */}
                    <p className="text-xs text-[#666666] dark:text-zinc-400">
                        {total} {total === 1 ? 'pedido encontrado' : 'pedidos encontrados'}
                    </p>

                    {/* Cards */}
                    <div className="space-y-3">
                        {requests.map((req) => (
                            <RequestCard
                                key={req.id}
                                request={req}
                                canCancel={canCancel}
                                canEdit={canEdit}
                                onCancel={setConfirmCancel}
                                onEdit={setEditingRequest}
                            />
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                            <p className="text-xs text-[#666666] dark:text-zinc-400">
                                Página {page} de {totalPages}
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={!pagination?.has_prev}
                                    aria-label="Página anterior"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={!pagination?.has_next}
                                    aria-label="Próxima página"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
            </>
            )}

            {/* Dialog: Novo Pedido / Editar Pedido */}
            <MaterialRequestDialog
                open={dialogOpen || editingRequest !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setDialogOpen(false);
                        setEditingRequest(null);
                    }
                }}
                stores={allStores}
                editing={editingRequest}
            />

            {/* AlertDialog: Cancelar Pedido */}
            <AlertDialog
                open={confirmCancel !== null}
                onOpenChange={(open) => {
                    if (!open) { setConfirmCancel(null); setCancelReason(''); }
                }}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">
                            Cancelar Pedido
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Cancelar o pedido de{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {confirmCancel ? formatDateBR(confirmCancel.request_date) : ''}
                            </span>
                            {confirmCancel?.store_name ? ` da loja ${confirmCancel.store_name}` : ''}
                            . As bobinas que ainda não foram usadas em carros serão removidas do estoque.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 px-1">
                        <Label htmlFor="cancel-reason-mr" className="text-sm font-medium text-[#111111] dark:text-white">
                            Motivo do cancelamento <span className="text-red-600">*</span>
                        </Label>
                        <Textarea
                            id="cancel-reason-mr"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Descreva o motivo do cancelamento…"
                            rows={3}
                            className="bg-white dark:bg-[#1C1C1C] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white resize-none"
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Voltar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleCancelConfirm}
                            disabled={!cancelReason.trim() || cancelMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                        >
                            {cancelMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Confirmar cancelamento
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
