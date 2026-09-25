import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
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
import { useTheme } from '@/theme';
import {
    DEPARTMENT_LABELS,
    FILM_REGION_SUGGESTIONS,
    getTonalityOptionsForFilmType,
} from '@/constants/scheduling';
import type {
    Appointment,
    CombinedAppointmentPayload,
    CombinedDepartmentEntry,
    CreateAppointmentPayload,
    FilmApplication,
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
 * AGENDAMENTO COMBINADO (2C) — só na CRIAÇÃO:
 * - Toggle "Combinado (múltiplos departamentos)". Ligado, o mesmo carro recebe
 *   VÁRIOS departamentos (chips multi-seleção), cada um com sua própria seção de
 *   serviços/películas (reusa `DepartmentServicesSection`). O submit monta
 *   `departments[]` e chama `onSubmitCombined` → POST /scheduling/combined.
 * - Espelha o web: ao ligar, semeia `combinedDepts` com o departamento atual; ao
 *   desligar, volta ao modo simples e limpa a seleção combinada.
 *
 * O componente NÃO chama mutations: monta o payload e delega via
 * `onSubmit`/`onSubmitCombined`; o caller (screen) chama a mutation.
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

const FILM_DEPTS = ['film', 'security_film', 'ppf'];
const isFilmDepartment = (dept: string) => FILM_DEPTS.includes(dept);
const deptRequiresTonality = (dept: string) => dept === 'film' || dept === 'security_film';

// ─── Schema Zod (espelha o web AppointmentForm) ───────────────────────────────
export const appointmentSchema = z
    .object({
        store_id: z.number({ error: 'Selecione a loja' }).int().positive('Selecione a loja'),
        // No modo combinado, `department` fica com o sentinel 'combined' (a seleção
        // real está em `combinedDepts`); por isso aceitamos qualquer string aqui e
        // validamos a seleção fora do schema (espelha o web).
        department: z.string().min(1, 'Selecione o departamento'),
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

/** Estado de serviços de UM departamento (não-película: serviceIds; película: filmEntries). */
interface ServiceSelectionState {
    serviceIds: number[];
    filmEntries: FilmEntryLocal[];
}

const EMPTY_SELECTION: ServiceSelectionState = { serviceIds: [], filmEntries: [] };

export interface AppointmentFormFieldsProps {
    mode: 'create' | 'edit';
    /** Agendamento existente (modo edit) — para popular o form. */
    appointment?: Appointment | null;
    /** Recebe o payload já montado; o caller chama a mutation. */
    onSubmit: (payload: CreateAppointmentPayload) => void;
    /**
     * Recebe o payload combinado (múltiplos departamentos). Obrigatório para
     * habilitar o modo combinado na CRIAÇÃO; se ausente, o toggle não aparece.
     */
    onSubmitCombined?: (payload: CombinedAppointmentPayload) => void;
    /**
     * Modo EDIÇÃO combinada: recebe o payload de atualização do agendamento
     * atual + os departamentos NOVOS a criar como irmãos. Obrigatório para
     * habilitar o toggle "Combinar" na edição; se ausente, o toggle não aparece.
     */
    onSubmitEditCombined?: (
        updatePayload: CreateAppointmentPayload,
        newDepartments: CombinedDepartmentEntry[]
    ) => void;
    /** Mutation em andamento (desabilita campos/ações). */
    submitting: boolean;
}

type CourtesyReturnValue = 'normal' | 'courtesy' | 'return';
const COURTESY_RETURN_OPTIONS: { value: CourtesyReturnValue; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'courtesy', label: 'Cortesia' },
    { value: 'return', label: 'Retorno' },
];

function todayISO(): string {
    // Data LOCAL (não UTC): `toISOString()` volta a data em UTC e, perto da
    // meia-noite, empurra a previsão de entrega para o dia seguinte (bug de +1).
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
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

/** Mapeia `filmEntries` locais → payload de `film_entries` (inclui applications). */
function buildFilmEntriesPayload(entries: FilmEntryLocal[]): FilmEntryItem[] {
    return entries.map(({ service_id, tonality, film_roll_id, film_type_id, applications }) => ({
        service_id,
        tonality,
        film_roll_id: film_roll_id ?? undefined,
        film_type_id: film_type_id ?? undefined,
        // Só envia applications quando o usuário detalhou por região; caso
        // contrário mantém a tonalidade única (comportamento atual).
        applications:
            applications && applications.length > 0
                ? applications.map(({ tonality: appTonality, region }) => ({
                      tonality: appTonality,
                      region: region?.trim() || undefined,
                  }))
                : undefined,
    }));
}

/**
 * Valida os serviços de um departamento (espelha `validateDeptSelection` do web).
 * Retorna a mensagem de erro ou `null` se estiver ok.
 */
function validateDeptSelection(dept: string, sel: ServiceSelectionState): string | null {
    const isFilm = isFilmDepartment(dept);
    const hasServices = isFilm ? sel.filmEntries.length > 0 : sel.serviceIds.length > 0;
    const label = DEPARTMENT_LABELS[dept] ?? dept;
    if (!hasServices) {
        return `Adicione ao menos 1 serviço para "${label}".`;
    }
    if (
        deptRequiresTonality(dept) &&
        sel.filmEntries.some((e) =>
            e.applications && e.applications.length > 0
                ? e.applications.some((app) => !app.tonality)
                : !e.tonality
        )
    ) {
        return `Informe a tonalidade de todas as películas em "${label}" (incluindo cada região adicionada).`;
    }
    return null;
}

export function AppointmentFormFields({
    mode,
    appointment,
    onSubmit,
    onSubmitCombined,
    onSubmitEditCombined,
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

    // Modo combinado: na criação combina do zero; na edição adiciona
    // departamentos-irmãos ao agendamento atual. Só habilita se o caller
    // souber tratar o modo correspondente.
    const combinedSupported =
        (mode === 'create' && !!onSubmitCombined) || (mode === 'edit' && !!onSubmitEditCombined);
    // Departamento do agendamento em edição (travado no modo combinado).
    const editingDept = mode === 'edit' ? (appointment?.department ?? '') : '';
    const [isCombined, setIsCombined] = useState(false);
    // Departamentos selecionados no modo combinado.
    const [combinedDepts, setCombinedDepts] = useState<string[]>([]);
    // Estado de serviços POR departamento: Record<department, ServiceSelectionState>.
    // Usado tanto no modo simples (chave = departamento único) quanto no combinado.
    const [serviceSelections, setServiceSelections] = useState<
        Record<string, ServiceSelectionState>
    >({});
    const [serviceError, setServiceError] = useState<string | null>(null);

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
    const vehiclePlate = watch('vehicle_plate');

    // Loja resolvida + marca (derivada 1:1 da loja — filtra modelo/serviços).
    const currentStore = useMemo(() => stores.find((s) => s.id === storeId), [stores, storeId]);
    const storeBrandId = currentStore?.brand_id ?? undefined;

    // Pickers de dados (loja/modelo/consultor).
    const { data: vehicleModels = [], isLoading: modelsLoading } = useVehicleModels(
        storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );
    const { consultants, isLoading: consultantsLoading } = useConsultants(
        storeId ? { store_id: storeId, is_active: true } : undefined,
        1,
        200
    );

    // Capacidade (aviso amarelo não-bloqueante).
    const { data: capacityCount } = useAppointmentCapacity(storeId ?? null, deliveryDate);

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
        // Popula o slice do departamento do agendamento (serviços + películas).
        const dept = appointment.department;
        const ids = appointment.service_ids ?? [];
        const names = appointment.service_names ?? [];
        const filmEntries: FilmEntryLocal[] =
            appointment.film_entries && appointment.film_entries.length > 0
                ? appointment.film_entries.map((fe, idx) => {
                      const pos = ids.indexOf(fe.service_id);
                      const name = (pos >= 0 ? names[pos] : names[idx]) ?? `Serviço ${fe.service_id}`;
                      return {
                          service_id: fe.service_id,
                          tonality: fe.tonality,
                          film_type_id: fe.film_type_id ?? undefined,
                          film_roll_id: fe.film_roll_id ?? null,
                          // Preserva só tonalidade/região (bobina resolve na finalização).
                          applications:
                              fe.applications && fe.applications.length > 0
                                  ? fe.applications.map((app) => ({
                                        tonality: app.tonality,
                                        region: app.region ?? '',
                                    }))
                                  : undefined,
                          service_name: name,
                          service_code: null,
                      };
                  })
                : [];
        setServiceSelections({
            [dept]: {
                serviceIds: appointment.service_ids ?? [],
                filmEntries,
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, appointment]);

    // ─── Refs dos sheets (loja/modelo/consultor) ───────────────────────────────
    const storeSheetRef = useRef<SelectRef>(null);
    const modelSheetRef = useRef<SelectRef>(null);
    const consultantSheetRef = useRef<SelectRef>(null);

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
    const isCourtesyAppointment = isCourtesy;

    // ─── Opções dos sheets ────────────────────────────────────────────────────
    const storeOptions = useMemo(() => stores.map((s) => ({ value: s.id, label: s.name })), [stores]);
    const modelOptions = useMemo(
        () => vehicleModels.map((m) => ({ value: m.id, label: m.name })),
        [vehicleModels]
    );
    const consultantOptions = useMemo(
        () => consultants.map((c) => ({ value: c.id, label: c.name })),
        [consultants]
    );

    const selectedConsultantName = consultants.find((c) => c.id === consultantId)?.name;

    // ─── Helpers de slice por departamento ─────────────────────────────────────
    const getSelection = (dept: string): ServiceSelectionState =>
        serviceSelections[dept] ?? EMPTY_SELECTION;

    const setSelection = (dept: string) => (v: ServiceSelectionState) => {
        setServiceSelections((prev) => ({ ...prev, [dept]: v }));
        setServiceError(null);
    };

    // ─── Submit ───────────────────────────────────────────────────────────────
    const submit = (data: AppointmentFormData) => {
        Keyboard.dismiss();
        setServiceError(null);

        // ── Modo combinado ────────────────────────────────────────────────────
        if (isCombined && combinedSupported) {
            const buildDeptEntry = (dept: string): CombinedDepartmentEntry => {
                const sel = getSelection(dept);
                const isFilm = isFilmDepartment(dept);
                return {
                    department: dept,
                    service_ids: isFilm ? sel.filmEntries.map((e) => e.service_id) : sel.serviceIds,
                    film_entries:
                        isFilm && sel.filmEntries.length > 0
                            ? buildFilmEntriesPayload(sel.filmEntries)
                            : undefined,
                };
            };

            // ── Edição combinada: atualiza o atual + cria irmãos p/ os novos ──
            if (mode === 'edit') {
                const newDepts = combinedDepts.filter((d) => d !== editingDept);

                // Valida o departamento atual e os novos.
                const curErr = validateDeptSelection(editingDept, getSelection(editingDept));
                if (curErr) {
                    setServiceError(curErr);
                    return;
                }
                for (const dept of newDepts) {
                    const err = validateDeptSelection(dept, getSelection(dept));
                    if (err) {
                        setServiceError(err);
                        return;
                    }
                }

                const curSel = getSelection(editingDept);
                const isCurFilm = isFilmDepartment(editingDept);
                const updatePayload: CreateAppointmentPayload = {
                    store_id: data.store_id,
                    department: editingDept,
                    delivery_date: data.delivery_date,
                    delivery_time: data.delivery_time || undefined,
                    external_os_number: data.external_os_number?.trim() || undefined,
                    vehicle_plate: data.vehicle_plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    vehicle_model: data.vehicle_model || undefined,
                    vehicle_color: data.vehicle_color || undefined,
                    consultant_id: data.consultant_id || undefined,
                    service_ids: isCurFilm
                        ? curSel.filmEntries.map((e) => e.service_id)
                        : curSel.serviceIds.length > 0
                          ? curSel.serviceIds
                          : undefined,
                    film_entries:
                        isCurFilm && curSel.filmEntries.length > 0
                            ? buildFilmEntriesPayload(curSel.filmEntries)
                            : undefined,
                    notes: data.notes?.trim() || undefined,
                    is_galpon: data.is_galpon,
                    is_courtesy: data.is_courtesy,
                    is_return: data.is_return,
                };
                onSubmitEditCombined?.(updatePayload, newDepts.map(buildDeptEntry));
                return;
            }

            // ── Criação combinada (≥1 departamento) ───────────────────────────
            if (combinedDepts.length < 1) {
                setServiceError('Selecione ao menos um departamento.');
                return;
            }
            for (const dept of combinedDepts) {
                const err = validateDeptSelection(dept, getSelection(dept));
                if (err) {
                    setServiceError(err);
                    return;
                }
            }

            const departments: CombinedDepartmentEntry[] = combinedDepts.map(buildDeptEntry);

            const combinedPayload: CombinedAppointmentPayload = {
                store_id: data.store_id,
                delivery_date: data.delivery_date,
                delivery_time: data.delivery_time || undefined,
                external_os_number: data.external_os_number?.trim() || undefined,
                vehicle_plate: data.vehicle_plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                vehicle_model: data.vehicle_model || undefined,
                vehicle_color: data.vehicle_color || undefined,
                consultant_id: data.consultant_id || undefined,
                notes: data.notes?.trim() || undefined,
                is_galpon: data.is_galpon,
                is_courtesy: data.is_courtesy,
                is_return: data.is_return,
                departments,
            };
            onSubmitCombined?.(combinedPayload);
            return;
        }

        // ── Modo simples (1 departamento) ─────────────────────────────────────
        const sel = getSelection(data.department);
        const err = validateDeptSelection(data.department, sel);
        if (err) {
            setServiceError(err);
            return;
        }
        const isFilm = isFilmDepartment(data.department);

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
            service_ids: isFilm
                ? sel.filmEntries.map((e) => e.service_id)
                : sel.serviceIds.length > 0
                  ? sel.serviceIds
                  : undefined,
            film_entries:
                isFilm && sel.filmEntries.length > 0
                    ? buildFilmEntriesPayload(sel.filmEntries)
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

    // Departamentos novos (edição combinada).
    const newCombinedDepts =
        mode === 'edit' ? combinedDepts.filter((d) => d !== editingDept) : combinedDepts;

    // Texto de preview do modo combinado.
    const combinedPreview = !isCombined
        ? null
        : mode === 'edit'
          ? newCombinedDepts.length > 0
              ? `O departamento atual será atualizado e serão criados ${newCombinedDepts.length} agendamento(s) combinado(s): ${newCombinedDepts
                    .map((d) => DEPARTMENT_LABELS[d] ?? d)
                    .join(' + ')} — mesmo carro ${vehiclePlate?.trim() || '(placa não informada)'}`
              : null
          : combinedDepts.length >= 2
            ? `Serão criados ${combinedDepts.length} agendamentos: ${combinedDepts
                  .map((d) => `1 de ${DEPARTMENT_LABELS[d] ?? d}`)
                  .join(' + ')} — mesmo carro ${vehiclePlate?.trim() || '(placa não informada)'}`
            : null;

    // Rótulo do botão de submit.
    const submitLabel = isBusy
        ? 'Salvando...'
        : mode === 'edit'
          ? isCombined && newCombinedDepts.length > 0
              ? `Salvar e combinar (+${newCombinedDepts.length})`
              : 'Salvar alterações'
          : isCombined && combinedDepts.length >= 2
            ? `Criar ${combinedDepts.length} agendamentos`
            : 'Criar agendamento';

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

            {/* ─── Toggle "Combinado" (só na criação) ───────────────────── */}
            {combinedSupported ? (
                <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isCombined }}
                    accessibilityLabel={
                        mode === 'edit'
                            ? 'Combinar com outros departamentos'
                            : 'Combinado (múltiplos departamentos)'
                    }
                    disabled={isBusy}
                    onPress={() => {
                        const next = !isCombined;
                        setIsCombined(next);
                        setServiceError(null);
                        if (next) {
                            // Entra no combinado: semeia com o depto atual (na edição é
                            // o depto travado) e marca o sentinel em `department`.
                            const current = mode === 'edit' ? editingDept : department;
                            const seed = current && current !== 'combined' ? [current] : [];
                            setCombinedDepts(seed);
                            setValue('department', 'combined', { shouldValidate: true });
                        } else {
                            // Volta ao modo simples.
                            setCombinedDepts([]);
                            if (mode === 'edit') {
                                // Mantém os serviços já carregados do depto atual.
                                setValue('department', editingDept, { shouldValidate: true });
                            } else {
                                setServiceSelections({});
                                setValue('department', undefined as unknown as string);
                            }
                        }
                    }}
                    className="mb-4 flex-row items-center gap-3 active:opacity-80"
                >
                    <View
                        className={[
                            'h-6 w-10 justify-center rounded-full px-0.5',
                            isCombined ? 'bg-brand' : 'bg-neutral-300 dark:bg-dark-elevated',
                        ].join(' ')}
                    >
                        <View
                            className="h-5 w-5 rounded-full bg-white"
                            style={{ transform: [{ translateX: isCombined ? 16 : 0 }] }}
                        />
                    </View>
                    <View className="flex-1 flex-row items-center gap-1.5">
                        <Ionicons name="link" size={16} color="#B58900" />
                        <Text className="font-sans-medium text-sm text-neutral-700 dark:text-dark-text">
                            {mode === 'edit'
                                ? 'Combinar com outros departamentos'
                                : 'Combinado (múltiplos departamentos)'}
                        </Text>
                    </View>
                </Pressable>
            ) : null}

            {/* ─── Departamento(s) ──────────────────────────────────────── */}
            {isCombined && combinedSupported ? (
                <>
                    <FieldLabel>Departamentos *</FieldLabel>
                    <View className="mb-1 flex-row flex-wrap gap-2">
                        {DEPARTMENTS.map(([value, label]) => {
                            const selected = combinedDepts.includes(value);
                            // Na edição o departamento atual fica travado.
                            const locked = mode === 'edit' && value === editingDept;
                            return (
                                <Chip
                                    key={value}
                                    label={locked ? `${label} • atual` : label}
                                    active={selected}
                                    disabled={isBusy || locked}
                                    onPress={() => {
                                        if (locked) return;
                                        setCombinedDepts((prev) =>
                                            selected
                                                ? prev.filter((d) => d !== value)
                                                : [...prev, value]
                                        );
                                        if (!selected) {
                                            // Inicializa o slice vazio ao selecionar novo depto.
                                            setServiceSelections((prev) => ({
                                                ...prev,
                                                [value]: prev[value] ?? EMPTY_SELECTION,
                                            }));
                                        }
                                        setServiceError(null);
                                    }}
                                />
                            );
                        })}
                    </View>
                    {mode === 'edit' ? (
                        <Text className="mb-3 mt-1 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            O departamento atual será atualizado; os demais serão criados como
                            agendamentos combinados (mesmo carro, mesma data).
                        </Text>
                    ) : combinedDepts.length === 0 ? (
                        <Text className="mb-3 mt-1 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Selecione ao menos um departamento.
                        </Text>
                    ) : (
                        <View className="mb-3" />
                    )}
                </>
            ) : (
                <>
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
                                        setServiceSelections({});
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
                </>
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
                        placeholder="Opcional"
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

            {/* ─── Seção(ões) de serviços/películas ─────────────────────── */}
            {isCombined && combinedSupported ? (
                combinedDepts.length > 0 ? (
                    <View className="gap-1">
                        {combinedDepts.map((dept) => (
                            <DepartmentServicesSection
                                key={dept}
                                department={dept}
                                storeBrandId={storeBrandId}
                                isCourtesyAppointment={isCourtesyAppointment}
                                value={getSelection(dept)}
                                onChange={setSelection(dept)}
                                sectionTitle={DEPARTMENT_LABELS[dept] ?? dept}
                                disabled={isBusy}
                            />
                        ))}
                    </View>
                ) : null
            ) : department ? (
                <DepartmentServicesSection
                    department={department}
                    storeBrandId={storeBrandId}
                    isCourtesyAppointment={isCourtesyAppointment}
                    value={getSelection(department)}
                    onChange={setSelection(department)}
                    disabled={isBusy}
                />
            ) : null}

            {/* ─── Preview do modo combinado ────────────────────────────── */}
            {combinedPreview ? (
                <View className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-800 dark:bg-violet-900/20">
                    <Text className="font-sans text-sm text-violet-800 dark:text-violet-300">
                        {combinedPreview}
                    </Text>
                </View>
            ) : null}

            {/* ─── Erro de validação de serviços (nível form) ───────────── */}
            {serviceError ? (
                <Text className="mb-3 font-sans text-sm text-error">{serviceError}</Text>
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
                    title={submitLabel}
                    icon="checkmark"
                    loading={isBusy}
                    disabled={isBusy}
                    onPress={onPressSave}
                />
            </View>

            {/* ─── Sheets de seleção (loja/modelo/consultor) ────────────── */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={storeOptions}
                value={storeId ?? null}
                onChange={(v) => {
                    setValue('store_id', v, { shouldValidate: true });
                    // Trocar de loja pode mudar a marca → limpa modelo/consultor/serviços.
                    setValue('vehicle_model', '');
                    setValue('vehicle_model_id', undefined);
                    setValue('consultant_id', undefined);
                    setServiceSelections({});
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
        </View>
    );
}

// ─── DepartmentServicesSection ────────────────────────────────────────────────
// Subcomponente extraído: encapsula todo o picker de serviços/películas de UM
// departamento. Espelha o `DepartmentServicesSection` do web — permite reusar a
// mesma UI tanto no modo simples (1 depto) quanto no combinado (N deptos).
// Cada instância tem seus próprios sheets/estado pendente de película.

interface DepartmentServicesSectionProps {
    department: string;
    storeBrandId?: number;
    isCourtesyAppointment: boolean;
    value: ServiceSelectionState;
    onChange: (v: ServiceSelectionState) => void;
    /** Label exibido no topo da seção (modo combinado). Omitir no modo simples. */
    sectionTitle?: string;
    disabled?: boolean;
}

function DepartmentServicesSection({
    department,
    storeBrandId,
    isCourtesyAppointment,
    value,
    onChange,
    sectionTitle,
    disabled,
}: DepartmentServicesSectionProps) {
    const isFilmDept = isFilmDepartment(department);
    const requiresTonality = deptRequiresTonality(department);

    const [pendingFilmServiceId, setPendingFilmServiceId] = useState<number | null>(null);
    const [pendingFilmTonality, setPendingFilmTonality] = useState<string | null>(null);
    const [pendingFilmTypeId, setPendingFilmTypeId] = useState<number | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);

    // Serviços do departamento (filtrados pela marca da loja).
    const { data: allServices = [], isLoading: servicesLoading } = useServices(
        department || undefined,
        storeBrandId
    );
    // A8 — serviços exclusivos de cortesia só aparecem quando o agendamento é cortesia.
    const services = useMemo(
        () => (isCourtesyAppointment ? allServices : allServices.filter((s) => !s.is_courtesy_only)),
        [allServices, isCourtesyAppointment]
    );

    // Tipos de película do departamento atual (A7 — dirige tonalidades; PPF = marca).
    const { data: filmTypes = [] } = useFilmTypes(
        isFilmDept ? (department as FilmDepartment) : undefined
    );
    const ppfBrands = filmTypes;

    // ─── Sheets desta seção ────────────────────────────────────────────────────
    const serviceSheetRef = useRef<SelectRef>(null);
    const filmServiceSheetRef = useRef<SelectRef>(null);
    const filmTonalitySheetRef = useRef<SelectRef>(null);
    const filmBrandSheetRef = useRef<SelectRef>(null);

    const sortByLabel = (a: { label: string }, b: { label: string }) =>
        a.label.localeCompare(b.label, 'pt-BR');

    const serviceOptions = useMemo(
        () =>
            services
                .map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
                .sort(sortByLabel),
        [services]
    );
    const filmServiceOptions = useMemo(
        () =>
            services
                .filter((s) => !value.filmEntries.some((e) => e.service_id === s.id))
                .map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
                .sort(sortByLabel),
        [services, value.filmEntries]
    );
    const pendingFilmService = services.find((s) => s.id === pendingFilmServiceId);
    // A7 — tonalidades dirigidas pelo tipo de película (união das available_tonalities).
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

    const selectedServices = useMemo(
        () => services.filter((s) => value.serviceIds.includes(s.id)),
        [services, value.serviceIds]
    );

    // ─── Película: adicionar / remover ────────────────────────────────────────
    const addFilmEntry = () => {
        if (!pendingFilmServiceId) return;
        const svc = services.find((s) => s.id === pendingFilmServiceId);
        if (!svc) return;
        if (requiresTonality && !pendingFilmTonality) {
            setLocalError('Selecione a tonalidade da película.');
            return;
        }
        onChange({
            ...value,
            filmEntries: [
                ...value.filmEntries,
                {
                    service_id: svc.id,
                    tonality: pendingFilmTonality,
                    film_type_id: pendingFilmTypeId ?? undefined,
                    film_roll_id: null,
                    service_name: svc.name,
                    service_code: svc.code ?? null,
                },
            ],
        });
        setPendingFilmServiceId(null);
        setPendingFilmTonality(null);
        setPendingFilmTypeId(null);
        setLocalError(null);
    };

    const removeFilmEntry = (serviceId: number) => {
        onChange({ ...value, filmEntries: value.filmEntries.filter((e) => e.service_id !== serviceId) });
    };

    // ─── Película: tonalidade por região (applications) — espelha o web ────────
    const updateFilmEntry = (serviceId: number, patch: Partial<FilmEntryLocal>) => {
        onChange({
            ...value,
            filmEntries: value.filmEntries.map((e) =>
                e.service_id === serviceId ? { ...e, ...patch } : e
            ),
        });
    };

    const enableRegions = (entry: FilmEntryLocal) => {
        updateFilmEntry(entry.service_id, {
            applications: [
                { tonality: entry.tonality ?? '', region: '' },
                { tonality: '', region: '' },
            ],
        });
        setLocalError(null);
    };

    const updateApplication = (entry: FilmEntryLocal, index: number, patch: Partial<FilmApplication>) => {
        const next = (entry.applications ?? []).map((app, i) =>
            i === index ? { ...app, ...patch } : app
        );
        updateFilmEntry(entry.service_id, { applications: next });
        setLocalError(null);
    };

    const addApplication = (entry: FilmEntryLocal) => {
        updateFilmEntry(entry.service_id, {
            applications: [...(entry.applications ?? []), { tonality: '', region: '' }],
        });
    };

    const removeApplication = (entry: FilmEntryLocal, index: number) => {
        const next = (entry.applications ?? []).filter((_, i) => i !== index);
        if (next.length <= 1) {
            updateFilmEntry(entry.service_id, {
                applications: null,
                tonality: next[0]?.tonality || entry.tonality || null,
            });
            return;
        }
        updateFilmEntry(entry.service_id, { applications: next });
    };

    const removeService = (serviceId: number) => {
        onChange({ ...value, serviceIds: value.serviceIds.filter((id) => id !== serviceId) });
    };

    return (
        <View className="mb-4 rounded-2xl border border-neutral-100 bg-neutral-50 p-3 dark:border-dark-border-soft dark:bg-dark-elevated">
            {sectionTitle ? (
                <Text className="mb-2 font-sans-bold text-xs uppercase tracking-wide text-primary-700 dark:text-brand">
                    {sectionTitle}
                </Text>
            ) : null}

            {/* ─── Películas (film/security_film/ppf) ───────────────────── */}
            {isFilmDept ? (
                <View>
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
                                disabled={disabled || filmServiceOptions.length === 0}
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
                                        disabled={disabled}
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
                                        value={ppfBrands.find((b) => b.id === pendingFilmTypeId)?.name}
                                        disabled={disabled}
                                        onPress={() => filmBrandSheetRef.current?.present()}
                                    />
                                </>
                            ) : null}

                            <Button
                                title="Adicionar película"
                                variant="secondary"
                                icon="add"
                                disabled={
                                    disabled ||
                                    !pendingFilmServiceId ||
                                    (requiresTonality && !pendingFilmTonality)
                                }
                                onPress={addFilmEntry}
                            />
                        </>
                    )}

                    {/* Entradas adicionadas */}
                    {value.filmEntries.length > 0 ? (
                        <View className="mt-3 gap-2">
                            {value.filmEntries.map((entry, idx) => (
                                <FilmEntryCard
                                    key={`${entry.service_id}-${idx}`}
                                    index={idx}
                                    entry={entry}
                                    department={department}
                                    ppfBrandName={ppfBrands.find((b) => b.id === entry.film_type_id)?.name}
                                    availableTonalities={departmentTonalities}
                                    disabled={disabled}
                                    // Só película (film/security_film) permite tonalidade por região.
                                    allowRegions={requiresTonality}
                                    onRemove={() => removeFilmEntry(entry.service_id)}
                                    onEnableRegions={() => enableRegions(entry)}
                                    onUpdateApplication={(i, patch) => updateApplication(entry, i, patch)}
                                    onAddApplication={() => addApplication(entry)}
                                    onRemoveApplication={(i) => removeApplication(entry, i)}
                                />
                            ))}
                        </View>
                    ) : null}

                    {localError ? (
                        <Text className="mt-2 font-sans text-sm text-error">{localError}</Text>
                    ) : null}
                </View>
            ) : (
                /* ─── Serviços (departamentos não-película) ─────────────── */
                <View>
                    <FieldLabel>Serviços *</FieldLabel>
                    <PickerField
                        placeholder={
                            !storeBrandId
                                ? 'Selecione a loja primeiro'
                                : servicesLoading
                                  ? 'Carregando serviços...'
                                  : value.serviceIds.length > 0
                                    ? `${value.serviceIds.length} serviço(s) selecionado(s)`
                                    : 'Selecionar serviços...'
                        }
                        disabled={!storeBrandId || disabled}
                        onPress={() => serviceSheetRef.current?.present()}
                    />
                    {selectedServices.length > 0 ? (
                        <View className="mt-2 gap-2">
                            {selectedServices.map((svc) => (
                                <View
                                    key={svc.id}
                                    className="flex-row items-center gap-3 rounded-xl bg-white px-3.5 py-3 dark:bg-dark-surface"
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
                                        disabled={disabled}
                                        onPress={() => removeService(svc.id)}
                                        className="h-7 w-7 items-center justify-center rounded-full active:bg-neutral-200 dark:active:bg-dark-elevated"
                                    >
                                        <Ionicons name="close" size={18} color="#98A2B3" />
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                    ) : null}
                </View>
            )}

            {/* ─── Sheets desta seção ───────────────────────────────────── */}
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
                            setLocalError(null);
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
            ) : (
                <Select<number>
                    ref={serviceSheetRef}
                    title="Selecionar serviços"
                    multiple
                    options={serviceOptions}
                    value={value.serviceIds}
                    onChange={(ids) => onChange({ ...value, serviceIds: ids })}
                />
            )}
        </View>
    );
}

// ─── Película: card de entrada com tonalidade por região ──────────────────────

interface FilmEntryCardProps {
    index: number;
    entry: FilmEntryLocal;
    department: string;
    ppfBrandName?: string;
    /** Tonalidades configuradas nos tipos de película do depto (A7). */
    availableTonalities: string[];
    disabled?: boolean;
    /** Regiões só em película (film/security_film); PPF fica sem essa opção. */
    allowRegions: boolean;
    onRemove: () => void;
    onEnableRegions: () => void;
    onUpdateApplication: (index: number, patch: Partial<FilmApplication>) => void;
    onAddApplication: () => void;
    onRemoveApplication: (index: number) => void;
}

/**
 * Card de uma película adicionada. Espelha o "FILME N" do web:
 *  - cabeçalho (rótulo do serviço + remover);
 *  - tonalidade única (quando sem regiões) exibida ao lado do rótulo;
 *  - link "Tonalidades diferentes por região do carro?" quando aplicável;
 *  - lista editável de aplicações {tonalidade (sheet), região (input+sugestões)}
 *    com remover por linha e "+ tonalidade".
 */
function FilmEntryCard({
    index,
    entry,
    department,
    ppfBrandName,
    availableTonalities,
    disabled,
    allowRegions,
    onRemove,
    onEnableRegions,
    onUpdateApplication,
    onAddApplication,
    onRemoveApplication,
}: FilmEntryCardProps) {
    const tonalitySheetRef = useRef<SelectRef>(null);
    // Índice da aplicação cuja tonalidade está sendo escolhida na sheet.
    const [activeAppIndex, setActiveAppIndex] = useState<number | null>(null);

    const hasRegions = !!entry.applications && entry.applications.length > 0;
    const label = entry.service_code
        ? `${entry.service_code} — ${entry.service_name}`
        : entry.service_name;

    // Tonalidades válidas para ESTE serviço (código do serviço + depto + A7).
    const tonalityOptions = useMemo(
        () =>
            getTonalityOptionsForFilmType({
                serviceCode: entry.service_code,
                department,
                availableTonalities,
            }),
        [entry.service_code, department, availableTonalities]
    );

    const openTonalitySheet = (appIndex: number) => {
        setActiveAppIndex(appIndex);
        tonalitySheetRef.current?.present();
    };

    return (
        <View className="rounded-xl bg-white p-3 dark:bg-dark-surface">
            {/* Cabeçalho: rótulo + remover */}
            <View className="flex-row items-start gap-3">
                <Ionicons name="layers-outline" size={18} color="#98A2B3" />
                <View className="flex-1">
                    <Text className="font-sans-semibold text-xs uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                        {`Filme ${index + 1}`}
                    </Text>
                    <Text
                        className="mt-0.5 font-sans text-sm text-neutral-800 dark:text-dark-text"
                        numberOfLines={2}
                    >
                        {label}
                    </Text>
                    {/* Sem regiões: tonalidade única e/ou marca PPF ao lado */}
                    {!hasRegions && (entry.tonality || ppfBrandName) ? (
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            {[entry.tonality, ppfBrandName].filter(Boolean).join(' · ')}
                        </Text>
                    ) : null}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${entry.service_name}`}
                    hitSlop={8}
                    disabled={disabled}
                    onPress={onRemove}
                    className="h-7 w-7 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                >
                    <Ionicons name="close" size={18} color="#98A2B3" />
                </Pressable>
            </View>

            {/* Aplicações por região */}
            {allowRegions && hasRegions ? (
                <View className="mt-2.5 gap-2">
                    {entry.applications!.map((app, appIdx) => (
                        <View key={appIdx} className="flex-row items-center gap-2">
                            {/* Tonalidade (sheet) */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                    app.tonality
                                        ? `Tonalidade ${app.tonality}`
                                        : 'Selecionar tonalidade da região'
                                }
                                disabled={disabled}
                                onPress={() => openTonalitySheet(appIdx)}
                                className={[
                                    'min-h-[44px] w-24 flex-row items-center justify-between rounded-lg border px-3 py-2 active:opacity-80',
                                    app.tonality
                                        ? 'border-neutral-200 dark:border-dark-border-strong'
                                        : 'border-error',
                                    'bg-white dark:bg-dark-input',
                                ].join(' ')}
                            >
                                <Text
                                    className={[
                                        'flex-1 font-sans text-sm',
                                        app.tonality
                                            ? 'text-neutral-900 dark:text-dark-text'
                                            : 'text-neutral-400 dark:text-dark-text-muted',
                                    ].join(' ')}
                                    numberOfLines={1}
                                >
                                    {app.tonality || 'G05...'}
                                </Text>
                                <Ionicons name="chevron-down" size={16} color="#98A2B3" />
                            </Pressable>

                            {/* Região (texto livre + sugestões) */}
                            <View className="flex-1">
                                <RegionField
                                    value={app.region ?? ''}
                                    disabled={disabled}
                                    onChange={(region) => onUpdateApplication(appIdx, { region })}
                                />
                            </View>

                            {/* Remover aplicação */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Remover região ${appIdx + 1}`}
                                hitSlop={8}
                                disabled={disabled}
                                onPress={() => onRemoveApplication(appIdx)}
                                className="h-8 w-8 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                            >
                                <Ionicons name="close" size={16} color="#98A2B3" />
                            </Pressable>
                        </View>
                    ))}

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Adicionar tonalidade"
                        disabled={disabled}
                        onPress={onAddApplication}
                        className="mt-0.5 flex-row items-center gap-1 self-start active:opacity-70"
                    >
                        <Ionicons name="add" size={16} color="#98A2B3" />
                        <Text className="font-sans-medium text-xs text-neutral-500 dark:text-dark-text-muted">
                            tonalidade
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            {/* Link para detalhar por região (só quando sem regiões ainda) */}
            {allowRegions && !hasRegions ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tonalidades diferentes por região do carro?"
                    disabled={disabled}
                    onPress={onEnableRegions}
                    className="mt-2 self-start active:opacity-70"
                >
                    <Text className="font-sans text-xs text-neutral-500 underline dark:text-dark-text-muted">
                        Tonalidades diferentes por região do carro?
                    </Text>
                </Pressable>
            ) : null}

            {/* Sheet de tonalidade (compartilhada pelas aplicações do card) */}
            <Select<string>
                ref={tonalitySheetRef}
                title="Selecionar tonalidade"
                options={tonalityOptions}
                value={
                    activeAppIndex !== null
                        ? (entry.applications?.[activeAppIndex]?.tonality ?? null)
                        : null
                }
                onChange={(v) => {
                    if (activeAppIndex !== null) {
                        onUpdateApplication(activeAppIndex, { tonality: v });
                    }
                }}
            />
        </View>
    );
}

/**
 * Campo de região do carro: input de texto livre + sheet de sugestões.
 * Adapta o RegionSuggestInput do web (popover) ao mobile: um botão "sugestões"
 * abre uma bottom sheet com FILM_REGION_SUGGESTIONS; o texto continua editável.
 */
function RegionField({
    value,
    onChange,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const { colors } = useTheme();
    const suggestSheetRef = useRef<SelectRef>(null);
    const suggestionOptions = useMemo(
        () => FILM_REGION_SUGGESTIONS.map((r) => ({ value: r, label: r })),
        []
    );

    return (
        <View
            className={[
                'min-h-[44px] flex-row items-center rounded-lg border',
                'border-neutral-200 bg-white dark:border-dark-border-strong dark:bg-dark-input',
                disabled ? 'opacity-60' : '',
            ].join(' ')}
        >
            <TextInput
                className="flex-1 px-3 py-2 font-sans text-sm text-neutral-900 dark:text-dark-text"
                placeholder="Região (ex.: Portas)"
                placeholderTextColor={colors.placeholder}
                value={value}
                maxLength={60}
                autoCorrect={false}
                accessibilityLabel="Região do carro"
                onChangeText={onChange}
                editable={!disabled}
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sugestões de região"
                hitSlop={8}
                disabled={disabled}
                onPress={() => suggestSheetRef.current?.present()}
                className="h-11 w-9 items-center justify-center"
            >
                <Ionicons name="chevron-down" size={16} color="#98A2B3" />
            </Pressable>

            <Select<string>
                ref={suggestSheetRef}
                title="Sugestões de região"
                options={suggestionOptions}
                value={value || null}
                onChange={(v) => onChange(v)}
            />
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
