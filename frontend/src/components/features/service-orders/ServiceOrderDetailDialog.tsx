import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { DepartmentBadge } from '@/components/common/DepartmentBadge';
import { useServiceOrder } from '@/hooks/useServiceOrders';
import { formatMeters } from '@/utils/filmRoll';
import { STATUS_LABELS } from '@/constants/service-orders';
import type { ServiceOrder, ServiceOrderStatus } from '@/types/service-order.types';

interface ServiceOrderDetailDialogProps {
    /** id numérico interno da O.S. — null/undefined mantém o dialog fechado sem disparar a query. */
    serviceOrderId: number | null;
    open: boolean;
    onClose: () => void;
}

const STATUS_BADGE_COLORS: Record<ServiceOrderStatus, string> = {
    waiting:   'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400',
    doing:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    ready:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    wrong:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    duplicate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

function formatServiceDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function isFilmDepartment(dept: string): boolean {
    return dept === 'film' || dept === 'security_film' || dept === 'ppf';
}

/**
 * Modal de detalhe READ-ONLY de uma O.S. (HML-245). Aberto pelo botão
 * "Visualizar" nos cards mobile da listagem de Ordens de Serviço.
 *
 * Busca os dados via `useServiceOrder(id)` (só dispara quando `open` +
 * `serviceOrderId` presentes). `linear_meters`/`service_order_item_id` são
 * campos novos expostos pelo backend — ver `service-order.types.ts`.
 */
export function ServiceOrderDetailDialog({ serviceOrderId, open, onClose }: ServiceOrderDetailDialogProps) {
    const { data: order, isLoading, isError } = useServiceOrder(open ? (serviceOrderId ?? undefined) : undefined);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
                <DialogTitle className="sr-only">
                    Detalhes da O.S. {order?.plate ?? ''}
                </DialogTitle>

                {isLoading ? (
                    <div className="space-y-3 py-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-5 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse" />
                        ))}
                    </div>
                ) : isError || !order ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-sm text-red-500">
                        <AlertCircle className="h-5 w-5" />
                        Erro ao carregar os detalhes da O.S.
                    </div>
                ) : (
                    <ServiceOrderDetailContent order={order} />
                )}

                <div className="flex justify-end pt-1">
                    <Button variant="outline" onClick={onClose}>Fechar</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ServiceOrderDetailContent({ order }: { order: ServiceOrder }) {
    // Ordena por id (= ordem de criação dos itens) para o rótulo "[WP N]" ser
    // estável entre leituras — a relação items não tem order_by garantido.
    const filmItems = (order.items ?? [])
        .filter((item) => item.service_name)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const showFilmSection = isFilmDepartment(order.department) && filmItems.length > 0;
    const hasNotes = !!(order.notes || order.internal_notes);

    return (
        <div className="space-y-4 pr-4">
            {/* Badges: Departamento + Status */}
            <div className="flex items-center gap-2 flex-wrap">
                <DepartmentBadge department={order.department} />
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE_COLORS[order.status] ?? STATUS_BADGE_COLORS.waiting}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
                </span>
            </div>

            {/* Placa + Modelo */}
            <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono font-bold text-lg tracking-widest text-[#111111] dark:text-white">
                    {order.plate}
                </span>
                {order.vehicle_model && (
                    <span className="text-sm text-[#666666] dark:text-zinc-400">{order.vehicle_model}</span>
                )}
            </div>

            {/* Cor / Loja */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold mb-0.5">Cor</div>
                    <div className="text-sm text-[#111111] dark:text-zinc-200">{order.vehicle_color || '—'}</div>
                </div>
                <div>
                    <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold mb-0.5">Loja</div>
                    <div className="flex items-center gap-1.5 text-sm text-[#111111] dark:text-zinc-200">
                        <span className="truncate">{order.location_name || '—'}</span>
                        {order.is_galpon && (
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                Galpão
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Data do Serviço / Consultor */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold mb-0.5">Data do Serviço</div>
                    <div className="text-sm text-[#111111] dark:text-zinc-200">
                        {formatServiceDateTime(order.service_date ?? order.entry_time)}
                    </div>
                </div>
                <div>
                    <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold mb-0.5">Consultor</div>
                    <div className="text-sm text-[#111111] dark:text-zinc-200 truncate">{order.consultant_name || '—'}</div>
                </div>
            </div>

            {/* Películas */}
            {showFilmSection && (
                <div className="rounded-lg border border-[#E8E8E8] dark:border-[#333333] bg-gray-50 dark:bg-zinc-800/20 p-3 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold">Películas</div>
                    {filmItems.map((item, idx) => {
                        // Um item pode ter N instaladores (serviço feito a dois) —
                        // cada um é um worker com o mesmo service_order_item_id.
                        const installers = (order.workers ?? []).filter(
                            (w) => item.id != null && w.service_order_item_id === item.id
                        );
                        return (
                            <div
                                key={item.id ?? idx}
                                className="rounded-md border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-2.5 space-y-1"
                            >
                                <div className="text-sm text-[#111111] dark:text-zinc-200">
                                    <span className="font-semibold">[WP {idx + 1}]</span>{' '}
                                    {item.service_name}
                                    {item.tonality ? ` — ${item.tonality}` : ''}
                                </div>
                                <div className="text-xs text-[#666666] dark:text-zinc-400 font-mono">
                                    {item.roll_code || '—'} · {formatMeters(item.linear_meters)}
                                </div>
                                <div className="flex items-center gap-1.5 pt-0.5">
                                    <span className="text-[10px] uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold">
                                        Instalador:
                                    </span>
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-[#111111] dark:text-zinc-200">
                                        {installers.length ? installers.map((w) => w.name).filter(Boolean).join(', ') : '—'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Observações */}
            <div className="rounded-lg border border-[#E8E8E8] dark:border-[#333333] bg-gray-50 dark:bg-zinc-800/20 p-3 space-y-1.5">
                <div className="text-xs uppercase tracking-wide text-[#999999] dark:text-zinc-500 font-semibold">Observações</div>
                {hasNotes ? (
                    <>
                        {order.notes && (
                            <p className="text-sm text-[#111111] dark:text-zinc-200 whitespace-pre-wrap">{order.notes}</p>
                        )}
                        {order.internal_notes && (
                            <p className="text-sm text-[#666666] dark:text-zinc-400 whitespace-pre-wrap">
                                <span className="font-semibold">Interna:</span> {order.internal_notes}
                            </p>
                        )}
                    </>
                ) : (
                    <p className="text-sm text-[#999999] dark:text-zinc-500">—</p>
                )}
            </div>
        </div>
    );
}
