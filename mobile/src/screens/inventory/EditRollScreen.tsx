import { useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { useFilmTypes, useRoll, useUpdateRoll } from '@/hooks/useInventory';
import { useSuppliers } from '@/hooks/useSuppliers';
import { getApiErrorMessage } from '@/lib/api-error';
import { FILM_DEPARTMENT_OPTIONS } from '@/constants/inventory';
import { FILM_TONALITY_OPTIONS, getTonalityOptionsForFilmType } from '@/constants/scheduling';
import type { FilmDepartment, FilmRoll, UpdateFilmRollPayload } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-05 — Editar bobina (metadados).
 *
 * Espelha o modal "Editar bobina" do web (InventoryPage): tipo (filtrado por
 * departamento), tonalidade (film/security_film), fornecedor (seletor com opção
 * "Nenhum"), NFe, metragem total, custo, lote e recebimento. Reusa a estrutura
 * de formulário do CreateRollScreen.
 *
 * Regras: alterar `total_meters` NÃO edita o saldo (o backend recalcula
 * preservando o consumo). Trocar o tipo pode trocar o departamento → reseta
 * tonalidade. Campos esvaziados (fornecedor/NFe/custo/lote) enviam o respectivo
 * `clear_*: true` em vez de string vazia. `store_id` não é editável aqui (use a
 * transferência de bobina).
 */

const TONALITY_VALUES = FILM_TONALITY_OPTIONS.map((o) => o.value) as [string, ...string[]];
/** Sentinela do fornecedor "Nenhum" (Select<number> não aceita null como valor). */
const SUPPLIER_NONE = 0;

const editRollSchema = z
    .object({
        department: z.enum(['film', 'security_film', 'ppf']),
        film_type_id: z
            .number({ error: 'Selecione o tipo de película' })
            .int()
            .positive('Selecione o tipo de película'),
        tonality: z.enum(TONALITY_VALUES).optional(),
        supplier_id: z.number().int().nonnegative().optional(),
        nfe_number: z.string().optional(),
        total_meters: z
            .number({ error: 'Informe a metragem' })
            .positive('Metragem deve ser maior que zero'),
        // Custo mantido como STRING (Decimal serializado como string pelo backend
        // — nunca `.toFixed` no prefill); convertido no submit.
        cost: z.string().optional(),
        lot_number: z.string().optional(),
        receipt_date: z.string().min(1, 'Informe a data de recebimento'),
    })
    .superRefine((data, ctx) => {
        if ((data.department === 'film' || data.department === 'security_film') && !data.tonality) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Informe a tonalidade',
                path: ['tonality'],
            });
        }
    });

type EditRollFormData = z.infer<typeof editRollSchema>;

function formatDateBR(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

function isoToDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function dateToISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Loader: resolve a bobina + todos os tipos de película (para derivar o
 * departamento atual) antes de montar o formulário com valores pré-preenchidos.
 */
export function EditRollScreen({ route, navigation }: InventoryStackScreenProps<'EditRoll'>) {
    const { id } = route.params;
    const { data: roll, isLoading, isError, refetch } = useRoll(id);
    // Todos os tipos (sem filtro de departamento) — só p/ descobrir o departamento
    // do tipo atual da bobina e inicializar os chips corretamente.
    const { data: allFilmTypes, isLoading: typesLoading } = useFilmTypes();

    if (isLoading || typesLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar bobina" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={120} />
                    <Skeleton width="100%" height={80} />
                </View>
            </View>
        );
    }

    if (isError || !roll) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar bobina" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const currentType = (allFilmTypes ?? []).find((ft) => ft.id === roll.film_type_id);
    const initialDepartment: FilmDepartment = currentType?.department ?? 'film';

    return (
        <EditRollForm roll={roll} initialDepartment={initialDepartment} navigation={navigation} />
    );
}

interface EditRollFormProps {
    roll: FilmRoll;
    initialDepartment: FilmDepartment;
    navigation: InventoryStackScreenProps<'EditRoll'>['navigation'];
}

function EditRollForm({ roll, initialDepartment, navigation }: EditRollFormProps) {
    const updateRoll = useUpdateRoll();
    const toast = useToast();

    // Tonalidade só pré-preenche se estiver na lista base conhecida (senão o
    // resolver zod rejeitaria um default fora do enum).
    const initialTonality =
        roll.tonality && TONALITY_VALUES.includes(roll.tonality) ? roll.tonality : undefined;

    const {
        control,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<EditRollFormData>({
        resolver: zodResolver(editRollSchema),
        defaultValues: {
            department: initialDepartment,
            film_type_id: roll.film_type_id,
            tonality: initialTonality as EditRollFormData['tonality'],
            supplier_id: roll.supplier_id ?? SUPPLIER_NONE,
            nfe_number: roll.nfe_number ?? '',
            total_meters: roll.total_meters,
            cost: roll.cost != null ? String(roll.cost) : '',
            lot_number: roll.lot_number ?? '',
            receipt_date: roll.receipt_date,
        },
    });

    const department = watch('department');
    const filmTypeId = watch('film_type_id');
    const tonality = watch('tonality');
    const supplierId = watch('supplier_id');
    const receiptDate = watch('receipt_date');

    const isFilm = department === 'film' || department === 'security_film';

    const { data: filmTypes = [], isLoading: filmTypesLoading } = useFilmTypes(department);
    const { data: suppliers = [] } = useSuppliers();

    const filmTypeSheetRef = useRef<SelectRef>(null);
    const tonalitySheetRef = useRef<SelectRef>(null);
    const supplierSheetRef = useRef<SelectRef>(null);

    const [showDatePicker, setShowDatePicker] = useState(false);

    // Edição: NÃO filtra por is_active — o tipo atual da bobina pode estar
    // inativo e ainda assim precisa aparecer selecionado.
    const filmTypeOptions = useMemo(
        () => filmTypes.map((ft) => ({ value: ft.id, label: ft.name })),
        [filmTypes]
    );
    const supplierOptions = useMemo(
        () => [
            { value: SUPPLIER_NONE, label: 'Nenhum' },
            ...suppliers.map((s) => ({ value: s.id, label: s.company_name })),
        ],
        [suppliers]
    );

    const selectedFilmType = filmTypes.find((ft) => ft.id === filmTypeId);
    const selectedFilmTypeName = selectedFilmType?.name;
    const tonalityOptions = useMemo(
        () =>
            getTonalityOptionsForFilmType({
                department,
                availableTonalities: selectedFilmType?.available_tonalities,
            }),
        [department, selectedFilmType]
    );
    const selectedSupplierName =
        supplierId && supplierId !== SUPPLIER_NONE
            ? suppliers.find((s) => s.id === supplierId)?.company_name
            : 'Nenhum';

    const isBusy = updateRoll.isPending;

    const changeDepartment = (value: FilmDepartment) => {
        if (value === department) return;
        setValue('department', value);
        // Trocar de departamento invalida tipo/tonalidade.
        setValue('film_type_id', undefined as unknown as number, { shouldValidate: false });
        setValue('tonality', undefined);
    };

    const buildPayload = (data: EditRollFormData): UpdateFilmRollPayload => {
        const nfe = data.nfe_number?.trim();
        const lot = data.lot_number?.trim();
        const costStr = data.cost?.trim();
        const costNum = costStr ? Number(costStr.replace(',', '.')) : undefined;
        const hasSupplier = !!data.supplier_id && data.supplier_id !== SUPPLIER_NONE;
        return {
            film_type_id: data.film_type_id,
            tonality: isFilm ? (data.tonality ?? null) : null,
            total_meters: data.total_meters,
            receipt_date: data.receipt_date || undefined,
            supplier_id: hasSupplier ? data.supplier_id : undefined,
            clear_supplier: !hasSupplier,
            nfe_number: nfe || undefined,
            clear_nfe: !nfe,
            cost: costStr && costNum != null && Number.isFinite(costNum) ? costNum : undefined,
            clear_cost: !costStr,
            lot_number: lot || undefined,
            clear_lot: !lot,
        };
    };

    const submit = async (data: EditRollFormData) => {
        Keyboard.dismiss();
        try {
            await updateRoll.mutateAsync({ id: roll.id, payload: buildPayload(data) });
            navigation.goBack();
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Erro ao atualizar bobina.'));
        }
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title={`Editar ${roll.visual_id}`} onBack={() => navigation.goBack()} />
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                {/* Departamento (tipo de estoque) */}
                <FieldLabel>Tipo de estoque *</FieldLabel>
                <View className="mb-4 flex-row flex-wrap gap-2">
                    {FILM_DEPARTMENT_OPTIONS.map((opt) => (
                        <Chip
                            key={opt.value}
                            label={opt.label}
                            active={department === opt.value}
                            disabled={isBusy}
                            onPress={() => changeDepartment(opt.value)}
                        />
                    ))}
                </View>

                {/* Tipo de película */}
                <FieldLabel>{department === 'ppf' ? 'Tipo de PPF *' : 'Tipo de película *'}</FieldLabel>
                <PickerField
                    placeholder={
                        filmTypesLoading
                            ? 'Carregando tipos...'
                            : filmTypeOptions.length === 0
                              ? 'Nenhum tipo disponível'
                              : 'Selecionar tipo...'
                    }
                    value={selectedFilmTypeName}
                    disabled={isBusy || filmTypeOptions.length === 0}
                    onPress={() => filmTypeSheetRef.current?.present()}
                    error={errors.film_type_id?.message}
                />

                {/* Tonalidade (film / security_film) */}
                {isFilm ? (
                    <>
                        <FieldLabel>Tonalidade *</FieldLabel>
                        <PickerField
                            placeholder="Selecionar tonalidade..."
                            value={tonality ?? undefined}
                            disabled={isBusy}
                            onPress={() => tonalitySheetRef.current?.present()}
                            error={errors.tonality?.message}
                        />
                    </>
                ) : null}

                {/* Fornecedor (seletor com opção "Nenhum") */}
                <FieldLabel>Fornecedor</FieldLabel>
                <PickerField
                    placeholder="Selecionar fornecedor..."
                    value={selectedSupplierName}
                    disabled={isBusy}
                    onPress={() => supplierSheetRef.current?.present()}
                />

                {/* NFe / Nº pedido */}
                <Controller
                    control={control}
                    name="nfe_number"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="NFe / Nº pedido"
                            placeholder="Ex: NF-001234 ou PED-5678"
                            autoCorrect={false}
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            editable={!isBusy}
                        />
                    )}
                />

                {/* Metragem total */}
                <Controller
                    control={control}
                    name="total_meters"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Metragem total (m) *"
                            placeholder="Ex: 15"
                            keyboardType="numeric"
                            value={value != null && !Number.isNaN(value) ? String(value) : ''}
                            onChangeText={(t) => {
                                const n = Number(t.replace(',', '.'));
                                onChange(t === '' || Number.isNaN(n) ? undefined : n);
                            }}
                            onBlur={onBlur}
                            error={errors.total_meters?.message}
                            hint="Alterar não mexe no saldo restante — o consumo é preservado."
                            editable={!isBusy}
                        />
                    )}
                />

                {/* Custo (opcional) */}
                <Controller
                    control={control}
                    name="cost"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Custo (R$)"
                            placeholder="Ex: 1200.00"
                            keyboardType="numeric"
                            value={value ?? ''}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            error={errors.cost?.message}
                            editable={!isBusy}
                        />
                    )}
                />

                {/* Lote (opcional) */}
                <Controller
                    control={control}
                    name="lot_number"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Lote"
                            placeholder="Ex: LOTE-2024-A"
                            autoCorrect={false}
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            editable={!isBusy}
                        />
                    )}
                />

                {/* Data de recebimento */}
                <FieldLabel>Recebimento *</FieldLabel>
                <PickerField
                    placeholder="Data..."
                    value={receiptDate ? formatDateBR(receiptDate) : undefined}
                    onPress={() => {
                        Keyboard.dismiss();
                        setShowDatePicker(true);
                    }}
                    error={errors.receipt_date?.message}
                    disabled={isBusy}
                />

                {showDatePicker && Platform.OS === 'ios' ? (
                    <PickerModal title="Data de recebimento" onClose={() => setShowDatePicker(false)}>
                        <DateTimePicker
                            value={receiptDate ? isoToDate(receiptDate) : new Date()}
                            mode="date"
                            display="spinner"
                            onChange={(_e: DateTimePickerEvent, date?: Date) => {
                                if (date)
                                    setValue('receipt_date', dateToISO(date), { shouldValidate: true });
                            }}
                        />
                    </PickerModal>
                ) : showDatePicker ? (
                    <DateTimePicker
                        value={receiptDate ? isoToDate(receiptDate) : new Date()}
                        mode="date"
                        display="default"
                        onChange={(event: DateTimePickerEvent, date?: Date) => {
                            setShowDatePicker(false);
                            if (event.type !== 'dismissed' && date)
                                setValue('receipt_date', dateToISO(date), { shouldValidate: true });
                        }}
                    />
                ) : null}

                {/* Ação */}
                <View className="mt-2">
                    <Button
                        title={isBusy ? 'Salvando...' : 'Salvar alterações'}
                        icon="checkmark"
                        loading={isBusy}
                        disabled={isBusy}
                        onPress={handleSubmit(submit)}
                    />
                </View>
            </ScrollView>

            {/* Sheets */}
            <Select<number>
                ref={filmTypeSheetRef}
                title="Selecionar tipo"
                options={filmTypeOptions}
                value={filmTypeId ?? null}
                onChange={(v) => {
                    setValue('film_type_id', v, { shouldValidate: true });
                    // Trocar de tipo pode mudar as tonalidades disponíveis → limpa.
                    setValue('tonality', undefined);
                }}
            />
            <Select<string>
                ref={tonalitySheetRef}
                title="Selecionar tonalidade"
                options={tonalityOptions}
                value={tonality ?? null}
                onChange={(v) =>
                    setValue('tonality', v as EditRollFormData['tonality'], { shouldValidate: true })
                }
            />
            <Select<number>
                ref={supplierSheetRef}
                title="Selecionar fornecedor"
                options={supplierOptions}
                value={supplierId ?? SUPPLIER_NONE}
                onChange={(v) => setValue('supplier_id', v)}
            />
        </View>
    );
}

// ─── Subcomponentes locais (espelham CreateRollScreen) ────────────────────────

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}

interface PickerFieldProps {
    placeholder: string;
    value?: string;
    onPress: () => void;
    error?: string;
    disabled?: boolean;
}

function PickerField({ placeholder, value, onPress, error, disabled }: PickerFieldProps) {
    return (
        <View className="mb-4">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={value ?? placeholder}
                disabled={disabled}
                onPress={onPress}
                className={[
                    'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                    error ? 'border-error' : 'border-neutral-200 dark:border-dark-border-strong',
                    'bg-white dark:bg-dark-input',
                    disabled ? 'opacity-60' : '',
                ].join(' ')}
            >
                <Text
                    className={[
                        'flex-1 font-sans text-base',
                        value
                            ? 'text-neutral-900 dark:text-dark-text'
                            : 'text-neutral-400 dark:text-dark-text-muted',
                    ].join(' ')}
                    numberOfLines={1}
                >
                    {value || placeholder}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#98A2B3" />
            </Pressable>
            {error ? <Text className="mt-1 font-sans text-sm text-error">{error}</Text> : null}
        </View>
    );
}

interface ChipProps {
    label: string;
    active: boolean;
    onPress: () => void;
    disabled?: boolean;
}

function Chip({ label, active, onPress, disabled }: ChipProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            className={[
                'min-h-[40px] items-center justify-center rounded-full px-4 py-2 active:opacity-80',
                active ? 'bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated',
                disabled ? 'opacity-50' : '',
            ].join(' ')}
        >
            <Text
                className={[
                    'font-sans-semibold text-sm',
                    active ? 'text-brand-black' : 'text-neutral-600 dark:text-dark-text',
                ].join(' ')}
            >
                {label}
            </Text>
        </Pressable>
    );
}

function PickerModal({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <Modal transparent animationType="fade" visible onRequestClose={onClose}>
            <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
                <Pressable
                    onPress={(e) => e.stopPropagation()}
                    className="rounded-t-3xl bg-white pb-6 dark:bg-dark-surface"
                >
                    <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-dark-border">
                        <Text className="font-sans-semibold text-base text-neutral-900 dark:text-dark-text">
                            {title}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Concluir seleção"
                            hitSlop={8}
                            onPress={onClose}
                        >
                            <Text className="font-sans-bold text-base text-brand-black">Pronto</Text>
                        </Pressable>
                    </View>
                    {children}
                </Pressable>
            </Pressable>
        </Modal>
    );
}
