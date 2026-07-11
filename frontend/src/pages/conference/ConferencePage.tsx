import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getApiErrorMessage } from '@/lib/api-error';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { servicesService } from '@/services/api/services.service';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import { useConferenceFiltersStore, type ConferenceStatusValue } from '@/stores/filters.store';
import { MultiSelectFilter } from '@/components/common/MultiSelectFilter';
import { useConsultants } from '@/hooks/useConsultants';
import { useVehicleModels } from '@/hooks/useVehicleModels';
import { useServices } from '@/hooks/useServices';
import { useConferenceSummary } from '@/hooks/useConferenceSummary';
import { useConferenceSummaryByStore } from '@/hooks/useConferenceSummaryByStore';
import { useDebounce } from '@/hooks/useDebounce';
import { employeesService } from '@/services/api/employees.service';
import { storesService } from '@/services/api/stores.service';
import type { ServiceOrder, Department } from '@/types/service-order.types';
import type { Photo } from '@/types/photo.types';
import { DEPARTMENTS_MAP, OS_STATUS_HISTORY_LABELS } from '@/constants/service-orders';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import { toThumbUrl } from '@/utils/imageThumb';

// Cores do badge de status no histórico (vocabulário backend). Fora do componente
// para não recriar o objeto a cada item renderizado da timeline.
const HISTORY_STATUS_COLORS: Record<string, string> = {
    waiting: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    wrong: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    duplicate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};
import { isValidPlateOrChassi, PLATE_ERROR_MESSAGE } from '@/utils/plate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { PhotoDialog } from '@/components/common/PhotoDialog';
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
import { AlertCircle, CheckCircle, CheckCircle2, Pencil, Search, ClipboardCheck, ImageOff, X, RotateCcw, Download, ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, Car, Clock, AlertTriangle, XCircle, Copy } from 'lucide-react';
import apiClient from '@/services/api/client';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadService } from '@/services/api/upload.service';
import {
    DeptToggle,
    ServicePicker,
    FilmPicker,
    CompactPhotoUploader,
    QuickCreateModal,
    buildPrefillFromOrder,
    type FilmEntry,
} from '@/components/features/service-orders/QuickCreateModal';
import { ConferenceSummaryCards } from '@/components/features/conference/ConferenceSummaryCards';
import { DepartmentBadge } from '@/components/common/DepartmentBadge';

// ─── Flag Filter Dropdown (Cortesia / Galpão / Retorno) ───────────────────────

interface FlagFilters { courtesy: boolean; galpon: boolean; retorno: boolean }

function FlagFilterDropdown({ value, onChange }: { value: FlagFilters; onChange: (v: FlagFilters) => void }) {
    const [open, setOpen] = useState(false);

    const active = [
        value.courtesy && 'Cortesia',
        value.galpon   && 'Galpão',
        value.retorno  && 'Retorno',
    ].filter(Boolean) as string[];

    const label = active.length === 0 ? 'Todos' : active.join(', ');

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="flex h-9 w-36 items-center justify-between gap-2 rounded-lg border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 text-sm text-[#111111] dark:text-white cursor-pointer hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] focus:outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] transition-colors"
                >
                    <span className="truncate">{label}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 p-1 border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]">
                {([
                    { key: 'courtesy', label: 'Cortesia' },
                    { key: 'galpon',   label: 'Galpão'   },
                    { key: 'retorno',  label: 'Retorno'  },
                ] as { key: keyof FlagFilters; label: string }[]).map(opt => (
                    <DropdownMenuCheckboxItem
                        key={opt.key}
                        checked={value[opt.key]}
                        onSelect={(e) => { e.preventDefault(); onChange({ ...value, [opt.key]: !value[opt.key] }); }}
                        className="text-sm text-[#111111] dark:text-white focus:bg-[#F5F5F5] dark:focus:bg-[#2A2A2A] [&>span]:border-2 [&>span]:border-[#F5A800] [&>span]:rounded-sm"
                    >
                        {opt.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

// Formata data para pt-BR
function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// Formata um datetime ISO (ex: updated_at) como dd/mm/aaaa HH:mm
function formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// Formata valor em BRL
function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Calcula valor total de uma OS com base nos itens (unit_price * quantity)
function calcTotal(order: ServiceOrder): number {
    if (!order.items || order.items.length === 0) return 0;
    return order.items.reduce((sum, item) => {
        const price = item.unit_price ?? 0;
        const qty = item.quantity ?? 1;
        return sum + price * qty;
    }, 0);
}

// Remove tags [CORTESIA] e [RETORNO] das observações para exibição
function cleanNotes(notes: string | null | undefined): string {
    if (!notes) return '—';
    const clean = notes
        .replace(/\s*\|\s*\[CORTESIA\]|\[CORTESIA\]\s*\|\s*/g, '')
        .replace(/\s*\|\s*\[RETORNO\]|\[RETORNO\]\s*\|\s*/g, '')
        .trim();
    return clean || '—';
}

// Lista de nomes dos serviços de uma OS
function getServiceList(order: ServiceOrder, services?: Array<{ id: number; name: string; code?: string | null }>): string[] {
    if (!order.items || order.items.length === 0) return [];
    if (!services || services.length === 0) return order.items.map((_, i) => `Serviço #${i + 1}`);
    return order.items.map((item) => {
        const svc = services.find((s) => s.id === item.service_id);
        const name = item.service_name ?? svc?.name ?? `Serviço #${item.service_id}`;
        const code = svc?.code;
        return code ? `${code} - ${name}` : name;
    });
}

// ─── EditDialog ────────────────────────────────────────────────────────────────
interface EditDialogProps {
    order: ServiceOrder | null;
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
    canEdit?: boolean;
    canDelete?: boolean;
    onGenerateCopy?: (order: ServiceOrder) => void;
}

function EditDialog({ order, open, onClose, onSaved, canEdit, canDelete, onGenerateCopy }: EditDialogProps) {
    const [department, setDepartment] = useState<Department | undefined>();
    const [serviceDate, setServiceDate] = useState('');
    const [externalOs, setExternalOs] = useState('');
    const [plate, setPlate] = useState('');
    const [vehicleModel, setVehicleModel] = useState('');
    const [vehicleModelId, setVehicleModelId] = useState<number | undefined>();
    const [vehicleColor, setVehicleColor] = useState('');
    const [consultantId, setConsultantId] = useState<number | undefined>();
    const [isGalpon, setIsGalpon] = useState(false);
    const [isReturn, setIsReturn] = useState(false);
    const [isCourtesy, setIsCourtesy] = useState(false);
    const [selectedServices, setSelectedServices] = useState<number[]>([]);
    // Preços de serviços com valor variável (PEQREP — ex.: Martelinho de Ouro)
    const [servicePrices, setServicePrices] = useState<Record<number, string>>({});
    const [servicePriceErrors, setServicePriceErrors] = useState<Record<number, string>>({});
    const [filmEntries, setFilmEntries] = useState<FilmEntry[]>([]);
    const [installers, setInstallers] = useState<number[]>([]);
    const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
    const [confirmRemovePhotoOpen, setConfirmRemovePhotoOpen] = useState(false);
    const [photoZoomOpen, setPhotoZoomOpen] = useState(false);
    const [newPhoto, setNewPhoto] = useState<Photo[]>([]);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [internalNotes, setInternalNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [vehicleHistoryOpen, setVehicleHistoryOpen] = useState(true);
    const [osHistoryOpen, setOsHistoryOpen] = useState(false);

    // Ponto 2: storeId como estado
    const [storeId, setStoreId] = useState<number | undefined>(undefined);
    // Serviços originais do lançamento para referência quando a loja mudar
    const [originalServiceNames, setOriginalServiceNames] = useState<string[]>([]);
    // Indica que a loja foi trocada e o usuário precisa reselecionar serviços
    const [needsServiceReconfirm, setNeedsServiceReconfirm] = useState(false);

    // Ponto 1: estado para o dialog de cancelamento com motivo
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Ponto 1: estado para o dialog de erro com motivo
    const [errorDialogOpen, setErrorDialogOpen] = useState(false);
    const [errorReason, setErrorReason] = useState('');
    const [markingError, setMarkingError] = useState(false);

    const { data: vehicleHistory, isLoading: vehicleHistoryLoading } = useQuery({
        queryKey: ['vehicle-history', order?.plate],
        queryFn: () => serviceOrdersService.getVehicleHistory(order!.plate),
        enabled: vehicleHistoryOpen && !!order?.plate,
        staleTime: 30_000,
    });

    const { data: osHistory, isLoading: osHistoryLoading } = useQuery({
        queryKey: ['os-history', order?.id],
        queryFn: () => serviceOrdersService.getOSHistory(order!.id),
        enabled: osHistoryOpen && !!order?.id,
        staleTime: 30_000,
    });

    const { data: orderDetail } = useQuery({
        queryKey: ['service-order-edit-detail', order?.id],
        queryFn: () => serviceOrdersService.getById(order!.id),
        enabled: open && !!order?.id,
        staleTime: 0,
    });

    const { availableStores } = useStoreStore();
    const cachedBrandId = availableStores.find((s) => s.id === storeId)?.brand_id;

    const { data: storeDetail } = useQuery({
        queryKey: ['stores', storeId],
        queryFn: () => storesService.getById(storeId!),
        enabled: open && !!storeId && !cachedBrandId,
        staleTime: 1000 * 60 * 60,
    });

    const storeBrandId = cachedBrandId ?? storeDetail?.brand_id;

    const { consultants, isLoading: consultantsLoading } = useConsultants(
        storeId ? { store_id: storeId, is_active: true } : undefined,
        1,
        100
    );
    const { data: vehicleModels, isLoading: modelsLoading } = useVehicleModels(
        storeId && storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );
    // Catálogo de serviços do departamento — usado para validar preços variáveis (PEQREP)
    const { data: editServices } = useServices(department, storeBrandId);

    const queryClient = useQueryClient();

    useEffect(() => {
        if (order && open) {
            setDepartment(order.department);
            setServiceDate(order.service_date ?? '');
            setExternalOs(order.external_os_number ?? '');
            setPlate(order.plate ?? '');
            setVehicleModel(order.vehicle_model ?? '');
            setVehicleModelId(order.vehicle_model_id ?? undefined);
            setVehicleColor(order.vehicle_color ?? '');
            setConsultantId(order.consultant_id ?? undefined);
            setIsGalpon(order.is_galpon ?? false);
            setIsCourtesy(order.is_courtesy ?? false);
            setIsReturn(order.is_return ?? false);
            const rawNotes = order.notes ?? '';
            setNotes(rawNotes.replace(/\s*\|\s*\[CORTESIA\]|\[CORTESIA\]\s*\|\s*/g, '').replace(/\s*\|\s*\[RETORNO\]|\[RETORNO\]\s*\|\s*/g, '').trim());
            setInternalNotes(order.internal_notes ?? '');
            setInvoiceNumber(order.invoice_number ?? '');
            setExistingPhotoUrl(order.photos?.[0] ?? null);
            setNewPhoto([]);

            // Ponto 2: inicializa storeId com a loja original
            setStoreId(order.location_id ?? undefined);
            setNeedsServiceReconfirm(false);

            // Captura nomes dos serviços originais para referência
            const isFilm = order.department === 'film' || order.department === 'security_film' || order.department === 'ppf';
            if (isFilm) {
                setOriginalServiceNames((order.items ?? []).map(item => {
                    const name = item.service_name ?? `Serviço #${item.service_id}`;
                    const tonality = item.tonality ? ` (${item.tonality})` : '';
                    return `${name}${tonality}`;
                }));
                setFilmEntries((order.items ?? []).map(item => ({
                    service_id: item.service_id,
                    service_name: item.service_name ?? undefined,
                    tonality: item.tonality ?? '',
                    roll_code: item.roll_code ?? '',
                    film_roll_id: item.film_roll_id ?? undefined,
                    film_type_id: item.film_type_id ?? undefined,
                })));
                setSelectedServices([]);
            } else {
                setOriginalServiceNames((order.items ?? []).map(item => item.service_name ?? `Serviço #${item.service_id}`));
                setSelectedServices((order.items ?? []).map(item => item.service_id));
                setFilmEntries([]);
                // Pré-popula preços variáveis dos itens existentes
                const initialPrices: Record<number, string> = {};
                (order.items ?? []).forEach(item => {
                    if (item.unit_price != null) initialPrices[item.service_id] = String(item.unit_price);
                });
                setServicePrices(initialPrices);
                setServicePriceErrors({});
            }
            setInstallers((order.workers ?? []).map(w => Number(w.employee_id)).filter(id => id > 0));
            setVehicleHistoryOpen(true);
            setOsHistoryOpen(false);
        }
    }, [order?.id, open]);

    useEffect(() => {
        if (!orderDetail) return;
        if (orderDetail.workers) {
            setInstallers(orderDetail.workers.map(w => Number(w.employee_id)).filter(id => id > 0));
        }
        const isFilmDetail = orderDetail.department === 'film' || orderDetail.department === 'security_film' || orderDetail.department === 'ppf';
        if (isFilmDetail && orderDetail.items?.length) {
            setFilmEntries(orderDetail.items.map(item => ({
                service_id: item.service_id,
                service_name: item.service_name ?? undefined,
                tonality: item.tonality ?? '',
                roll_code: item.roll_code ?? '',
                film_roll_id: item.film_roll_id ?? undefined,
                film_type_id: item.film_type_id ?? undefined,
            })));
        } else if (!isFilmDetail && orderDetail.items?.length) {
            // Atualiza preços variáveis com os valores confiáveis do detalhe completo
            const detailPrices: Record<number, string> = {};
            orderDetail.items.forEach(item => {
                if (item.unit_price != null) detailPrices[item.service_id] = String(item.unit_price);
            });
            setServicePrices(detailPrices);
        }
        setIsGalpon(orderDetail.is_galpon ?? false);
        setIsReturn(orderDetail.is_return ?? false);
        setIsCourtesy(orderDetail.is_courtesy ?? false);
    }, [orderDetail]);

    // Quando a lista de modelos carrega (ou o modelo muda), resolve vehicleModelId pelo nome
    useEffect(() => {
        if (!vehicleModelId && vehicleModel && vehicleModels?.length) {
            const match = vehicleModels.find(m => m.name === vehicleModel);
            if (match) setVehicleModelId(match.id);
        }
    }, [vehicleModels, vehicleModel]);

    const handleDeptChange = (v: Department) => {
        setDepartment(v);
        setSelectedServices([]);
        setFilmEntries((v === 'film' || v === 'security_film' || v === 'ppf') ? [{ service_id: 0, tonality: '', roll_code: '' }] : []);
        setInstallers([]);
    };

    // Ponto 1: handleSave aceita opções — keepOpen mantém o dialog aberto; extra mescla campos adicionais no payload
    const handleSave = async ({ keepOpen = false, extra = {} }: { keepOpen?: boolean; extra?: Record<string, unknown> } = {}): Promise<boolean> => {
        if (!order) return false;

        if (!isValidPlateOrChassi(plate)) {
            toast({ variant: 'destructive', title: 'Placa/Chassi inválido', description: PLATE_ERROR_MESSAGE });
            return false;
        }

        const isFilm = department === 'film' || department === 'security_film' || department === 'ppf';

        // Valida preços de serviços com valor variável (PEQREP) — não-film
        if (!isFilm) {
            const priceErrs: Record<number, string> = {};
            (editServices ?? [])
                .filter(s => selectedServices.includes(s.id) && s.has_variable_price)
                .forEach(s => {
                    const price = servicePrices[s.id];
                    if (!price || parseFloat(price) <= 0) priceErrs[s.id] = 'Informe o valor';
                });
            if (Object.keys(priceErrs).length > 0) {
                setServicePriceErrors(priceErrs);
                toast({ variant: 'destructive', title: 'Valor obrigatório', description: 'Informe o valor dos serviços com preço variável.' });
                return false;
            }
        }

        setSaving(true);
        try {
            let photosPayload: string[] | undefined;
            if (newPhoto.length > 0) {
                const results = await uploadService.uploadPhotos(newPhoto);
                photosPayload = results.map(r => r.url);
            } else if (!existingPhotoUrl) {
                photosPayload = [];
            }

            const itemsPayload = isFilm
                ? filmEntries
                    .filter(e => e.service_id > 0 && (department === 'ppf' || e.tonality))
                    .map(e => ({ service_id: e.service_id, quantity: 1, tonality: e.tonality, roll_code: e.roll_code || undefined, film_roll_id: e.film_roll_id || undefined, film_type_id: e.film_type_id || undefined }))
                : selectedServices.map(id => ({
                    service_id: id,
                    quantity: 1,
                    unit_price: servicePrices[id] ? parseFloat(servicePrices[id]) : undefined,
                }));

            await serviceOrdersService.update(order.id, {
                department: department,
                vehicle_plate: plate || undefined,
                vehicle_model: vehicleModel || undefined,
                vehicle_model_id: vehicleModelId ?? undefined,
                vehicle_color: vehicleColor || undefined,
                external_os_number: externalOs || undefined,
                service_date: serviceDate || undefined,
                consultant_id: consultantId ?? undefined,
                is_galpon: isGalpon,
                is_return: isReturn,
                is_courtesy: isCourtesy,
                items: itemsPayload.length > 0 ? itemsPayload : undefined,
                workers: isFilm && installers.length > 0 ? installers.map(id => ({ employee_id: id })) : undefined,
                invoice_number: isFilm ? (invoiceNumber || undefined) : undefined,
                notes: notes.trim() ? notes : null,
                internal_notes: internalNotes.trim() ? internalNotes : null,
                store_id: storeId,
                ...(photosPayload !== undefined && { photos: photosPayload }),
                ...extra,
            } as Parameters<typeof serviceOrdersService.update>[1]);

            onSaved();
            queryClient.invalidateQueries({ queryKey: ['service-order-edit-detail', order.id] });

            if (!keepOpen) {
                toast({ title: 'OS atualizada com sucesso!' });
                onClose();
            } else {
                toast({ title: 'OS salva!' });
            }
            return true;
        } catch (err: unknown) {
            toast({ variant: 'destructive', title: 'Erro ao salvar alterações', description: getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.') });
            return false;
        } finally {
            setSaving(false);
        }
    };

    // Ponto 1: Validar — salva edições + marca is_verified=true, fecha o dialog
    const handleVerify = async () => {
        const ok = await handleSave({ extra: { is_verified: true } });
        if (ok) {
            onClose();
        }
    };

    // Ponto 1: Confirmar erro — salva edições + atualiza status para 'wrong'
    const handleConfirmError = async () => {
        if (!order || !errorReason.trim()) return;
        setMarkingError(true);
        try {
            const savedOk = await handleSave({ keepOpen: true, extra: { internal_notes: errorReason } });
            if (savedOk) {
                await serviceOrdersService.updateStatus(order.id, 'wrong', { notes: errorReason });
                onSaved();
                onClose();
                setErrorDialogOpen(false);
                setErrorReason('');
            }
        } catch (err: unknown) {
            toast({ variant: 'destructive', title: 'Erro ao marcar OS', description: getApiErrorMessage(err as Error) });
        } finally {
            setMarkingError(false);
        }
    };

    // Ponto 1: Confirmar cancelamento com motivo obrigatório
    const handleConfirmCancel = async () => {
        if (!order || !cancelReason.trim()) return;
        setCancelling(true);
        try {
            await serviceOrdersService.cancel(order.id, cancelReason);
            onSaved();
            onClose();
            setCancelDialogOpen(false);
            setCancelReason('');
        } catch (err: unknown) {
            toast({ variant: 'destructive', title: 'Erro ao cancelar OS', description: getApiErrorMessage(err as Error) });
        } finally {
            setCancelling(false);
        }
    };

    if (!order) return null;

    const isFilmDept = department === 'film' || department === 'security_film' || department === 'ppf';
    const showExistingPhoto = !!existingPhotoUrl && newPhoto.length === 0;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 bg-white dark:bg-[#1E1E1E] border-[#D1D1D1] dark:border-[#333333]"
                aria-describedby={undefined}
            >
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <DialogTitle className="text-lg font-bold text-[#111111] dark:text-white">
                        Editar OS — {order.order_number}
                    </DialogTitle>
                </DialogHeader>

                <div className="px-6 py-4 space-y-5">

                    {/* Ponto 2: Seletor de Loja */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Loja</Label>
                        <Select
                            value={storeId?.toString() ?? ''}
                            onValueChange={(v) => {
                                const newId = Number(v);
                                if (newId !== storeId) {
                                    setStoreId(newId);
                                    if (newId !== order?.location_id) {
                                        setNeedsServiceReconfirm(true);
                                        setSelectedServices([]);
                                        setFilmEntries([]);
                                    } else {
                                        setNeedsServiceReconfirm(false);
                                    }
                                    // Resetar consultor e modelo ao trocar loja
                                    setConsultantId(undefined);
                                    setVehicleModelId(undefined);
                                }
                            }}
                        >
                            <SelectTrigger className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]">
                                <SelectValue placeholder="Selecionar loja..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableStores.map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {needsServiceReconfirm && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                Você mudou a loja. Reabra a lista de serviços e selecione novamente para poder salvar.
                            </p>
                        )}
                    </div>

                    {/* Galpão / Retorno / Cortesia */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 cursor-pointer select-none">
                            <Checkbox checked={isGalpon} onCheckedChange={(v) => setIsGalpon(!!v)} />
                            <span className="text-sm font-medium text-[#111111] dark:text-zinc-300">Galpão</span>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer select-none">
                            <Checkbox checked={isReturn} onCheckedChange={(v) => setIsReturn(!!v)} />
                            <span className="text-sm font-medium text-[#111111] dark:text-zinc-300">Retorno</span>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer select-none">
                            <Checkbox checked={isCourtesy} onCheckedChange={(v) => setIsCourtesy(!!v)} />
                            <span className="text-sm font-medium text-[#111111] dark:text-zinc-300">Cortesia</span>
                        </div>
                    </div>

                    {/* Departamento */}
                    <DeptToggle value={department} onChange={handleDeptChange} />

                    {/* Data + Nº OS */}
                    <div className="grid grid-cols-5 gap-3">
                        <div className="col-span-3 space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">
                                Data do Serviço
                            </Label>
                            <Input
                                type="date"
                                value={serviceDate}
                                onChange={(e) => setServiceDate(e.target.value)}
                                className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]"
                            />
                        </div>
                        {department !== 'vn' && department !== 'vd' && department !== 'vu' && (
                            <div className="col-span-2 space-y-1.5">
                                <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">
                                    Nº OS Concessionária
                                </Label>
                                <Input
                                    value={externalOs}
                                    onChange={(e) => setExternalOs(e.target.value)}
                                    placeholder="Ex: 12345"
                                    className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                                />
                            </div>
                        )}
                    </div>

                    {/* Placa / Modelo / Cor */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">
                                Placa / Chassi
                            </Label>
                            <Input
                                value={plate}
                                onChange={(e) => setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                placeholder="ABC1D23"
                                className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600 font-mono tracking-widest uppercase"
                                maxLength={8}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">
                                Modelo
                            </Label>
                            {department === 'vu' ? (
                                <Input
                                    value={vehicleModel}
                                    onChange={(e) => {
                                        setVehicleModel(e.target.value);
                                        setVehicleModelId(undefined);
                                    }}
                                    placeholder="Digite o modelo..."
                                    className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                                />
                            ) : modelsLoading ? (
                                <Skeleton className="h-9 w-full bg-zinc-800" />
                            ) : (
                                <Select
                                    value={vehicleModelId?.toString() ?? ''}
                                    onValueChange={(v) => {
                                        const model = (vehicleModels ?? []).find(m => m.id === Number(v));
                                        setVehicleModelId(Number(v));
                                        setVehicleModel(model?.name ?? '');
                                    }}
                                >
                                    <SelectTrigger className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]">
                                        <SelectValue placeholder="Selecionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(vehicleModels ?? []).map((m) => (
                                            <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Cor</Label>
                            <Input
                                value={vehicleColor}
                                onChange={(e) => setVehicleColor(e.target.value)}
                                placeholder="Branco"
                                className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                            />
                        </div>
                    </div>

                    {/* Consultor */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Consultor</Label>
                        {consultantsLoading ? (
                            <Skeleton className="h-9 w-full bg-zinc-800" />
                        ) : (
                            <Select
                                value={consultantId?.toString() ?? 'none'}
                                onValueChange={(v) => setConsultantId(v === 'none' ? undefined : Number(v))}
                            >
                                <SelectTrigger className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]">
                                    <SelectValue placeholder="Selecionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">— Nenhum —</SelectItem>
                                    {consultants.map((c) => (
                                        <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Ponto 2: Serviços originais para referência quando loja muda (próximo ao seletor) */}
                    {needsServiceReconfirm && originalServiceNames.length > 0 && (
                        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 p-3 space-y-1.5">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                                Serviços do lançamento original (referência)
                            </p>
                            <ul className="space-y-0.5">
                                {originalServiceNames.map((name, i) => (
                                    <li key={i} className="text-xs text-amber-700 dark:text-amber-300">• {name}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Serviços */}
                    {isFilmDept ? (
                        <FilmPicker
                            storeId={storeId ?? 0}
                            brandId={storeBrandId}
                            department={department as 'film' | 'security_film' | 'ppf'}
                            selectedEntries={filmEntries}
                            onChange={(entries) => {
                                setFilmEntries(entries);
                            }}
                            installers={installers}
                            onInstallersChange={setInstallers}
                            isGalpon={isGalpon}
                        />
                    ) : (
                        <ServicePicker
                            department={department}
                            brandId={storeBrandId}
                            selectedIds={selectedServices}
                            onChange={(ids) => {
                                setSelectedServices(ids);
                            }}
                            prices={servicePrices}
                            onPriceChange={(id, price) => {
                                setServicePrices(prev => ({ ...prev, [id]: price }));
                                setServicePriceErrors(prev => {
                                    if (!prev[id]) return prev;
                                    const next = { ...prev };
                                    delete next[id];
                                    return next;
                                });
                            }}
                            priceErrors={servicePriceErrors}
                            isCourtesy={isCourtesy}
                        />
                    )}
                    {/* Ponto 2: botão para confirmar serviços da nova loja */}
                    {needsServiceReconfirm && (() => {
                        const hasServices = isFilmDept
                            ? filmEntries.some(e => e.service_id > 0)
                            : selectedServices.length > 0;
                        return hasServices ? (
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => setNeedsServiceReconfirm(false)}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                            >
                                Confirmar serviços da nova loja
                            </Button>
                        ) : null;
                    })()}

                    {/* Foto */}
                    {showExistingPhoto ? (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Foto da OS</Label>
                            <div className="relative w-20 h-20 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setPhotoZoomOpen(true)}
                                    title="Clique para ampliar"
                                    className="block w-full h-full p-0 border-0 bg-transparent rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                                >
                                    <img src={existingPhotoUrl!} alt="Foto da OS" className="w-full h-full object-cover rounded-lg border border-[#333333]" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setConfirmRemovePhotoOpen(true); }}
                                    aria-label="Remover foto"
                                    className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                            <AlertDialog open={confirmRemovePhotoOpen} onOpenChange={setConfirmRemovePhotoOpen}>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Remover foto da OS?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            A foto será removida da ordem de serviço ao salvar. Esta ação não pode ser desfeita.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => { setExistingPhotoUrl(null); setConfirmRemovePhotoOpen(false); }}
                                            className="bg-red-600 hover:bg-red-700 text-white"
                                        >
                                            Remover
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    ) : (
                        <CompactPhotoUploader photos={newPhoto} onChange={setNewPhoto} />
                    )}

                    {/* NF — apenas película/ppf */}
                    {isFilmDept && (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">
                                Número da NF
                            </Label>
                            <Input
                                value={invoiceNumber}
                                onChange={(e) => setInvoiceNumber(e.target.value)}
                                placeholder="Ex: NF-001234"
                                className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                            />
                        </div>
                    )}

                    {/* Observações */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Observações</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Informações adicionais..."
                            rows={3}
                            className="rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600 resize-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-500">Observações Internas</Label>
                        <Textarea
                            value={internalNotes}
                            onChange={(e) => setInternalNotes(e.target.value)}
                            placeholder="Notas internas..."
                            rows={3}
                            className="rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600 resize-none"
                        />
                    </div>
                </div>

                <div className="px-6 pb-6 pt-4 border-t border-[#E8E8E8] dark:border-[#333333] flex items-center justify-between">
                    {/* Histórico + Gerar cópia */}
                    <div className="flex gap-1.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setVehicleHistoryOpen(true); setOsHistoryOpen(false); }}
                            className="text-xs text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-700/50 gap-1.5"
                        >
                            <Car className="h-3.5 w-3.5" />
                            Histórico Veículo
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setOsHistoryOpen(true); setVehicleHistoryOpen(false); }}
                            className="text-xs text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-700/50 gap-1.5"
                        >
                            <Clock className="h-3.5 w-3.5" />
                            Histórico OS
                        </Button>
                        {onGenerateCopy && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onGenerateCopy(orderDetail ?? order)}
                                className="text-xs text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-700/50 gap-1.5"
                            >
                                <Copy className="h-3.5 w-3.5" />
                                Gerar cópia
                            </Button>
                        )}
                    </div>
                    {/* Ações */}
                    <div className="grid grid-cols-2 gap-2">
                        {canEdit && !order.is_verified && order.status !== 'cancelled' && (
                            <Button
                                type="button"
                                disabled={saving || needsServiceReconfirm}
                                onClick={handleVerify}
                                className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Salvando...' : 'Validar'}
                            </Button>
                        )}
                        {canEdit && order.status !== 'wrong' && order.status !== 'cancelled' && (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={saving || needsServiceReconfirm}
                                onClick={() => { setErrorReason(''); setErrorDialogOpen(true); }}
                                className="w-full border-amber-500 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Erro
                            </Button>
                        )}
                        {canDelete && order.status !== 'cancelled' && (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={cancelling}
                                onClick={() => { setCancelReason(''); setCancelDialogOpen(true); }}
                                className="w-full font-semibold"
                            >
                                Cancelar O.S
                            </Button>
                        )}
                        <Button
                            onClick={() => handleSave({ keepOpen: true })}
                            disabled={saving || needsServiceReconfirm}
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            className="w-full font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Salvando...' : 'Salvar'}
                        </Button>
                    </div>
                </div>

                {/* Ponto 1: AlertDialog de Cancelar O.S. com motivo obrigatório */}
                <AlertDialog open={cancelDialogOpen} onOpenChange={(v) => { if (!v) { setCancelDialogOpen(false); setCancelReason(''); } }}>
                    <AlertDialogContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-[#111111] dark:text-white">Cancelar OS?</AlertDialogTitle>
                            <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                                Informe o motivo do cancelamento. A OS não aparecerá mais na listagem padrão após cancelada.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-1.5 px-1">
                            <label htmlFor="cancel-reason-textarea" className="text-sm font-medium text-[#666666] dark:text-zinc-300">Motivo do cancelamento *</label>
                            <Textarea
                                id="cancel-reason-textarea"
                                placeholder="Ex: OS lançada em duplicidade..."
                                rows={3}
                                className="rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-500 resize-none"
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                            />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setCancelDialogOpen(false); setCancelReason(''); }}>
                                Voltar
                            </AlertDialogCancel>
                            <AlertDialogAction
                                disabled={!cancelReason.trim() || cancelling}
                                onClick={handleConfirmCancel}
                                className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {cancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Ponto 1: Dialog de Marcar como Erro com motivo obrigatório */}
                <AlertDialog open={errorDialogOpen} onOpenChange={(v) => { if (!v) { setErrorDialogOpen(false); setErrorReason(''); } }}>
                    <AlertDialogContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-amber-500 flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5" />
                                Marcar OS como Erro
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                                As edições do formulário serão salvas junto com o motivo do erro.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-1.5 px-1">
                            <label htmlFor="error-reason-dialog-textarea" className="text-sm font-medium text-[#666666] dark:text-zinc-300">Motivo do erro *</label>
                            <Textarea
                                id="error-reason-dialog-textarea"
                                placeholder="Ex: Serviço lançado no departamento errado..."
                                rows={3}
                                className="rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-500 resize-none"
                                value={errorReason}
                                onChange={(e) => setErrorReason(e.target.value)}
                            />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setErrorDialogOpen(false); setErrorReason(''); }}>
                                Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction
                                disabled={!errorReason.trim() || markingError}
                                onClick={handleConfirmError}
                                className="bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {markingError ? 'Salvando...' : 'Confirmar'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </DialogContent>

            {/* ── Painel: Histórico do Veículo ─────────────────────────────────── */}
            {open && <div
                className={`fixed inset-y-0 right-0 z-[60] w-96 flex flex-col bg-white dark:bg-[#1E1E1E] border-l border-[#D1D1D1] dark:border-[#333333] shadow-2xl transition-transform duration-300 ease-in-out ${
                    vehicleHistoryOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div>
                        <p className="font-bold text-sm text-[#111111] dark:text-white">Histórico do Veículo</p>
                        <p className="text-xs text-[#666666] dark:text-zinc-400 mt-0.5">{order?.plate}</p>
                    </div>
                    <button
                        onClick={() => setVehicleHistoryOpen(false)}
                        className="text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white p-1 rounded"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {vehicleHistoryLoading ? (
                        <div className="space-y-3">
                            {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-[#F5F5F5] dark:bg-[#252525] animate-pulse" />)}
                        </div>
                    ) : !vehicleHistory?.items.length ? (
                        <p className="text-sm text-center text-[#666666] dark:text-zinc-500 mt-8">Nenhuma OS anterior para esta placa.</p>
                    ) : (
                        [...vehicleHistory.items]
                            .sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'))
                            .map(item => {
                            const isCancelled = item.status === 'cancelled';
                            return (
                            <div key={item.id} className={`rounded-xl border border-[#E8E8E8] dark:border-[#333333] bg-[#FAFAFA] dark:bg-[#252525] p-4 space-y-2 ${isCancelled ? 'opacity-60' : ''}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-sm font-semibold text-[#111111] dark:text-white truncate">{item.order_number}</span>
                                        {isCancelled && (
                                            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                                Cancelada
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-xs text-[#666666] dark:text-zinc-500 shrink-0">
                                        {item.service_date
                                            ? formatDate(item.service_date)
                                            : new Date(item.entry_time).toLocaleDateString('pt-BR')}
                                    </span>
                                </div>
                                {item.store_name && (
                                    <p className="text-xs text-[#666666] dark:text-zinc-400">{item.store_name}</p>
                                )}
                                <DepartmentBadge department={item.department} />
                                {item.service_names.length > 0 && (
                                    <ul className="mt-1 space-y-0.5">
                                        {item.service_names.map((name, idx) => (
                                            <li key={`${name}-${idx}`} className="text-xs text-[#666666] dark:text-zinc-400">• {name}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            );
                        })
                    )}
                </div>
            </div>}

            {/* ── Painel: Histórico da OS ───────────────────────────────────────── */}
            {open && <div
                className={`fixed inset-y-0 right-0 z-[60] w-96 flex flex-col bg-white dark:bg-[#1E1E1E] border-l border-[#D1D1D1] dark:border-[#333333] shadow-2xl transition-transform duration-300 ease-in-out ${
                    osHistoryOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div>
                        <p className="font-bold text-sm text-[#111111] dark:text-white">Histórico da OS</p>
                        <p className="text-xs text-[#666666] dark:text-zinc-400 mt-0.5">{order?.order_number}</p>
                    </div>
                    <button
                        onClick={() => setOsHistoryOpen(false)}
                        className="text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white p-1 rounded"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    {osHistoryLoading ? (
                        <div className="space-y-4">
                            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-[#F5F5F5] dark:bg-[#252525] animate-pulse" />)}
                        </div>
                    ) : !osHistory?.items.length ? (
                        <p className="text-sm text-center text-[#666666] dark:text-zinc-500 mt-8">Nenhum histórico encontrado.</p>
                    ) : (
                        <div className="relative">
                            {/* Linha vertical da timeline */}
                            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#E8E8E8] dark:bg-[#333333]" />
                            <div className="space-y-4">
                                {osHistory.items.map((item, idx) => {
                                    const toColor = HISTORY_STATUS_COLORS[item.to_status] ?? 'bg-zinc-100 text-zinc-600';
                                    const changedAt = new Date(item.changed_at);
                                    const dateStr = changedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                                    const timeStr = changedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                    return (
                                        <div key={item.id} className="flex gap-4 pl-5 relative">
                                            {/* Ponto na linha */}
                                            <div className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#1E1E1E] ${idx === osHistory.items.length - 1 ? 'bg-[#F5A800]' : 'bg-[#D1D1D1] dark:bg-[#444]'}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                                    {item.from_status && (
                                                        <>
                                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${HISTORY_STATUS_COLORS[item.from_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                                                                {OS_STATUS_HISTORY_LABELS[item.from_status] ?? item.from_status}
                                                            </span>
                                                            <span className="text-[#999999] dark:text-zinc-500 text-xs">→</span>
                                                        </>
                                                    )}
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${toColor}`}>
                                                        {OS_STATUS_HISTORY_LABELS[item.to_status] ?? item.to_status}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-[#666666] dark:text-zinc-400">
                                                    {item.changed_by_name ?? 'Sistema'} · {dateStr} {timeStr}
                                                </p>
                                                {item.notes && (
                                                    <p className="text-xs text-[#999999] dark:text-zinc-500 mt-0.5 italic">"{item.notes}"</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>}

            {existingPhotoUrl && (
                <PhotoDialog url={existingPhotoUrl} open={photoZoomOpen} onClose={() => setPhotoZoomOpen(false)} />
            )}
        </Dialog>
    );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export function ConferencePage() {
    const user = useAuthStore((s) => s.user);
    const hasDeletePermission = useAuthStore((s) => s.hasPermission);
    // Seletores granulares: assinar a store inteira re-renderizava a página
    // (2k+ linhas) a qualquer mudança de qualquer campo do useStoreStore
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const availableStores = useStoreStore((s) => s.availableStores);
    const queryClient = useQueryClient();

    // Filters state — persistido na sessão (sessionStorage): sobrevive à
    // navegação entre páginas e ao F5; reseta ao fechar o navegador.
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString().split('T')[0];

    const {
        dateFrom, dateTo, departments, search, serviceIds, statusFilters, flagFilters,
        workerId, selectedStoreIds,
        setDateFrom, setDateTo, setDepartments, setSearch, setServiceIds, setStatusFilters,
        setFlagFilters, setWorkerId, setSelectedStoreIds,
        reset: resetFilters,
    } = useConferenceFiltersStore();
    const [isExporting, setIsExporting] = useState(false);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 50;
    // Ordenação por coluna (server-side). Padrão = Data do Serviço crescente (preservado ao recarregar).
    const [sortBy, setSortBy] = useState<string>('service_date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const toggleSort = useCallback((col: string) => {
        setPage(1);
        if (sortBy === col) {
            // 1º clique numa coluna nova = desc; cliques seguintes alternam desc ⇄ asc
            setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
        } else {
            setSortBy(col);
            setSortDir('desc');
        }
    }, [sortBy]);

    const hasActiveFilters =
        search !== '' ||
        serviceIds.length > 0 ||
        departments.length > 0 ||
        !(statusFilters.length === 1 && statusFilters[0] === 'pending') ||
        flagFilters.courtesy ||
        flagFilters.galpon ||
        flagFilters.retorno ||
        workerId !== undefined ||
        selectedStoreIds.length > 0 ||
        dateFrom !== firstOfMonth ||
        dateTo !== today;

    const handleClearFilters = useCallback(() => {
        resetFilters();
    }, [resetFilters]);

    const handleSummaryCardClick = useCallback((dept: string, filterType: 'verified' | 'waiting' | 'wrong' | 'all' | 'cancelled') => {
        setDepartments(dept ? [dept] : []);
        setStatusFilters(filterType === 'all' ? [] : [filterType === 'waiting' ? 'pending' : filterType]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Visibilidade de colunas condicionais por departamento
    const filmDepts = ['film', 'security_film', 'ppf'];
    const showFilmCols = departments.length === 0 || departments.some((d) => filmDepts.includes(d));
    const showTonality = departments.length === 0 || departments.some((d) => filmDepts.includes(d));
    const totalCols = 18 + (showFilmCols ? 2 : 0) + (showTonality ? 2 : 0);

    // Edit state
    const [editOrder, setEditOrder] = useState<ServiceOrder | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    // Gerar cópia: fonte da O.S. a ser copiada (montagem condicional garante defaultValues corretos)
    const [copySource, setCopySource] = useState<ServiceOrder | null>(null);

    // Atalho externo ?os={id} (ex.: botão "Ver OS" do agendamento): abre o
    // modal da O.S. direto na Conferência e limpa o parâmetro da URL.
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        const osParam = searchParams.get('os');
        if (!osParam) return;
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('os');
            return next;
        }, { replace: true });
        const osId = Number(osParam);
        if (!Number.isFinite(osId) || osId <= 0) return;
        serviceOrdersService.getById(osId)
            .then((os) => {
                setEditOrder(os);
                setEditOpen(true);
            })
            .catch(() => {
                toast({
                    variant: 'destructive',
                    title: 'O.S. não encontrada',
                    description: `Não foi possível abrir a O.S. #${osParam}.`,
                });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<ServiceOrder | null>(null);

    // Mark as error state (HML-48 / HML-70)
    const [errorTarget, setErrorTarget] = useState<ServiceOrder | null>(null);
    const [errorReason, setErrorReason] = useState('');

    // Photo lightbox state
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [damagePhotoUrl, setDamagePhotoUrl] = useState<string | null>(null);

    const storeId = selectedStoreId ?? user?.store_id ?? undefined;

    // Buscas por texto: a query usa o valor debounced (1 request quando o
    // usuário para de digitar, não 1 por tecla)
    const debouncedSearch = useDebounce(search);

    // Serviços: gating — só mostra opções quando loja e departamento estiverem selecionados
    const serviceFilterReady = selectedStoreIds.length > 0 && departments.length > 0;

    // Lista de serviços para exibir nomes nas colunas e preencher o filtro de serviços
    // Declarada antes das queries principais porque expandedServiceIds é usado nelas.
    const { data: servicesData } = useQuery({
        queryKey: ['services', 'all'],
        queryFn: () => servicesService.getAll(),
        staleTime: 1000 * 60 * 10,
        gcTime: 1000 * 60 * 5,
    });
    const services = useMemo(() => servicesData ?? [], [servicesData]);

    // Agrupa serviços por código|nome para deduplicar cortesias gêmeas;
    // a opção usa o 1º id do grupo — na query enviamos todos os ids do grupo.
    const serviceGroups = useMemo(() => {
        if (!serviceFilterReady) return [];
        const map = new Map<string, { label: string; ids: number[] }>();
        for (const s of services) {
            if (!s.is_active || !departments.includes(s.department)) continue;
            const key = `${s.code ?? ''}|${s.name}`;
            const g = map.get(key);
            if (g) g.ids.push(s.id);
            else map.set(key, { label: s.code ? `${s.code} – ${s.name}` : s.name, ids: [s.id] });
        }
        return [...map.values()];
    }, [services, departments, serviceFilterReady]);

    const serviceOptions = useMemo(
        () => serviceGroups.map((g) => ({ value: g.ids[0], label: g.label })),
        [serviceGroups],
    );

    const expandedServiceIds = useMemo(() => {
        const byRep = new Map(serviceGroups.map((g) => [g.ids[0], g.ids]));
        return serviceIds.flatMap((id) => byRep.get(id) ?? [id]);
    }, [serviceIds, serviceGroups]);

    // Limpeza: zera serviceIds quando os filtros de gating mudam e os ids deixam de ser válidos
    useEffect(() => {
        if (serviceIds.length === 0) return;
        if (!serviceFilterReady) { setServiceIds([]); return; }
        if (services.length === 0) return; // catálogo ainda carregando (F5): não zerar
        const valid = new Set(serviceOptions.map((o) => o.value));
        const next = serviceIds.filter((id) => valid.has(id));
        if (next.length !== serviceIds.length) setServiceIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serviceFilterReady, departments, services]);

    // Reseta para página 1 sempre que qualquer filtro mudar
    useEffect(() => {
        setPage(1);
    }, [dateFrom, dateTo, departments, debouncedSearch, serviceIds, statusFilters, flagFilters, workerId, selectedStoreIds]);

    const queryKey = ['service-orders', 'conference', selectedStoreIds, dateFrom, dateTo, departments, debouncedSearch, serviceIds, statusFilters, flagFilters, workerId, page, sortBy, sortDir];

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey,
        queryFn: () => serviceOrdersService.getFiltered({
            store_ids: selectedStoreIds.length > 0 ? selectedStoreIds : undefined,
            conference_statuses: statusFilters.length ? statusFilters : undefined,
            include_cancelled: statusFilters.length === 0 ? true : undefined,
            flag: [
                flagFilters.courtesy ? 'courtesy' : null,
                flagFilters.galpon ? 'galpon' : null,
                flagFilters.retorno ? 'retorno' : null,
            ].filter(Boolean) as string[],
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            departments: departments.length ? departments : undefined,
            plate: debouncedSearch || undefined,
            service_ids: expandedServiceIds.length ? expandedServiceIds : undefined,
            worker_id: workerId,
            sort_by: sortBy,
            sort_dir: sortDir,
            page,
            limit: PAGE_SIZE,
        }),
        enabled: true,
        placeholderData: (prev) => prev,
    });

    const summaryFilters = {
        store_ids: selectedStoreIds.length > 0 ? selectedStoreIds : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        plate: debouncedSearch || undefined,
        service_ids: expandedServiceIds.length ? expandedServiceIds : undefined,
        worker_id: workerId,
        include_cancelled: true,
        is_courtesy: flagFilters.courtesy ? true : undefined,
    };

    const { data: summaryData, isLoading: summaryLoading } = useConferenceSummary(summaryFilters);

    const { data: storeSummaryData, isLoading: storeSummaryLoading } = useConferenceSummaryByStore(summaryFilters);

    // Lista de instaladores para o filtro (somente cargo Instalador de Película)
    const { data: employeesData } = useQuery({
        queryKey: ['employees', 'conference-filter', storeId],
        queryFn: () => employeesService.list(
            { store_id: storeId, is_active: true, position: FILM_INSTALLER_POSITION },
            1,
            100,
        ),
    });
    const employees = employeesData?.employees ?? [];

    // ── Optimistic updates ────────────────────────────────────────────────────────
    // Aplica a mudança no cache da página atual e devolve o snapshot p/ rollback em erro.
    const optimisticConference = async (updater: (items: ServiceOrder[]) => ServiceOrder[]) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (old: any) => {
            if (!old?.items) return old;
            const items = updater(old.items as ServiceOrder[]);
            const removed = (old.items as ServiceOrder[]).length - items.length;
            return { ...old, items, total: Math.max(0, (old.total ?? 0) - removed) };
        });
        return previous;
    };
    const dropRow = (id: number) => (items: ServiceOrder[]) => items.filter((o) => o.id !== id);
    const patchRow = (id: number, p: Partial<ServiceOrder>) => (items: ServiceOrder[]) =>
        items.map((o) => (o.id === id ? { ...o, ...p } : o));
    const rollback = (previous: unknown) => {
        if (previous !== undefined) queryClient.setQueryData(queryKey, previous);
    };
    const reconcile = () => {
        queryClient.invalidateQueries({ queryKey: ['service-orders'] });
        queryClient.invalidateQueries({ queryKey: ['service-order'] });
        queryClient.invalidateQueries({ queryKey: ['os-history'] });
        queryClient.invalidateQueries({ queryKey: ['vehicle-history'] });
    };

    const verifyMutation = useMutation({
        mutationFn: (id: number) => serviceOrdersService.verify(id),
        onMutate: (id: number) =>
            optimisticConference(
                statusFilters.includes('pending') && !statusFilters.includes('verified')
                    ? dropRow(id)
                    : patchRow(id, { is_verified: true }),
            ).then((previous) => ({ previous })),
        onError: (_e, _id, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao verificar OS' });
        },
        onSuccess: () => toast({ title: 'OS verificada!' }),
        onSettled: reconcile,
    });

    const unverifyMutation = useMutation({
        mutationFn: (id: number) => serviceOrdersService.unverify(id),
        onMutate: (id: number) =>
            optimisticConference(
                statusFilters.includes('verified') && !statusFilters.includes('pending')
                    ? dropRow(id)
                    : patchRow(id, { is_verified: false }),
            ).then((previous) => ({ previous })),
        onError: (_e, _id, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao desfazer verificação' });
        },
        onSuccess: () => toast({ title: 'Verificação desfeita.' }),
        onSettled: reconcile,
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => serviceOrdersService.cancel(id, 'OS cancelada via conferência'),
        onMutate: (id: number) =>
            optimisticConference(
                statusFilters.length === 0 || statusFilters.includes('cancelled')
                    ? patchRow(id, { status: 'cancelled' })
                    : dropRow(id),
            ).then((previous) => ({ previous })),
        onError: (_e, _id, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao cancelar OS' });
        },
        onSuccess: () => {
            toast({ title: 'OS cancelada.' });
            setDeleteTarget(null);
        },
        onSettled: reconcile,
    });

    // HML-48 / HML-70: marcar OS como erro com observação obrigatória
    const markWrongMutation = useMutation({
        mutationFn: async ({ id, internal_notes }: { id: number; internal_notes: string }) => {
            await apiClient.patch(`/service-orders/${id}/status`, { new_status: 'wrong', notes: internal_notes });
            await apiClient.patch(`/service-orders/${id}`, { internal_notes });
        },
        onMutate: ({ id, internal_notes }: { id: number; internal_notes: string }) =>
            optimisticConference(patchRow(id, { status: 'wrong', internal_notes })).then(
                (previous) => ({ previous }),
            ),
        onError: (_e, _vars, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao marcar OS' });
        },
        onSuccess: () => {
            toast({ title: 'OS marcada como erro.' });
            setErrorTarget(null);
            setErrorReason('');
        },
        onSettled: reconcile,
    });

    // HML-70: desfazer erro — volta para waiting
    const undoWrongMutation = useMutation({
        mutationFn: (id: number) =>
            apiClient.patch(`/service-orders/${id}/status`, { new_status: 'waiting' }),
        onMutate: (id: number) =>
            optimisticConference(
                statusFilters.includes('wrong') && !statusFilters.includes('pending')
                    ? dropRow(id)
                    : patchRow(id, { status: 'waiting' }),
            ).then((previous) => ({ previous })),
        onError: (_e, _id, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao desfazer' });
        },
        onSuccess: () => toast({ title: 'Erro desfeito. OS voltou para Aguardando.' }),
        onSettled: reconcile,
    });

    // Resolver duplicidade (falso positivo) — volta a O.S. para Aguardando
    const resolveDuplicateMutation = useMutation({
        mutationFn: (id: number) =>
            apiClient.patch(`/service-orders/${id}/status`, { new_status: 'waiting' }),
        onMutate: (id: number) =>
            optimisticConference(
                statusFilters.includes('duplicate') && !statusFilters.includes('pending')
                    ? dropRow(id)
                    : patchRow(id, { status: 'waiting' }),
            ).then((previous) => ({ previous })),
        onError: (_e, _id, ctx) => {
            rollback(ctx?.previous);
            toast({ variant: 'destructive', title: 'Erro ao resolver duplicidade' });
        },
        onSuccess: () => toast({ title: 'Duplicidade resolvida. OS voltou para Aguardando.' }),
        onSettled: reconcile,
    });

    // Ordenação é feita no servidor (server-side); usar a ordem retornada diretamente.
    const orders = data?.items ?? [];

    // Cabeçalho clicável para ordenação por coluna
    const HEAD_CLASS = 'text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3';
    const sortHead = (label: string, col: string, extra = '') => (
        <TableHead
            onClick={() => toggleSort(col)}
            className={`${HEAD_CLASS} cursor-pointer select-none hover:text-[#111111] dark:hover:text-white ${extra}`}
        >
            <span className={`inline-flex items-center gap-1 ${extra.includes('text-right') ? 'justify-end w-full' : ''}`}>
                {label}
                {sortBy === col
                    ? (sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)
                    : <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />}
            </span>
        </TableHead>
    );

    const handleVerify = (order: ServiceOrder) => {
        verifyMutation.mutate(order.id);
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const qs = new URLSearchParams();
            if (storeId) qs.append('store_id', String(storeId));
            if (dateFrom) qs.append('date_from', dateFrom);
            if (dateTo) qs.append('date_to', dateTo);
            departments.forEach((d) => qs.append('departments', d));
            statusFilters.forEach((s) => qs.append('conference_statuses', s));
            expandedServiceIds.forEach((id) => qs.append('service_ids', String(id)));
            if (flagFilters.courtesy) qs.append('flag', 'courtesy');
            if (flagFilters.galpon) qs.append('flag', 'galpon');
            if (flagFilters.retorno) qs.append('flag', 'retorno');
            if (search) qs.append('plate', search);
            if (workerId) qs.append('worker_id', String(workerId));

            const response = await apiClient.get(`/service-orders/export/conferencia?${qs.toString()}`, {
                responseType: 'blob',
            });
            const blob = new Blob([response.data], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conferencia_${dateFrom}_${dateTo}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Erro ao exportar conferência:', err);
            toast({ variant: 'destructive', title: 'Erro ao exportar', description: 'Não foi possível gerar o Excel.' });
        } finally {
            setIsExporting(false);
        }
    };

    const handleEdit = (order: ServiceOrder) => {
        setEditOrder(order);
        setEditOpen(true);
    };

    return (
        <div className="pt-3 px-4 pb-3 md:pt-3 md:px-6 md:pb-3 flex flex-col h-full gap-3">
            {/* Header + Filters */}
            <div className="space-y-3">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <ClipboardCheck className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Conferência de OS
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            {statusFilters.length === 1 && statusFilters[0] === 'pending' ? 'OS aguardando verificação' : statusFilters.length === 1 && statusFilters[0] === 'verified' ? 'OS verificadas' : statusFilters.length === 1 && statusFilters[0] === 'cancelled' ? 'OS canceladas' : statusFilters.length === 1 && statusFilters[0] === 'wrong' ? 'OS lançadas errado' : statusFilters.length === 1 && statusFilters[0] === 'duplicate' ? 'OS duplicadas' : statusFilters.length === 0 ? 'Todas as OS' : 'OS filtradas'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleExport}
                    disabled={orders.length === 0 || isExporting}
                    className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition-all shrink-0"
                    style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                >
                    <Download className="h-4 w-4" />
                    {isExporting ? 'Exportando...' : 'Exportar Excel'}
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-3 flex flex-wrap gap-3 items-start">
                {/* 1. Busca */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Busca (placa/OS)</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#999999] dark:text-zinc-500" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Placa ou Nº OS..."
                            className="pl-8 w-48 h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                        />
                    </div>
                </div>
                {/* 2. Loja (multi-select) */}
                {availableStores.length > 1 && (
                    <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Loja</Label>
                        <MultiSelectFilter<number>
                            options={availableStores.map((s) => ({ value: s.id, label: s.name }))}
                            value={selectedStoreIds}
                            onChange={setSelectedStoreIds}
                            allLabel="Todas"
                            countLabel={(n) => `${n} lojas`}
                            triggerClassName="w-40"
                        />
                    </div>
                )}
                {/* 3. Departamento (multi-select) */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Departamento</Label>
                    <MultiSelectFilter<string>
                        options={Object.entries(DEPARTMENTS_MAP).map(([value, label]) => ({ value, label }))}
                        value={departments}
                        onChange={setDepartments}
                        allLabel="Todos"
                        countLabel={(n) => `${n} deptos`}
                        triggerClassName="w-36"
                    />
                </div>
                {/* 4. Serviços (multi-select) */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Serviços</Label>
                    <MultiSelectFilter<number>
                        options={serviceFilterReady ? serviceOptions : []}
                        value={serviceIds}
                        onChange={setServiceIds}
                        allLabel="Todos"
                        countLabel={(n) => `${n} serviços`}
                        emptyMessage={!serviceFilterReady ? 'Selecione uma loja e um departamento' : 'Nenhum serviço encontrado'}
                        triggerClassName="w-48"
                        contentClassName="w-80 max-h-72 overflow-y-auto"
                    />
                </div>
                {/* 5. Status (multi-select) */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Status</Label>
                    <MultiSelectFilter<string>
                        options={[
                            { value: 'pending', label: 'Aguardando' },
                            { value: 'verified', label: 'Verificadas' },
                            { value: 'cancelled', label: 'Canceladas' },
                            { value: 'wrong', label: 'Lançadas Errado' },
                            { value: 'duplicate', label: 'Duplicado' },
                        ]}
                        value={statusFilters}
                        onChange={(next) => setStatusFilters(next as ConferenceStatusValue[])}
                        allLabel="Todas"
                        countLabel={(n) => `${n} status`}
                        triggerClassName="w-36"
                    />
                </div>
                {/* 6. Instalador */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Instalador</Label>
                    <Select
                        value={workerId?.toString() ?? 'all'}
                        onValueChange={(v) => setWorkerId(v === 'all' ? undefined : parseInt(v))}
                    >
                        <SelectTrigger className="w-36 h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]">
                            <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            {employees.map((emp) => (
                                <SelectItem key={emp.id} value={emp.id.toString()}>
                                    {emp.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {/* 7. Cortesia/Retorno */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Cortesia/Retorno</Label>
                    <FlagFilterDropdown value={flagFilters} onChange={setFlagFilters} />
                </div>
                {/* 8. Datas */}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Data início</Label>
                    <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-40 h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] dark:[color-scheme:dark]"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-500 font-semibold">Data fim</Label>
                    <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-40 h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] dark:[color-scheme:dark]"
                    />
                </div>
                {hasActiveFilters && (
                    <div className="space-y-1 self-end">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={handleClearFilters}
                            className="h-9 px-3 text-sm text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] border border-[#D1D1D1] dark:border-[#333333] rounded-lg gap-1.5"
                        >
                            <X className="h-4 w-4" />
                            Limpar Filtros
                        </Button>
                    </div>
                )}
            </div>
            </div>{/* end space-y-3 */}

            {/* Summary cards por departamento / por loja */}
            <ConferenceSummaryCards
                summary={summaryData ?? []}
                isLoading={summaryLoading}
                onFilterClick={handleSummaryCardClick}
                storeSummary={storeSummaryData ?? []}
                storeSummaryLoading={storeSummaryLoading}
            />

            {/* Count + HML-60: indicador 100% verificadas */}
            {(() => {
                const verifiedCount = orders.filter((o) => o.is_verified).length;
                const allVerified = orders.length > 0 && verifiedCount === orders.length && !statusFilters.includes('cancelled');
                const allClear = statusFilters.length === 1 && statusFilters[0] === 'pending' && orders.length === 0 && !isLoading;
                return (
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="text-sm text-[#666666] dark:text-zinc-400">
                            {isLoading ? '...' : statusFilters.length === 1 && statusFilters[0] === 'pending' ? `${data?.total ?? orders.length} OS aguardando verificação` : statusFilters.length === 1 && statusFilters[0] === 'verified' ? `${data?.total ?? orders.length} OS verificadas` : statusFilters.length === 1 && statusFilters[0] === 'cancelled' ? `${data?.total ?? orders.length} OS canceladas` : statusFilters.length === 1 && statusFilters[0] === 'wrong' ? `${data?.total ?? orders.length} OS lançadas errado` : statusFilters.length === 1 && statusFilters[0] === 'duplicate' ? `${data?.total ?? orders.length} OS duplicadas` : `${data?.total ?? orders.length} OS no total`}
                        </div>
                        {allVerified && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700/50">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                100% verificadas
                            </span>
                        )}
                        {allClear && (
                            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700/40 dark:text-green-400 text-sm font-medium">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                Todas as OS do período foram conferidas!
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Table */}
            <div
                className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-auto flex-1 min-h-0"
            >
                <Table wrapperClassName="h-full">
                    <TableHeader className="sticky top-0 z-20 bg-gray-100 dark:bg-zinc-800/60">
                        <TableRow className="border-b border-[#E8E8E8] dark:border-[#333333] hover:bg-transparent">
                            <TableHead className="sticky left-0 z-30 bg-gray-100 dark:bg-zinc-800 text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-center w-[100px] min-w-[100px] after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-[#D1D1D1] after:dark:bg-zinc-700">Ações</TableHead>
                            {sortHead('Status', 'status')}
                            {sortHead('Data Serv.', 'service_date')}
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Foto</TableHead>
                            {sortHead('Loja', 'location')}
                            {sortHead('Depto', 'department')}
                            {sortHead('Consultor', 'consultant')}
                            {sortHead('Cortesia/Retorno', 'courtesy')}
                            {sortHead('Nº OS Conc.', 'external_os_number')}
                            {sortHead('Placa', 'plate')}
                            {sortHead('Modelo', 'model')}
                            {sortHead('Obs. Internas', 'internal_notes')}
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Serviços</TableHead>
                            {sortHead('Observações', 'notes')}
                            {showTonality && <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Tonalidade</TableHead>}
                            {showTonality && <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">N° Pelicula</TableHead>}
                            {showFilmCols && <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Instalador</TableHead>}
                            {showFilmCols && sortHead('Nº NF', 'invoice_number')}
                            {sortHead('Valor', 'value', 'text-right')}
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Foto de Avaria</TableHead>
                            {sortHead('Atualizado em', 'updated_at')}
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Atualizado por</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i} className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                    {Array.from({ length: totalCols }).map((_, j) => (
                                        <TableCell key={j} className="px-4 py-3">
                                            <div className="bg-gray-200 dark:bg-zinc-800 animate-pulse rounded h-4 w-full" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : isError ? (
                            // Tela de auditoria financeira: erro não pode parecer "nada a conferir"
                            <TableRow className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                <TableCell colSpan={totalCols} className="text-center py-12">
                                    <div className="space-y-3">
                                        <p className="flex items-center justify-center gap-2 text-red-500 text-sm font-medium">
                                            <AlertCircle className="w-4 h-4" />
                                            Erro ao carregar as O.S. da conferência.
                                        </p>
                                        <Button variant="outline" size="sm" onClick={() => refetch()}>
                                            Tentar novamente
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : orders.length === 0 ? (
                            <TableRow className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                <TableCell colSpan={totalCols} className="text-center py-12 text-[#999999] dark:text-zinc-500">
                                    Nenhuma OS aguardando verificação
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order) => (
                                <TableRow
                                    key={order.id}
                                    className={[
                                    'border-t border-[#E8E8E8] dark:border-[#333333] transition-colors',
                                    order.status === 'cancelled'
                                        ? 'bg-red-100 dark:bg-red-900/35 hover:bg-red-200/70 dark:hover:bg-red-900/50'
                                        : order.is_verified
                                            ? 'bg-green-50 dark:bg-green-900/10 hover:bg-green-100/60 dark:hover:bg-green-900/20'
                                            : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40',
                                ].join(' ')}>
                                    {/* Ações */}
                                    <TableCell className="sticky left-0 z-10 bg-white dark:bg-zinc-900 px-4 py-3 w-[100px] min-w-[100px] after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-[#E8E8E8] after:dark:bg-zinc-700">
                                        <div className="flex items-center justify-center gap-1">
                                            {hasDeletePermission('conference', 'edit') && (
                                                <button
                                                    onClick={() => handleEdit(order)}
                                                    title="Editar"
                                                    className="h-8 w-8 rounded-lg text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-700/50 transition-colors flex items-center justify-center"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                            )}
                                            {hasDeletePermission('conference', 'edit') && order.status !== 'cancelled' && (
                                                order.is_verified ? (
                                                    <button
                                                        onClick={() => unverifyMutation.mutate(order.id)}
                                                        disabled={unverifyMutation.isPending}
                                                        title="Desfazer verificação"
                                                        className="h-8 w-8 rounded-lg text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleVerify(order)}
                                                        disabled={verifyMutation.isPending}
                                                        title="Validar"
                                                        className="h-8 w-8 rounded-lg text-green-500 hover:text-green-400 hover:bg-green-900/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <CheckCircle className="h-4 w-4" />
                                                    </button>
                                                )
                                            )}
                                            {hasDeletePermission('conference', 'edit') && order.status === 'wrong' && (
                                                <button
                                                    onClick={() => undoWrongMutation.mutate(order.id)}
                                                    disabled={undoWrongMutation.isPending}
                                                    title="Desfazer Erro"
                                                    className="h-8 w-8 rounded-lg text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </button>
                                            )}
                                            {hasDeletePermission('conference', 'edit') && order.status === 'duplicate' && (
                                                <button
                                                    onClick={() => resolveDuplicateMutation.mutate(order.id)}
                                                    disabled={resolveDuplicateMutation.isPending}
                                                    title="Resolver duplicidade (voltar para Aguardando)"
                                                    className="h-8 w-8 rounded-lg text-purple-500 hover:text-purple-400 hover:bg-purple-900/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </TableCell>
                                    {/* Status (HML-66 / HML-69) */}
                                    <TableCell className="px-4 py-3">
                                        <div className="flex flex-col gap-1 items-start">
                                            <TooltipProvider delayDuration={200}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="inline-flex items-center gap-1.5 cursor-default">
                                                            {order.status === 'cancelled' ? (
                                                                <XCircle className="h-5 w-5 text-red-500 dark:text-red-400" />
                                                            ) : order.is_verified ? (
                                                                <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400" />
                                                            ) : order.status === 'duplicate' ? (
                                                                <Copy className="h-5 w-5 text-purple-500 dark:text-purple-400" />
                                                            ) : order.status === 'wrong' ? (
                                                                <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
                                                            ) : (
                                                                <Clock className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                                                            )}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="right">
                                                        {order.status === 'cancelled' ? 'Cancelada' : order.is_verified ? 'Verificada' : order.status === 'duplicate' ? 'Duplicado' : order.status === 'wrong' ? 'Com Erro' : 'Aguardando'}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </TableCell>
                                    {/* Data Serv. */}
                                    <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                        {formatDate(order.service_date)}
                                    </TableCell>
                                    {/* Foto (posição 4, sem sticky) */}
                                    <TableCell className="px-4 py-3">
                                        {order.photos?.[0] ? (
                                            <button
                                                onClick={() => setPhotoUrl(order.photos![0])}
                                                className="block rounded overflow-hidden hover:opacity-80 transition-opacity"
                                                title="Ver foto"
                                            >
                                                <img
                                                    src={toThumbUrl(order.photos[0])}
                                                    alt="Foto da OS"
                                                    className="h-10 w-10 object-cover rounded"
                                                    loading="lazy"
                                                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = order.photos![0]; }}
                                                />
                                            </button>
                                        ) : (
                                            <ImageOff className="h-5 w-5 text-zinc-600" />
                                        )}
                                    </TableCell>
                                    {/* Loja */}
                                    <TableCell className="px-4 py-3">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm text-[#111111] dark:text-zinc-200 whitespace-nowrap">{order.location_name || '—'}</span>
                                            {order.is_galpon && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700/50 w-fit">
                                                    Galpão
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    {/* Depto */}
                                    <TableCell className="px-4 py-3">
                                        <DepartmentBadge department={order.department} />
                                    </TableCell>
                                    {/* Consultor */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                        {order.consultant_name || '—'}
                                    </TableCell>
                                    {/* Cortesia / Retorno */}
                                    <TableCell className="px-4 py-3">
                                        <div className="flex flex-col gap-1">
                                            {order.is_courtesy && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/50 w-fit">
                                                    Cortesia
                                                </span>
                                            )}
                                            {order.is_return && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700/50 w-fit">
                                                    Retorno
                                                </span>
                                            )}
                                            {!order.is_courtesy && !order.is_return && (
                                                <span className="text-sm text-zinc-400">—</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    {/* Nº OS Conc. */}
                                    <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200 font-mono">
                                        {order.external_os_number || '—'}
                                    </TableCell>
                                    {/* Placa */}
                                    <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200 font-mono font-medium">
                                        {order.plate}
                                    </TableCell>
                                    {/* Modelo */}
                                    <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                        {order.vehicle_model || '—'}
                                    </TableCell>
                                    {/* Obs. Internas */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 max-w-[180px]">
                                        <span className="block truncate" title={order.internal_notes || undefined}>
                                            {order.internal_notes || '—'}
                                        </span>
                                    </TableCell>
                                    {/* Serviços */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 max-w-[220px]">
                                        {(() => {
                                            const list = getServiceList(order, services);
                                            if (list.length === 0) return <span>—</span>;
                                            const preview = list.length === 1
                                                ? list[0]
                                                : `${list[0].length > 22 ? list[0].slice(0, 22) + '…' : list[0]} +${list.length - 1}`;
                                            return (
                                                <TooltipProvider delayDuration={200}>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="cursor-default truncate block">{preview}</span>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="bottom" className="max-w-xs p-2">
                                                            <ul className="space-y-0.5">
                                                                {list.map((name, i) => (
                                                                    <li key={i} className="text-xs">{name}</li>
                                                                ))}
                                                            </ul>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            );
                                        })()}
                                    </TableCell>
                                    {/* Observações */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 max-w-[180px]">
                                        <span
                                            className="block truncate"
                                            title={cleanNotes(order.notes) !== '—' ? cleanNotes(order.notes) : undefined}
                                        >
                                            {cleanNotes(order.notes)}
                                        </span>
                                    </TableCell>
                                    {/* Tonalidade (film/ppf) */}
                                    {showTonality && (
                                        <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                            {(order.department === 'film' || order.department === 'security_film' || order.department === 'ppf')
                                                ? (order.items?.map(i => i.tonality).filter(Boolean).join(', ') || '—')
                                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                                            }
                                        </TableCell>
                                    )}
                                    {/* N° Pelicula (film/ppf) */}
                                    {showTonality && (
                                        <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 font-mono">
                                            {(order.department === 'film' || order.department === 'security_film' || order.department === 'ppf')
                                                ? (order.items?.map(i => i.roll_code).filter(Boolean).join(', ') || '—')
                                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                                            }
                                        </TableCell>
                                    )}
                                    {/* Instalador (film/ppf) */}
                                    {showFilmCols && (
                                        <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                            {(order.department === 'film' || order.department === 'security_film' || order.department === 'ppf')
                                                ? (order.workers && order.workers.length > 0
                                                    ? order.workers.map(w => w.name).join(', ')
                                                    : '—')
                                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                                            }
                                        </TableCell>
                                    )}
                                    {/* Nº NF (film/ppf) */}
                                    {showFilmCols && (
                                        <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 font-mono">
                                            {(order.department === 'film' || order.department === 'security_film' || order.department === 'ppf')
                                                ? (order.invoice_number || '—')
                                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                                            }
                                        </TableCell>
                                    )}
                                    {/* Valor */}
                                    <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200 text-right font-medium">
                                        {formatCurrency(calcTotal(order))}
                                    </TableCell>
                                    {/* Foto de Avaria */}
                                    <TableCell className="px-4 py-3">
                                        {order.damage_photos?.[0] ? (
                                            <button
                                                onClick={() => setDamagePhotoUrl(order.damage_photos![0])}
                                                className="block rounded overflow-hidden hover:opacity-80 transition-opacity"
                                                title="Ver foto de avaria"
                                            >
                                                <img
                                                    src={toThumbUrl(order.damage_photos[0])}
                                                    alt="Foto de avaria"
                                                    className="h-10 w-10 object-cover rounded"
                                                    loading="lazy"
                                                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = order.damage_photos![0]; }}
                                                />
                                            </button>
                                        ) : (
                                            <ImageOff className="h-5 w-5 text-zinc-600" />
                                        )}
                                    </TableCell>
                                    {/* Atualizado em */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 whitespace-nowrap">
                                        {formatDateTime(order.updated_at)}
                                    </TableCell>
                                    {/* Atualizado por */}
                                    <TableCell className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                        {order.updated_by_name || '—'}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Paginação */}
            {!isLoading && (data?.total ?? 0) > PAGE_SIZE && (() => {
                const total = data?.total ?? 0;
                const totalPages = Math.ceil(total / PAGE_SIZE);
                const from = (page - 1) * PAGE_SIZE + 1;
                const to = Math.min(page * PAGE_SIZE, total);
                return (
                    <div className="flex items-center justify-between pt-1">
                        <span className="text-sm text-[#666666] dark:text-zinc-400">
                            Mostrando {from}–{to} de {total}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage((p) => p - 1)}
                                disabled={page === 1}
                                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="px-3 text-sm text-[#111111] dark:text-white font-medium">
                                {page} / {totalPages}
                            </span>
                            <button
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= totalPages}
                                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                );
            })()}

            <EditDialog
                order={editOrder}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ['service-orders'] });
                    queryClient.invalidateQueries({ queryKey: ['service-order'] });
                    queryClient.invalidateQueries({ queryKey: ['vehicle-history'] });
                    queryClient.invalidateQueries({ queryKey: ['os-history'] });
                }}
                canEdit={hasDeletePermission('conference', 'edit')}
                canDelete={hasDeletePermission('conference', 'delete')}
                onGenerateCopy={hasDeletePermission('service_orders', 'edit') ? (o) => { setEditOpen(false); setCopySource(o); } : undefined}
            />

            {/* Gerar cópia: montagem condicional garante que defaultValues do useForm sejam aplicados */}
            {copySource && (
                <QuickCreateModal
                    open
                    onClose={() => setCopySource(null)}
                    prefill={buildPrefillFromOrder(copySource)}
                />
            )}

            {photoUrl && (
                <PhotoDialog
                    url={photoUrl}
                    open={!!photoUrl}
                    onClose={() => setPhotoUrl(null)}
                />
            )}
            {damagePhotoUrl && (
                <PhotoDialog
                    url={damagePhotoUrl}
                    open={!!damagePhotoUrl}
                    onClose={() => setDamagePhotoUrl(null)}
                />
            )}

            <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
                <DialogContent className="max-w-sm bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Cancelar OS?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-[#666666] dark:text-zinc-400">
                        A OS <span className="font-semibold text-[#111111] dark:text-white">#{deleteTarget?.id}</span> será cancelada e não aparecerá mais na listagem padrão. É possível visualizá-la filtrando por "Canceladas".
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                            Voltar
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                        >
                            {deleteMutation.isPending ? 'Cancelando...' : 'Confirmar'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* HML-48 / HML-70: Dialog Marcar como Erro */}
            <Dialog open={!!errorTarget} onOpenChange={(v) => { if (!v) { setErrorTarget(null); setErrorReason(''); } }}>
                <DialogContent className="max-w-sm bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]">
                    <DialogHeader>
                        <DialogTitle className="text-amber-500 flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5" />
                            Marcar OS como Erro
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-[#666666] dark:text-zinc-400">
                        Descreva o erro encontrado na OS <span className="font-semibold text-[#111111] dark:text-white">#{errorTarget?.id}</span>. A observação é obrigatória.
                    </p>
                    <div className="space-y-1.5">
                        <label htmlFor="error-reason-textarea" className="text-sm font-medium text-[#666666] dark:text-zinc-300">Motivo do erro *</label>
                        <Textarea
                            id="error-reason-textarea"
                            placeholder="Ex: Serviço lançado no departamento errado..."
                            className="min-h-[80px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            value={errorReason}
                            onChange={(e) => setErrorReason(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => { setErrorTarget(null); setErrorReason(''); }}>Cancelar</Button>
                        <Button
                            disabled={!errorReason.trim() || markWrongMutation.isPending}
                            className="bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={() => errorTarget && markWrongMutation.mutate({ id: errorTarget.id, internal_notes: errorReason })}
                        >
                            {markWrongMutation.isPending ? 'Salvando...' : 'Confirmar'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
