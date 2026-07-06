import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiErrorMessage } from '@/lib/api-error';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
import type { Department } from '@/types/service-order.types';
import { CourtesyReturnSelect } from './CourtesyReturnSelect';
import { ServiceCodeCombobox } from './ServiceCodeCombobox';
import type { Photo } from '@/types/photo.types';
import { CameraCapture } from '@/components/common/CameraCapture';
import { compressImage } from '@/utils/imageCompression';
import { validateImageFile } from '@/utils/fileValidation';
import { generateId } from '@/utils/generateId';
import { isValidPlateOrChassi, PLATE_ERROR_MESSAGE } from '@/utils/plate';
import { DismissibleNotice } from '@/components/common/DismissibleNotice';
import { DuplicateAlert } from './DuplicateAlert';
import { useDuplicateCheck } from '@/hooks/useDuplicateCheck';
import { logger } from '@/lib/logger';
import { uploadService } from '@/services/api/upload.service';
import { inventoryService } from '@/services/api/inventory.service';
import type { FilmRoll, FilmType } from '@/services/api/inventory.service';
import {
    Camera,
    ImageIcon,
    X,
    Check,
    ChevronsUpDown,
    ChevronDown,
    ChevronRight,
    Search,
} from 'lucide-react';

// ─── Zod schema ───────────────────────────────────────────────────────────────
const schema = z.object({
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
    })).optional(),
    installers: z.array(z.number()).optional(),
    form_store_id: z.number().optional(),
    service_prices: z.record(z.string(), z.string()).optional(),
}).superRefine((data, ctx) => {
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
                if (isRollRequiredDept && !entry.film_roll_id) {
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
});

type QuickCreateFormData = z.infer<typeof schema>;

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
}

export function ServicePicker({ department, brandId, selectedIds, onChange, error, prices, onPriceChange, priceErrors, isCourtesy = false }: ServicePickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const { data: services, isLoading } = useServices(department, brandId);

    const filtered = (services ?? [])
        .filter((s) => isCourtesy || !s.is_courtesy_only)
        .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

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

    const selectedNames = selectedIds
        .map((id) => services?.find((s) => s.id === id)?.name)
        .filter(Boolean) as string[];

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
                    ) : filtered.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground text-center">
                            Nenhum serviço encontrado
                        </p>
                    ) : (
                        <ScrollArea className="h-[240px]">
                            <div className="p-1">
                                {filtered.map((svc) => (
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
                                        <span className="text-sm">{svc.code ? `${svc.code} - ${svc.name}` : svc.name}</span>
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

// ─── Sub-component: FilmPicker ────────────────────────────────────────────────
export interface FilmEntry {
    service_id: number;
    service_name?: string;
    tonality: string;
    roll_code?: string;
    film_roll_id?: number;
    film_type_id?: number;
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
        queryKey: ['film-types-ppf'],
        queryFn: () => inventoryService.listFilmTypes({ department: 'ppf', limit: 100 }),
        enabled: department === 'ppf',
        staleTime: 1000 * 60 * 5,
    });
    const ppfBrands: FilmType[] = ppfBrandsData?.items ?? [];

    // Tipos de película do departamento (film ou security_film) — usados para cruzar service_code → film_type_id
    const { data: filmFilmTypesData } = useQuery({
        queryKey: ['film-types-for-os', department],
        queryFn: () => inventoryService.listFilmTypes({ department: department as 'film' | 'security_film', limit: 100 }),
        enabled: department === 'film' || department === 'security_film',
        staleTime: 1000 * 60 * 5,
    });
    const filmFilmTypes: FilmType[] = filmFilmTypesData?.items ?? [];

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
            const [stock, inUse] = await Promise.all([
                inventoryService.listRolls({ ...rollParams, status: 'em_estoque', department: 'ppf', include_roll_ids: includeIds, limit: 200 }),
                inventoryService.listRolls({ ...rollParams, status: 'em_uso', department: 'ppf', include_roll_ids: includeIds, limit: 200 }),
            ]);
            return [...stock.items, ...inUse.items] as FilmRoll[];
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
            const [stock, inUse] = await Promise.all([
                inventoryService.listRolls({ ...rollParams, status: 'em_estoque', department: department as 'film' | 'security_film', include_roll_ids: includeIds, limit: 200 }),
                inventoryService.listRolls({ ...rollParams, status: 'em_uso', department: department as 'film' | 'security_film', include_roll_ids: includeIds, limit: 200 }),
            ]);
            return [...stock.items, ...inUse.items] as FilmRoll[];
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
                (r) => r.film_type_id === brandId || r.id === selectedRollId
            );
        },
        [selectedEntries, allPpfRolls]
    );

    const getFilmRollsForEntry = useCallback(
        (index: number) => {
            const entry = selectedEntries[index];
            const tonality = entry?.tonality;
            const selectedRollId = entry?.film_roll_id;

            // Filtrar por tonalidade, mas nunca remover a bobina já selecionada da entry
            let rolls = tonality
                ? allFilmRolls.filter((r) => r.tonality === tonality || r.id === selectedRollId)
                : allFilmRolls;

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
                    ? { ...entry, film_roll_id: roll?.id, roll_code: roll?.visual_id ?? '' }
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
                    ? { ...entry, film_roll_id: roll?.id, roll_code: roll?.visual_id ?? '' }
                    : entry
            );
            onChange(updated);
        },
        [selectedEntries, allPpfRolls, onChange]
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
                                        <Select
                                            value={entry.film_roll_id?.toString() ?? ''}
                                            onValueChange={(v) => selectPpfRoll(index, v)}
                                            disabled={!entry.film_type_id}
                                        >
                                            <SelectTrigger className={cn('h-10', rollCodeErrors?.[index] && 'border-destructive')}>
                                                <SelectValue placeholder="Selecionar bobina" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {getPpfRollsForEntry(index).length === 0 ? (
                                                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                        {entry.film_type_id ? 'Nenhuma bobina disponível' : 'Selecione a marca primeiro'}
                                                    </div>
                                                ) : (
                                                    getPpfRollsForEntry(index).map((roll) => (
                                                        <SelectItem key={roll.id} value={roll.id.toString()}>
                                                            {roll.visual_id} — {roll.remaining_meters.toFixed(1)}m
                                                            {roll.status === 'em_uso' && (
                                                                <span className="ml-1 text-xs text-amber-600">(em uso)</span>
                                                            )}
                                                            {roll.status === 'esgotada' && (
                                                                <span className="ml-1 text-xs text-red-600 dark:text-red-400">(esgotada)</span>
                                                            )}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {rollCodeErrors?.[index] && (
                                        <p className="text-xs text-destructive">{rollCodeErrors[index]}</p>
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
                                        {getTonalityOptions({ serviceCode: (services ?? []).find(s => s.id === entry.service_id)?.code, department }).map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <div className="space-y-1">
                                    {filmRollsLoading ? (
                                        <Skeleton className="h-10 w-full" />
                                    ) : (
                                        <Select
                                            value={entry.film_roll_id?.toString() ?? ''}
                                            onValueChange={(v) => selectFilmRoll(index, v)}
                                            disabled={!entry.tonality}
                                        >
                                            <SelectTrigger className={cn('h-10', rollCodeErrors?.[index] && 'border-destructive')}>
                                                <SelectValue placeholder="Selecionar bobina" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {getFilmRollsForEntry(index).length === 0 ? (
                                                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                        {entry.tonality ? 'Nenhuma bobina disponível' : 'Selecione a tonalidade primeiro'}
                                                    </div>
                                                ) : (
                                                    getFilmRollsForEntry(index).map((roll) => (
                                                        <SelectItem key={roll.id} value={roll.id.toString()}>
                                                            {roll.visual_id} — {roll.remaining_meters.toFixed(1)}m
                                                            {roll.status === 'em_uso' && (
                                                                <span className="ml-1 text-xs text-amber-600">(em uso)</span>
                                                            )}
                                                            {roll.status === 'esgotada' && (
                                                                <span className="ml-1 text-xs text-red-600 dark:text-red-400">(esgotada)</span>
                                                            )}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {rollCodeErrors?.[index] && (
                                        <p className="text-xs text-destructive">{rollCodeErrors[index]}</p>
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
}

export function QuickCreateModal({ open, onClose }: QuickCreateModalProps) {
    const user = useAuthStore((s) => s.user);
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    const isGalponProfile = effectivePermissions?.is_galpon_profile === true;
    const hideGalponOption = !isGalponProfile && effectivePermissions?.hide_galpon_option === true;
    const { availableStores, selectedStoreId } = useStoreStore();
    const createServiceOrder = useCreateServiceOrder();

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [damagePhotos, setDamagePhotos] = useState<Photo[]>([]);
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

    const scrollToFirstError = useCallback((fieldErrors: Record<string, unknown>) => {
        const fieldOrder = [
            'courtesy_return_set',
            'department',
            'service_date',
            'external_os_number',
            'plate',
            'vehicle_model',
            'selected_services',
            'film_entries',
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
        formState: { errors, isSubmitting },
    } = useForm<QuickCreateFormData>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(schema) as any,
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

    // Resolve loja: form_store_id (multi-store) or selectedStoreId/user's store
    const storeId = formStoreId ?? selectedStoreId ?? user?.store_id ?? undefined;
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
                const defaultId = selectedStoreId ?? user?.store_id ?? availableStores[0]?.id;
                if (defaultId) setValue('form_store_id', defaultId);
            }
            if (isGalponProfile) {
                setValue('is_galpon', true);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
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

    // Reset everything on close
    const handleClose = useCallback(() => {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        damagePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
        reset();
        setPhotos([]);
        setDamagePhotos([]);
        onClose();
    }, [reset, onClose, photos, damagePhotos]);

    // Full reset: clear form and stay open for next OS
    const fullReset = useCallback(() => {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        damagePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
        const currentFormStoreId = formStoreId ?? selectedStoreId ?? user?.store_id ?? availableStores[0]?.id;
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
        setTimeout(() => plateInputRef.current?.focus(), 50);
    }, [reset, formStoreId, selectedStoreId, user, availableStores, isGalponProfile, photos, damagePhotos]);

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
            setTimeout(() => plateInputRef.current?.focus(), 50);
        },
        [reset, isGalponProfile, photos, damagePhotos]
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
                    roll_code:    e.roll_code || undefined,
                    film_roll_id: e.film_roll_id || undefined,
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
                department: data.department,
                location_id: resolvedStoreId,
                store_id: resolvedStoreId,
                dealership_id: resolvedStore?.dealership_id || undefined,
                consultant_id: data.consultant_id || undefined,
                external_os_number: (data.department !== 'vn' && data.department !== 'vd' && data.department !== 'vu')
                    ? data.external_os_number || undefined
                    : undefined,
                is_galpon: data.is_galpon,
                is_return: data.is_return,
                is_courtesy: data.is_courtesy,
                items,
                workers,
                notes: notesText,
                photos: uploadedPhotoUrls,
                damage_photos: uploadedDamageUrls,
                service_date: data.service_date,
            };
        },
        [storeId, availableStores]
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
            partialReset(savedDept, savedFormStore);
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

                    {/* Observações */}
                    <div className="space-y-1.5">
                        <Label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Observações
                        </Label>
                        <Textarea
                            id="notes"
                            {...register('notes')}
                            placeholder="Informações adicionais..."
                            rows={2}
                            className="resize-none bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                        />
                    </div>
                </form>

                {/* Footer actions */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-gray-50/80 dark:bg-zinc-900/50">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onSave}
                        disabled={isBusy}
                        className="border-[#F5A800] text-[#E89200] hover:bg-[#F5A800]/10"
                    >
                        {isBusy ? 'Salvando...' : 'Salvar'}
                    </Button>
                    <Button
                        type="button"
                        onClick={onSaveAndNext}
                        disabled={isBusy}
                        className="bg-[#F5A800] hover:bg-[#E89200] text-[#111111] font-semibold gap-1.5"
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
