import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getApiErrorMessage } from '@/lib/api-error';
import { useQuery } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getTonalityOptions } from '@/constants/scheduling';
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import { useVehicleModels } from '@/hooks/useVehicleModels';
import { useServices } from '@/hooks/useServices';
import { useFilmInstallers } from '@/hooks/useEmployees';
import { useConsultants } from '@/hooks/useConsultants';
import { useCreateServiceOrder } from '@/hooks/useServiceOrders';
import { CATALOG_STALE_TIME, CATALOG_GC_TIME, filmTypesKey } from '@/lib/catalog-queries';
import type { Department, ServiceOrder } from '@/types/service-order.types';
import { CourtesyReturnSelect } from './CourtesyReturnSelect';
import { ServiceCodeCombobox } from './ServiceCodeCombobox';
import type { Photo } from '@/types/photo.types';
import { CameraCapture } from '@/components/common/CameraCapture';
import { compressImage } from '@/utils/imageCompression';
import { validateImageFile } from '@/utils/fileValidation';
import { markDirty, markClean } from '@/lib/pendingWork';
import { useFormDraft } from '@/hooks/useFormDraft';
import { generateId } from '@/utils/generateId';
import { isValidPlateOrChassi, PLATE_ERROR_MESSAGE } from '@/utils/plate';
import { DismissibleNotice } from '@/components/common/DismissibleNotice';
import { DraftRestoredBanner } from '@/components/common/DraftRestoredBanner';
import { DuplicateAlert } from './DuplicateAlert';
import { useDuplicateCheck } from '@/hooks/useDuplicateCheck';
import { VideoCapture } from '@/components/features/service-orders/VideoCapture';
import { logger } from '@/lib/logger';
import { uploadService } from '@/services/api/upload.service';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { inventoryService } from '@/services/api/inventory.service';
import type { FilmRoll, FilmRollStatus, FilmType } from '@/services/api/inventory.service';
import { formatFilmRollName, formatMeters, formatReceiptDate } from '@/utils/filmRoll';
import {
    Camera,
    ImageIcon,
    X,
    Check,
    ChevronsUpDown,
    ChevronDown,
    ChevronRight,
    Repeat,
    Search,
} from 'lucide-react';
import { cleanConsultantNotes } from '@/utils/serviceOrderNotes';

// ─── Zod schema ───────────────────────────────────────────────────────────────
// Schema base (sem a validação condicional de retorno sem origem) — usado só
// para inferir o tipo do form. A validação completa nasce de `buildQuickCreateSchema`,
// parametrizada por `isOwner` (regra "retorno sem O.S. de origem").
const baseSchema = z.object({
    department: z.enum(['film', 'security_film', 'ppf', 'vn', 'vd', 'vu', 'bodywork', 'workshop'] as const, {
        error: 'Selecione um departamento',
    }),
    plate: z
        .string()
        .min(1, 'Placa ou chassi obrigatório')
        .refine((v) => isValidPlateOrChassi(v), PLATE_ERROR_MESSAGE),
    vehicle_model: z.string().min(1, 'Modelo obrigatório'),
    vehicle_model_id: z.number().optional(),
    vehicle_color: z.string().min(1, 'Cor obrigatória'),
    consultant_id: z.number().optional(),
    external_os_number: z.string().optional(), // validação condicional via superRefine
    selected_services: z.array(z.number()).default([]),
    is_return: z.boolean().default(false),
    is_courtesy: z.boolean().default(false),
    courtesy_return_set: z.boolean().refine((v) => v === true, { message: 'Selecione uma opção' }),
    is_galpon: z.boolean().default(false),
    notes: z.string().optional(),
    service_date: z.string().min(1, 'Data do serviço obrigatória'),
    film_entries: z.array(z.object({
        service_id:   z.number(),
        tonality:     z.string(),
        roll_code:    z.string().optional(),
        film_roll_id: z.number().optional(),
        film_type_id: z.number().optional(),
        // Retalho (sobra de corte anterior): dispensa a bobina obrigatória — não
        // há metros a debitar. Ver superRefine abaixo.
        used_scrap:   z.boolean().optional(),
    })).optional(),
    installers: z.array(z.number()).optional(),
    form_store_id: z.number().optional(),
    service_prices: z.record(z.string(), z.string()).optional(),
    original_service_order_id: z.number().optional(),
});

/**
 * Constrói o schema completo (objeto base + validação condicional) parametrizado
 * por `isOwner`. Regra "retorno sem O.S. de origem":
 * - Não-Owner: origem continua obrigatória (comportamento histórico).
 * - Owner: pode deixar a origem vazia, mas a Observação (`notes`) passa a ser
 *   obrigatória (motivo do lançamento retroativo/sem origem no sistema).
 * O backend espelha esta mesma regra (403/422) — aqui é só UX antecipada.
 */
function buildQuickCreateSchema(isOwner: boolean) {
    return baseSchema.superRefine((data, ctx) => {
        if (data.department === 'film' || data.department === 'security_film' || data.department === 'ppf') {
            const isTonalityDept = data.department === 'film' || data.department === 'security_film';
            // Bobina obrigatória apenas para Película comum. Película de Segurança e PPF têm bobina opcional.
            const isRollRequiredDept = data.department === 'film';
            if (!data.film_entries || data.film_entries.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Adicione ao menos uma película',
                    path: ['film_entries'],
                });
            } else {
                data.film_entries.forEach((entry, i) => {
                    if (!entry.service_id || entry.service_id <= 0) {
                        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione uma película', path: ['film_entries', i, 'service_id'] });
                    }
                    if (isTonalityDept && !entry.tonality) {
                        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione a tonalidade', path: ['film_entries', i, 'tonality'] });
                    }
                    if (isRollRequiredDept && !entry.film_roll_id && !entry.used_scrap) {
                        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione uma bobina', path: ['film_entries', i, 'film_roll_id'] });
                    }
                });
            }
        } else if (data.department) {
            if (data.selected_services.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Selecione pelo menos 1 serviço',
                    path: ['selected_services'],
                });
            }
        }

        if (data.department !== 'vn' && data.department !== 'vd' && data.department !== 'vu' && !data.external_os_number?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Nº OS Concessionária obrigatório',
                path: ['external_os_number'],
            });
        }

        if (!data.is_galpon && !data.consultant_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Consultor obrigatório',
                path: ['consultant_id'],
            });
        }

        if ((data.department === 'film' || data.department === 'security_film' || data.department === 'ppf') && (!data.installers || data.installers.length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Selecione pelo menos 1 instalador',
                path: ['installers'],
            });
        }

        if (data.is_return && !data.original_service_order_id) {
            if (!isOwner) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Selecione a O.S. de origem do retorno',
                    path: ['original_service_order_id'],
                });
            } else if (!data.notes?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Informe a observação (motivo) ao lançar um retorno sem O.S. de origem.',
                    path: ['notes'],
                });
            }
        }
    });
}

export type QuickCreateFormData = z.infer<typeof baseSchema>;

/**
 * Chave do rascunho local (localStorage) do formulário. O rascunho guarda só
 * os campos de texto/seleção do form (mesmo shape do `QuickCreateFormData`)
 * — NUNCA fotos/vídeo, que vivem nos `useState` separados (`photos`,
 * `damagePhotos`, `videoUrl`).
 */
const QUICK_CREATE_DRAFT_KEY = 'aems-draft:quick-create-os';

// ─── Prefill types ─────────────────────────────────────────────────────────────
/**
 * Dados para pré-preencher o QuickCreateModal na montagem.
 * O chamador DEVE montar o modal condicionalmente ({source && <QuickCreateModal />})
 * para que os defaultValues do useForm sejam aplicados corretamente —
 * o hook não reaplica defaults após a montagem.
 */
export interface QuickCreatePrefill {
    values: Partial<QuickCreateFormData>;
    photos?: Photo[];
    damagePhotos?: Photo[];
    passthrough?: {
        vehicle_year?: number;
        vehicle_brand?: string;
        dealership_id?: number;
    };
}

// ─── Prefill builder ──────────────────────────────────────────────────────────
/**
 * Constrói um QuickCreatePrefill a partir de uma O.S. existente.
 * Departamento e serviços são omitidos intencionalmente — o usuário seleciona ao criar a cópia.
 * As fotos são reutilizadas como URLs já enviadas (sem re-upload).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildPrefillFromOrder(order: ServiceOrder): QuickCreatePrefill {
    const today = new Date().toISOString().split('T')[0];

    // Mesma lógica de strip de notas do EditDialog (ConferencePage ~linha 317)
    const rawNotes = order.notes ?? '';
    const strippedNotes = cleanConsultantNotes(rawNotes) ?? '';

    const values: Partial<QuickCreateFormData> = {
        plate: order.plate,
        vehicle_model: order.vehicle_model ?? '',
        vehicle_model_id: order.vehicle_model_id ?? undefined,
        vehicle_color: order.vehicle_color ?? '',
        consultant_id: order.consultant_id ?? undefined,
        external_os_number: order.external_os_number ?? '',
        is_galpon: order.is_galpon,
        is_return: order.is_return,
        is_courtesy: order.is_courtesy,
        // Zod exige courtesy_return_set === true para passar na validação
        courtesy_return_set: true,
        service_date: order.service_date ?? today,
        notes: strippedNotes,
        form_store_id: order.location_id,
    };

    const photos: Photo[] = (order.photos ?? []).map((url) => ({
        id: generateId(),
        preview: url,
        url,
        uploaded: true,
        uploadProgress: 100,
    }));

    const damagePhotos: Photo[] = (order.damage_photos ?? []).map((url) => ({
        id: generateId(),
        preview: url,
        url,
        uploaded: true,
        uploadProgress: 100,
    }));

    return {
        values,
        photos,
        damagePhotos,
        passthrough: {
            vehicle_year: order.vehicle_year ?? undefined,
            vehicle_brand: order.vehicle_brand,
            dealership_id: order.dealership_id,
        },
    };
}

// ─── Department config ────────────────────────────────────────────────────────
interface DeptOption {
    value: Department;
    label: string;
}

const DEPT_OPTIONS: DeptOption[] = [
    { value: 'film',          label: 'Película' },
    { value: 'security_film', label: 'Pel. Segurança' },
    { value: 'ppf',      label: 'PPF' },
    { value: 'vn',       label: 'VN' },
    { value: 'vd',       label: 'Venda Direta' },
    { value: 'vu',       label: 'VU' },
    { value: 'bodywork', label: 'Funilaria' },
    { value: 'workshop', label: 'Oficina' },
];

// ─── Sub-component: department toggle buttons ─────────────────────────────────
export interface DeptToggleProps {
    value: Department | undefined;
    onChange: (v: Department) => void;
    error?: string;
}

export function DeptToggle({ value, onChange, error }: DeptToggleProps) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Departamento <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
                {DEPT_OPTIONS.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            value === opt.value
                                ? 'bg-[#F5A800] border-[#F5A800] text-[#111111]'
                                : 'bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#444444] dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-[#BDBDBD] dark:hover:border-zinc-600'
                        )}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

// ─── Sub-component: inline service picker (no prices) ─────────────────────────
// Tipo mínimo de item de O.S. necessário para identificar serviços "fora do catálogo"
export interface ServicePickerOrderItem {
    service_id: number;
    service_name?: string | null;
    service_code?: string | null;
}

export interface ServicePickerProps {
    department: Department | undefined;
    brandId?: number;
    selectedIds: number[];
    onChange: (ids: number[]) => void;
    error?: string;
    prices?: Record<number, string>;
    onPriceChange?: (serviceId: number, price: string) => void;
    priceErrors?: Record<number, string>;
    isCourtesy?: boolean;
    /**
     * Itens já vinculados à O.S. em edição. Quando fornecido, serviços presentes
     * na O.S. mas ausentes do catálogo ativo aparecem marcados com rótulo "(atual)"
     * — mesmo padrão do EditServicesModal — evitando descarte silencioso ao salvar.
     */
    currentOrderItems?: ServicePickerOrderItem[];
}

export function ServicePicker({ department, brandId, selectedIds, onChange, error, prices, onPriceChange, priceErrors, isCourtesy = false, currentOrderItems }: ServicePickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const { data: services, isLoading } = useServices(department, brandId);

    // Serviços do catálogo ativo filtrados por cortesia e busca
    const catalogFiltered = (services ?? [])
        .filter((s) => isCourtesy || !s.is_courtesy_only)
        .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

    // Serviços que a O.S. já tem mas que NÃO aparecem no catálogo ativo (inativos ou
    // de marca/departamento diferente). Precisam aparecer marcados para não serem
    // descartados silenciosamente ao salvar. Mesmo padrão do EditServicesModal.
    const catalogIds = new Set((services ?? []).map((s) => s.id));
    const orphanServices: Array<{ id: number; name: string; outOfCatalog: true }> = (currentOrderItems ?? [])
        .filter((i) => i.service_id != null && !catalogIds.has(i.service_id))
        .filter((i, idx, arr) => arr.findIndex((x) => x.service_id === i.service_id) === idx)
        .map((i) => ({
            id: i.service_id,
            name: i.service_name || i.service_code || `Serviço #${i.service_id}`,
            outOfCatalog: true as const,
        }));

    // Exibe órfãos primeiro (já marcados), depois o catálogo filtrado
    const visibleInPopover: Array<{ id: number; name: string; code?: string | null; outOfCatalog?: boolean }> = [
        ...orphanServices.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())),
        ...catalogFiltered.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    ];

    const toggle = useCallback(
        (id: number) => {
            onChange(
                selectedIds.includes(id)
                    ? selectedIds.filter((x) => x !== id)
                    : [...selectedIds, id]
            );
        },
        [selectedIds, onChange]
    );

    const removeChip = useCallback(
        (id: number) => {
            onChange(selectedIds.filter((x) => x !== id));
        },
        [selectedIds, onChange]
    );

    // Resolve o nome de exibição: tenta catálogo, cai no órfão, cai no genérico
    const orphanMap = new Map(orphanServices.map((o) => [o.id, o.name]));
    const selectedNames = selectedIds.map((id) => {
        return services?.find((s) => s.id === id)?.name
            ?? orphanMap.get(id)
            ?? `Serviço #${id}`;
    });

    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Serviços <span className="text-destructive">*</span>
            </Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        type="button"
                        className={cn(
                            'w-full justify-between h-10 bg-white dark:bg-[#1A1A1A]',
                            selectedIds.length === 0 && 'text-muted-foreground'
                        )}
                    >
                        {selectedIds.length > 0
                            ? `${selectedIds.length} serviço(s) selecionado(s)`
                            : 'Selecionar serviços...'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[calc(100vw-2rem)] sm:w-[420px] p-0"
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    <div className="flex items-center border-b px-3 py-2 gap-2">
                        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        <input
                            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            placeholder="Buscar serviço..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    {isLoading ? (
                        <div className="p-4 space-y-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-4/5" />
                            <Skeleton className="h-4 w-3/5" />
                        </div>
                    ) : !department ? (
                        <p className="p-4 text-sm text-muted-foreground text-center">
                            Selecione um departamento primeiro
                        </p>
                    ) : visibleInPopover.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground text-center">
                            Nenhum serviço encontrado
                        </p>
                    ) : (
                        <ScrollArea className="h-[240px]">
                            <div className="p-1">
                                {visibleInPopover.map((svc) => (
                                    <div
                                        key={svc.id}
                                        className="flex items-center gap-2 px-3 py-2 rounded-sm cursor-pointer hover:bg-accent"
                                        onClick={() => toggle(svc.id)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(svc.id); }}
                                        role="checkbox"
                                        aria-checked={selectedIds.includes(svc.id)}
                                        tabIndex={0}
                                    >
                                        <div
                                            className={cn(
                                                'flex h-4 w-4 items-center justify-center rounded-sm border border-primary shrink-0',
                                                selectedIds.includes(svc.id)
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'opacity-50 [&_svg]:invisible'
                                            )}
                                        >
                                            <Check className="h-3 w-3" />
                                        </div>
                                        <span className="text-sm">
                                            {svc.outOfCatalog
                                                ? svc.name
                                                : (svc.code ? `${svc.code} - ${svc.name}` : svc.name)}
                                            {svc.outOfCatalog && (
                                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                                    (atual)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </PopoverContent>
            </Popover>

            {selectedNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedNames.map((name, idx) => (
                        <Badge
                            key={selectedIds[idx]}
                            variant="secondary"
                            className="text-xs gap-1 pr-1 max-w-full"
                        >
                            <span className="truncate">{name}</span>
                            <button
                                type="button"
                                onClick={() => removeChip(selectedIds[idx])}
                                className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5"
                                aria-label={`Remover ${name}`}
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
            {/* Inputs de preço para serviços variáveis */}
            {prices !== undefined && onPriceChange && services && selectedIds.length > 0 && (
                <div className="space-y-2 mt-2">
                    {selectedIds
                        .filter((id) => services.find((s) => s.id === id)?.has_variable_price)
                        .map((id) => {
                            const svc = services.find((s) => s.id === id)!;
                            return (
                                <div key={id}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground flex-1 truncate">{svc.name}: <span className="text-destructive">*</span></span>
                                        <div className="relative w-32">
                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                placeholder="0,00"
                                                value={prices[id] ?? ''}
                                                onChange={(e) => onPriceChange(id, e.target.value)}
                                                className={cn('pl-7 h-8 text-xs', priceErrors?.[id] && 'border-destructive focus-visible:ring-destructive')}
                                            />
                                        </div>
                                    </div>
                                    {priceErrors?.[id] && (
                                        <p className="text-xs text-destructive mt-0.5 text-right">{priceErrors[id]}</p>
                                    )}
                                </div>
                            );
                        })
                    }
                </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

// ─── Sub-component: RollSelect ────────────────────────────────────────────────
// Seletor de bobina com o mesmo visual do FilmRollSelector do Agendamento:
// item em 2 linhas (nome + data/metragem) e campo fechado com resumo de 1 linha.
function RollSelect({
    rolls,
    value,
    onChange,
    disabled,
    hasError,
    emptyMessage,
    allowScrap,
    isScrap,
}: {
    rolls: FilmRoll[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    hasError?: boolean;
    emptyMessage: string;
    /** Habilita a opção "Retalho (sobra)" no topo do dropdown. */
    allowScrap?: boolean;
    /** A entry atual está em modo retalho — reflete no valor/placeholder exibido. */
    isScrap?: boolean;
}) {
    const selected = rolls.find((r) => r.id.toString() === value);
    return (
        <Select value={isScrap ? 'scrap' : value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={cn('h-10', hasError && 'border-destructive')}>
                <SelectValue placeholder="Selecionar bobina">
                    {isScrap
                        ? 'Retalho (sobra)'
                        : selected
                            ? `${formatFilmRollName(selected)} · ${formatReceiptDate(selected.receipt_date)} · ${formatMeters(selected.remaining_meters)}`
                            : undefined}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {allowScrap && <SelectItem value="scrap">Retalho (sobra)</SelectItem>}
                {rolls.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        {emptyMessage}
                    </div>
                ) : (
                    rolls.map((roll) => (
                        <SelectItem
                            key={roll.id}
                            value={roll.id.toString()}
                            textValue={`${formatFilmRollName(roll)} ${formatReceiptDate(roll.receipt_date)}`}
                        >
                            <div className="flex flex-col items-start">
                                <span className="font-medium">
                                    {formatFilmRollName(roll)}
                                    {roll.status === 'em_uso' && (
                                        <span className="ml-1 text-xs font-normal text-amber-600">(em uso)</span>
                                    )}
                                    {roll.status === 'esgotada' && (
                                        <span className="ml-1 text-xs font-normal text-red-600 dark:text-red-400">(esgotada)</span>
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {formatReceiptDate(roll.receipt_date)} · restam {formatMeters(roll.remaining_meters)}
                                </span>
                            </div>
                        </SelectItem>
                    ))
                )}
            </SelectContent>
        </Select>
    );
}

// ─── Sub-component: FilmPicker ────────────────────────────────────────────────
export interface FilmEntry {
    service_id: number;
    service_name?: string;
    tonality: string;
    roll_code?: string;
    film_roll_id?: number;
    film_type_id?: number;
    /** Retalho (sobra de corte anterior): selecionado como opção dentro do próprio
     * dropdown de bobina — sem film_roll_id vinculado, nenhum metro é debitado. */
    used_scrap?: boolean;
}

export interface FilmPickerProps {
    storeId: number;
    brandId?: number;
    department: 'film' | 'security_film' | 'ppf';
    selectedEntries: FilmEntry[];
    onChange: (entries: FilmEntry[]) => void;
    installers: number[];
    onInstallersChange: (ids: number[]) => void;
    error?: string;
    rollCodeErrors?: Record<number, string>;
    isGalpon?: boolean;
}

export function FilmPicker({
    storeId,
    brandId,
    department,
    selectedEntries,
    onChange,
    installers,
    onInstallersChange,
    error,
    rollCodeErrors,
    isGalpon = false,
}: FilmPickerProps) {
    const [installersOpen, setInstallersOpen] = useState(false);

    const { data: services, isLoading: servicesLoading } = useServices(department, brandId);
    const { data: employeesData, isLoading: employeesLoading } = useFilmInstallers(department);

    // Marcas PPF cadastradas (apenas para ppf)
    const { data: ppfBrandsData } = useQuery({
        queryKey: filmTypesKey('ppf'),
        queryFn: () => inventoryService.listFilmTypes({ department: 'ppf', limit: 100 }),
        enabled: department === 'ppf',
        staleTime: CATALOG_STALE_TIME,
        gcTime: CATALOG_GC_TIME,
    });
    const ppfBrands: FilmType[] = ppfBrandsData?.items ?? [];

    // Tipos de película do departamento (film ou security_film) — usados para cruzar service_code → film_type_id
    const { data: filmFilmTypesData } = useQuery({
        queryKey: filmTypesKey(department as 'film' | 'security_film'),
        queryFn: () => inventoryService.listFilmTypes({ department: department as 'film' | 'security_film', limit: 100 }),
        enabled: department === 'film' || department === 'security_film',
        staleTime: CATALOG_STALE_TIME,
        gcTime: CATALOG_GC_TIME,
    });
    const filmFilmTypes: FilmType[] = useMemo(() => filmFilmTypesData?.items ?? [], [filmFilmTypesData]);

    // União das tonalidades configuradas nos tipos que incluem o serviço.
    // Vazio → getTonalityOptions cai no fallback por departamento (todas).
    const tonalitiesForService = useCallback(
        (serviceId?: number | null): string[] => {
            if (!serviceId) return [];
            const set = new Set<string>();
            for (const ft of filmFilmTypes) {
                if ((ft.services ?? []).some((s) => s.service_id === serviceId)) {
                    for (const t of ft.available_tonalities ?? []) set.add(t);
                }
            }
            return Array.from(set);
        },
        [filmFilmTypes]
    );

    // Ids de bobinas PPF já vinculadas nas entries — garante que bobinas esgotadas continuem visíveis
    const linkedPpfRollIds = selectedEntries
        .map((e) => e.film_roll_id)
        .filter((id): id is number => id !== undefined);

    // Ids de bobinas Film/SecurityFilm já vinculadas nas entries
    const linkedFilmRollIds = selectedEntries
        .map((e) => e.film_roll_id)
        .filter((id): id is number => id !== undefined);

    // Bobinas PPF disponíveis da loja (filtradas por departamento ppf no backend)
    const { data: allPpfRolls = [], isLoading: ppfRollsLoading } = useQuery({
        queryKey: ['ppf-rolls-for-os', isGalpon ? 'galpon' : storeId, 'ppf', isGalpon, linkedPpfRollIds],
        queryFn: async () => {
            const rollParams = isGalpon
                ? { use_galpon_store: true as const }
                : { store_id: storeId }
            const includeIds = linkedPpfRollIds.length > 0 ? linkedPpfRollIds : undefined;
            // Só bobinas EM USO — lacradas (em estoque) nunca são ofertadas aqui.
            const statuses: FilmRollStatus[] = ['em_uso'];
            const results = await Promise.all(
                statuses.map((status) => inventoryService.listRolls({ ...rollParams, status, department: 'ppf', include_roll_ids: includeIds, limit: 200 }))
            );
            return Array.from(new Map(results.flatMap((r) => r.items).map((r) => [r.id, r])).values()) as FilmRoll[];
        },
        enabled: (isGalpon ? true : !!storeId) && department === 'ppf',
        staleTime: 1000 * 60 * 2,
        gcTime: 1000 * 60 * 2,
    });

    // Bobinas do departamento de película (film ou security_film) disponíveis da loja
    const { data: allFilmRolls = [], isLoading: filmRollsLoading } = useQuery({
        queryKey: ['film-rolls-for-os', isGalpon ? 'galpon' : storeId, department, isGalpon, linkedFilmRollIds],
        queryFn: async () => {
            const rollParams = isGalpon
                ? { use_galpon_store: true as const }
                : { store_id: storeId }
            const includeIds = linkedFilmRollIds.length > 0 ? linkedFilmRollIds : undefined;
            // Só bobinas EM USO — lacradas (em estoque) nunca são ofertadas aqui.
            const statuses: FilmRollStatus[] = ['em_uso'];
            const results = await Promise.all(
                statuses.map((status) => inventoryService.listRolls({ ...rollParams, status, department: department as 'film' | 'security_film', include_roll_ids: includeIds, limit: 200 }))
            );
            return Array.from(new Map(results.flatMap((r) => r.items).map((r) => [r.id, r])).values()) as FilmRoll[];
        },
        enabled: (isGalpon ? true : !!storeId) && (department === 'film' || department === 'security_film'),
        staleTime: 1000 * 60 * 2,
        gcTime: 1000 * 60 * 2,
    });

    const getPpfRollsForEntry = useCallback(
        (index: number) => {
            const entry = selectedEntries[index];
            const brandId = entry?.film_type_id;
            const selectedRollId = entry?.film_roll_id;
            if (!brandId) return [];
            return allPpfRolls.filter(
                (r) =>
                    (r.status !== 'esgotada' || r.id === selectedRollId) &&
                    (r.film_type_id === brandId || r.id === selectedRollId)
            );
        },
        [selectedEntries, allPpfRolls]
    );

    const getFilmRollsForEntry = useCallback(
        (index: number) => {
            const entry = selectedEntries[index];
            const tonality = entry?.tonality;
            const selectedRollId = entry?.film_roll_id;

            let rolls = allFilmRolls.filter(
                (r) => r.status !== 'esgotada' || r.id === selectedRollId
            );

            // Filtrar por tonalidade, mas nunca remover a bobina já selecionada da entry
            rolls = tonality
                ? rolls.filter((r) => r.tonality === tonality || r.id === selectedRollId)
                : rolls;

            if (entry?.service_id) {
                const entryCode = (services ?? []).find((s) => s.id === entry.service_id)?.code;
                const linkedTypeIds = filmFilmTypes
                    .filter((ft) => ft.services.some((s) =>
                        entryCode ? s.service_code === entryCode : s.service_id === entry.service_id
                    ))
                    .map((ft) => ft.id);
                if (linkedTypeIds.length > 0) {
                    rolls = rolls.filter((r) => linkedTypeIds.includes(r.film_type_id) || r.id === selectedRollId);
                }
            }

            return rolls;
        },
        [selectedEntries, allFilmRolls, filmFilmTypes, services]
    );

    const employees = (employeesData ?? []).filter(
        (e) => e.position === 'Instalador de Película'
    );

    const updateEntry = useCallback(
        (index: number, field: keyof FilmEntry, value: string | number) => {
            const updated = selectedEntries.map((entry, i) =>
                i === index ? { ...entry, [field]: value } : entry
            );
            onChange(updated);
        },
        [selectedEntries, onChange]
    );

    const selectService = useCallback(
        (index: number, serviceId: string) => {
            const svc = (services ?? []).find((s) => s.id.toString() === serviceId);
            const derivedTonality = svc
                ? (svc.name.match(/^(G\d+)/i)?.[1]?.toUpperCase() ?? '')
                : '';
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, service_id: Number(serviceId), service_name: svc?.name, tonality: derivedTonality, film_roll_id: undefined, roll_code: '' }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, services, onChange]
    );

    const selectTonality = useCallback(
        (index: number, tonality: string) => {
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, tonality, film_roll_id: undefined, roll_code: '' }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, onChange]
    );

    const selectFilmRoll = useCallback(
        (index: number, rollId: string) => {
            const roll = allFilmRolls.find((r) => r.id.toString() === rollId);
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, film_roll_id: roll?.id, roll_code: roll?.visual_id ?? '', used_scrap: false }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, allFilmRolls, onChange]
    );

    const selectPpfRoll = useCallback(
        (index: number, rollId: string) => {
            const roll = allPpfRolls.find((r) => r.id.toString() === rollId);
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, film_roll_id: roll?.id, roll_code: roll?.visual_id ?? '', used_scrap: false }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, allPpfRolls, onChange]
    );

    // Marca a entry como retalho (sobra de corte anterior) — selecionado
    // diretamente no dropdown de bobina. Sem bobina vinculada, sem código.
    const selectScrap = useCallback(
        (index: number) => {
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, used_scrap: true, film_roll_id: undefined, roll_code: '' }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, onChange]
    );

    const selectPpfBrand = useCallback(
        (index: number, brandIdStr: string) => {
            const updated = selectedEntries.map((entry, i) =>
                i === index
                    ? { ...entry, film_type_id: Number(brandIdStr), film_roll_id: undefined, roll_code: '' }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, onChange]
    );

    const addEntry = useCallback(() => {
        onChange([...selectedEntries, { service_id: 0, tonality: '', roll_code: '', film_roll_id: undefined }]);
    }, [selectedEntries, onChange]);

    const removeEntry = useCallback(
        (index: number) => {
            onChange(selectedEntries.filter((_, i) => i !== index));
        },
        [selectedEntries, onChange]
    );

    const toggleInstaller = useCallback(
        (id: number) => {
            onInstallersChange(
                installers.includes(id)
                    ? installers.filter((x) => x !== id)
                    : [...installers, id]
            );
        },
        [installers, onInstallersChange]
    );

    return (
        <div className="space-y-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {department === 'ppf' ? 'PPF' : 'Películas'} <span className="text-destructive">*</span>
            </Label>

            <div className="space-y-2">
                {selectedEntries.map((entry, index) => (
                    <div
                        key={index}
                        className="border border-[#D1D1D1] dark:border-[#333333] rounded-lg p-3 space-y-2 bg-gray-50/50 dark:bg-zinc-800/30"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                {department === 'ppf' ? 'PPF' : 'Filme'} {index + 1}
                            </span>
                            {selectedEntries.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeEntry(index)}
                                    aria-label={`Remover item ${index + 1}`}
                                    className="text-muted-foreground hover:text-destructive transition-colors rounded p-0.5"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>

                        {servicesLoading ? (
                            <Skeleton className="h-10 w-full" />
                        ) : (
                            <ServiceCodeCombobox
                                services={services ?? []}
                                value={entry.service_id}
                                onChange={(v) => (department === 'film' || department === 'security_film') ? selectService(index, v) : updateEntry(index, 'service_id', Number(v))}
                                placeholder={department === 'ppf' ? 'Selecionar serviço PPF...' : 'Selecionar película...'}
                                fallback={entry.service_id > 0 && entry.service_name ? { id: entry.service_id, name: entry.service_name } : undefined}
                            />
                        )}

                        {department === 'ppf' ? (
                            // PPF: [Marca PPF] [Bobina PPF por marca]
                            <div className="grid grid-cols-2 gap-2">
                                <Select
                                    value={entry.film_type_id?.toString() ?? ''}
                                    onValueChange={(v) => selectPpfBrand(index, v)}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="PPF" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ppfBrands.length === 0 ? (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                Nenhuma marca cadastrada
                                            </div>
                                        ) : (
                                            ppfBrands.map((brand) => (
                                                <SelectItem key={brand.id} value={brand.id.toString()}>
                                                    {brand.name}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>

                                <div className="space-y-1">
                                    {ppfRollsLoading ? (
                                        <Skeleton className="h-10 w-full" />
                                    ) : (
                                        <RollSelect
                                            rolls={getPpfRollsForEntry(index)}
                                            value={entry.film_roll_id?.toString() ?? ''}
                                            onChange={(v) => (v === 'scrap' ? selectScrap(index) : selectPpfRoll(index, v))}
                                            disabled={!entry.film_type_id}
                                            hasError={!!rollCodeErrors?.[index]}
                                            emptyMessage={entry.film_type_id ? 'Nenhuma bobina disponível' : 'Selecione a marca primeiro'}
                                            allowScrap
                                            isScrap={!!entry.used_scrap}
                                        />
                                    )}
                                    {rollCodeErrors?.[index] && (
                                        <p className="text-xs text-destructive">{rollCodeErrors[index]}</p>
                                    )}
                                    {entry.used_scrap && (
                                        <p className="text-[11px] text-muted-foreground leading-tight">
                                            A sobra já foi descontada no corte anterior — a bobina não será debitada.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            // Film: [Tonalidade] + [Bobina de Película]
                            <div className="grid grid-cols-2 gap-2">
                                <Select
                                    value={entry.tonality ?? ''}
                                    onValueChange={(v) => selectTonality(index, v)}
                                    disabled={!entry.service_id}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Tonalidade" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {getTonalityOptions({ serviceCode: (services ?? []).find(s => s.id === entry.service_id)?.code, department, availableTonalities: tonalitiesForService(entry.service_id) }).map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <div className="space-y-1">
                                    {filmRollsLoading ? (
                                        <Skeleton className="h-10 w-full" />
                                    ) : (
                                        <RollSelect
                                            rolls={getFilmRollsForEntry(index)}
                                            value={entry.film_roll_id?.toString() ?? ''}
                                            onChange={(v) => (v === 'scrap' ? selectScrap(index) : selectFilmRoll(index, v))}
                                            disabled={!entry.tonality}
                                            hasError={!!rollCodeErrors?.[index]}
                                            emptyMessage={entry.tonality ? 'Nenhuma bobina disponível' : 'Selecione a tonalidade primeiro'}
                                            allowScrap
                                            isScrap={!!entry.used_scrap}
                                        />
                                    )}
                                    {rollCodeErrors?.[index] && (
                                        <p className="text-xs text-destructive">{rollCodeErrors[index]}</p>
                                    )}
                                    {entry.used_scrap && (
                                        <p className="text-[11px] text-muted-foreground leading-tight">
                                            A sobra já foi descontada no corte anterior — a bobina não será debitada.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={addEntry}
                className="text-sm font-medium text-[#E89200] hover:text-[#D47F00] transition-colors"
            >
                + Adicionar {department === 'ppf' ? 'PPF' : 'Película'}
            </button>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Instaladores
                </Label>
                {employeesLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                ) : employees.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum instalador disponível</p>
                ) : (
                    <Popover open={installersOpen} onOpenChange={setInstallersOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={installersOpen}
                                className={cn(
                                    "w-full justify-between font-normal h-10 rounded-md",
                                    "border border-[#D1D1D1] dark:border-[#333333]",
                                    "bg-white dark:bg-[#1A1A1A]",
                                    "text-[#111111] dark:text-white",
                                    "hover:bg-white dark:hover:bg-[#1A1A1A]",
                                    "hover:text-[#111111] dark:hover:text-white",
                                    "focus-visible:ring-0 focus-visible:border-[#F5A800]",
                                    installersOpen && "border-[#F5A800]"
                                )}
                            >
                                <span className={cn("truncate", installers.length === 0 && "text-[#999999] dark:text-zinc-500")}>
                                    {installers.length === 0
                                        ? 'Selecionar instaladores...'
                                        : `${installers.length} instalador(es) selecionado(s)`}
                                </span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {employees.map((emp: { id: number; name: string; last_name?: string | null }) => {
                                    const isSelected = installers.includes(emp.id);
                                    return (
                                        <button
                                            key={emp.id}
                                            type="button"
                                            onClick={() => toggleInstaller(emp.id)}
                                            className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 cursor-pointer hover:bg-accent select-none text-left transition-colors"
                                        >
                                            <div className={cn(
                                                'w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0',
                                                isSelected ? 'border-[#F5A800] bg-[#F5A800]' : 'border-[#D1D1D1] dark:border-[#555555]'
                                            )}>
                                                {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                            </div>
                                            <span className="text-sm">{emp.name}{emp.last_name ? ` ${emp.last_name}` : ''}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </PopoverContent>
                    </Popover>
                )}
                {installers.length > 0 && employees.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {employees
                            .filter(e => installers.includes(e.id))
                            .map(e => (
                                <span key={e.id} className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5">
                                    {e.name}{e.last_name ? ` ${e.last_name}` : ''}
                                </span>
                            ))
                        }
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Sub-component: camera photo capture ──────────────────────────────────────
export interface CompactPhotoUploaderProps {
    photos: Photo[];
    onChange: (photos: Photo[]) => void;
    label?: string;
}

export function CompactPhotoUploader({ photos, onChange, label = 'Foto da OS' }: CompactPhotoUploaderProps) {
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [showOptions, setShowOptions] = useState(false);
    const [showCamera, setShowCamera] = useState(false);

    useEffect(() => {
        if (!showOptions) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowOptions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showOptions]);

    const processFile = useCallback(
        async (file: File) => {
            const validation = validateImageFile(file);
            if (!validation.valid) {
                toast({ variant: 'destructive', title: 'Arquivo inválido', description: validation.error });
                return;
            }
            try {
                const compressed = await compressImage(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 });
                const preview = URL.createObjectURL(compressed);
                onChange([{ id: generateId(), preview, compressed, uploaded: false, uploadProgress: 0 }]);
            } catch (err) {
                logger.error('Erro ao comprimir imagem:', err);
                toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Tente novamente com outra foto.' });
            }
        },
        [onChange]
    );

    const handleGalleryCapture = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (galleryInputRef.current) galleryInputRef.current.value = '';
            if (!file) return;
            await processFile(file);
        },
        [processFile]
    );

    const remove = useCallback(() => {
        if (photos[0]) URL.revokeObjectURL(photos[0].preview);
        onChange([]);
    }, [photos, onChange]);

    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
            </Label>
            {/* Galeria — sem capture, abre seletor de arquivo */}
            <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleGalleryCapture}
            />
            {/* Câmera in-app (getUserMedia) — evita a câmera nativa que reinicia o PWA */}
            {showCamera && (
                <CameraCapture
                    onCapture={(file) => { setShowCamera(false); void processFile(file); }}
                    onCancel={() => setShowCamera(false)}
                />
            )}
            {photos.length === 0 ? (
                <div ref={dropdownRef} className="relative self-start">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowOptions((v) => !v)}
                        className="flex items-center gap-2"
                    >
                        <Camera className="h-4 w-4" />
                        Tirar foto
                    </Button>
                    {showOptions && (
                        <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden min-w-[140px]">
                            <button
                                type="button"
                                onClick={() => { setShowOptions(false); setShowCamera(true); }}
                                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-zinc-700"
                            >
                                <Camera className="h-4 w-4 shrink-0" /> Câmera
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowOptions(false); galleryInputRef.current?.click(); }}
                                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-zinc-700 border-t border-gray-100 dark:border-zinc-700"
                            >
                                <ImageIcon className="h-4 w-4 shrink-0" /> Galeria
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="relative w-20 h-20 shrink-0">
                    <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="w-full h-full p-0 border-0 bg-transparent"
                        aria-label="Alterar foto"
                    >
                        <img
                            src={photos[0].preview}
                            alt={label}
                            className="w-full h-full object-cover rounded-lg border"
                        />
                    </button>
                    <button
                        type="button"
                        onClick={remove}
                        aria-label="Remover foto"
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Main QuickCreateModal ────────────────────────────────────────────────────
interface QuickCreateModalProps {
    open: boolean;
    onClose: () => void;
    /** Dados para pré-preencher o formulário. Aplicado apenas na montagem — use montagem condicional. */
    prefill?: QuickCreatePrefill;
}

export function QuickCreateModal({ open, onClose, prefill }: QuickCreateModalProps) {
    const user = useAuthStore((s) => s.user);
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    const isGalponProfile = effectivePermissions?.is_galpon_profile === true;
    const hideGalponOption = !isGalponProfile && effectivePermissions?.hide_galpon_option === true;
    // Regra "retorno sem O.S. de origem": Owner pode lançar retorno sem origem
    // (observação vira obrigatória); demais perfis seguem exigindo a origem.
    // Fonte única do papel: mesmo selector da store usado em AppointmentForm/useMyPermissions.
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const isOwner = isOwnerFn();
    const quickCreateSchema = useMemo(() => buildQuickCreateSchema(isOwner), [isOwner]);
    const { availableStores } = useStoreStore();
    const createServiceOrder = useCreateServiceOrder();

    const [photos, setPhotos] = useState<Photo[]>(prefill?.photos ?? []);
    const [damagePhotos, setDamagePhotos] = useState<Photo[]>(prefill?.damagePhotos ?? []);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const plateInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);

    // Refs para acessar o estado mais recente no cleanup de unmount
    const photosRef = useRef<Photo[]>([]);
    photosRef.current = photos;
    const damagePhotosRef = useRef<Photo[]>([]);
    damagePhotosRef.current = damagePhotos;

    useEffect(() => {
        return () => {
            photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
            damagePhotosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
        };
    }, []);

    // ─── Sugestão de O.S. de origem (campo Retorno) ───────────────────────────
    type ReturnOriginSuggestion = {
        id: number;
        order_number: string | null;
        external_os_number: string | null;
        service_date: string | null;
        services: string[];
    };

    const [originSuggestion, setOriginSuggestion] = useState<ReturnOriginSuggestion | null>(null);
    const [originLoadingPlate, setOriginLoadingPlate] = useState<string | null>(null);
    const [originConfirmed, setOriginConfirmed] = useState(false);
    const [originChanging, setOriginChanging] = useState(false);
    const [originInputValue, setOriginInputValue] = useState('');

    const scrollToFirstError = useCallback((fieldErrors: Record<string, unknown>) => {
        const fieldOrder = [
            'courtesy_return_set',
            'original_service_order_id',
            'department',
            'service_date',
            'external_os_number',
            'plate',
            'vehicle_model',
            'selected_services',
            'film_entries',
            'notes',
        ];
        for (const field of fieldOrder) {
            if (!(field in fieldErrors)) continue;
            const el = formRef.current?.querySelector(`[data-field="${field}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                break;
            }
        }
    }, []);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        getValues,
        reset,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<QuickCreateFormData>({
        // @hookform/resolvers v5 + zod v4 têm incompatibilidade no genérico Resolver;
        // o cast via unknown para o tipo correto preserva a checagem de tipos do form
        // (mesmo padrão de EditServiceOrderPage).
        resolver: zodResolver(quickCreateSchema) as unknown as Resolver<QuickCreateFormData>,
        defaultValues: {
            department: undefined,
            plate: '',
            vehicle_model: '',
            vehicle_model_id: undefined,
            vehicle_color: '',
            consultant_id: undefined,
            external_os_number: '',
            selected_services: [],
            is_return: false,
            is_courtesy: false,
            courtesy_return_set: false,
            is_galpon: false,
            notes: '',
            service_date: new Date().toISOString().split('T')[0],
            film_entries: [],
            installers: [],
            form_store_id: undefined,
            ...(prefill?.values ?? {}),
        },
    });

    const department         = watch('department');
    const selectedSvcs       = watch('selected_services');
    const isReturn           = watch('is_return');
    const isCourtesy         = watch('is_courtesy');
    const courtesyReturnSet  = watch('courtesy_return_set');
    const isGalpon           = watch('is_galpon');
    const formStoreId  = watch('form_store_id');
    const watchedPlate       = watch('plate');
    const watchedServiceDate = watch('service_date');
    const watchedFilmEntries = watch('film_entries');
    // Campos adicionais assistidos só para compor o snapshot do rascunho local
    // (não usados diretamente no render fora do draft).
    const watchedVehicleModel           = watch('vehicle_model');
    const watchedVehicleModelId         = watch('vehicle_model_id');
    const watchedVehicleColor           = watch('vehicle_color');
    const watchedConsultantId           = watch('consultant_id');
    const watchedExternalOsNumber       = watch('external_os_number');
    const watchedNotes                  = watch('notes');
    const watchedInstallers             = watch('installers');
    const watchedServicePrices          = watch('service_prices');
    const watchedOriginalServiceOrderId = watch('original_service_order_id');

    // Sinaliza "trabalho não salvo" para o auto-update do PWA não recarregar a
    // página no meio de uma O.S. em digitação (fotos são blobs, não sobrevivem
    // ao reload). Considera sujo quando placa, foto ou serviço já foram tocados.
    useEffect(() => {
        const dirty =
            (watchedPlate?.trim().length ?? 0) > 0 ||
            photos.length > 0 ||
            (selectedSvcs?.length ?? 0) > 0;
        if (dirty) markDirty('quick-create-os');
        else markClean('quick-create-os');
        return () => markClean('quick-create-os');
    }, [watchedPlate, photos, selectedSvcs]);

    // Busca sugestão de O.S. de origem quando is_return=true e placa é válida
    useEffect(() => {
        const plate = (watchedPlate ?? '').toUpperCase().trim();
        if (!isReturn || !plate || !isValidPlateOrChassi(plate)) {
            setOriginSuggestion(null);
            setOriginConfirmed(false);
            setOriginChanging(false);
            setOriginInputValue('');
            setValue('original_service_order_id', undefined);
            return;
        }
        if (originConfirmed) return; // já confirmado — não sobrescrever com nova busca
        setOriginLoadingPlate(plate);
        const returnStoreId = formStoreId ?? user?.store_id ?? undefined;
        serviceOrdersService.suggestReturnOrigin(plate, undefined, returnStoreId, department || undefined).then((suggestion) => {
            setOriginSuggestion(suggestion);
            setOriginLoadingPlate(null);
        }).catch(() => {
            setOriginSuggestion(null);
            setOriginLoadingPlate(null);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReturn, watchedPlate, formStoreId, department]);

    // Reúne todos os service_ids selecionados (película ou catálogo)
    const isFilmDeptWatch = department === 'film' || department === 'security_film' || department === 'ppf';
    const duplicateServiceIds: number[] = isFilmDeptWatch
        ? (watchedFilmEntries ?? []).map((e) => e.service_id).filter((id) => id > 0)
        : (selectedSvcs ?? []);

    const { data: duplicateData } = useDuplicateCheck({
        plate: (watchedPlate ?? '').toUpperCase().trim(),
        service_date: watchedServiceDate ?? '',
        department: department ?? '',
        service_ids: duplicateServiceIds,
        is_return: isReturn,
    });

    // Resolve loja: form_store_id (multi-store) ou loja do usuário
    const storeId = formStoreId ?? user?.store_id ?? undefined;
    const currentStore = availableStores.find((s) => s.id === storeId);
    const storeBrandId = currentStore?.brand_id ?? undefined;

    // Serviços disponíveis no nível do modal — usado para validação de preço variável
    // (React Query deduplica a requisição com o ServicePicker)
    const { data: modalServices } = useServices(department, storeBrandId);

    const [priceErrors, setPriceErrors] = useState<Record<number, string>>({});

    // On open: pre-fill form_store_id and force is_galpon for galpon-profile users
    useEffect(() => {
        if (open) {
            if (formStoreId === undefined) {
                const defaultId = user?.store_id ?? availableStores[0]?.id;
                if (defaultId) setValue('form_store_id', defaultId);
            }
            if (isGalponProfile) {
                setValue('is_galpon', true);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ─── Rascunho local (localStorage) ────────────────────────────────────────
    // Snapshot serializável do form para autosave — só texto/seleção, nunca
    // mídia (photos/damagePhotos/videoUrl vivem fora do draft, em useState).
    const draftValue = useMemo<QuickCreateFormData>(() => ({
        department,
        plate: watchedPlate,
        vehicle_model: watchedVehicleModel,
        vehicle_model_id: watchedVehicleModelId,
        vehicle_color: watchedVehicleColor,
        consultant_id: watchedConsultantId,
        external_os_number: watchedExternalOsNumber,
        selected_services: selectedSvcs,
        is_return: isReturn,
        is_courtesy: isCourtesy,
        courtesy_return_set: courtesyReturnSet,
        is_galpon: isGalpon,
        notes: watchedNotes,
        service_date: watchedServiceDate,
        film_entries: watchedFilmEntries,
        installers: watchedInstallers,
        form_store_id: formStoreId,
        service_prices: watchedServicePrices,
        original_service_order_id: watchedOriginalServiceOrderId,
    }), [
        department, watchedPlate, watchedVehicleModel, watchedVehicleModelId,
        watchedVehicleColor, watchedConsultantId, watchedExternalOsNumber,
        selectedSvcs, isReturn, isCourtesy, courtesyReturnSet, isGalpon,
        watchedNotes, watchedServiceDate, watchedFilmEntries, watchedInstallers,
        formStoreId, watchedServicePrices, watchedOriginalServiceOrderId,
    ]);

    const { discard: discardDraft, restored: draftRestored } = useFormDraft<QuickCreateFormData>({
        key: QUICK_CREATE_DRAFT_KEY,
        enabled: open,
        value: draftValue,
        onRestore: (draft) => {
            reset({ ...getValues(), ...draft });
            // O perfil galpão sempre vence sobre o rascunho (mesma regra do
            // efeito acima, reafirmada aqui independente da ordem dos efeitos).
            if (isGalponProfile) setValue('is_galpon', true);
        },
        // Só persiste quando o usuário de fato colocou conteúdo. `isDirty` pega
        // os campos registrados (placa, modelo, cor, nº OS, observações). Vários
        // controles usam `setValue` SEM `shouldDirty` (departamento, serviços,
        // toggles de cortesia/retorno) — checados explicitamente. Exclui o que o
        // efeito de abertura seta como base (loja, galpão, data de hoje) para não
        // gravar uma O.S. intocada e reexibir o banner.
        shouldPersist: (v) =>
            isDirty ||
            v.department !== undefined ||
            (v.selected_services?.length ?? 0) > 0 ||
            (v.film_entries?.length ?? 0) > 0 ||
            (v.installers?.length ?? 0) > 0 ||
            v.is_return ||
            v.is_courtesy ||
            v.courtesy_return_set,
    });

    const { consultants, isLoading: consultantsLoading } = useConsultants(
        storeId ? { store_id: storeId, is_active: true } : undefined,
        1,
        100
    );

    // Vehicle models loaded by brand_id of the selected store
    const { data: vehicleModels, isLoading: modelsLoading } = useVehicleModels(
        storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );

    // Focus plate when modal opens (desktop only — mobile would open keyboard immediately)
    useEffect(() => {
        if (open && !('ontouchstart' in window)) {
            setTimeout(() => plateInputRef.current?.focus(), 100);
        }
    }, [open]);

    const clearOriginState = useCallback(() => {
        setOriginSuggestion(null);
        setOriginConfirmed(false);
        setOriginChanging(false);
        setOriginInputValue('');
        setOriginLoadingPlate(null);
    }, []);

    // Trocar a loja muda a MARCA-base da O.S. de origem: um vínculo já confirmado para
    // a marca anterior deixa de valer e seria descartado silenciosamente no backend.
    // Reseta o estado para forçar nova busca/confirmação (paridade com o mobile).
    const prevStoreRef = useRef(formStoreId);
    useEffect(() => {
        // Só reseta numa troca genuína entre duas lojas reais. A 1ª hidratação
        // (undefined→loja), inclusive a de edição que repõe o vínculo existente,
        // apenas registra a loja — senão apagaria o vínculo restaurado.
        if (prevStoreRef.current == null || prevStoreRef.current === formStoreId) {
            prevStoreRef.current = formStoreId;
            return;
        }
        prevStoreRef.current = formStoreId;
        clearOriginState();
        setValue('original_service_order_id', undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formStoreId]);

    // Trocar o DEPARTAMENTO invalida um vínculo de origem já confirmado (a busca é
    // estrita por departamento). Reseta o estado para forçar nova busca/confirmação.
    const prevReturnDeptRef = useRef(department);
    useEffect(() => {
        if (prevReturnDeptRef.current == null || prevReturnDeptRef.current === department) {
            prevReturnDeptRef.current = department;
            return;
        }
        prevReturnDeptRef.current = department;
        clearOriginState();
        setValue('original_service_order_id', undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [department]);

    // Reset everything on close
    const handleClose = useCallback(() => {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        damagePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
        reset();
        setPhotos([]);
        setDamagePhotos([]);
        setVideoUrl(null);
        clearOriginState();
        onClose();
    }, [reset, onClose, photos, damagePhotos, clearOriginState]);

    // Full reset: clear form and stay open for next OS
    const fullReset = useCallback(() => {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        damagePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
        const currentFormStoreId = formStoreId ?? user?.store_id ?? availableStores[0]?.id;
        reset({
            department: undefined,
            plate: '',
            vehicle_model: '',
            vehicle_model_id: undefined,
            vehicle_color: '',
            consultant_id: undefined,
            external_os_number: '',
            selected_services: [],
            service_prices: {},
            is_return: false,
            is_courtesy: false,
            courtesy_return_set: false,
            is_galpon: isGalponProfile ? true : false,
            notes: '',
            service_date: new Date().toISOString().split('T')[0],
            film_entries: [],
            installers: [],
            form_store_id: currentFormStoreId,
        });
        setPhotos([]);
        setDamagePhotos([]);
        setVideoUrl(null);
        clearOriginState();
        setTimeout(() => plateInputRef.current?.focus(), 50);
    }, [reset, formStoreId, user, availableStores, isGalponProfile, photos, damagePhotos, clearOriginState]);

    // Partial reset: keep dept and store — for "Salvar e Próxima"
    const partialReset = useCallback(
        (savedDept: Department | undefined, savedFormStoreId: number | undefined) => {
            photos.forEach((p) => URL.revokeObjectURL(p.preview));
            damagePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
            reset({
                department: savedDept,
                plate: '',
                vehicle_model: '',
                vehicle_model_id: undefined,
                vehicle_color: '',
                consultant_id: undefined,
                external_os_number: '',
                selected_services: [],
                service_prices: {},
                is_return: false,
                is_courtesy: false,
                courtesy_return_set: false,
                is_galpon: isGalponProfile ? true : false,
                notes: '',
                service_date: new Date().toISOString().split('T')[0],
                film_entries: (savedDept === 'film' || savedDept === 'security_film' || savedDept === 'ppf') ? [{ service_id: 0, tonality: '', roll_code: '', film_roll_id: undefined }] : [],
                installers: [],
                form_store_id: savedFormStoreId,
            });
            setPhotos([]);
            setDamagePhotos([]);
            setVideoUrl(null);
            clearOriginState();
            setTimeout(() => plateInputRef.current?.focus(), 50);
        },
        [reset, isGalponProfile, photos, damagePhotos, clearOriginState]
    );

    // Keep-vehicle reset: preserves plate/car/consultant/store/notes for "Salvar e Outro Depto."
    // Photos are intentionally NOT touched — uploadPhotos() filters !p.url, so already-uploaded
    // photos are reused via their existing URL on the next submit without re-uploading.
    const keepVehicleReset = useCallback(
        (data: QuickCreateFormData) => {
            reset({
                plate: data.plate,
                vehicle_model: data.vehicle_model,
                vehicle_model_id: data.vehicle_model_id,
                vehicle_color: data.vehicle_color,
                consultant_id: data.consultant_id,
                notes: data.notes,
                form_store_id: data.form_store_id,
                is_return: data.is_return,
                is_courtesy: data.is_courtesy,
                service_date: data.service_date,
                is_galpon: isGalponProfile ? true : data.is_galpon,
                courtesy_return_set: true,
                department: undefined,
                external_os_number: '',
                selected_services: [],
                service_prices: {},
                film_entries: [],
                installers: [],
            });
            clearOriginState();
            setPriceErrors({});
            setTimeout(
                () =>
                    formRef.current
                        ?.querySelector('[data-field="department"]')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                50
            );
        },
        [reset, isGalponProfile, clearOriginState]
    );

    const validatePrices = useCallback((): boolean => {
        const servicePrices = getValues('service_prices') ?? {};
        const selectedServices = getValues('selected_services') ?? [];
        const errs: Record<number, string> = {};
        (modalServices ?? [])
            .filter((s) => selectedServices.includes(s.id) && s.has_variable_price)
            .forEach((s) => {
                const price = servicePrices[String(s.id)];
                if (!price || parseFloat(price) <= 0) {
                    errs[s.id] = 'Informe o valor';
                }
            });
        setPriceErrors(errs);
        return Object.keys(errs).length === 0;
    }, [getValues, modalServices]);

    const buildPayload = useCallback(
        (data: QuickCreateFormData, uploadedPhotoUrls: string[], uploadedDamageUrls: string[] = []) => {
            const resolvedStoreId = data.form_store_id ?? storeId ?? 0;
            const resolvedStore = availableStores.find((s) => s.id === resolvedStoreId);

            const notesText = data.notes || undefined;

            const isFilmDept = data.department === 'film' || data.department === 'security_film' || data.department === 'ppf';

            const items = isFilmDept
                ? data.film_entries!.map((e) => ({
                    service_id:   e.service_id,
                    quantity:     1,
                    tonality:     e.tonality,
                    // Retalho (sobra): sem bobina vinculada — nenhum metro é debitado.
                    roll_code:    e.used_scrap ? undefined : (e.roll_code || undefined),
                    film_roll_id: e.used_scrap ? undefined : (e.film_roll_id || undefined),
                    used_scrap:   e.used_scrap || undefined,
                }))
                : data.selected_services.map((id) => ({
                    service_id: id,
                    quantity: 1,
                    unit_price: data.service_prices?.[String(id)] ? parseFloat(data.service_prices[String(id)]) : undefined,
                }));

            const workers = isFilmDept
                ? (data.installers ?? []).map((id) => ({ employee_id: id }))
                : undefined;

            return {
                plate: data.plate.toUpperCase(),
                vehicle_plate: data.plate.toUpperCase(),
                vehicle_model: data.vehicle_model,
                vehicle_model_id: data.vehicle_model_id || undefined,
                vehicle_color: data.vehicle_color || undefined,
                vehicle_year: prefill?.passthrough?.vehicle_year,
                vehicle_brand: prefill?.passthrough?.vehicle_brand,
                department: data.department,
                location_id: resolvedStoreId,
                store_id: resolvedStoreId,
                dealership_id: resolvedStore?.dealership_id ?? prefill?.passthrough?.dealership_id ?? undefined,
                consultant_id: data.consultant_id || undefined,
                external_os_number: (data.department !== 'vn' && data.department !== 'vd' && data.department !== 'vu')
                    ? data.external_os_number || undefined
                    : undefined,
                is_galpon: data.is_galpon,
                is_return: data.is_return,
                is_courtesy: data.is_courtesy,
                original_service_order_id: data.is_return ? (data.original_service_order_id ?? null) : null,
                items,
                workers,
                // Lançamento direto de película já traz instalador + bobina: nasce finalizada
                // (completed), entrando no Desempenho/Fechamento. Demais deptos seguem em Aguardando.
                finalize_on_create: isFilmDept,
                notes: notesText,
                photos: uploadedPhotoUrls,
                damage_photos: uploadedDamageUrls,
                video_url: videoUrl ?? undefined,
                service_date: data.service_date,
            };
        },
        [storeId, availableStores, prefill, videoUrl]
    );

    const uploadPhotos = useCallback(async (): Promise<string[]> => {
        const unuploaded = photos.filter((p) => !p.url);
        if (unuploaded.length === 0) return photos.map((p) => p.url).filter(Boolean) as string[];
        try {
            const results = await uploadService.uploadPhotos(unuploaded);
            const urlMap = new Map(results.map((r) => [r.id, r.url]));
            const updated = photos.map((p) => urlMap.has(p.id) ? { ...p, url: urlMap.get(p.id), uploaded: true } : p);
            setPhotos(updated);
            return updated.map((p) => p.url).filter(Boolean) as string[];
        } catch {
            throw new Error('Falha ao enviar foto. Tente novamente.');
        }
    }, [photos]);

    const uploadDamagePhotos = useCallback(async (): Promise<string[]> => {
        const unuploaded = damagePhotos.filter((p) => !p.url);
        if (unuploaded.length === 0) return damagePhotos.map((p) => p.url).filter(Boolean) as string[];
        try {
            const results = await uploadService.uploadPhotos(unuploaded);
            const urlMap = new Map(results.map((r) => [r.id, r.url]));
            const updated = damagePhotos.map((p) => urlMap.has(p.id) ? { ...p, url: urlMap.get(p.id), uploaded: true } : p);
            setDamagePhotos(updated);
            return updated.map((p) => p.url).filter(Boolean) as string[];
        } catch {
            throw new Error('Falha ao enviar foto de avaria. Tente novamente.');
        }
    }, [damagePhotos]);

    const onSave = handleSubmit(async (rawData) => {
        const data = rawData as QuickCreateFormData;
        if (!validatePrices()) {
            formRef.current?.querySelector('[data-field="selected_services"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        try {
            const [uploadedUrls, damageUrls] = await Promise.all([uploadPhotos(), uploadDamagePhotos()]);
            await createServiceOrder.mutateAsync(buildPayload(data, uploadedUrls, damageUrls));
            toast({ title: 'OS lançada com sucesso!' });
            discardDraft();
            fullReset();
            onClose();
        } catch (err: unknown) {
            toast({ variant: 'destructive', title: 'Erro ao lançar OS', description: getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.') });
        }
    }, scrollToFirstError);

    const onSaveAndNext = handleSubmit(async (rawData) => {
        const data = rawData as QuickCreateFormData;
        const savedDept      = data.department;
        const savedFormStore = data.form_store_id;

        if (!validatePrices()) {
            formRef.current?.querySelector('[data-field="selected_services"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        try {
            const [uploadedUrls, damageUrls] = await Promise.all([uploadPhotos(), uploadDamagePhotos()]);
            await createServiceOrder.mutateAsync(buildPayload(data, uploadedUrls, damageUrls));
            toast({ title: 'OS lançada! Próxima OS...' });
            discardDraft();
            partialReset(savedDept, savedFormStore);
        } catch (err) {
            toast({ variant: 'destructive', title: 'Erro ao lançar OS', description: getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.') });
        }
    }, scrollToFirstError);

    const onSaveAndOtherDept = handleSubmit(async (rawData) => {
        const data = rawData as QuickCreateFormData;
        if (!validatePrices()) {
            formRef.current?.querySelector('[data-field="selected_services"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        try {
            const [uploadedUrls, damageUrls] = await Promise.all([uploadPhotos(), uploadDamagePhotos()]);
            await createServiceOrder.mutateAsync(buildPayload(data, uploadedUrls, damageUrls));
            toast({ title: 'O.S. lançada!', description: 'Escolha o próximo departamento.' });
            discardDraft();
            keepVehicleReset(data);
        } catch (err) {
            toast({ variant: 'destructive', title: 'Erro ao lançar OS', description: getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.') });
        }
    }, scrollToFirstError);

    const isBusy = isSubmitting || createServiceOrder.isPending;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
            <DialogContent
                className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 [&>button:last-child]:hidden"
                aria-describedby={undefined}
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader className="px-6 pt-6 pb-4 border-b">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-lg font-bold">Lançar OS</DialogTitle>
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Fechar"
                            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                        >
                            <X className="h-5 w-5" />
                            <span className="sr-only">Fechar</span>
                        </button>
                    </div>
                </DialogHeader>

                <form ref={formRef} className="px-6 py-4 space-y-5 overflow-x-hidden" onSubmit={(e) => e.preventDefault()}>

                    <DismissibleNotice storageKey="aems_notice_plate_chassi_quickos_v1" title="Novos padrões de placa e chassi">
                        O campo Placa/Chassi agora aceita apenas placa (ABC1234 ou ABC1D23) ou o chassi gravado no vidro
                        (8 caracteres, com letras e números). O chassi completo de 17 caracteres não é mais aceito.
                    </DismissibleNotice>

                    {draftRestored && (
                        <DraftRestoredBanner onDiscard={() => { discardDraft(); fullReset(); }} />
                    )}

                    {/* Row 1: Loja | Cortesia/Retorno + Galpão */}
                    <div className="space-y-3">
                        {/* Loja */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Loja
                            </Label>
                            {availableStores.length === 1 ? (
                                <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm font-medium text-foreground">
                                    {availableStores[0].name}
                                </div>
                            ) : (
                                <Select
                                    value={formStoreId?.toString() ?? ''}
                                    onValueChange={(v) => setValue('form_store_id', v ? Number(v) : undefined)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecionar loja..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableStores.map((s) => (
                                            <SelectItem key={s.id} value={s.id.toString()}>
                                                {s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Cortesia/Retorno + Galpão */}
                        <div className="space-y-1.5" data-field="courtesy_return_set">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Cortesia/Retorno <span className="text-destructive">*</span>
                            </Label>
                            <div className="flex items-center gap-3">
                                <CourtesyReturnSelect
                                    value={{ is_courtesy: isCourtesy, is_return: isReturn }}
                                    isSet={courtesyReturnSet}
                                    error={errors.courtesy_return_set?.message}
                                    onChange={({ is_courtesy, is_return }) => {
                                        setValue('is_courtesy', is_courtesy);
                                        setValue('is_return', is_return);
                                        setValue('courtesy_return_set', true, { shouldValidate: true });
                                    }}
                                />
                                {!hideGalponOption && (
                                    <label
                                        htmlFor="is_galpon"
                                        className={cn(
                                            'flex h-9 items-center gap-2 rounded-md border px-4 select-none text-sm font-medium',
                                            'bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333]',
                                            'hover:bg-[#F5F5F5] dark:hover:bg-[#222222] transition-colors',
                                            isGalpon && 'border-[#F5A800] text-[#F5A800]',
                                            isGalponProfile ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                                        )}
                                    >
                                        <Checkbox
                                            checked={isGalpon}
                                            onCheckedChange={(v) => {
                                                if (!isGalponProfile) setValue('is_galpon', Boolean(v));
                                            }}
                                            id="is_galpon"
                                            disabled={isGalponProfile}
                                            className="border-[#F5A800] data-[state=checked]:bg-[#F5A800] data-[state=checked]:border-[#F5A800]"
                                        />
                                        Galpão
                                    </label>
                                )}
                            </div>
                            {errors.courtesy_return_set && (
                                <p className="text-xs text-destructive">{errors.courtesy_return_set.message}</p>
                            )}
                        </div>
                    </div>

                    {/* O.S. de origem (visível apenas quando is_return = true) */}
                    {isReturn && (
                        <div className="rounded-md border border-[#D1D1D1] dark:border-[#333333] bg-[#FAFAFA] dark:bg-[#181818] p-3 space-y-2" data-field="original_service_order_id">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                <Repeat className="h-3.5 w-3.5" />
                                O.S. de origem
                            </p>

                            {/* Owner pode lançar retorno sem O.S. de origem — observação vira obrigatória */}
                            {isOwner && (
                                <p className="text-xs text-muted-foreground">
                                    Como Proprietário, você pode lançar sem O.S. de origem — informe o motivo na Observação.
                                </p>
                            )}

                            {/* Estado: carregando */}
                            {originLoadingPlate && !originConfirmed && (
                                <p className="text-xs text-muted-foreground">Buscando O.S. original...</p>
                            )}

                            {/* Estado: sugestão disponível e não confirmada */}
                            {!originLoadingPlate && originSuggestion && !originConfirmed && !originChanging && (
                                <div className="space-y-1.5">
                                    <div className="rounded-md bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] px-3 py-2 text-sm">
                                        <p className="font-medium text-[#111111] dark:text-white">
                                            {originSuggestion.order_number ?? `#${originSuggestion.id}`}
                                            {originSuggestion.external_os_number && (
                                                <span className="ml-1.5 text-muted-foreground font-normal">
                                                    ({originSuggestion.external_os_number})
                                                </span>
                                            )}
                                        </p>
                                        {originSuggestion.service_date && (
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(originSuggestion.service_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                            </p>
                                        )}
                                        {originSuggestion.services.length > 0 && (
                                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                                {originSuggestion.services.join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setValue('original_service_order_id', originSuggestion.id);
                                                setOriginConfirmed(true);
                                            }}
                                            className="flex items-center gap-1 rounded-md bg-[#F5A800] px-3 py-1 text-xs font-semibold text-[#111111] hover:bg-[#e09800] transition-colors"
                                        >
                                            <Check className="h-3 w-3" /> Confirmar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOriginChanging(true);
                                                setOriginInputValue('');
                                            }}
                                            className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-3 py-1 text-xs font-semibold text-[#444444] dark:text-zinc-300 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                                        >
                                            Trocar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOriginSuggestion(null);
                                                setValue('original_service_order_id', undefined);
                                            }}
                                            className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-3 py-1 text-xs font-semibold text-[#444444] dark:text-zinc-300 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                                        >
                                            Limpar
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Estado: confirmado */}
                            {originConfirmed && originSuggestion && (
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-sm">
                                        <Check className="h-4 w-4 text-green-600 shrink-0" />
                                        <span className="font-medium text-[#111111] dark:text-white">
                                            {originSuggestion.order_number ?? `#${originSuggestion.id}`}
                                        </span>
                                        {originSuggestion.external_os_number && (
                                            <span className="text-xs text-muted-foreground">({originSuggestion.external_os_number})</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOriginConfirmed(false);
                                            setOriginSuggestion(null);
                                            setValue('original_service_order_id', undefined);
                                        }}
                                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                                        aria-label="Limpar O.S. de origem"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}

                            {/* Estado: trocar — input manual por placa/chassi */}
                            {originChanging && (
                                <div className="space-y-1.5">
                                    <p className="text-xs text-muted-foreground">Informe a placa/chassi da O.S. de origem:</p>
                                    <div className="flex gap-2">
                                        <Input
                                            type="text"
                                            placeholder="Placa/chassi da O.S. de origem"
                                            value={originInputValue}
                                            onChange={(e) => setOriginInputValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                            className="h-8 text-sm font-mono tracking-widest uppercase"
                                            maxLength={17}
                                        />
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const searchPlate = originInputValue.trim() || (watchedPlate ?? '').toUpperCase().trim();
                                                if (!searchPlate) return;
                                                try {
                                                    const suggestion = await serviceOrdersService.suggestReturnOrigin(searchPlate, undefined, storeId, department || undefined);
                                                    if (suggestion) {
                                                        setOriginSuggestion(suggestion);
                                                        setValue('original_service_order_id', suggestion.id);
                                                        setOriginConfirmed(true);
                                                        setOriginChanging(false);
                                                    } else {
                                                        setOriginSuggestion(null);
                                                    }
                                                } catch {
                                                    setOriginSuggestion(null);
                                                }
                                            }}
                                            className="flex items-center gap-1 rounded-md bg-[#F5A800] px-3 py-1 text-xs font-semibold text-[#111111] hover:bg-[#e09800] transition-colors whitespace-nowrap"
                                        >
                                            <Search className="h-3 w-3" /> Buscar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOriginChanging(false);
                                                setOriginInputValue('');
                                            }}
                                            className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-2 py-1 text-xs text-muted-foreground hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    {originInputValue.trim() && !originLoadingPlate && originSuggestion === null && !originConfirmed && (
                                        <p className="text-xs text-muted-foreground">Nenhuma O.S. encontrada para essa placa/chassi.</p>
                                    )}
                                </div>
                            )}

                            {/* Estado: sem sugestão e não está carregando */}
                            {!originLoadingPlate && !originSuggestion && !originConfirmed && !originChanging && (
                                <p className="text-xs text-muted-foreground">
                                    {isValidPlateOrChassi((watchedPlate ?? '').toUpperCase().trim())
                                        ? 'Nenhuma O.S. anterior encontrada para esta placa.'
                                        : 'Informe a placa para buscar a O.S. original.'}
                                </p>
                            )}

                            {errors.original_service_order_id && (
                                <p className="text-xs text-destructive">
                                    {errors.original_service_order_id.message}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Departamento */}
                    <div data-field="department">
                        <DeptToggle
                            value={department}
                            onChange={(v) => {
                                setValue('department', v, { shouldValidate: true });
                                if (v === 'vn' || v === 'vd' || v === 'vu') {
                                    setValue('external_os_number', '');
                                }
                                setValue('selected_services', []);
                                setValue('film_entries', (v === 'film' || v === 'security_film' || v === 'ppf') ? [{ service_id: 0, tonality: '', roll_code: '', film_roll_id: undefined }] : []);
                                setValue('installers', []);
                            }}
                            error={errors.department?.message}
                        />
                    </div>

                    {/* Row: Data do Serviço + Nº OS Concessionária */}
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                        <div className="sm:col-span-3 space-y-1.5" data-field="service_date">
                            <Label htmlFor="service_date" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Data do Serviço <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="service_date"
                                type="date"
                                {...register('service_date')}
                                max={new Date().toISOString().split('T')[0]}
                                className={cn(errors.service_date && 'border-destructive')}
                            />
                            {errors.service_date && (
                                <p className="text-xs text-destructive">{errors.service_date.message}</p>
                            )}
                        </div>

                        {(department !== 'vn' && department !== 'vd' && department !== 'vu') && (
                            <div className="sm:col-span-2 space-y-1.5" data-field="external_os_number">
                                <Label htmlFor="external_os_number" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Nº OS Concessionária <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    id="external_os_number"
                                    {...register('external_os_number')}
                                    placeholder="Ex: 12345"
                                    inputMode="numeric"
                                />
                            </div>
                        )}
                    </div>

                    {/* Row: Placa / Modelo / Cor */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="space-y-1.5" data-field="plate">
                            <Label htmlFor="plate" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Placa / Chassi <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="plate"
                                {...(() => {
                                    const { ref: registerRef, ...rest } = register('plate');
                                    return {
                                        ...rest,
                                        ref: (el: HTMLInputElement | null) => {
                                            registerRef(el);
                                            plateInputRef.current = el;
                                        },
                                    };
                                })()}
                                onChange={(e) =>
                                    setValue('plate', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''), {
                                        shouldValidate: true,
                                    })
                                }
                                placeholder="ABC1D23 ou chassi (8)"
                                maxLength={8}
                                className={cn('font-mono tracking-widest uppercase', errors.plate && 'border-destructive')}
                                aria-invalid={!!errors.plate}
                            />
                            {errors.plate && (
                                <p className="text-xs text-destructive">{errors.plate.message}</p>
                            )}
                        </div>

                        <div className="space-y-1.5" data-field="vehicle_model">
                            <Label htmlFor="vehicle_model" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Modelo <span className="text-destructive">*</span>
                            </Label>
                            {department === 'vu' ? (
                                <Input
                                    id="vehicle_model"
                                    value={watch('vehicle_model')}
                                    onChange={(e) => {
                                        setValue('vehicle_model', e.target.value, { shouldValidate: true });
                                        setValue('vehicle_model_id', undefined);
                                    }}
                                    placeholder="Digite o modelo..."
                                    className={cn('h-10', errors.vehicle_model && 'border-destructive')}
                                />
                            ) : modelsLoading ? (
                                <Skeleton className="h-10 w-full" />
                            ) : (
                                <Select
                                    value={watch('vehicle_model')}
                                    onValueChange={(v) => {
                                        setValue('vehicle_model', v, { shouldValidate: true });
                                        const selected = (vehicleModels ?? []).find((m) => m.name === v);
                                        setValue('vehicle_model_id', selected?.id ?? undefined);
                                    }}
                                >
                                    <SelectTrigger
                                        id="vehicle_model"
                                        className={cn(errors.vehicle_model && 'border-destructive')}
                                    >
                                        <SelectValue placeholder="Selecionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(vehicleModels ?? []).map((m) => (
                                            <SelectItem key={m.id} value={m.name}>
                                                {m.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            {errors.vehicle_model && (
                                <p className="text-xs text-destructive">{errors.vehicle_model.message}</p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="vehicle_color" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Cor <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="vehicle_color"
                                {...register('vehicle_color')}
                                placeholder="Branco"
                            />
                            {errors.vehicle_color && (
                                <p className="text-xs text-destructive">{errors.vehicle_color.message}</p>
                            )}
                        </div>
                    </div>

                    {/* Alerta de duplicidade (não bloqueante) */}
                    <DuplicateAlert result={duplicateData} />

                    {/* Consultor */}
                    <div className="space-y-1.5">
                        <Label htmlFor="consultant_id" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Consultor {!isGalpon && <span className="text-destructive">*</span>}
                        </Label>
                        {consultantsLoading ? (
                            <Skeleton className="h-10 w-full" />
                        ) : (
                            <Select
                                value={watch('consultant_id')?.toString() ?? ''}
                                onValueChange={(v) =>
                                    setValue('consultant_id', v ? Number(v) : undefined, {
                                        shouldValidate: true,
                                    })
                                }
                            >
                                <SelectTrigger id="consultant_id">
                                    <SelectValue placeholder="Selecionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {consultants.map((c) => (
                                        <SelectItem key={c.id} value={c.id.toString()}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {errors.consultant_id && (
                            <p className="text-xs text-destructive mt-1">{errors.consultant_id.message}</p>
                        )}
                    </div>

                    {/* Serviços / Películas */}
                    {(department === 'film' || department === 'security_film' || department === 'ppf')
                        ? (
                            <div data-field="film_entries">
                                <FilmPicker
                                    storeId={storeId ?? 0}
                                    brandId={storeBrandId}
                                    department={department}
                                    selectedEntries={watch('film_entries') ?? [{ service_id: 0, tonality: '', roll_code: '', film_roll_id: undefined }]}
                                    onChange={(entries) => setValue('film_entries', entries)}
                                    installers={watch('installers') ?? []}
                                    onInstallersChange={(ids) => setValue('installers', ids)}
                                    error={errors.film_entries?.message}
                                    rollCodeErrors={
                                        Array.isArray(errors.film_entries)
                                            ? Object.fromEntries(
                                                (errors.film_entries as Array<{ film_roll_id?: { message?: string } } | undefined>)
                                                    .map((e, i) => [i, e?.film_roll_id?.message])
                                                    .filter(([, msg]) => msg != null) as [number, string][]
                                              )
                                            : undefined
                                    }
                                    isGalpon={isGalpon}
                                />
                                {errors.installers && (
                                    <p className="text-xs text-destructive mt-1">
                                        {(errors.installers as { message?: string }).message ?? 'Selecione pelo menos 1 instalador'}
                                    </p>
                                )}
                            </div>
                        )
                        : (
                            <div data-field="selected_services">
                                <ServicePicker
                                    department={department}
                                    brandId={storeBrandId}
                                    selectedIds={selectedSvcs}
                                    onChange={(ids) => setValue('selected_services', ids, { shouldValidate: true })}
                                    error={errors.selected_services?.message}
                                    isCourtesy={isCourtesy}
                                    prices={Object.fromEntries(
                                        Object.entries(watch('service_prices') ?? {}).map(([k, v]) => [Number(k), v])
                                    )}
                                    onPriceChange={(id, price) => {
                                        const current = watch('service_prices') ?? {};
                                        setValue('service_prices', { ...current, [String(id)]: price });
                                        if (priceErrors[id]) setPriceErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
                                    }}
                                    priceErrors={priceErrors}
                                />
                            </div>
                        )
                    }

                    {/* Fotos */}
                    <div className="flex flex-wrap gap-6">
                        <CompactPhotoUploader photos={photos} onChange={setPhotos} label="Foto da OS" />
                        <CompactPhotoUploader photos={damagePhotos} onChange={setDamagePhotos} label="Foto de Avaria" />
                    </div>

                    {/* Vídeo */}
                    <div className="space-y-1">
                        <span className="text-xs font-medium uppercase text-muted-foreground">Vídeo da OS</span>
                        <VideoCapture videoUrl={videoUrl} onChange={setVideoUrl} />
                    </div>

                    {/* Observações */}
                    <div className="space-y-1.5" data-field="notes">
                        <Label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Observações
                            {isReturn && isOwner && !watchedOriginalServiceOrderId && (
                                <span className="text-destructive"> *</span>
                            )}
                        </Label>
                        <Textarea
                            id="notes"
                            {...register('notes')}
                            placeholder="Informações adicionais..."
                            rows={2}
                            className={cn(
                                'resize-none bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]',
                                errors.notes && 'border-destructive'
                            )}
                        />
                        {errors.notes && (
                            <p className="text-xs text-destructive">{errors.notes.message}</p>
                        )}
                    </div>
                </form>

                {/* Footer actions */}
                <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 px-6 py-4 border-t bg-gray-50/80 dark:bg-zinc-900/50">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onSaveAndOtherDept}
                        disabled={isBusy}
                        className="w-full sm:w-auto border-[#F5A800] text-[#E89200] hover:bg-[#F5A800]/10 gap-1.5"
                        title="Salva esta O.S. e mantém os dados do carro para lançar em outro departamento"
                    >
                        <Repeat className="h-4 w-4" />
                        {isBusy ? 'Salvando...' : 'Salvar e Outro Depto.'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onSave}
                        disabled={isBusy}
                        className="w-full sm:w-auto border-[#F5A800] text-[#E89200] hover:bg-[#F5A800]/10"
                        title="Salva a O.S. e fecha"
                    >
                        {isBusy ? 'Salvando...' : 'Salvar'}
                    </Button>
                    <Button
                        type="button"
                        onClick={onSaveAndNext}
                        disabled={isBusy}
                        className="w-full sm:w-auto bg-[#F5A800] hover:bg-[#E89200] text-[#111111] font-semibold gap-1.5"
                        title="Salva e limpa o formulário para o próximo carro (mesmo departamento)"
                    >
                        {isBusy ? 'Salvando...' : (
                            <>
                                Salvar e Próxima
                                <ChevronRight className="h-4 w-4" />
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
