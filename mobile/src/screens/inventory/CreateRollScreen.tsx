import { useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { useCreateRoll, useFilmTypes } from '@/hooks/useInventory';
import { useStores } from '@/hooks/useStores';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useStoreStore } from '@/stores/store.store';
import { isCriticalRollsError } from '@/services/api/inventory.service';
import { getApiErrorMessage } from '@/lib/api-error';
import { FILM_DEPARTMENT_OPTIONS } from '@/constants/inventory';
import { FILM_TONALITY_OPTIONS, getTonalityOptionsForFilmType } from '@/constants/scheduling';
import type { CreateFilmRollPayload, FilmDepartment } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-04 — Entrada de Bobina.
 *
 * Espelha o modal "Entrada de Bobina" do web (InventoryPage): toggle de
 * departamento (Película / Pel. Segurança / PPF), loja (default
 * `selectedStoreId`), tipo de película (filtrado pelo departamento),
 * tonalidade (apenas film/security_film), fornecedor (opcional, via lista),
 * NFe, metragem total, custo, lote e data de recebimento.
 *
 * Fluxo do 409 crítico (paridade com o web): `useCreateRoll` propaga
 * `CriticalRollsError` quando há bobinas críticas pendentes; aqui mostramos um
 * Alert "Registrar mesmo assim?" e, ao confirmar, re-chamamos `mutateAsync` com
 * `force: true`. Sucesso → Toast (no hook) + volta para a lista.
 */

const TONALITY_VALUES = FILM_TONALITY_OPTIONS.map((o) => o.value) as [string, ...string[]];

const rollSchema = z
    .object({
        store_id: z.number({ error: 'Selecione a loja' }).int().positive('Selecione a loja'),
        department: z.enum(['film', 'security_film', 'ppf']),
        film_type_id: z
            .number({ error: 'Selecione o tipo de película' })
            .int()
            .positive('Selecione o tipo de película'),
        tonality: z.enum(TONALITY_VALUES).optional(),
        supplier_id: z.number().int().positive().optional(),
        nfe_number: z.string().optional(),
        total_meters: z
            .number({ error: 'Informe a metragem' })
            .positive('Metragem deve ser maior que zero'),
        cost: z.number().nonnegative('Custo inválido').optional(),
        lot_number: z.string().optional(),
        receipt_date: z.string().min(1, 'Informe a data de recebimento'),
    })
    .superRefine((data, ctx) => {
        // Tonalidade obrigatória para película / película de segurança (não PPF).
        if ((data.department === 'film' || data.department === 'security_film') && !data.tonality) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Informe a tonalidade',
                path: ['tonality'],
            });
        }
    });

type RollFormData = z.infer<typeof rollSchema>;

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

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

export function CreateRollScreen({ navigation }: InventoryStackScreenProps<'CreateRoll'>) {
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const createRoll = useCreateRoll();
    const toast = useToast();

    const defaultStoreId = selectedStoreId ?? stores[0]?.id ?? undefined;

    const {
        control,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<RollFormData>({
        resolver: zodResolver(rollSchema),
        defaultValues: {
            store_id: defaultStoreId as unknown as number,
            department: 'film',
            film_type_id: undefined as unknown as number,
            tonality: undefined,
            supplier_id: undefined,
            nfe_number: '',
            total_meters: undefined as unknown as number,
            cost: undefined,
            lot_number: '',
            receipt_date: todayISO(),
        },
    });

    const storeId = watch('store_id');
    const department = watch('department');
    const filmTypeId = watch('film_type_id');
    const tonality = watch('tonality');
    const supplierId = watch('supplier_id');
    const receiptDate = watch('receipt_date');

    const isFilm = department === 'film' || department === 'security_film';

    const { data: filmTypes = [], isLoading: filmTypesLoading } = useFilmTypes(department);
    const { data: suppliers = [] } = useSuppliers();

    // Refs dos sheets.
    const storeSheetRef = useRef<SelectRef>(null);
    const filmTypeSheetRef = useRef<SelectRef>(null);
    const tonalitySheetRef = useRef<SelectRef>(null);
    const supplierSheetRef = useRef<SelectRef>(null);

    const [showDatePicker, setShowDatePicker] = useState(false);

    const storeOptions = useMemo(
        () => stores.map((s) => ({ value: s.id, label: s.name })),
        [stores]
    );
    const filmTypeOptions = useMemo(
        () => filmTypes.filter((ft) => ft.is_active).map((ft) => ({ value: ft.id, label: ft.name })),
        [filmTypes]
    );
    const supplierOptions = useMemo(
        () => suppliers.map((s) => ({ value: s.id, label: s.company_name })),
        [suppliers]
    );

    const currentStore = stores.find((s) => s.id === storeId);
    const selectedFilmType = filmTypes.find((ft) => ft.id === filmTypeId);
    const selectedFilmTypeName = selectedFilmType?.name;
    // A7 — tonalidades dirigidas pelo tipo de película selecionado (com fallback
    // por departamento quando o tipo não tem `available_tonalities`).
    const tonalityOptions = useMemo(
        () =>
            getTonalityOptionsForFilmType({
                department,
                availableTonalities: selectedFilmType?.available_tonalities,
            }),
        [department, selectedFilmType]
    );
    const selectedSupplierName = suppliers.find((s) => s.id === supplierId)?.company_name;
    const storeLocked = stores.length <= 1;

    const buildPayload = (data: RollFormData): CreateFilmRollPayload => ({
        store_id: data.store_id,
        film_type_id: data.film_type_id,
        tonality: isFilm ? data.tonality : undefined,
        supplier_id: data.supplier_id ?? undefined,
        nfe_number: data.nfe_number?.trim() || undefined,
        total_meters: data.total_meters,
        cost: data.cost ?? undefined,
        lot_number: data.lot_number?.trim() || undefined,
        receipt_date: data.receipt_date,
    });

    const submit = async (data: RollFormData) => {
        Keyboard.dismiss();
        const payload = buildPayload(data);
        try {
            await createRoll.mutateAsync({ payload, force: false });
            navigation.goBack();
        } catch (err) {
            if (isCriticalRollsError(err)) {
                // 409: bobinas críticas pendentes → confirma "registrar mesmo assim".
                Alert.alert(
                    'Bobinas críticas pendentes',
                    'Existem bobinas críticas nesta loja. Deseja registrar mesmo assim?',
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                            text: 'Registrar',
                            style: 'destructive',
                            onPress: () => {
                                createRoll.mutateAsync({ payload, force: true }).then(
                                    () => navigation.goBack(),
                                    (e: unknown) =>
                                        toast.error(
                                            getApiErrorMessage(e as Error, 'Erro ao registrar bobina.')
                                        )
                                );
                            },
                        },
                    ]
                );
                return;
            }
            toast.error(getApiErrorMessage(err as Error, 'Erro ao registrar bobina.'));
        }
    };

    const isBusy = createRoll.isPending;

    const changeDepartment = (value: FilmDepartment) => {
        if (value === department) return;
        setValue('department', value);
        // Trocar de departamento invalida tipo/tonalidade.
        setValue('film_type_id', undefined as unknown as number);
        setValue('tonality', undefined);
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Entrada de bobina" onBack={() => navigation.goBack()} />
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

                {/* Loja */}
                <FieldLabel>Loja *</FieldLabel>
                {storeLocked ? (
                    <View className="mb-4 min-h-[48px] justify-center rounded-lg border border-neutral-200 bg-neutral-100 px-4 dark:border-dark-border-strong dark:bg-dark-elevated">
                        <Text className="font-sans text-base text-neutral-700 dark:text-dark-text">
                            {currentStore?.name ?? 'Nenhuma loja disponível'}
                        </Text>
                    </View>
                ) : (
                    <PickerField
                        placeholder="Selecionar loja..."
                        value={currentStore?.name}
                        onPress={() => storeSheetRef.current?.present()}
                        error={errors.store_id?.message}
                        disabled={isBusy}
                    />
                )}

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

                {/* Fornecedor (opcional) */}
                <FieldLabel>Fornecedor</FieldLabel>
                <PickerField
                    placeholder={
                        supplierOptions.length === 0
                            ? 'Nenhum fornecedor cadastrado'
                            : 'Selecionar fornecedor...'
                    }
                    value={selectedSupplierName}
                    disabled={isBusy || supplierOptions.length === 0}
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
                            value={value != null && !Number.isNaN(value) ? String(value) : ''}
                            onChangeText={(t) => {
                                const n = Number(t.replace(',', '.'));
                                onChange(t === '' || Number.isNaN(n) ? undefined : n);
                            }}
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
                        title={isBusy ? 'Registrando...' : 'Registrar bobina'}
                        icon="checkmark"
                        loading={isBusy}
                        disabled={isBusy}
                        onPress={handleSubmit(submit)}
                    />
                </View>
            </ScrollView>

            {/* Sheets */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={storeOptions}
                value={storeId ?? null}
                onChange={(v) => setValue('store_id', v, { shouldValidate: true })}
            />
            <Select<number>
                ref={filmTypeSheetRef}
                title="Selecionar tipo"
                options={filmTypeOptions}
                value={filmTypeId ?? null}
                onChange={(v) => {
                    setValue('film_type_id', v, { shouldValidate: true });
                    // Trocar de tipo pode mudar as tonalidades disponíveis (A7) →
                    // limpa a tonalidade para forçar reescolha válida.
                    setValue('tonality', undefined);
                }}
            />
            <Select<string>
                ref={tonalitySheetRef}
                title="Selecionar tonalidade"
                options={tonalityOptions}
                value={tonality ?? null}
                onChange={(v) =>
                    setValue('tonality', v as RollFormData['tonality'], { shouldValidate: true })
                }
            />
            <Select<number>
                ref={supplierSheetRef}
                title="Selecionar fornecedor"
                options={supplierOptions}
                value={supplierId ?? null}
                onChange={(v) => setValue('supplier_id', v)}
            />
        </View>
    );
}

// ─── Subcomponentes locais (espelham AppointmentFormFields) ───────────────────

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
