import { useEffect, useMemo, useRef } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Film, Wrench } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { inventoryService } from '@/services/api/inventory.service';
import type { FilmType } from '@/services/api/inventory.service';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useEmployeesByStore } from '@/hooks/useEmployees';
import { useCreateMaterialRequest, useUpdateMaterialRequest } from '@/hooks/useMaterialRequests';
import { getLocalDateISO } from '@/utils/date';
import type {
    MaterialRequest,
    MaterialRequestCreate,
    MaterialRequestUpdate,
    MaterialRequestFilmItem,
} from '@/types/materialRequest.types';

// Cargos que NÃO recebem ferramentas (não aparecem no dropdown de vínculo).
const _normalizeCargo = (s: string) => s.toLowerCase().trim();

const EXCLUDED_CARGOS = new Set(
    [
        'Supervisor',
        'Jovem Aprendiz',
        'Auxiliar Administrativo',
        'Assistente Administrativo',
        'Promotor de Vendas',
    ].map(_normalizeCargo)
);

// ─── Zod schema ──────────────────────────────────────────────────────────────

const filmLineSchema = z.object({
    film_type_id: z.number({ error: 'Selecione um tipo de película' }).min(1, 'Selecione um tipo de película'),
    // Tonalidade é obrigatória apenas para tipos que possuem tonalidades (film);
    // PPF não tem tonalidade → validação condicional no superRefine do form.
    tonality: z.string().optional(),
    // Data de recebimento por bobina; se vazia, o backend usa a data do pedido.
    receipt_date: z.string().optional(),
    total_meters: z.number({ error: 'Informe os metros' }).positive('Deve ser > 0'),
    supplier_id: z.number({ error: 'Selecione o fornecedor' }).min(1, 'Selecione o fornecedor'),
    nfe_number: z.string({ error: 'Informe a nota fiscal' }).min(1, 'Informe a nota fiscal'),
    cost: z
        .string({ error: 'Informe o custo' })
        .min(1, 'Informe o custo')
        .refine((v) => Number(v) > 0, 'Custo deve ser > 0'),
    lot_number: z.string().max(100, 'Máximo de 100 caracteres').optional(),
    // Presente apenas em linhas de edição vindas de uma bobina já existente.
    film_roll_id: z.number().nullable().optional(),
});

const toolLineSchema = z.object({
    name: z.string().min(1, 'Nome obrigatório'),
    quantity: z.number({ error: 'Informe a quantidade' }).int().positive('Deve ser > 0'),
    notes: z.string().nullable().optional(),
    // Funcionário destinatário (opcional). Preenchido → gera card de recebimento.
    employee_id: z.number().nullable().optional(),
    nfe_number: z.string({ error: 'Informe a nota fiscal' }).min(1, 'Informe a nota fiscal'),
    cost: z
        .string({ error: 'Informe o custo' })
        .min(1, 'Informe o custo')
        .refine((v) => Number(v) > 0, 'Custo deve ser > 0'),
});

const baseSchema = z
    .object({
        store_id: z.number({ error: 'Selecione uma loja' }).min(1, 'Selecione uma loja'),
        request_date: z.string().min(1, 'Data obrigatória'),
        notes: z.string().nullable().optional(),
        is_galpon: z.boolean().optional(),
        film_lines: z.array(filmLineSchema),
        tool_lines: z.array(toolLineSchema),
    })
    .refine(
        (data) => data.film_lines.length > 0 || data.tool_lines.length > 0,
        {
            message: 'Adicione ao menos 1 película ou 1 ferramenta/insumo.',
            path: ['film_lines'],
        }
    );

type FormData = z.infer<typeof baseSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface MaterialRequestDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Available stores for the store dropdown */
    stores: { id: number; name: string }[];
    /** Pedido em edição. Quando presente, o diálogo opera em modo de edição. */
    editing?: MaterialRequest | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MaterialRequestDialog({ open, onOpenChange, stores, editing }: MaterialRequestDialogProps) {
    const isEditing = !!editing;
    const createMutation = useCreateMaterialRequest();
    const updateMutation = useUpdateMaterialRequest();

    const today = getLocalDateISO();

    // Ref sempre com os tipos de película atuais, lido na validação condicional
    // (tonalidade obrigatória só quando o tipo possui tonalidades; PPF fica livre).
    const filmTypesRef = useRef<FilmType[]>([]);

    const formSchema = useMemo(
        () =>
            baseSchema.superRefine((data, ctx) => {
                data.film_lines.forEach((fl, idx) => {
                    const ft = filmTypesRef.current.find((t) => t.id === fl.film_type_id);
                    const hasTonalities = (ft?.available_tonalities?.length ?? 0) > 0;
                    if (hasTonalities && !fl.tonality) {
                        ctx.addIssue({
                            code: 'custom',
                            message: 'Selecione a tonalidade',
                            path: ['film_lines', idx, 'tonality'],
                        });
                    }
                });
            }),
        []
    );

    const {
        register,
        handleSubmit,
        control,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            store_id: undefined,
            request_date: today,
            notes: '',
            is_galpon: false,
            film_lines: [],
            tool_lines: [],
        },
    });

    const {
        fields: filmFields,
        append: appendFilm,
        remove: removeFilm,
    } = useFieldArray({ control, name: 'film_lines' });

    const {
        fields: toolFields,
        append: appendTool,
        remove: removeTool,
    } = useFieldArray({ control, name: 'tool_lines' });

    // Reset form on open (create ou pré-preenchimento em edição)
    useEffect(() => {
        if (!open) return;

        if (isEditing && editing) {
            reset({
                store_id: editing.store_id,
                request_date: editing.request_date,
                notes: editing.notes ?? '',
                is_galpon: editing.is_galpon,
                film_lines: editing.film_items.map((it) => ({
                    film_roll_id: it.film_roll_id,
                    film_type_id: it.film_type_id,
                    tonality: it.tonality ?? '',
                    receipt_date: it.receipt_date ?? '',
                    total_meters: it.total_meters,
                    supplier_id: it.supplier_id ?? 0,
                    nfe_number: it.nfe_number ?? '',
                    cost: it.cost ?? '',
                    lot_number: it.lot_number ?? '',
                })),
                tool_lines: editing.tool_items.map((it) => ({
                    name: it.name,
                    quantity: it.quantity,
                    notes: it.notes ?? null,
                    employee_id: it.employee_id ?? null,
                    nfe_number: it.nfe_number ?? '',
                    cost: it.cost ?? '',
                })),
            });
            return;
        }

        reset({
            store_id: stores.length === 1 ? stores[0].id : undefined,
            request_date: today,
            notes: '',
            is_galpon: false,
            film_lines: [],
            tool_lines: [],
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editing]);

    // Film types query (reference data — no inventory permission required)
    const { data: filmTypesData } = useQuery({
        queryKey: ['film-types', 'all', 200],
        queryFn: () => inventoryService.listFilmTypes({ limit: 200 }),
        staleTime: 1000 * 60 * 10,
        enabled: open,
    });
    const filmTypes = filmTypesData?.items ?? [];
    filmTypesRef.current = filmTypes;

    // Fornecedores cadastrados (ativos) para o dropdown
    const { data: suppliersData } = useSuppliers();
    const suppliers = suppliersData?.items ?? [];

    const watchedFilmLines = watch('film_lines');
    const watchedStoreId = watch('store_id');

    // Bobinas de origem por film_roll_id (modo edição) — usadas para travar
    // tipo/metros/remoção de bobinas já consumidas em carros.
    const filmRollMap = useMemo(() => {
        const m = new Map<number, MaterialRequestFilmItem>();
        (editing?.film_items ?? []).forEach((it) => {
            m.set(it.film_roll_id, it);
        });
        return m;
    }, [editing]);

    // Funcionários da loja do pedido — para vincular ferramentas (gera card de
    // recebimento no Controle de EPIs).
    const { data: employeesData } = useEmployeesByStore(
        open && watchedStoreId ? watchedStoreId : undefined
    );
    // Só funcionários cuja LOJA DO CADASTRO é a loja escolhida (volantes de
    // outras lojas — que o backend inclui para O.S. — não entram aqui) e que não
    // sejam de cargos administrativos/vendas.
    const employees = (employeesData ?? []).filter(
        (e) =>
            e.store_id === watchedStoreId &&
            (!e.position || !EXCLUDED_CARGOS.has(_normalizeCargo(e.position)))
    );

    const onSubmit = (data: FormData) => {
        if (isEditing && editing) {
            const payload: MaterialRequestUpdate = {
                request_date: data.request_date,
                notes: data.notes || null,
                is_galpon: data.is_galpon ?? false,
                film_lines: data.film_lines.map((fl) => ({
                    film_roll_id: fl.film_roll_id ?? undefined,
                    film_type_id: fl.film_type_id,
                    tonality: fl.tonality || null,
                    receipt_date: fl.receipt_date || null,
                    total_meters: fl.total_meters,
                    supplier_id: fl.supplier_id,
                    nfe_number: fl.nfe_number,
                    cost: fl.cost,
                    lot_number: fl.lot_number?.trim() || null,
                })),
                tool_lines: data.tool_lines.map((tl) => ({
                    name: tl.name,
                    quantity: tl.quantity,
                    notes: tl.notes || null,
                    employee_id: tl.employee_id ?? null,
                    nfe_number: tl.nfe_number,
                    cost: tl.cost,
                })),
            };

            updateMutation.mutate(
                { id: editing.id, payload },
                { onSuccess: () => onOpenChange(false) }
            );
            return;
        }

        const payload: MaterialRequestCreate = {
            store_id: data.store_id,
            request_date: data.request_date,
            notes: data.notes || null,
            is_galpon: data.is_galpon ?? false,
            film_lines: data.film_lines.map((fl) => ({
                film_type_id: fl.film_type_id,
                tonality: fl.tonality || null,
                receipt_date: fl.receipt_date || null,
                total_meters: fl.total_meters,
                supplier_id: fl.supplier_id,
                nfe_number: fl.nfe_number,
                cost: fl.cost,
                lot_number: fl.lot_number?.trim() || null,
            })),
            tool_lines: data.tool_lines.map((tl) => ({
                name: tl.name,
                quantity: tl.quantity,
                notes: tl.notes || null,
                employee_id: tl.employee_id ?? null,
                nfe_number: tl.nfe_number,
                cost: tl.cost,
            })),
        };

        createMutation.mutate(payload, {
            onSuccess: () => onOpenChange(false),
        });
    };

    const isSaving = isEditing ? updateMutation.isPending : createMutation.isPending;

    // Root-level error (at least one line required)
    const rootError = errors.film_lines?.root?.message ?? (errors.film_lines as { message?: string } | undefined)?.message;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl w-full flex flex-col max-h-[90vh] p-0 gap-0">
                <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
                    <DialogTitle>
                        {isEditing ? 'Editar Pedido de Material' : 'Novo Pedido de Material'}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

                        {/* Loja + Data */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="mr-store">
                                    Loja <span className="text-red-500">*</span>
                                </Label>
                                <Controller
                                    control={control}
                                    name="store_id"
                                    render={({ field }) => (
                                        <Select
                                            value={field.value ? String(field.value) : ''}
                                            onValueChange={(v) => field.onChange(Number(v))}
                                            disabled={isEditing}
                                        >
                                            <SelectTrigger
                                                id="mr-store"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white"
                                            >
                                                <SelectValue placeholder="Selecione a loja" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {stores.map((s) => (
                                                    <SelectItem key={s.id} value={String(s.id)}>
                                                        {s.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                {errors.store_id && (
                                    <p className="text-xs text-red-500">{errors.store_id.message}</p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="mr-date">
                                    Data <span className="text-red-500">*</span>
                                </Label>
                                <input
                                    id="mr-date"
                                    type="date"
                                    {...register('request_date')}
                                    className="h-9 w-full rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                                />
                                {errors.request_date && (
                                    <p className="text-xs text-red-500">{errors.request_date.message}</p>
                                )}
                            </div>
                        </div>

                        {/* Observação */}
                        <div className="space-y-1.5">
                            <Label htmlFor="mr-notes">Observações</Label>
                            <Textarea
                                id="mr-notes"
                                {...register('notes')}
                                placeholder="Observações gerais sobre o pedido..."
                                rows={2}
                                className="resize-none border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] text-[#111111] dark:text-white"
                            />
                        </div>

                        {/* Erro global de "ao menos 1 linha" */}
                        {rootError && (
                            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
                                {rootError}
                            </p>
                        )}

                        {/* ── Linhas de Película ── */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Film className="h-4 w-4 text-amber-600" />
                                    <span className="text-sm font-semibold text-[#111111] dark:text-white">
                                        Películas
                                    </span>
                                    {filmFields.length > 0 && (
                                        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                                            {filmFields.length}
                                        </span>
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        appendFilm({
                                            film_type_id: 0,
                                            tonality: '',
                                            receipt_date: today,
                                            total_meters: 0,
                                            supplier_id: 0,
                                            nfe_number: '',
                                            cost: '',
                                            lot_number: '',
                                        })
                                    }
                                    className="h-7 text-xs gap-1"
                                >
                                    <Plus className="h-3 w-3" />
                                    Adicionar película
                                </Button>
                            </div>

                            {filmFields.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic pl-1">
                                    Nenhuma película adicionada.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {filmFields.map((field, idx) => {
                                        const selectedFilmTypeId = watchedFilmLines[idx]?.film_type_id;
                                        const selectedFilmType = filmTypes.find(
                                            (ft) => ft.id === selectedFilmTypeId
                                        );
                                        const tonalities = selectedFilmType?.available_tonalities ?? [];

                                        // Bobina já usada em carros (modo edição): trava tipo/metros/remoção.
                                        const lineRollId = watchedFilmLines[idx]?.film_roll_id;
                                        const rollInfo = lineRollId ? filmRollMap.get(lineRollId) : undefined;
                                        const isConsumed = !!rollInfo && rollInfo.remaining_meters < rollInfo.total_meters;

                                        return (
                                            <div
                                                key={field.id}
                                                className="border border-[#E8E8E8] dark:border-[#333333] rounded-lg p-3 space-y-3 bg-gray-50/50 dark:bg-zinc-800/30"
                                            >
                                                {/* Row 1: tipo + tonalidade + metros + remove */}
                                                <div className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-start">
                                                    {/* Tipo */}
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Tipo *
                                                        </Label>
                                                        <Controller
                                                            control={control}
                                                            name={`film_lines.${idx}.film_type_id`}
                                                            render={({ field: f }) => (
                                                                <Select
                                                                    value={f.value ? String(f.value) : ''}
                                                                    onValueChange={(v) => {
                                                                        f.onChange(Number(v));
                                                                        // Reset tonality when type changes
                                                                        setValue(`film_lines.${idx}.tonality`, '');
                                                                    }}
                                                                    disabled={isConsumed}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#1A1A1A]">
                                                                        <SelectValue placeholder="Selecione..." />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {filmTypes.map((ft) => (
                                                                            <SelectItem key={ft.id} value={String(ft.id)}>
                                                                                {ft.name}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        />
                                                        {errors.film_lines?.[idx]?.film_type_id && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.film_type_id?.message}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Tonalidade */}
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Tonalidade{tonalities.length > 0 ? ' *' : ''}
                                                        </Label>
                                                        <Controller
                                                            control={control}
                                                            name={`film_lines.${idx}.tonality`}
                                                            render={({ field: f }) => (
                                                                <Select
                                                                    value={f.value || ''}
                                                                    onValueChange={(v) => f.onChange(v)}
                                                                    disabled={tonalities.length === 0}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#1A1A1A]">
                                                                        <SelectValue placeholder={tonalities.length === 0 ? 'N/A (PPF)' : 'Selecione...'} />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {tonalities.map((t) => (
                                                                            <SelectItem key={t} value={t}>
                                                                                {t}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        />
                                                        {errors.film_lines?.[idx]?.tonality && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.tonality?.message}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Metros */}
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Metros *
                                                        </Label>
                                                        <Input
                                                            type="number"
                                                            step="0.1"
                                                            min="0.1"
                                                            disabled={isConsumed}
                                                            {...register(`film_lines.${idx}.total_meters`, {
                                                                valueAsNumber: true,
                                                            })}
                                                            className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                            placeholder="Ex: 50"
                                                        />
                                                        {errors.film_lines?.[idx]?.total_meters && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.total_meters?.message}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Remove button */}
                                                    <div className="pt-5">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => removeFilm(idx)}
                                                            disabled={isConsumed}
                                                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:hover:bg-transparent"
                                                            aria-label="Remover linha de película"
                                                            title={
                                                                isConsumed
                                                                    ? 'Bobina já usada — não pode ser removida'
                                                                    : undefined
                                                            }
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {isConsumed && (
                                                    <p className="text-xs text-amber-600 dark:text-amber-500">
                                                        Bobina já usada em carros — tipo e metros travados.
                                                    </p>
                                                )}

                                                {/* Row 2: fornecedor, NF, custo (todos obrigatórios), data recebimento e lote (opcionais) */}
                                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Fornecedor *
                                                        </Label>
                                                        <Controller
                                                            control={control}
                                                            name={`film_lines.${idx}.supplier_id`}
                                                            render={({ field: f }) => (
                                                                <Select
                                                                    value={f.value ? String(f.value) : ''}
                                                                    onValueChange={(v) => f.onChange(Number(v))}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#1A1A1A]">
                                                                        <SelectValue placeholder="Selecione..." />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {suppliers.map((s) => (
                                                                            <SelectItem key={s.id} value={String(s.id)}>
                                                                                {s.company_name}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        />
                                                        {errors.film_lines?.[idx]?.supplier_id && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.supplier_id?.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Nota Fiscal *
                                                        </Label>
                                                        <Input
                                                            {...register(`film_lines.${idx}.nfe_number`)}
                                                            className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                            placeholder="Nº da NF"
                                                        />
                                                        {errors.film_lines?.[idx]?.nfe_number && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.nfe_number?.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Custo (R$) *
                                                        </Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            {...register(`film_lines.${idx}.cost`)}
                                                            className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                            placeholder="0,00"
                                                        />
                                                        {errors.film_lines?.[idx]?.cost && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.cost?.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                                                            Data Receb.
                                                        </Label>
                                                        <Input
                                                            type="date"
                                                            {...register(`film_lines.${idx}.receipt_date`)}
                                                            className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                            title="Se vazio, usa a data do pedido acima"
                                                        />
                                                        {errors.film_lines?.[idx]?.receipt_date && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.receipt_date?.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Lote
                                                        </Label>
                                                        <Input
                                                            {...register(`film_lines.${idx}.lot_number`)}
                                                            maxLength={100}
                                                            className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                            placeholder="Número do lote"
                                                        />
                                                        {errors.film_lines?.[idx]?.lot_number && (
                                                            <p className="text-xs text-red-500">
                                                                {errors.film_lines[idx]?.lot_number?.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* ── Linhas de Ferramenta / Insumo ── */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Wrench className="h-4 w-4 text-blue-600" />
                                    <span className="text-sm font-semibold text-[#111111] dark:text-white">
                                        Ferramentas / Insumos
                                    </span>
                                    {toolFields.length > 0 && (
                                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                                            {toolFields.length}
                                        </span>
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        appendTool({
                                            name: '',
                                            quantity: 1,
                                            notes: null,
                                            employee_id: null,
                                            nfe_number: '',
                                            cost: '',
                                        })
                                    }
                                    className="h-7 text-xs gap-1"
                                >
                                    <Plus className="h-3 w-3" />
                                    Adicionar ferramenta
                                </Button>
                            </div>

                            {toolFields.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic pl-1">
                                    Nenhuma ferramenta/insumo adicionado.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {toolFields.map((field, idx) => (
                                        <div
                                            key={field.id}
                                            className="space-y-2 border border-[#E8E8E8] dark:border-[#333333] rounded-lg p-3 bg-gray-50/50 dark:bg-zinc-800/30"
                                        >
                                          <div className="grid grid-cols-[1fr_80px_1fr_32px] gap-2 items-start">
                                            {/* Nome */}
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">
                                                    Nome *
                                                </Label>
                                                <Input
                                                    {...register(`tool_lines.${idx}.name`)}
                                                    className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                    placeholder="Ex: Espátula Bulldozer"
                                                />
                                                {errors.tool_lines?.[idx]?.name && (
                                                    <p className="text-xs text-red-500">
                                                        {errors.tool_lines[idx]?.name?.message}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Quantidade */}
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">
                                                    Qtd *
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    {...register(`tool_lines.${idx}.quantity`, {
                                                        valueAsNumber: true,
                                                    })}
                                                    className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                    placeholder="1"
                                                />
                                                {errors.tool_lines?.[idx]?.quantity && (
                                                    <p className="text-xs text-red-500">
                                                        {errors.tool_lines[idx]?.quantity?.message}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Observação */}
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">
                                                    Observação
                                                </Label>
                                                <Input
                                                    {...register(`tool_lines.${idx}.notes`)}
                                                    className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                    placeholder="Opcional"
                                                />
                                            </div>

                                            {/* Remove */}
                                            <div className="pt-5">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeTool(idx)}
                                                    className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                                    aria-label="Remover ferramenta"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                          </div>

                                            {/* Row 2: Nota Fiscal + Custo (obrigatórios) */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">
                                                        Nota Fiscal *
                                                    </Label>
                                                    <Input
                                                        {...register(`tool_lines.${idx}.nfe_number`)}
                                                        className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                        placeholder="Nº da NF"
                                                    />
                                                    {errors.tool_lines?.[idx]?.nfe_number && (
                                                        <p className="text-xs text-red-500">
                                                            {errors.tool_lines[idx]?.nfe_number?.message}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">
                                                        Custo (R$) *
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        {...register(`tool_lines.${idx}.cost`)}
                                                        className="h-8 text-xs bg-white dark:bg-[#1A1A1A]"
                                                        placeholder="0,00"
                                                    />
                                                    {errors.tool_lines?.[idx]?.cost && (
                                                        <p className="text-xs text-red-500">
                                                            {errors.tool_lines[idx]?.cost?.message}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Funcionário (opcional) — gera card de recebimento */}
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">
                                                    Funcionário (gera recebimento)
                                                </Label>
                                                <Controller
                                                    control={control}
                                                    name={`tool_lines.${idx}.employee_id`}
                                                    render={({ field: f }) => (
                                                        <Select
                                                            value={f.value ? String(f.value) : '__none__'}
                                                            onValueChange={(v) =>
                                                                f.onChange(v === '__none__' ? null : Number(v))
                                                            }
                                                            disabled={!watchedStoreId}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#1A1A1A]">
                                                                <SelectValue
                                                                    placeholder={watchedStoreId ? 'Sem funcionário' : 'Selecione a loja primeiro'}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="__none__">Sem funcionário</SelectItem>
                                                                {employees.map((e) => (
                                                                    <SelectItem key={e.id} value={String(e.id)}>
                                                                        {e.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="px-6 py-4 border-t bg-muted/30 shrink-0">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSaving}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSaving}
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            className="font-semibold"
                        >
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isSaving
                                ? 'Salvando...'
                                : isEditing
                                    ? 'Salvar alterações'
                                    : 'Criar Pedido'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
