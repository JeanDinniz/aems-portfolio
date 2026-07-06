import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ServiceItemPicker, type ServiceItemSelection } from '@/components/features/ServiceItemPicker';
import { useServiceOrder, useUpdateServiceOrder } from '@/hooks/useServiceOrders';
import { useStores } from '@/hooks/useStores';
import { useVehicleModels } from '@/hooks/useVehicleModels';
import { useConsultants } from '@/hooks/useConsultants';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useGalponFlags } from '@/navigation/guards';
import { getApiErrorMessage } from '@/lib/api-error';
import { DEPARTMENTS } from '@/constants/service-orders';
import type { CreateServiceOrderData, Department, ServiceOrder } from '@/types/service-order.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';

/**
 * OS-07 — EditServiceOrderScreen.
 *
 * Edição de uma O.S. já existente (módulo de registro + acompanhamento BÁSICO).
 * Espelha o EditServiceOrderPage do web: reaproveita o layout/campos do
 * CreateServiceOrderScreen (TextField/PickerField/Chip/Select/ServiceItemPicker),
 * MAS sem fotos/fila offline/rascunho — só editar campos + serviços.
 *
 * Regra de edição (idêntica ao web `canEdit` em ServiceOrdersPage):
 *   - bloqueia se `is_verified === true`;
 *   - bloqueia se a O.S. foi criada há mais de 7 dias (base: `entry_time`).
 * Combinada com `useCanEdit('service_orders')` (permissão/UX).
 *
 * Read-only espelhando o web: `order_number` (exibido) e a LOJA (o web não troca
 * a loja na edição → `location_id` não é alterável aqui).
 *
 * Status nunca usa quality_check/delivered.
 */

// ─── Validação de placa / chassi (idêntica ao Create) ─────────────────────────
const PLATE_MERCOSUL = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const PLATE_OLD = /^[A-Z]{3}[0-9]{4}$/;
const CHASSI_VIN = /^[A-HJ-NPR-Z0-9]{17}$/; // VIN padrão — sem I, O, Q
const CHASSI_CURTO = /^[A-Z0-9]{4,17}$/; // Chassi curto (BYD, vidro, etc.) — 4 a 17 chars

function isValidPlateOrChassi(value: string): boolean {
    const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return PLATE_MERCOSUL.test(v) || PLATE_OLD.test(v) || CHASSI_VIN.test(v) || CHASSI_CURTO.test(v);
}

const DEPT_VALUES = DEPARTMENTS.map((d) => d.value) as [Department, ...Department[]];

// ─── Schema Zod (espelha o Create, sem fotos/tipo-de-rascunho) ────────────────
const schema = z
    .object({
        is_courtesy: z.boolean(),
        is_return: z.boolean(),
        is_galpon: z.boolean(),
        department: z.enum(DEPT_VALUES, { error: 'Selecione um departamento' }),
        service_date: z.string().min(1, 'Data do serviço obrigatória'),
        external_os_number: z.string().optional(),
        plate: z
            .string()
            .min(1, 'Placa ou chassi obrigatório')
            .refine(
                isValidPlateOrChassi,
                'Formato inválido. Use placa (ex: ABC1D23) ou chassi (4-17 caracteres)'
            ),
        vehicle_model: z.string().min(1, 'Modelo obrigatório'),
        vehicle_model_id: z.number().optional(),
        vehicle_color: z.string().min(1, 'Cor obrigatória'),
        consultant_id: z.number().optional(),
        items: z
            .array(z.object({ service_id: z.number(), quantity: z.number() }))
            .min(1, 'Selecione pelo menos 1 serviço'),
        notes: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        // Nº OS Concessionária obrigatório fora dos departamentos de venda (VN/VD/VU).
        if (
            data.department !== 'vn' &&
            data.department !== 'vd' &&
            data.department !== 'vu' &&
            !data.external_os_number?.trim()
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Nº O.S. Concessionária obrigatório',
                path: ['external_os_number'],
            });
        }
        // Consultor obrigatório quando NÃO for galpão (espelha o web/Create).
        if (!data.is_galpon && !data.consultant_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Consultor obrigatório',
                path: ['consultant_id'],
            });
        }
    });

type EditOSForm = z.infer<typeof schema>;

/** Opções de Cortesia/Retorno (espelha o Create). */
type CourtesyReturnValue = 'normal' | 'courtesy' | 'return';
const COURTESY_RETURN_OPTIONS: { value: CourtesyReturnValue; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'courtesy', label: 'Cortesia' },
    { value: 'return', label: 'Retorno' },
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Regra de edição do web (`canEdit` em ServiceOrdersPage): verificada OU >7 dias bloqueia. */
function isWithinEditWindow(order: ServiceOrder): boolean {
    if (order.is_verified) return false;
    const entry = order.entry_time ?? order.created_at;
    if (!entry) return true;
    const diffMs = Date.now() - new Date(entry).getTime();
    if (Number.isNaN(diffMs)) return true;
    return diffMs <= SEVEN_DAYS_MS;
}

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" para exibição. */
function formatDateBR(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** "AAAA-MM-DD" → Date local (meio-dia evita drift de fuso). */
function isoToDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/** Date → "AAAA-MM-DD" (componentes locais, sem UTC). */
function dateToISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Normaliza `service_date` da O.S. (pode vir ISO com hora) para "AAAA-MM-DD". */
function normalizeServiceDate(value: string | null | undefined): string {
    if (!value) return todayISO();
    return value.split('T')[0];
}

export function EditServiceOrderScreen({
    route,
    navigation,
}: ServiceOrdersStackScreenProps<'EditServiceOrder'>) {
    const { id } = route.params;
    const toast = useToast();
    const canEditPermission = useCanEdit('service_orders');
    const updateServiceOrder = useUpdateServiceOrder();
    const { stores } = useStores();
    const { isGalponProfile, hideGalponOption } = useGalponFlags();

    const { data: order, isLoading, isError, refetch } = useServiceOrder(id);

    const {
        control,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<EditOSForm>({
        resolver: zodResolver(schema),
        defaultValues: {
            is_courtesy: false,
            is_return: false,
            is_galpon: false,
            department: undefined as unknown as Department,
            service_date: todayISO(),
            external_os_number: '',
            plate: '',
            vehicle_model: '',
            vehicle_model_id: undefined,
            vehicle_color: '',
            consultant_id: undefined,
            items: [],
            notes: '',
        },
    });

    // Prefill — repõe o form com os valores atuais da O.S. ao carregar.
    useEffect(() => {
        if (!order) return;
        reset({
            is_courtesy: order.is_courtesy ?? false,
            is_return: order.is_return ?? false,
            is_galpon: order.is_galpon ?? false,
            department: order.department,
            service_date: normalizeServiceDate(order.service_date),
            external_os_number: order.external_os_number ?? '',
            plate: order.plate ?? '',
            vehicle_model: order.vehicle_model ?? '',
            vehicle_model_id: order.vehicle_model_id ?? undefined,
            vehicle_color: order.vehicle_color ?? '',
            consultant_id: order.consultant_id ?? undefined,
            items: (order.items ?? []).map((it) => ({
                service_id: it.service_id,
                quantity: it.quantity,
            })),
            notes: order.notes ?? '',
        });
    }, [order, reset]);

    const [showDatePicker, setShowDatePicker] = useState(false);

    const department = watch('department');
    const isGalpon = watch('is_galpon');
    const isCourtesy = watch('is_courtesy');
    const isReturn = watch('is_return');
    const consultantId = watch('consultant_id');
    const vehicleModelId = watch('vehicle_model_id');
    const serviceDate = watch('service_date');

    // Loja da O.S. é READ-ONLY no Edit (espelha o web): resolve para exibição e
    // deriva a marca (filtra modelo/serviços).
    const currentStore = useMemo(
        () => stores.find((s) => s.id === order?.location_id),
        [stores, order?.location_id]
    );
    const storeBrandId = currentStore?.brand_id ?? undefined;

    const { data: vehicleModels = [], isLoading: modelsLoading } = useVehicleModels(
        storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );
    const { consultants, isLoading: consultantsLoading } = useConsultants(
        order?.location_id ? { store_id: order.location_id, is_active: true } : undefined,
        1,
        200
    );

    const modelSheetRef = useRef<SelectRef>(null);
    const consultantSheetRef = useRef<SelectRef>(null);

    const courtesyReturn: CourtesyReturnValue = isCourtesy
        ? 'courtesy'
        : isReturn
          ? 'return'
          : 'normal';

    const editable = order ? isWithinEditWindow(order) : false;
    const locked = !canEditPermission || !editable;

    const isBusy = isSubmitting || updateServiceOrder.isPending;

    const modelOptions = useMemo(
        () => vehicleModels.map((m) => ({ value: m.id, label: m.name })),
        [vehicleModels]
    );
    const consultantOptions = useMemo(
        () => consultants.map((c) => ({ value: c.id, label: c.name })),
        [consultants]
    );
    const selectedConsultantName = consultants.find((c) => c.id === consultantId)?.name;

    // ─── Submit: PATCH parcial dos campos editáveis ───────────────────────────
    const buildPayload = useCallback(
        (data: EditOSForm): Partial<CreateServiceOrderData> => {
            const isSaleDept =
                data.department === 'vn' || data.department === 'vd' || data.department === 'vu';
            const plate = data.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return {
                plate,
                vehicle_plate: plate,
                external_os_number: !isSaleDept
                    ? data.external_os_number?.trim() || undefined
                    : undefined,
                vehicle_model: data.vehicle_model,
                vehicle_model_id: data.vehicle_model_id || undefined,
                vehicle_color: data.vehicle_color || undefined,
                department: data.department,
                consultant_id: data.consultant_id || undefined,
                items: data.items.map((it) => ({
                    service_id: it.service_id,
                    quantity: it.quantity,
                })),
                notes: data.notes?.trim() || undefined,
                is_galpon: data.is_galpon,
                is_return: data.is_return,
                is_courtesy: data.is_courtesy,
                service_date: data.service_date,
            };
        },
        []
    );

    const submit = useCallback(
        async (data: EditOSForm) => {
            Keyboard.dismiss();
            if (locked) return;
            try {
                await updateServiceOrder.mutateAsync({ id, data: buildPayload(data) });
                toast.success('O.S. atualizada com sucesso!');
                navigation.goBack();
            } catch (err) {
                toast.error(
                    getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.')
                );
            }
        },
        [locked, updateServiceOrder, id, buildPayload, toast, navigation]
    );

    const onSave = handleSubmit(submit);

    // ─── Loading / Erro ───────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar O.S" onBack={() => navigation.goBack()} />
                <View className="p-4 gap-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} width="100%" height={56} />
                    ))}
                </View>
            </View>
        );
    }

    if (isError || !order) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar O.S" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Editar O.S" onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                {/* Aviso de bloqueio (verificada / >7 dias / sem permissão) */}
                {locked ? (
                    <View className="mb-4 rounded-xl bg-warning-light p-3 dark:bg-dark-elevated">
                        <Text className="font-sans-semibold text-sm text-primary-800 dark:text-brand">
                            Edição indisponível
                        </Text>
                        <Text className="mt-1 font-sans text-sm text-primary-700 dark:text-dark-text">
                            {!canEditPermission
                                ? 'Você não tem permissão para editar esta O.S.'
                                : order.is_verified
                                  ? 'Esta O.S. já foi conferida e não pode mais ser editada.'
                                  : 'A edição só é permitida até 7 dias após a criação da O.S.'}
                        </Text>
                    </View>
                ) : null}

                {/* ─── Nº O.S. (read-only) ──────────────────────────────── */}
                <FieldLabel>Nº O.S. (sistema)</FieldLabel>
                <ReadonlyField value={order.order_number} />

                {/* ─── Loja (read-only — web não troca loja na edição) ──── */}
                <FieldLabel>Loja</FieldLabel>
                <ReadonlyField value={currentStore?.name ?? order.location_name ?? '—'} />

                {/* ─── Cortesia/Retorno + Galpão ────────────────────────── */}
                <FieldLabel>Tipo</FieldLabel>
                <View className="mb-3 flex-row flex-wrap gap-2">
                    {COURTESY_RETURN_OPTIONS.map((opt) => (
                        <Chip
                            key={opt.value}
                            label={opt.label}
                            active={courtesyReturn === opt.value}
                            disabled={locked}
                            onPress={() => {
                                setValue('is_courtesy', opt.value === 'courtesy');
                                setValue('is_return', opt.value === 'return');
                            }}
                        />
                    ))}
                    {!hideGalponOption ? (
                        <Chip
                            label="Galpão"
                            active={isGalpon}
                            disabled={locked || isGalponProfile}
                            onPress={() => {
                                if (!isGalponProfile) setValue('is_galpon', !isGalpon);
                            }}
                        />
                    ) : null}
                </View>

                {/* ─── Departamento ─────────────────────────────────────── */}
                <FieldLabel>Departamento *</FieldLabel>
                <View className="mb-1 flex-row flex-wrap gap-2">
                    {DEPARTMENTS.map((dep) => (
                        <Chip
                            key={dep.value}
                            label={dep.label}
                            active={department === dep.value}
                            disabled={locked}
                            onPress={() => {
                                setValue('department', dep.value, { shouldValidate: true });
                                if (
                                    dep.value === 'vn' ||
                                    dep.value === 'vd' ||
                                    dep.value === 'vu'
                                ) {
                                    setValue('external_os_number', '');
                                }
                            }}
                        />
                    ))}
                </View>
                {errors.department ? (
                    <Text className="mb-3 mt-1 font-sans text-sm text-error">
                        {errors.department.message}
                    </Text>
                ) : (
                    <View className="mb-3" />
                )}

                {/* ─── Data do serviço ──────────────────────────────────── */}
                <FieldLabel>Data do serviço *</FieldLabel>
                <PickerField
                    placeholder="Selecionar data..."
                    value={serviceDate ? formatDateBR(serviceDate) : undefined}
                    onPress={() => {
                        Keyboard.dismiss();
                        setShowDatePicker(true);
                    }}
                    error={errors.service_date?.message}
                    disabled={locked || isBusy}
                />
                {showDatePicker && Platform.OS === 'ios' ? (
                    <Modal
                        transparent
                        animationType="fade"
                        visible
                        onRequestClose={() => setShowDatePicker(false)}
                    >
                        <Pressable
                            className="flex-1 justify-end bg-black/40"
                            onPress={() => setShowDatePicker(false)}
                        >
                            <Pressable
                                onPress={(e) => e.stopPropagation()}
                                className="rounded-t-3xl bg-white pb-6 dark:bg-dark-surface"
                            >
                                <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-dark-border">
                                    <Text className="font-sans-semibold text-base text-neutral-900 dark:text-dark-text">
                                        Data do serviço
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Concluir seleção de data"
                                        hitSlop={8}
                                        onPress={() => setShowDatePicker(false)}
                                    >
                                        <Text className="font-sans-bold text-base text-brand-black">
                                            Pronto
                                        </Text>
                                    </Pressable>
                                </View>
                                <DateTimePicker
                                    value={serviceDate ? isoToDate(serviceDate) : new Date()}
                                    mode="date"
                                    display="spinner"
                                    maximumDate={new Date()}
                                    onChange={(_e: DateTimePickerEvent, date?: Date) => {
                                        if (date) {
                                            setValue('service_date', dateToISO(date), {
                                                shouldValidate: true,
                                            });
                                        }
                                    }}
                                />
                            </Pressable>
                        </Pressable>
                    </Modal>
                ) : showDatePicker ? (
                    <DateTimePicker
                        value={serviceDate ? isoToDate(serviceDate) : new Date()}
                        mode="date"
                        display="default"
                        maximumDate={new Date()}
                        onChange={(event: DateTimePickerEvent, date?: Date) => {
                            setShowDatePicker(false);
                            if (event.type !== 'dismissed' && date) {
                                setValue('service_date', dateToISO(date), { shouldValidate: true });
                            }
                        }}
                    />
                ) : null}

                {/* ─── Nº O.S. Concessionária (oculto p/ VN/VD/VU) ──────── */}
                {department !== 'vn' && department !== 'vd' && department !== 'vu' ? (
                    <Controller
                        control={control}
                        name="external_os_number"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Nº O.S. Concessionária"
                                placeholder="Ex: 12345"
                                keyboardType="number-pad"
                                autoCorrect={false}
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.external_os_number?.message}
                                editable={!locked && !isBusy}
                            />
                        )}
                    />
                ) : null}

                {/* ─── Placa / Chassi ───────────────────────────────────── */}
                <Controller
                    control={control}
                    name="plate"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Placa / Chassi *"
                            placeholder="ABC1D23"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={value}
                            onChangeText={(t) => onChange(t.toUpperCase())}
                            onBlur={onBlur}
                            error={errors.plate?.message}
                            editable={!locked && !isBusy}
                        />
                    )}
                />

                {/* Marca não é renderizada: deriva 1:1 da loja. */}

                {/* ─── Modelo ───────────────────────────────────────────── */}
                <FieldLabel>Modelo *</FieldLabel>
                <PickerField
                    placeholder={
                        storeBrandId
                            ? modelsLoading
                                ? 'Carregando modelos...'
                                : 'Selecionar modelo...'
                            : 'Sem marca vinculada à loja'
                    }
                    value={watch('vehicle_model')}
                    disabled={locked || !storeBrandId}
                    onPress={() => modelSheetRef.current?.present()}
                    error={errors.vehicle_model?.message}
                />

                {/* ─── Cor ──────────────────────────────────────────────── */}
                <Controller
                    control={control}
                    name="vehicle_color"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Cor *"
                            placeholder="Ex: Branco"
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            error={errors.vehicle_color?.message}
                            editable={!locked && !isBusy}
                        />
                    )}
                />

                {/* ─── Consultor ────────────────────────────────────────── */}
                <FieldLabel>{isGalpon ? 'Consultor' : 'Consultor *'}</FieldLabel>
                <PickerField
                    placeholder={
                        consultantsLoading ? 'Carregando consultores...' : 'Selecionar consultor...'
                    }
                    value={selectedConsultantName}
                    disabled={locked}
                    onPress={() => consultantSheetRef.current?.present()}
                    error={errors.consultant_id?.message}
                />

                {/* ─── Serviços (multi-select) ──────────────────────────── */}
                <View className="mb-4">
                    <Controller
                        control={control}
                        name="items"
                        render={({ field: { onChange, value } }) => (
                            <ServiceItemPicker
                                label="Serviços *"
                                department={department}
                                brandId={storeBrandId}
                                storeId={order.location_id}
                                value={value as ServiceItemSelection[]}
                                onChange={locked ? () => {} : onChange}
                                error={errors.items?.message}
                            />
                        )}
                    />
                </View>

                {/* ─── Observações ──────────────────────────────────────── */}
                <Controller
                    control={control}
                    name="notes"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label="Observações"
                            placeholder="Notas adicionais..."
                            multiline
                            numberOfLines={3}
                            style={{ minHeight: 80, textAlignVertical: 'top' }}
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            editable={!locked && !isBusy}
                        />
                    )}
                />

                {/* ─── Ações ────────────────────────────────────────────── */}
                <View className="mt-2 gap-3">
                    <Button
                        title={isBusy ? 'Salvando...' : 'Salvar alterações'}
                        icon="checkmark"
                        loading={isBusy}
                        disabled={locked || isBusy}
                        onPress={onSave}
                    />
                    <Button
                        title="Cancelar"
                        variant="ghost"
                        disabled={isBusy}
                        onPress={() => navigation.goBack()}
                    />
                </View>
            </ScrollView>

            {/* ─── Sheets de seleção ───────────────────────────────────── */}
            <Select<number>
                ref={modelSheetRef}
                title="Selecionar modelo"
                options={modelOptions}
                value={vehicleModelId ?? null}
                onChange={(v) => {
                    const model = vehicleModels.find((m) => m.id === v);
                    setValue('vehicle_model_id', v);
                    setValue('vehicle_model', model?.name ?? '', { shouldValidate: true });
                }}
            />
            <Select<number>
                ref={consultantSheetRef}
                title="Selecionar consultor"
                options={consultantOptions}
                value={consultantId ?? null}
                onChange={(v) => setValue('consultant_id', v, { shouldValidate: true })}
            />
        </View>
    );
}

// ─── Subcomponentes locais ────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}

/** Campo somente-leitura (Nº O.S., Loja). */
function ReadonlyField({ value }: { value: string }) {
    return (
        <View className="mb-4 min-h-[48px] justify-center rounded-lg border border-neutral-200 bg-neutral-100 px-4 dark:border-dark-border-strong dark:bg-dark-elevated">
            <Text className="font-sans text-base text-neutral-700 dark:text-dark-text">{value}</Text>
        </View>
    );
}

interface PickerFieldProps {
    placeholder: string;
    value?: string;
    onPress: () => void;
    error?: string;
    disabled?: boolean;
}

/** Campo de "abrir sheet" — aparência de input com chevron (área de toque ≥48). */
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
