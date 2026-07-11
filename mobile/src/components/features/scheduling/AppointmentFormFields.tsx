import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useStores } from '@/hooks/useStores';
import { useVehicleModels } from '@/hooks/useVehicleModels';
import { useConsultants } from '@/hooks/useConsultants';
import { useServices } from '@/hooks/useServices';
import { useFilmTypes } from '@/hooks/useInventory';
import type { FilmDepartment } from '@/services/api/inventory.service';
import { useAppointmentCapacity } from '@/hooks/useScheduling';
import { useStoreStore } from '@/stores/store.store';
import { useGalponFlags } from '@/navigation/guards';
import { DEPARTMENT_LABELS, getTonalityOptionsForFilmType } from '@/constants/scheduling';
import type {
    Appointment,
    CreateAppointmentPayload,
    FilmEntryItem,
} from '@/types/scheduling.types';

/**
 * AGD-03 / AGD-04 — Campos compartilhados do formulário de Agendamento.
 *
 * Componente único reutilizado por CreateAppointmentScreen e
 * EditAppointmentScreen (evita duplicar a tela). Espelha o web
 * (frontend/.../scheduling/AppointmentForm.tsx) e segue o MESMO padrão do
 * CreateServiceOrderScreen mobile (RHF + Zod, Select bottom-sheet,
 * DateTimePicker, chips de tipo/galpão, placa via regex, marca derivada da loja).
 *
 * Diferenças vs. O.S.:
 * - Película detalhada AQUI no agendamento (film_entries com tonalidade/PPF),
 *   espelhando o web.
 * - data + hora separadas (delivery_date / delivery_time).
 * - REGRA CRÍTICA: no modo `edit`, o usuário galpão PODE desmarcar `is_galpon`
 *   (no Create, se for perfil galpão, o toggle fica travado em galpão — igual
 *   ao web/CreateServiceOrderScreen).
 *
 * O componente NÃO chama mutations: monta o payload e delega via `onSubmit`.
 */

// ─── Validação de placa / chassi (regex do CreateServiceOrderScreen) ──────────
const PLATE_MERCOSUL = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const PLATE_OLD = /^[A-Z]{3}[0-9]{4}$/;
const CHASSI_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const CHASSI_CURTO = /^[A-Z0-9]{4,17}$/;

export function isValidPlateOrChassi(value: string): boolean {
    const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return PLATE_MERCOSUL.test(v) || PLATE_OLD.test(v) || CHASSI_VIN.test(v) || CHASSI_CURTO.test(v);
}

const DEPARTMENTS = Object.entries(DEPARTMENT_LABELS) as [string, string][];
const DEPT_VALUES = DEPARTMENTS.map(([value]) => value) as [string, ...string[]];

// ─── Schema Zod (espelha o web AppointmentForm) ───────────────────────────────
export const appointmentSchema = z
    .object({
        store_id: z.number({ error: 'Selecione a loja' }).int().positive('Selecione a loja'),
        department: z.enum(DEPT_VALUES, { error: 'Selecione o departamento' }),
        // Tipo (Normal/Cortesia/Retorno) exige escolha explícita — espelha a O.S.
        is_courtesy: z.boolean(),
        is_return: z.boolean(),
        courtesy_return_set: z.boolean().refine((v) => v === true, 'Selecione o tipo'),
        is_galpon: z.boolean(),
        delivery_date: z.string().min(1, 'Informe a previsão de entrega'),
        delivery_time: z.string().min(1, 'Informe o horário de entrega'),
        external_os_number: z.string().optional(),
        vehicle_plate: z
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
        notes: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        // Consultor obrigatório quando NÃO for galpão (espelha o web).
        if (!data.is_galpon && !data.consultant_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Consultor obrigatório',
                path: ['consultant_id'],
            });
        }
    });

export type AppointmentFormData = z.infer<typeof appointmentSchema>;

/** Entrada de película no estado local (com nome/código para exibição). */
interface FilmEntryLocal extends FilmEntryItem {
    service_name: string;
    service_code: string | null;
}

export interface AppointmentFormFieldsProps {
    mode: 'create' | 'edit';
    /** Agendamento existente (modo edit) — para popular o form. */
    appointment?: Appointment | null;
    /** Recebe o payload já montado; o caller chama a mutation. */
    onSubmit: (payload: CreateAppointmentPayload) => void;
    /** Mutation em andamento (desabilita campos/ações). */
    submitting: boolean;
}

type CourtesyReturnValue = 'normal' | 'courtesy' | 'return';
const COURTESY_RETURN_OPTIONS: { value: CourtesyReturnValue; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'courtesy', label: 'Cortesia' },
    { value: 'return', label: 'Retorno' },
];

const FILM_DEPTS = ['film', 'security_film', 'ppf'];

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
function formatDateBR(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** "AAAA-MM-DD" → Date local (meio-dia evita drift de fuso). */
function isoToDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/** Date → "AAAA-MM-DD" (componentes locais). */
function dateToISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** "HH:MM" → Date local (data arbitrária). */
function timeToDate(time: string): Date {
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d;
}

/** Date → "HH:MM". */
function dateToTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

export function AppointmentFormFields({
    mode,
    appointment,
    onSubmit,
    submitting,
}: AppointmentFormFieldsProps) {
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const { isGalponProfile, hideGalponOption } = useGalponFlags();

    // No Create, o perfil galpão trava o toggle em galpão (igual à O.S.).
    // No Edit, o usuário galpão PODE desmarcar (regra do agendamento).
    const lockGalponToggle = mode === 'create' && isGalponProfile;

    // Loja default (Create): loja global selecionada; senão a primeira acessível.
    const defaultStoreId = selectedStoreId ?? stores[0]?.id ?? undefined;

    const [filmEntries, setFilmEntries] = useState<FilmEntryLocal[]>([]);
    const [pendingFilmServiceId, setPendingFilmServiceId] = useState<number | null>(null);
    const [pendingFilmTonality, setPendingFilmTonality] = useState<string | null>(null);
    const [pendingFilmTypeId, setPendingFilmTypeId] = useState<number | null>(null);
    const [serviceError, setServiceError] = useState<string | null>(null);
    // Serviços (departamentos não-película) — lista de ids.
    const [serviceIds, setServiceIds] = useState<number[]>([]);

    const {
        control,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<AppointmentFormData>({
        resolver: zodResolver(appointmentSchema),
        defaultValues: {
            store_id: defaultStoreId as unknown as number,
            department: undefined as unknown as string,
            is_courtesy: false,
            is_return: false,
            courtesy_return_set: false,
            is_galpon: mode === 'create' ? isGalponProfile : false,
            delivery_date: todayISO(),
            delivery_time: '',
            external_os_number: '',
            vehicle_plate: '',
            vehicle_model: '',
            vehicle_model_id: undefined,
            vehicle_color: '',
            consultant_id: undefined,
            notes: '',
        },
    });

    const storeId = watch('store_id');
    const department = watch('department');
    const isGalpon = watch('is_galpon');
    const isCourtesy = watch('is_courtesy');
    const isReturn = watch('is_return');
    const courtesyReturnSet = watch('courtesy_return_set');
    const consultantId = watch('consultant_id');
    const vehicleModelId = watch('vehicle_model_id');
    const deliveryDate = watch('delivery_date');
    const deliveryTime = watch('delivery_time');

    const isFilmDept = FILM_DEPTS.includes(department);
    // Tonalidade é obrigatória por película nesses departamentos (PPF usa marca).
    const requiresTonality = department === 'film' || department === 'security_film';

    // Loja resolvida + marca (derivada 1:1 da loja — filtra modelo/serviços).
    const currentStore = useMemo(
        () => stores.find((s) => s.id === storeId),
        [stores, storeId]
    );
    const storeBrandId = currentStore?.brand_id ?? undefined;

    // Pickers de dados.
    const { data: vehicleModels = [], isLoading: modelsLoading } = useVehicleModels(
        storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );
    const { consultants, isLoading: consultantsLoading } = useConsultants(
        storeId ? { store_id: storeId, is_active: true } : undefined,
        1,
        200
    );
    const { data: allServices = [], isLoading: servicesLoading } = useServices(
        department || undefined,
        storeBrandId
    );
    // A8 — serviços exclusivos de cortesia só aparecem quando o agendamento é cortesia.
    const services = useMemo(
        () => (isCourtesy ? allServices : allServices.filter((s) => !s.is_courtesy_only)),
        [allServices, isCourtesy]
    );
    // Tipos de película do departamento atual (film/security_film/ppf).
    // - PPF: usados como "Marca PPF" (seleção por entrada → `ppfBrands`).
    // - film/security_film: usados para derivar as tonalidades disponíveis (A7),
    //   já que esses departamentos não selecionam um FilmType por entrada.
    const { data: filmTypes = [] } = useFilmTypes(
        isFilmDept ? (department as FilmDepartment) : undefined
    );
    const ppfBrands = filmTypes;

    // Capacidade (aviso amarelo não-bloqueante).
    const { data: capacityCount } = useAppointmentCapacity(
        storeId ?? null,
        deliveryDate
    );

    // ─── Popular o form no modo edit (uma vez, ao chegar o appointment) ────────
    const populatedRef = useRef(false);
    useEffect(() => {
        if (mode !== 'edit' || !appointment || populatedRef.current) return;
        populatedRef.current = true;
        reset({
            store_id: appointment.store_id,
            department: appointment.department,
            is_courtesy: appointment.is_courtesy,
            is_return: appointment.is_return,
            courtesy_return_set: true,
            is_galpon: appointment.is_galpon ?? false,
            delivery_date: appointment.delivery_date,
            delivery_time: appointment.delivery_time ?? '',
            external_os_number: appointment.external_os_number ?? '',
            vehicle_plate: appointment.vehicle_plate,
            vehicle_model: appointment.vehicle_model ?? '',
            vehicle_model_id: undefined,
            vehicle_color: appointment.vehicle_color ?? '',
            consultant_id: appointment.consultant_id ?? undefined,
            notes: appointment.notes ?? '',
        });
        setServiceIds(appointment.service_ids ?? []);
        if (appointment.film_entries && appointment.film_entries.length > 0) {
            const ids = appointment.service_ids ?? [];
            const names = appointment.service_names ?? [];
            setFilmEntries(
                appointment.film_entries.map((fe, idx) => {
                    const pos = ids.indexOf(fe.service_id);
                    const name = (pos >= 0 ? names[pos] : names[idx]) ?? `Serviço ${fe.service_id}`;
                    return {
                        service_id: fe.service_id,
                        tonality: fe.tonality,
                        film_type_id: fe.film_type_id ?? undefined,
                        film_roll_id: fe.film_roll_id ?? null,
                        service_name: name,
                        service_code: null,
                    };
                })
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, appointment]);

    // ─── Refs dos sheets ──────────────────────────────────────────────────────
    const storeSheetRef = useRef<SelectRef>(null);
    const modelSheetRef = useRef<SelectRef>(null);
    const consultantSheetRef = useRef<SelectRef>(null);
    const serviceSheetRef = useRef<SelectRef>(null);
    const filmServiceSheetRef = useRef<SelectRef>(null);
    const filmTonalitySheetRef = useRef<SelectRef>(null);
    const filmBrandSheetRef = useRef<SelectRef>(null);

    // Date/time pickers.
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);

    const courtesyReturn: CourtesyReturnValue | null = !courtesyReturnSet
        ? null
        : isCourtesy
          ? 'courtesy'
          : isReturn
            ? 'return'
            : 'normal';

    // ─── Opções dos sheets ────────────────────────────────────────────────────
    const storeOptions = useMemo(
        () => stores.map((s) => ({ value: s.id, label: s.name })),
        [stores]
    );
    const modelOptions = useMemo(
        () => vehicleModels.map((m) => ({ value: m.id, label: m.name })),
        [vehicleModels]
    );
    const consultantOptions = useMemo(
        () => consultants.map((c) => ({ value: c.id, label: c.name })),
        [consultants]
    );
    const sortByLabel = (a: { label: string }, b: { label: string }) =>
        a.label.localeCompare(b.label, 'pt-BR');

    // Serviços para o multi-select (não-película).
    const serviceOptions = useMemo(
        () =>
            services
                .map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
                .sort(sortByLabel),
        [services]
    );
    // Serviços disponíveis para adicionar como película (exclui já adicionados).
    const filmServiceOptions = useMemo(
        () =>
            services
                .filter((s) => !filmEntries.some((e) => e.service_id === s.id))
                .map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
                .sort(sortByLabel),
        [services, filmEntries]
    );
    const pendingFilmService = services.find((s) => s.id === pendingFilmServiceId);
    // A7 — tonalidades dirigidas pelo tipo de película. Como film/security_film
    // não selecionam um FilmType por entrada, unimos as `available_tonalities` de
    // todos os tipos do departamento (na ordem canônica). Sem tipos configurados,
    // `getTonalityOptionsForFilmType` cai no fallback por serviço/departamento.
    const departmentTonalities = useMemo(() => {
        const set = new Set<string>();
        for (const ft of filmTypes) {
            for (const t of ft.available_tonalities ?? []) set.add(t);
        }
        return [...set];
    }, [filmTypes]);
    const tonalityOptions = useMemo(
        () =>
            getTonalityOptionsForFilmType({
                serviceCode: pendingFilmService?.code,
                department,
                availableTonalities: departmentTonalities,
            }),
        [pendingFilmService, department, departmentTonalities]
    );
    const ppfBrandOptions = useMemo(
        () => ppfBrands.map((ft) => ({ value: ft.id, label: ft.name })),
        [ppfBrands]
    );

    const selectedConsultantName = consultants.find((c) => c.id === consultantId)?.name;
    const selectedServices = useMemo(
        () => services.filter((s) => serviceIds.includes(s.id)),
        [services, serviceIds]
    );

    // ─── Película: adicionar / remover ────────────────────────────────────────
    const addFilmEntry = () => {
        if (!pendingFilmServiceId) return;
        const svc = services.find((s) => s.id === pendingFilmServiceId);
        if (!svc) return;
        if (requiresTonality && !pendingFilmTonality) {
            setServiceError('Selecione a tonalidade da película.');
            return;
        }
        setFilmEntries((prev) => [
            ...prev,
            {
                service_id: svc.id,
                tonality: pendingFilmTonality,
                film_type_id: pendingFilmTypeId ?? undefined,
                film_roll_id: null,
                service_name: svc.name,
                service_code: svc.code ?? null,
            },
        ]);
        setPendingFilmServiceId(null);
        setPendingFilmTonality(null);
        setPendingFilmTypeId(null);
        setServiceError(null);
    };

    const removeFilmEntry = (serviceId: number) => {
        setFilmEntries((prev) => prev.filter((e) => e.service_id !== serviceId));
    };

    const removeService = (serviceId: number) => {
        setServiceIds((prev) => prev.filter((id) => id !== serviceId));
    };

    // ─── Submit ───────────────────────────────────────────────────────────────
    const submit = (data: AppointmentFormData) => {
        Keyboard.dismiss();
        const hasServices = isFilmDept ? filmEntries.length > 0 : serviceIds.length > 0;
        if (!hasServices) {
            setServiceError('Adicione ao menos 1 serviço para continuar.');
            return;
        }
        if (requiresTonality && filmEntries.some((e) => !e.tonality)) {
            setServiceError(
                'Informe a tonalidade de todas as películas (remova a película sem tonalidade e adicione novamente).'
            );
            return;
        }
        setServiceError(null);

        const payload: CreateAppointmentPayload = {
            store_id: data.store_id,
            department: data.department,
            delivery_date: data.delivery_date,
            delivery_time: data.delivery_time || undefined,
            external_os_number: data.external_os_number?.trim() || undefined,
            vehicle_plate: data.vehicle_plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
            vehicle_model: data.vehicle_model || undefined,
            vehicle_color: data.vehicle_color || undefined,
            consultant_id: data.consultant_id || undefined,
            service_ids: isFilmDept
                ? filmEntries.map((e) => e.service_id)
                : serviceIds.length > 0
                  ? serviceIds
                  : undefined,
            film_entries:
                isFilmDept && filmEntries.length > 0
                    ? filmEntries.map(({ service_id, tonality, film_roll_id, film_type_id }) => ({
                          service_id,
                          tonality,
                          film_roll_id: film_roll_id ?? undefined,
                          film_type_id: film_type_id ?? undefined,
                      }))
                    : undefined,
            notes: data.notes?.trim() || undefined,
            is_galpon: data.is_galpon,
            is_courtesy: data.is_courtesy,
            is_return: data.is_return,
        };

        onSubmit(payload);
    };

    const onPressSave = handleSubmit(submit);

    const isBusy = submitting;
    const storeLocked = stores.length <= 1;

    return (
        <View>
            {/* ─── Loja ─────────────────────────────────────────────────── */}
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

            {/* ─── Tipo (Normal/Cortesia/Retorno) + Galpão ──────────────── */}
            <FieldLabel>Tipo *</FieldLabel>
            <View className="mb-1 flex-row flex-wrap gap-2">
                {COURTESY_RETURN_OPTIONS.map((opt) => (
                    <Chip
                        key={opt.value}
                        label={opt.label}
                        active={courtesyReturn === opt.value}
                        disabled={isBusy}
                        onPress={() => {
                            setValue('is_courtesy', opt.value === 'courtesy');
                            setValue('is_return', opt.value === 'return');
                            setValue('courtesy_return_set', true, { shouldValidate: true });
                        }}
                    />
                ))}
                {!hideGalponOption ? (
                    <Chip
                        label="Galpão"
                        active={isGalpon}
                        // No Create com perfil galpão o toggle fica travado; no Edit
                        // o usuário galpão PODE desmarcar (regra do agendamento).
                        disabled={isBusy || lockGalponToggle}
                        onPress={() => {
                            if (!lockGalponToggle) setValue('is_galpon', !isGalpon);
                        }}
                    />
                ) : null}
            </View>
            {errors.courtesy_return_set ? (
                <Text className="mb-3 mt-1 font-sans text-sm text-error">
                    {errors.courtesy_return_set.message}
                </Text>
            ) : (
                <View className="mb-3" />
            )}

            {/* ─── Departamento ─────────────────────────────────────────── */}
            <FieldLabel>Departamento *</FieldLabel>
            <View className="mb-1 flex-row flex-wrap gap-2">
                {DEPARTMENTS.map(([value, label]) => (
                    <Chip
                        key={value}
                        label={label}
                        active={department === value}
                        disabled={isBusy}
                        onPress={() => {
                            if (value !== department) {
                                // Trocar de departamento invalida serviços/película.
                                setServiceIds([]);
                                setFilmEntries([]);
                                setPendingFilmServiceId(null);
                                setPendingFilmTonality(null);
                                setPendingFilmTypeId(null);
                                setServiceError(null);
                            }
                            setValue('department', value, { shouldValidate: true });
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

            {/* ─── Data + Horário de entrega ────────────────────────────── */}
            <View className="flex-row gap-3">
                <View className="flex-1">
                    <FieldLabel>Previsão de entrega *</FieldLabel>
                    <PickerField
                        placeholder="Data..."
                        value={deliveryDate ? formatDateBR(deliveryDate) : undefined}
                        onPress={() => {
                            Keyboard.dismiss();
                            setShowDatePicker(true);
                        }}
                        error={errors.delivery_date?.message}
                        disabled={isBusy}
                    />
                </View>
                <View className="flex-1">
                    <FieldLabel>Horário *</FieldLabel>
                    <PickerField
                        placeholder="HH:MM"
                        value={deliveryTime || undefined}
                        onPress={() => {
                            Keyboard.dismiss();
                            setShowTimePicker(true);
                        }}
                        error={errors.delivery_time?.message}
                        disabled={isBusy}
                    />
                </View>
            </View>

            {/* Date picker */}
            {showDatePicker && Platform.OS === 'ios' ? (
                <PickerModal title="Previsão de entrega" onClose={() => setShowDatePicker(false)}>
                    <DateTimePicker
                        value={deliveryDate ? isoToDate(deliveryDate) : new Date()}
                        mode="date"
                        display="spinner"
                        onChange={(_e: DateTimePickerEvent, date?: Date) => {
                            if (date)
                                setValue('delivery_date', dateToISO(date), {
                                    shouldValidate: true,
                                });
                        }}
                    />
                </PickerModal>
            ) : showDatePicker ? (
                <DateTimePicker
                    value={deliveryDate ? isoToDate(deliveryDate) : new Date()}
                    mode="date"
                    display="default"
                    onChange={(event: DateTimePickerEvent, date?: Date) => {
                        setShowDatePicker(false);
                        if (event.type !== 'dismissed' && date)
                            setValue('delivery_date', dateToISO(date), { shouldValidate: true });
                    }}
                />
            ) : null}

            {/* Time picker */}
            {showTimePicker && Platform.OS === 'ios' ? (
                <PickerModal title="Horário de entrega" onClose={() => setShowTimePicker(false)}>
                    <DateTimePicker
                        value={deliveryTime ? timeToDate(deliveryTime) : new Date()}
                        mode="time"
                        is24Hour
                        display="spinner"
                        onChange={(_e: DateTimePickerEvent, date?: Date) => {
                            if (date)
                                setValue('delivery_time', dateToTime(date), {
                                    shouldValidate: true,
                                });
                        }}
                    />
                </PickerModal>
            ) : showTimePicker ? (
                <DateTimePicker
                    value={deliveryTime ? timeToDate(deliveryTime) : new Date()}
                    mode="time"
                    is24Hour
                    display="default"
                    onChange={(event: DateTimePickerEvent, date?: Date) => {
                        setShowTimePicker(false);
                        if (event.type !== 'dismissed' && date)
                            setValue('delivery_time', dateToTime(date), { shouldValidate: true });
                    }}
                />
            ) : null}

            {/* ─── Aviso de capacidade (não-bloqueante) ─────────────────── */}
            {capacityCount !== undefined && capacityCount > 0 ? (
                <View className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-900/20">
                    <Text className="font-sans text-sm text-amber-800 dark:text-amber-300">
                        {`Já há ${capacityCount} agendamento${capacityCount > 1 ? 's' : ''} nesta data nesta loja.`}
                    </Text>
                </View>
            ) : null}

            {/* ─── N. OS Concessionária ─────────────────────────────────── */}
            <Controller
                control={control}
                name="external_os_number"
                render={({ field: { onChange, onBlur, value } }) => (
                    <TextField
                        label="Nº O.S. Concessionária"
                        placeholder="Ex: OS-2024-001"
                        autoCorrect={false}
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        editable={!isBusy}
                    />
                )}
            />

            {/* ─── Placa / Chassi ───────────────────────────────────────── */}
            <Controller
                control={control}
                name="vehicle_plate"
                render={({ field: { onChange, onBlur, value } }) => (
                    <TextField
                        label="Placa / Chassi *"
                        placeholder="ABC1D23"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        value={value}
                        onChangeText={(t) => onChange(t.toUpperCase())}
                        onBlur={onBlur}
                        error={errors.vehicle_plate?.message}
                        editable={!isBusy}
                    />
                )}
            />

            {/* ─── Modelo (deriva da marca da loja) ─────────────────────── */}
            <FieldLabel>Modelo *</FieldLabel>
            <PickerField
                placeholder={
                    storeBrandId
                        ? modelsLoading
                            ? 'Carregando modelos...'
                            : 'Selecionar modelo...'
                        : 'Selecione a loja primeiro'
                }
                value={watch('vehicle_model')}
                disabled={!storeBrandId || isBusy}
                onPress={() => modelSheetRef.current?.present()}
                error={errors.vehicle_model?.message}
            />

            {/* ─── Cor ──────────────────────────────────────────────────── */}
            <Controller
                control={control}
                name="vehicle_color"
                render={({ field: { onChange, onBlur, value } }) => (
                    <TextField
                        label="Cor *"
                        placeholder="Ex: Prata"
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        error={errors.vehicle_color?.message}
                        editable={!isBusy}
                    />
                )}
            />

            {/* ─── Consultor (obrigatório se não galpão) ────────────────── */}
            <FieldLabel>{isGalpon ? 'Consultor' : 'Consultor *'}</FieldLabel>
            <PickerField
                placeholder={
                    !storeId
                        ? 'Selecione a loja primeiro'
                        : consultantsLoading
                          ? 'Carregando consultores...'
                          : 'Selecionar consultor...'
                }
                value={selectedConsultantName}
                disabled={!storeId || isBusy}
                onPress={() => consultantSheetRef.current?.present()}
                error={errors.consultant_id?.message}
            />

            {/* ─── Películas (film/security_film/ppf) ───────────────────── */}
            {isFilmDept ? (
                <View className="mb-4 rounded-2xl border border-neutral-100 bg-neutral-50 p-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                    <Text className="mb-2 font-sans-semibold text-xs uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                        Películas
                    </Text>

                    {!storeBrandId ? (
                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Selecione a loja para ver os serviços disponíveis.
                        </Text>
                    ) : (
                        <>
                            {/* Picker: serviço */}
                            <FieldLabel>Serviço</FieldLabel>
                            <PickerField
                                placeholder={
                                    servicesLoading
                                        ? 'Carregando serviços...'
                                        : filmServiceOptions.length === 0
                                          ? 'Nenhum serviço disponível'
                                          : 'Selecionar serviço...'
                                }
                                value={pendingFilmService?.name}
                                disabled={isBusy || filmServiceOptions.length === 0}
                                onPress={() => filmServiceSheetRef.current?.present()}
                            />

                            {/* Tonalidade (film / security_film) */}
                            {(department === 'film' || department === 'security_film') &&
                            pendingFilmServiceId ? (
                                <>
                                    <FieldLabel>Tonalidade *</FieldLabel>
                                    <PickerField
                                        placeholder="Selecionar tonalidade..."
                                        value={pendingFilmTonality ?? undefined}
                                        disabled={isBusy}
                                        onPress={() => filmTonalitySheetRef.current?.present()}
                                    />
                                </>
                            ) : null}

                            {/* Marca PPF */}
                            {department === 'ppf' && pendingFilmServiceId ? (
                                <>
                                    <FieldLabel>Marca PPF</FieldLabel>
                                    <PickerField
                                        placeholder="Selecionar marca..."
                                        value={
                                            ppfBrands.find((b) => b.id === pendingFilmTypeId)?.name
                                        }
                                        disabled={isBusy}
                                        onPress={() => filmBrandSheetRef.current?.present()}
                                    />
                                </>
                            ) : null}

                            <Button
                                title="Adicionar película"
                                variant="secondary"
                                icon="add"
                                disabled={
                                    isBusy ||
                                    !pendingFilmServiceId ||
                                    (requiresTonality && !pendingFilmTonality)
                                }
                                onPress={addFilmEntry}
                            />
                        </>
                    )}

                    {/* Entradas adicionadas */}
                    {filmEntries.length > 0 ? (
                        <View className="mt-3 gap-2">
                            {filmEntries.map((entry, idx) => {
                                const brand = ppfBrands.find((b) => b.id === entry.film_type_id);
                                const label = entry.service_code
                                    ? `${entry.service_code} — ${entry.service_name}`
                                    : entry.service_name;
                                return (
                                    <View
                                        key={`${entry.service_id}-${idx}`}
                                        className="flex-row items-center gap-3 rounded-xl bg-white px-3.5 py-3 dark:bg-dark-surface"
                                    >
                                        <Ionicons name="layers-outline" size={18} color="#98A2B3" />
                                        <View className="flex-1">
                                            <Text
                                                className="font-sans text-sm text-neutral-800 dark:text-dark-text"
                                                numberOfLines={2}
                                            >
                                                {label}
                                            </Text>
                                            {entry.tonality || brand ? (
                                                <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                                    {[entry.tonality, brand?.name]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Remover ${entry.service_name}`}
                                            hitSlop={8}
                                            onPress={() => removeFilmEntry(entry.service_id)}
                                            className="h-7 w-7 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                                        >
                                            <Ionicons name="close" size={18} color="#98A2B3" />
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}

                    {serviceError ? (
                        <Text className="mt-2 font-sans text-sm text-error">{serviceError}</Text>
                    ) : null}
                </View>
            ) : null}

            {/* ─── Serviços (departamentos não-película) ────────────────── */}
            {department && !isFilmDept ? (
                <View className="mb-4">
                    <FieldLabel>Serviços *</FieldLabel>
                    <PickerField
                        placeholder={
                            !storeBrandId
                                ? 'Selecione a loja primeiro'
                                : servicesLoading
                                  ? 'Carregando serviços...'
                                  : serviceIds.length > 0
                                    ? `${serviceIds.length} serviço(s) selecionado(s)`
                                    : 'Selecionar serviços...'
                        }
                        disabled={!storeBrandId || isBusy}
                        onPress={() => serviceSheetRef.current?.present()}
                        error={serviceError ?? undefined}
                    />
                    {selectedServices.length > 0 ? (
                        <View className="mt-2 gap-2">
                            {selectedServices.map((svc) => (
                                <View
                                    key={svc.id}
                                    className="flex-row items-center gap-3 rounded-xl bg-neutral-50 px-3.5 py-3 dark:bg-dark-elevated"
                                >
                                    <Ionicons name="cube-outline" size={18} color="#98A2B3" />
                                    <Text
                                        className="flex-1 font-sans text-sm text-neutral-800 dark:text-dark-text"
                                        numberOfLines={2}
                                    >
                                        {svc.code ? `${svc.code} — ${svc.name}` : svc.name}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Remover ${svc.name}`}
                                        hitSlop={8}
                                        onPress={() => removeService(svc.id)}
                                        className="h-7 w-7 items-center justify-center rounded-full active:bg-neutral-200 dark:active:bg-dark-surface"
                                    >
                                        <Ionicons name="close" size={18} color="#98A2B3" />
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                    ) : null}
                </View>
            ) : null}

            {/* ─── Observações ──────────────────────────────────────────── */}
            <Controller
                control={control}
                name="notes"
                render={({ field: { onChange, onBlur, value } }) => (
                    <TextField
                        label="Observações"
                        placeholder="Informações adicionais..."
                        multiline
                        numberOfLines={3}
                        style={{ minHeight: 80, textAlignVertical: 'top' }}
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        editable={!isBusy}
                    />
                )}
            />

            {/* ─── Ação ─────────────────────────────────────────────────── */}
            <View className="mt-2">
                <Button
                    title={isBusy ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Criar agendamento'}
                    icon="checkmark"
                    loading={isBusy}
                    disabled={isBusy}
                    onPress={onPressSave}
                />
            </View>

            {/* ─── Sheets de seleção ────────────────────────────────────── */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={storeOptions}
                value={storeId ?? null}
                onChange={(v) => {
                    setValue('store_id', v, { shouldValidate: true });
                    // Trocar de loja pode mudar a marca → limpa modelo/consultor.
                    setValue('vehicle_model', '');
                    setValue('vehicle_model_id', undefined);
                    setValue('consultant_id', undefined);
                    setServiceIds([]);
                    setFilmEntries([]);
                }}
            />
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
            {department && !isFilmDept ? (
                <Select<number>
                    ref={serviceSheetRef}
                    title="Selecionar serviços"
                    multiple
                    options={serviceOptions}
                    value={serviceIds}
                    onChange={(ids) => {
                        setServiceIds(ids);
                        if (ids.length > 0) setServiceError(null);
                    }}
                />
            ) : null}
            {isFilmDept ? (
                <>
                    <Select<number>
                        ref={filmServiceSheetRef}
                        title="Selecionar serviço"
                        options={filmServiceOptions}
                        value={pendingFilmServiceId}
                        onChange={(v) => {
                            setPendingFilmServiceId(v);
                            setPendingFilmTonality(null);
                            setPendingFilmTypeId(null);
                        }}
                    />
                    <Select<string>
                        ref={filmTonalitySheetRef}
                        title="Selecionar tonalidade"
                        options={tonalityOptions}
                        value={pendingFilmTonality}
                        onChange={(v) => {
                            setPendingFilmTonality(v);
                            setServiceError(null);
                        }}
                    />
                    {department === 'ppf' ? (
                        <Select<number>
                            ref={filmBrandSheetRef}
                            title="Selecionar marca PPF"
                            options={ppfBrandOptions}
                            value={pendingFilmTypeId}
                            onChange={(v) => setPendingFilmTypeId(v)}
                        />
                    ) : null}
                </>
            ) : null}
        </View>
    );
}

// ─── Subcomponentes locais (espelham CreateServiceOrderScreen) ────────────────

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

/** Modal de picker iOS (envolve o DateTimePicker inline com "Pronto"). */
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
