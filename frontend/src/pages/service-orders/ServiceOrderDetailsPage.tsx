import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useServiceOrder, useUpdateServiceOrder, useUpdateServiceOrderStatus, useCancelServiceOrder } from '@/hooks/useServiceOrders';
import { useAuth } from '@/hooks/useAuth';
import { WorkerAssignmentDialog } from '@/components/features/service-orders/WorkerAssignmentDialog';
import { FinalizeOSModal } from '@/components/features/service-orders/FinalizeOSModal';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Car, Tag, Loader2, Edit, CheckCircle2, Play, FileText, XCircle, ListChecks } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CreateServiceOrderData } from '@/types/service-order.types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABELS, DEPARTMENTS_MAP } from '@/constants/service-orders';
import { SERVICE_CATEGORY_LABELS } from '@/services/api/services.service';
import type { ServiceCategory } from '@/services/api/services.service';

type OsItem = {
    service_id: number;
    quantity: number;
    unit_price?: number;
    notes?: string;
    tonality?: string;
    roll_code?: string;
    service_name?: string | null;
    service_code?: string | null;
    category?: ServiceCategory | null;
    service_category?: ServiceCategory | null;
    film_roll_id?: number | null;
    film_type_id?: number | null;
};

const UNGROUPED_LABEL = 'Serviços';

function groupItemsByCategory(items: OsItem[]): { category: string; items: OsItem[] }[] {
    const groups: Map<string, OsItem[]> = new Map();
    for (const item of items) {
        const rawCat = item.category ?? item.service_category ?? null;
        const label = rawCat
            ? (SERVICE_CATEGORY_LABELS[rawCat] ?? UNGROUPED_LABEL)
            : UNGROUPED_LABEL;
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label)!.push(item);
    }
    // Move "Serviços" (ungrouped) to the end
    const result: { category: string; items: OsItem[] }[] = [];
    groups.forEach((groupItems, category) => {
        if (category !== UNGROUPED_LABEL) result.push({ category, items: groupItems });
    });
    if (groups.has(UNGROUPED_LABEL)) {
        result.push({ category: UNGROUPED_LABEL, items: groups.get(UNGROUPED_LABEL)! });
    }
    return result;
}

export default function ServiceOrderDetailsPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { data: os, isLoading, isError } = useServiceOrder(Number(id));
    const updateStatus = useUpdateServiceOrderStatus();
    const updateOrder = useUpdateServiceOrder();

    const { user } = useAuth();
    const cancelOrder = useCancelServiceOrder();

    const [showWorkerDialog, setShowWorkerDialog] = useState(false);
    const [showFinalizeModal, setShowFinalizeModal] = useState(false);
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelReason, setCancelReason] = useState('');

    const canCancel = user?.role === 'owner'
        && os?.status !== 'cancelled';

    const groupedItems = useMemo(
        () => groupItemsByCategory((os?.items ?? []) as OsItem[]),
        [os?.items]
    );

    const handleWorkerAssignment = (workerIds: number[], primaryWorkerId: number) => {
        const workers = [
            { employee_id: primaryWorkerId },
            ...workerIds
                .filter(id => id !== primaryWorkerId)
                .map(id => ({ employee_id: id })),
        ];

        updateOrder.mutate({ id: Number(id), data: { workers } as Partial<CreateServiceOrderData> }, {
            onSuccess: () => {
                updateStatus.mutate({ id: Number(id), status: 'doing' }, {
                    onSuccess: () => {
                        setShowWorkerDialog(false);
                        toast({
                            title: "Serviço Iniciado",
                            description: "Funcionários atribuídos com sucesso."
                        });
                    },
                    onError: () => {
                        toast({
                            variant: "destructive",
                            title: "Erro",
                            description: "Não foi possível iniciar o serviço."
                        });
                    }
                });
            },
            onError: () => {
                toast({
                    variant: "destructive",
                    title: "Erro",
                    description: "Não foi possível atribuir os funcionários."
                });
            }
        });
    };


    const renderActionButtons = () => {
        if (!os) return null;
        switch (os.status) {
            case 'waiting':
                return (
                    <Button onClick={() => setShowWorkerDialog(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Play className="mr-2 h-4 w-4" /> Iniciar Serviço
                    </Button>
                );
            case 'doing':
                return (
                    <Button onClick={() => setShowFinalizeModal(true)} className="bg-green-600 hover:bg-green-700 text-white">
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Finalizar
                    </Button>
                );
            default:
                return null;
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
        );
    }
    if (isError || !os) {
        return (
            <div className="flex justify-center p-8 text-red-400">
                Erro ao carregar detalhes da OS.
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Voltar"
                    onClick={() => navigate('/service-orders')}
                    className="text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-700/50"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex items-center gap-3">
                            <h1
                                className="text-[#111111] dark:text-white text-2xl font-bold"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                OS #{os.order_number}
                            </h1>
                            <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                    os.status === 'cancelled'
                                        ? 'bg-red-900/30 text-red-400 border-red-700/50'
                                        : 'bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-300 border-[#D1D1D1] dark:border-zinc-700'
                                }`}
                            >
                                {STATUS_LABELS[os.status] || os.status}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {os.status !== 'cancelled' && (
                                <Button
                                    onClick={() => navigate(`/service-orders/${id}/edit`)}
                                    className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                                >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Editar
                                </Button>
                            )}
                            {renderActionButtons()}
                            {canCancel && (
                                <Button
                                    variant="ghost"
                                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                                    onClick={() => setShowCancelDialog(true)}
                                >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancelar OS
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Main Info */}
                <div className="md:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-6 space-y-6">
                        <h2 className="text-[#111111] dark:text-zinc-100 font-semibold text-base">Detalhes do Serviço</h2>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <span className="text-sm font-medium text-[#666666] dark:text-zinc-400 flex items-center gap-1">
                                    <Car className="h-3 w-3" /> Veículo / Placa
                                </span>
                                <p className="text-lg font-medium text-[#111111] dark:text-zinc-100">
                                    {os.vehicle_model}{os.vehicle_color ? ` - ${os.vehicle_color}` : ''}
                                </p>
                                <div className="inline-block bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-sm font-mono border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300">
                                    {os.plate}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-sm font-medium text-[#666666] dark:text-zinc-400 flex items-center gap-1">
                                    <Tag className="h-3 w-3" /> Departamento
                                </span>
                                <p className="text-lg font-medium text-[#111111] dark:text-zinc-100">
                                    {DEPARTMENTS_MAP[os.department] || os.department}
                                </p>
                                {os.invoice_number && (
                                    <p className="text-sm text-green-400 flex items-center gap-1">
                                        <FileText className="h-3 w-3" /> NF: {os.invoice_number}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-sm font-medium text-[#666666] dark:text-zinc-400">Descrição do Serviço</span>
                            <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-lg text-sm whitespace-pre-wrap text-[#111111] dark:text-zinc-200 border border-[#E8E8E8] dark:border-[#333333]">
                                {os.service_description}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-sm font-medium text-[#666666] dark:text-zinc-400">Observações Gerais</span>
                            <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-lg text-sm text-[#111111] dark:text-zinc-200 border border-[#E8E8E8] dark:border-[#333333]">
                                {os.notes || "N/A"}
                            </div>
                        </div>

                        {os.internal_notes && (
                            <div className="space-y-1">
                                <span className="text-sm font-medium text-[#666666] dark:text-zinc-400">Observações Internas</span>
                                <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg text-sm text-[#111111] dark:text-zinc-200 border border-amber-200 dark:border-amber-800/30">
                                    {os.internal_notes}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Itens do Serviço */}
                    {groupedItems.length > 0 && (
                        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-6 space-y-4">
                            <h2 className="text-[#111111] dark:text-zinc-100 font-semibold text-base flex items-center gap-2">
                                <ListChecks className="h-4 w-4 text-[#F5A800]" />
                                Itens do Serviço
                            </h2>
                            <div className="space-y-5">
                                {groupedItems.map(({ category, items }) => (
                                    <div key={category}>
                                        {groupedItems.length > 1 || category !== UNGROUPED_LABEL ? (
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400">
                                                    {category}
                                                </span>
                                                <div className="flex-1 h-px bg-[#E8E8E8] dark:bg-[#333333]" />
                                            </div>
                                        ) : null}
                                        <div className="space-y-1.5">
                                            {items.map((item, idx) => (
                                                <div
                                                    key={`${item.service_id}-${idx}`}
                                                    className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800/50 border border-[#E8E8E8] dark:border-[#333333]"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-[#111111] dark:text-zinc-200 truncate">
                                                            {item.service_code
                                                                ? `${item.service_code} - ${item.service_name ?? `Serviço #${item.service_id}`}`
                                                                : (item.service_name ?? `Serviço #${item.service_id}`)}
                                                        </p>
                                                        {(item.tonality || item.notes || item.roll_code) && (
                                                            <p className="text-xs text-[#666666] dark:text-zinc-400 mt-0.5 truncate">
                                                                {[
                                                                    item.tonality && `Tonalidade: ${item.tonality}`,
                                                                    item.roll_code && `Bobina: ${item.roll_code}`,
                                                                    item.notes,
                                                                ].filter(Boolean).join(' · ')}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        {item.quantity > 1 && (
                                                            <span className="text-xs text-[#666666] dark:text-zinc-400">
                                                                x{item.quantity}
                                                            </span>
                                                        )}
                                                        {item.unit_price != null && (
                                                            <span className="text-sm font-medium text-[#111111] dark:text-zinc-200">
                                                                {item.unit_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                    {os.workers && os.workers.length > 0 && (
                        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-5 space-y-3">
                            <h3 className="text-[#111111] dark:text-zinc-100 font-semibold text-sm">Equipe Atribuída</h3>
                            <div className="space-y-3">
                                {os.workers.map((worker) => (
                                    <div key={worker.id} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-zinc-700 flex items-center justify-center font-medium text-xs text-[#111111] dark:text-zinc-200">
                                                {worker.name.substring(0, 2).toUpperCase()}
                                            </div>
                                            <span className={`text-[#111111] dark:text-zinc-200 ${worker.isPrimary ? 'font-medium' : ''}`}>
                                                {worker.name} {worker.isPrimary && "(Responsável)"}
                                            </span>
                                        </div>
                                        {worker.isPrimary && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                                Principal
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>

            <WorkerAssignmentDialog
                open={showWorkerDialog}
                onOpenChange={setShowWorkerDialog}
                storeId={os.location_id}
                onConfirm={handleWorkerAssignment}
                isSubmitting={updateStatus.isPending}
            />

            <FinalizeOSModal
                open={showFinalizeModal}
                serviceOrderId={Number(id)}
                storeId={os.location_id}
                department={os.department}
                items={((os.items || []) as OsItem[]).map(i => ({
                    service_id: i.service_id,
                    service_name: i.service_name,
                    service_code: i.service_code,
                    category: i.category ?? i.service_category ?? null,
                    tonality: i.tonality,
                    film_roll_id: i.film_roll_id ?? null,
                    film_type_id: i.film_type_id ?? null,
                }))}
                isGalpon={os.is_galpon}
                onClose={() => setShowFinalizeModal(false)}
                onSuccess={() => {
                    setShowFinalizeModal(false)
                    toast({ title: 'O.S. Finalizada', description: 'A ordem de servico foi concluida com sucesso.' })
                }}
            />

            {/* Dialog: Confirmar Cancelamento */}
            <Dialog
                open={showCancelDialog}
                onOpenChange={(open) => {
                    setShowCancelDialog(open);
                    if (!open) setCancelReason('');
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                    <DialogHeader>
                        <DialogTitle className="text-red-400 flex items-center gap-2">
                            <XCircle className="h-5 w-5" />
                            Cancelar Ordem de Serviço
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-[#666666] dark:text-zinc-400">
                        A OS <strong className="text-[#111111] dark:text-zinc-200">#{os.order_number}</strong> será cancelada e removida do painel
                        operacional. O registro ficará disponível para auditoria.
                    </p>
                    <div className="space-y-1.5">
                        <label htmlFor="cancel-reason" className="text-sm font-medium text-[#666666] dark:text-zinc-300">Motivo (opcional)</label>
                        <Textarea
                            id="cancel-reason"
                            placeholder="Ex: OS lançada por engano, veículo não compareceu..."
                            className="min-h-[80px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                        />
                    </div>
                    <DialogFooter className="gap-2">
                        <Button
                            onClick={() => {
                                setShowCancelDialog(false);
                                setCancelReason('');
                            }}
                            className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                        >
                            Voltar
                        </Button>
                        <Button
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => {
                                cancelOrder.mutate(
                                    { id: Number(id), reason: cancelReason || undefined },
                                    {
                                        onSuccess: () => {
                                            setShowCancelDialog(false);
                                            setCancelReason('');
                                            toast({
                                                title: 'OS Cancelada',
                                                description: 'A ordem de serviço foi cancelada.',
                                            });
                                        },
                                        onError: () => {
                                            toast({
                                                variant: 'destructive',
                                                title: 'Não foi possível cancelar',
                                                description: 'Ocorreu um erro ao cancelar a OS. Tente novamente.',
                                            });
                                        },
                                    }
                                );
                            }}
                            disabled={cancelOrder.isPending}
                        >
                            {cancelOrder.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Confirmar Cancelamento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
