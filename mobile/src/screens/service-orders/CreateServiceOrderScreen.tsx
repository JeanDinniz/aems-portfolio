import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { ServiceItemPicker, type ServiceItemSelection } from '@/components/features/ServiceItemPicker';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { VideoAttach } from '@/components/features/service-orders/VideoAttach';
import { ReturnOriginPicker } from '@/components/features/ReturnOriginPicker';
import { useCreateServiceOrder, useDuplicateCheck } from '@/hooks/useServiceOrders';
import { useStores } from '@/hooks/useStores';
import { useVehicleModels } from '@/hooks/useVehicleModels';
import { useConsultants } from '@/hooks/useConsultants';
import { useGalponFlags } from '@/navigation/guards';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import { getApiErrorMessage } from '@/lib/api-error';
import {
    pruneUploaded,
    getItem as getQueueItem,
    remove as removeFromQueue,
    ensureHydrated,
    type QueueItem,
} from '@/services/upload/uploadQueue';
import {
    loadOSDraft,
    saveOSDraft,
    clearOSDraft,
    type OSDraftForm,
} from '@/services/draft/osDraftStorage';
import { DEPARTMENTS } from '@/constants/service-orders';
import type {
    CreateServiceOrderData,
    Department,
    OSCopyPrefill,
} from '@/types/service-order.types';
import type { Photo } from '@/types/photo.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';

/**
 * OS-06 — CreateServiceOrderScreen.
 *
 * Formulário ÚNICO (não wizard) que espelha o modal "Lançar O.S" do web
 * (QuickCreateModal), simplificado conforme a spec mobile (doc 03 §4): sem
 * película detalhada (tonalidade/bobina/instalador) — isso vai na finalização.
 * O backend só exige placa válida + ≥1 serviço + ≥1 foto.
 *
 * Fotos: capturadas via PhotoCapture, que ENFILEIRA na fila offline persistente.
 * O submit só prossegue quando todas as Fotos da OS já têm `url` (estado
 * "Enviando fotos…" enquanto pendente). Ao concluir, poda os ids consumidos.
 */

// ─── Validação de placa / chassi (regex do web QuickCreateModal) ──────────────
const PLATE_MERCOSUL = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const PLATE_OLD = /^[A-Z]{3}[0-9]{4}$/;
const CHASSI_VIN = /^[A-HJ-NPR-Z0-9]{17}$/; // VIN padrão — sem I, O, Q
const CHASSI_CURTO = /^[A-Z0-9]{4,17}$/; // Chassi curto (BYD, vidro, etc.) — 4 a 17 chars

function isValidPlateOrChassi(value: string): boolean {
    const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return PLATE_MERCOSUL.test(v) || PLATE_OLD.test(v) || CHASSI_VIN.test(v) || CHASSI_CURTO.test(v);
}

const DEPT_VALUES = DEPARTMENTS.map((d) => d.value) as [Department, ...Department[]];

// ─── Schema Zod (espelha o web, sem película detalhada) ───────────────────────
// Factory: o schema precisa enxergar `isOwner` para a trava de "retorno sem
// O.S. de origem" (o backend enforça — 403/422; aqui espelhamos client-side).
function makeSchema(isOwner: boolean) {
    return z
    .object({
        location_id: z.number({ error: 'Selecione a loja' }).int().positive('Selecione a loja'),
        is_courtesy: z.boolean(),
        is_return: z.boolean(),
        // Espelha o web: o tipo (Normal/Cortesia/Retorno) exige escolha explícita.
        courtesy_return_set: z.boolean().refine((v) => v === true, 'Selecione o tipo'),
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
        // Campo oculto (não renderizado): só é preenchido pela cópia de O.S.
        vehicle_year: z.number().optional(),
        vehicle_color: z.string().min(1, 'Cor obrigatória'),
        consultant_id: z.number().optional(),
        // Vínculo da O.S. de origem (quando Retorno). Preenchido pelo ReturnOriginPicker.
        original_service_order_id: z.number().optional(),
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
        // Consultor obrigatório quando NÃO for galpão (espelha o web).
        if (!data.is_galpon && !data.consultant_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Consultor obrigatório',
                path: ['consultant_id'],
            });
        }
        // Retorno SEM O.S. de origem (espelha a trava do backend — 403/422).
        //   • não-Owner → é OBRIGADO a vincular a O.S. de origem;
        //   • Owner → pode deixar vazio, MAS a Observação (motivo) vira obrigatória.
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

type CreateOSForm = z.infer<ReturnType<typeof makeSchema>>;

/** Opções de Cortesia/Retorno (espelha CourtesyReturnSelect do web). */
type CourtesyReturnValue = 'normal' | 'courtesy' | 'return';
const COURTESY_RETURN_OPTIONS: { value: CourtesyReturnValue; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'courtesy', label: 'Cortesia' },
    { value: 'return', label: 'Retorno' },
];

let draftSeq = 0;
function makeDraftId(): string {
    draftSeq += 1;
    return `osdraft_${Date.now()}_${draftSeq}`;
}

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Reconstrói uma `Photo` a partir de um item da fila offline (rascunho restaurado).
 * O `localUri` é a cópia PERSISTENTE da foto comprimida — serve de preview e de
 * `compressed` (PhotoCapture re-assina a fila por já ter `compressed`/`url`).
 */
function queueItemToPhoto(item: QueueItem): Photo {
    return {
        id: item.id,
        preview: item.localUri,
        compressed: { uri: item.localUri, mime: item.mime, name: item.name },
        uploaded: item.status === 'uploaded',
        uploadProgress: item.progress,
        url: item.url,
        error: item.status === 'error' ? item.error : undefined,
    };
}

/** Mapeia uma lista de ids da fila para `Photo[]`, ignorando ids podados/ausentes. */
function restorePhotos(ids: string[]): Photo[] {
    return ids
        .map((id) => getQueueItem(id))
        .filter((it): it is QueueItem => !!it)
        .map(queueItemToPhoto);
}

let remoteSeq = 0;
/**
 * Constrói uma `Photo` "remota" a partir de uma URL já hospedada no servidor
 * (cópia de O.S.). Não passa pela fila de upload: já vem `uploaded`/`url`, então
 * satisfaz o gate de submit e entra direto no payload. Id estável e único (o
 * prefixo `remote_` a distingue dos ids da fila).
 */
function remoteUrlToPhoto(url: string): Photo {
    remoteSeq += 1;
    return {
        id: `remote_${remoteSeq}`,
        preview: url,
        uploaded: true,
        uploadProgress: 100,
        url,
        remote: true,
    };
}

const AUTOSAVE_DEBOUNCE_MS = 400;

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

export function CreateServiceOrderScreen({
    navigation,
    route,
}: ServiceOrdersStackScreenProps<'CreateServiceOrder'>) {
    const copyFrom = route.params?.copyFrom;
    const toast = useToast();
    const { confirm } = useConfirm();
    const createServiceOrder = useCreateServiceOrder();
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const { isGalponProfile, hideGalponOption } = useGalponFlags();
    const isOwner = useAuthStore((s) => s.isOwner)();

    // Schema depende de isOwner (trava de retorno sem O.S. de origem).
    const schema = useMemo(() => makeSchema(isOwner), [isOwner]);

    // Id estável do rascunho — vincula as fotos enfileiradas a esta criação.
    const [osDraftId, setOsDraftId] = useState(() => makeDraftId());
    // Espelho do osDraftId atual p/ closures (autosave/restauração/descartar).
    const osDraftIdRef = useRef(osDraftId);
    osDraftIdRef.current = osDraftId;

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [damagePhotos, setDamagePhotos] = useState<Photo[]>([]);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoUploading, setVideoUploading] = useState(false);

    // Controle de restauração: até restaurar (ou confirmar que não há rascunho),
    // o autosave fica suspenso para não sobrescrever o rascunho com o form vazio.
    const restoredRef = useRef(false);
    // Conteúdo no form? (controla a exibição do "Descartar rascunho").
    const [hasContent, setHasContent] = useState(false);

    // Loja default: loja selecionada globalmente; se não houver, primeira acessível.
    const defaultStoreId = selectedStoreId ?? stores[0]?.id ?? undefined;

    const {
        control,
        handleSubmit,
        watch,
        setValue,
        getValues,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<CreateOSForm>({
        resolver: zodResolver(schema),
        defaultValues: {
            location_id: defaultStoreId,
            is_courtesy: false,
            is_return: false,
            courtesy_return_set: false,
            is_galpon: isGalponProfile,
            department: undefined as unknown as Department,
            service_date: todayISO(),
            external_os_number: '',
            plate: '',
            vehicle_model: '',
            vehicle_model_id: undefined,
            vehicle_year: undefined,
            vehicle_color: '',
            consultant_id: undefined,
            original_service_order_id: undefined,
            items: [],
            notes: '',
        },
    });

    // Date picker (Android abre como diálogo; iOS inline ao tocar).
    const [showDatePicker, setShowDatePicker] = useState(false);

    const locationId = watch('location_id');
    const department = watch('department');
    const isGalpon = watch('is_galpon');
    const isCourtesy = watch('is_courtesy');
    const isReturn = watch('is_return');
    const courtesyReturnSet = watch('courtesy_return_set');
    const consultantId = watch('consultant_id');
    const vehicleModelId = watch('vehicle_model_id');
    const serviceDate = watch('service_date');
    const plate = watch('plate');
    const items = watch('items');
    const originServiceOrderId = watch('original_service_order_id');

    // Observação vira obrigatória: Owner lançando retorno SEM O.S. de origem.
    const notesRequired = isReturn && isOwner && !originServiceOrderId;

    // Loja resolvida + marca (derivada da loja, 1:1 — não selecionável).
    const currentStore = useMemo(
        () => stores.find((s) => s.id === locationId),
        [stores, locationId]
    );
    const storeBrandId = currentStore?.brand_id ?? undefined;

    // Pickers de dados.
    const { data: vehicleModels = [], isLoading: modelsLoading } = useVehicleModels(
        storeBrandId ? { brand_id: storeBrandId, active_only: true } : {}
    );
    const { consultants, isLoading: consultantsLoading } = useConsultants(
        locationId ? { store_id: locationId, is_active: true } : undefined,
        1,
        200
    );

    // Refs dos sheets de seleção.
    const storeSheetRef = useRef<SelectRef>(null);
    const modelSheetRef = useRef<SelectRef>(null);
    const consultantSheetRef = useRef<SelectRef>(null);

    // Ref do campo de texto para a cadeia de foco (item 1 — "OK" avança o foco).
    const plateRef = useRef<TextInput>(null);

    // Tipo escolhido (null até o usuário marcar — campo obrigatório, sem default).
    const courtesyReturn: CourtesyReturnValue | null = !courtesyReturnSet
        ? null
        : isCourtesy
          ? 'courtesy'
          : isReturn
            ? 'return'
            : 'normal';

    // ─── Checagem de duplicidade (A3) — aviso NÃO bloqueante ──────────────────
    // Dispara (com debounce) quando placa válida + departamento + data + ≥1 serviço.
    const normalizedPlate = useMemo(
        () => plate?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '',
        [plate]
    );
    const serviceIds = useMemo(() => (items ?? []).map((it) => it.service_id), [items]);
    const dupReady =
        isValidPlateOrChassi(normalizedPlate) &&
        !!department &&
        !!serviceDate &&
        serviceIds.length > 0;

    const [dupParams, setDupParams] = useState<{
        plate: string;
        service_date: string;
        department: string;
        service_ids: number[];
    }>({ plate: '', service_date: '', department: '', service_ids: [] });

    useEffect(() => {
        const t = setTimeout(() => {
            setDupParams({
                plate: normalizedPlate,
                service_date: serviceDate ?? '',
                department: department ?? '',
                service_ids: serviceIds,
            });
        }, 500);
        return () => clearTimeout(t);
    }, [normalizedPlate, serviceDate, department, serviceIds]);

    const { data: duplicates } = useDuplicateCheck(dupParams, dupReady);
    const hasDuplicates =
        !!duplicates &&
        (duplicates.service_orders.length > 0 || duplicates.appointments.length > 0);

    // ─── Estado das fotos para o gate de submit ──────────────────────────────
    const osPhotosUploading = photos.some((p) => !p.url && !p.error);
    const damageUploading = damagePhotos.some((p) => !p.url && !p.error);

    // ─── Reset parcial para "Salvar e Próxima" ───────────────────────────────
    const partialReset = useCallback(
        (savedDept: Department, savedStoreId: number, savedServiceDate: string) => {
            reset({
                location_id: savedStoreId,
                is_courtesy: false,
                is_return: false,
                courtesy_return_set: false,
                is_galpon: isGalponProfile ? true : isGalpon,
                department: savedDept,
                // Item 5 — preserva a data digitada no "Salvar e Próxima" (antes
                // forçava todayISO()); o instalador lança vários carros na mesma data.
                service_date: savedServiceDate,
                external_os_number: '',
                plate: '',
                vehicle_model: '',
                vehicle_model_id: undefined,
                vehicle_year: undefined,
                vehicle_color: '',
                consultant_id: undefined,
                original_service_order_id: undefined,
                items: [],
                notes: '',
            });
            setPhotos([]);
            setDamagePhotos([]);
            setVideoUrl(null);
            setVideoUploading(false);
            // Novo rascunho → fotos da próxima O.S. não colidem com as anteriores.
            setOsDraftId(makeDraftId());
        },
        [reset, isGalponProfile, isGalpon]
    );

    // ─── Reset "Salvar e Outro Depto." (mesmo carro, outro departamento) ───────
    // Mantém TODOS os dados do veículo (placa, modelo, cor, consultor, tipo, data,
    // observações) e limpa só o que muda por departamento (departamento, Nº O.S.
    // Concessionária e serviços). As fotos viram REMOTAS (URLs já hospedadas) para
    // sobreviverem ao `pruneUploaded` — o próximo submit reenvia as mesmas URLs
    // sem re-upload.
    const keepVehicleReset = useCallback(
        (data: CreateOSForm) => {
            reset({
                // mantidos (mesmo carro)
                location_id: data.location_id,
                is_courtesy: data.is_courtesy,
                is_return: data.is_return,
                courtesy_return_set: true,
                is_galpon: isGalponProfile ? true : data.is_galpon,
                service_date: data.service_date, // mantém a data digitada
                plate: data.plate,
                vehicle_model: data.vehicle_model,
                vehicle_model_id: data.vehicle_model_id,
                vehicle_year: data.vehicle_year,
                vehicle_color: data.vehicle_color,
                consultant_id: data.consultant_id,
                original_service_order_id: data.original_service_order_id,
                notes: data.notes,
                // limpos (mudam por departamento)
                department: undefined as unknown as Department,
                external_os_number: '',
                items: [],
            });
            // Converte as fotos enviadas em remotas (URL https) para não sumirem
            // com o prune. O gate de submit garante url nas fotos da O.S.
            setPhotos((prev) =>
                prev
                    .filter((p) => p.remote || p.url)
                    .map((p) => (p.remote ? p : remoteUrlToPhoto(p.url!)))
            );
            setDamagePhotos((prev) =>
                prev
                    .filter((p) => p.remote || p.url)
                    .map((p) => (p.remote ? p : remoteUrlToPhoto(p.url!)))
            );
            // Vídeo é por O.S. (não por carro) — limpa ao trocar de departamento.
            setVideoUrl(null);
            setVideoUploading(false);
            // Novo rascunho → o autosave persistirá o estado atual (com as fotos
            // remotas via osRemotePhotoUrls) sem colidir com a O.S. recém-criada.
            const nextDraftId = makeDraftId();
            setOsDraftId(nextDraftId);
            osDraftIdRef.current = nextDraftId;
        },
        [reset, isGalponProfile]
    );

    // ─── Aplica o prefill de "Gerar cópia da O.S." ────────────────────────────
    // Copia tudo da O.S. original EXCETO departamento e serviços (o usuário
    // escolhe de novo). As fotos entram como remotas (URLs já hospedadas — sem
    // re-upload). `courtesy_return_set: true` para satisfazer a validação.
    const applyPrefill = useCallback(
        (src: OSCopyPrefill) => {
            reset({
                ...getValues(),
                location_id: src.location_id ?? getValues('location_id'),
                is_courtesy: src.is_courtesy,
                is_return: src.is_return,
                courtesy_return_set: true,
                is_galpon: isGalponProfile ? true : src.is_galpon,
                department: undefined as unknown as Department,
                service_date: src.service_date ?? todayISO(),
                external_os_number: src.external_os_number ?? '',
                plate: src.plate,
                vehicle_model: src.vehicle_model ?? '',
                vehicle_model_id: src.vehicle_model_id ?? undefined,
                vehicle_year: src.vehicle_year ?? undefined,
                vehicle_color: src.vehicle_color ?? '',
                consultant_id: src.consultant_id ?? undefined,
                // Cópia de O.S. não herda o vínculo de origem (o usuário reconfirma
                // se marcar Retorno). O ReturnOriginPicker refaz a busca pela placa.
                original_service_order_id: undefined,
                items: [],
                notes: src.notes ?? '',
            });
            setPhotos(src.photos.slice(0, 10).map(remoteUrlToPhoto));
            setDamagePhotos((src.damage_photos ?? []).slice(0, 10).map(remoteUrlToPhoto));
        },
        [reset, getValues, isGalponProfile]
    );

    // ─── Restauração do rascunho no mount ─────────────────────────────────────
    // Repõe campos + fotos a partir do que estava persistido (form em appStorage,
    // fotos na fila offline). Roda uma única vez; libera o autosave ao terminar.
    useEffect(() => {
        let active = true;
        (async () => {
            // Reconstrói as fotos de um rascunho: URLs remotas primeiro (fora da
            // fila), depois as fotos da fila offline (por id).
            const rebuildPhotos = (remoteUrls: string[] | undefined, ids: string[]): Photo[] => [
                ...(remoteUrls ?? []).map(remoteUrlToPhoto),
                ...restorePhotos(ids),
            ];

            const draft = await loadOSDraft();
            if (!active) return;

            const draftHasContent =
                !!draft &&
                (!!draft.form?.plate?.trim() ||
                    (draft.form?.items?.length ?? 0) > 0 ||
                    !!draft.form?.notes?.trim() ||
                    draft.osPhotoIds.length > 0 ||
                    draft.damagePhotoIds.length > 0 ||
                    (draft.osRemotePhotoUrls?.length ?? 0) > 0 ||
                    (draft.damageRemotePhotoUrls?.length ?? 0) > 0);

            // Restaura o rascunho persistido (fluxo padrão de "Lançar O.S").
            const restoreDraft = async (d: NonNullable<typeof draft>) => {
                // Reusa o MESMO osDraftId (as fotos da fila estão vinculadas a ele).
                setOsDraftId(d.osDraftId);
                osDraftIdRef.current = d.osDraftId;
                // Repõe os campos (merge com defaults — form pode estar parcial).
                reset({ ...getValues(), ...(d.form as Partial<CreateOSForm>) });
                // No boot a frio o mapa da fila está vazio até hidratar do disco —
                // garante o load antes de ler os itens (senão a foto "some").
                await ensureHydrated();
                if (!active) return;
                const restoredOs = rebuildPhotos(d.osRemotePhotoUrls, d.osPhotoIds);
                const restoredDamage = rebuildPhotos(d.damageRemotePhotoUrls, d.damagePhotoIds);
                if (restoredOs.length > 0) setPhotos(restoredOs);
                if (restoredDamage.length > 0) setDamagePhotos(restoredDamage);
            };

            if (copyFrom) {
                // Chegamos por "Gerar cópia". Se há um rascunho em andamento com
                // conteúdo, o usuário decide entre mantê-lo ou usar a cópia.
                if (draftHasContent && draft) {
                    Alert.alert(
                        'Rascunho em andamento',
                        'Você tem um rascunho de O.S. não salvo. Deseja mantê-lo ou substituí-lo pelos dados da cópia?',
                        [
                            {
                                text: 'Manter rascunho',
                                onPress: () => {
                                    void (async () => {
                                        await restoreDraft(draft);
                                        restoredRef.current = true;
                                    })();
                                },
                            },
                            {
                                text: 'Usar dados da cópia',
                                style: 'destructive',
                                onPress: () => {
                                    // Descarta as fotos do rascunho da fila e o rascunho.
                                    for (const id of [...draft.osPhotoIds, ...draft.damagePhotoIds]) {
                                        void removeFromQueue(id);
                                    }
                                    void clearOSDraft();
                                    applyPrefill(copyFrom);
                                    restoredRef.current = true;
                                },
                            },
                        ]
                    );
                    // A decisão do Alert libera o autosave; sai sem marcar restored.
                    return;
                }
                // Sem rascunho com conteúdo: aplica a cópia direto.
                void clearOSDraft();
                applyPrefill(copyFrom);
                restoredRef.current = true;
                return;
            }

            if (draft) await restoreDraft(draft);
            // Só agora liberamos o autosave (evita gravar o form vazio do mount).
            restoredRef.current = true;
        })();
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── Autosave (debounce) ──────────────────────────────────────────────────
    // Persiste o rascunho sempre que os campos OU as fotos mudarem (após a
    // restauração inicial). O timeout é limpo no unmount.
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Refs das fotos para o autosave ler o array atual dentro do debounce/closures.
    const photosRef = useRef(photos);
    photosRef.current = photos;
    const damagePhotosRef = useRef(damagePhotos);
    damagePhotosRef.current = damagePhotos;

    const persistDraft = useCallback(() => {
        if (!restoredRef.current) return;
        const form = getValues();
        // Fotos remotas (cópia de O.S.) persistem como URLs; as demais como ids da fila.
        const osPhotoIds = photosRef.current.filter((p) => !p.remote).map((p) => p.id);
        const damagePhotoIds = damagePhotosRef.current.filter((p) => !p.remote).map((p) => p.id);
        const osRemotePhotoUrls = photosRef.current
            .filter((p) => p.remote && !!p.url)
            .map((p) => p.url as string);
        const damageRemotePhotoUrls = damagePhotosRef.current
            .filter((p) => p.remote && !!p.url)
            .map((p) => p.url as string);
        // Marca se há conteúdo (placa/serviços/fotos/observações) para o botão "Descartar".
        const filled =
            !!form.plate?.trim() ||
            (form.items?.length ?? 0) > 0 ||
            !!form.notes?.trim() ||
            osPhotoIds.length > 0 ||
            damagePhotoIds.length > 0 ||
            osRemotePhotoUrls.length > 0 ||
            damageRemotePhotoUrls.length > 0;
        setHasContent(filled);
        void saveOSDraft({
            osDraftId: osDraftIdRef.current,
            form: form as OSDraftForm,
            osPhotoIds,
            damagePhotoIds,
            osRemotePhotoUrls,
            damageRemotePhotoUrls,
            savedAt: Date.now(),
        });
    }, [getValues]);

    const scheduleAutosave = useCallback(() => {
        if (!restoredRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(persistDraft, AUTOSAVE_DEBOUNCE_MS);
    }, [persistDraft]);

    // Dispara autosave quando QUALQUER campo do form muda.
    useEffect(() => {
        const sub = watch(() => scheduleAutosave());
        return () => sub.unsubscribe();
    }, [watch, scheduleAutosave]);

    // Dispara autosave quando as fotos (O.S./avaria) mudam.
    useEffect(() => {
        scheduleAutosave();
    }, [photos, damagePhotos, scheduleAutosave]);

    // Limpa o timer pendente no unmount (não cancela o save já agendado de propósito:
    // o setTimeout final dispara antes; aqui evitamos vazar o timer).
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    // ─── Descartar rascunho ───────────────────────────────────────────────────
    const discardDraft = useCallback(async () => {
        const ok = await confirm({
            title: 'Descartar rascunho?',
            message: 'As fotos e os dados preenchidos serão apagados.',
            confirmLabel: 'Descartar',
            destructive: true,
        });
        if (ok) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            // Remove as fotos da fila (O.S. + avaria) e apaga o rascunho.
            for (const p of [...photosRef.current, ...damagePhotosRef.current]) {
                void removeFromQueue(p.id);
            }
            void clearOSDraft();
            reset({
                location_id: defaultStoreId,
                is_courtesy: false,
                is_return: false,
                courtesy_return_set: false,
                is_galpon: isGalponProfile,
                department: undefined as unknown as Department,
                service_date: todayISO(),
                external_os_number: '',
                plate: '',
                vehicle_model: '',
                vehicle_model_id: undefined,
                vehicle_year: undefined,
                vehicle_color: '',
                consultant_id: undefined,
                original_service_order_id: undefined,
                items: [],
                notes: '',
            });
            setPhotos([]);
            setDamagePhotos([]);
            setVideoUrl(null);
            setVideoUploading(false);
            setHasContent(false);
            setOsDraftId(makeDraftId());
        }
    }, [confirm, reset, defaultStoreId, isGalponProfile]);

    // ─── Monta o payload final (CreateServiceOrderData) ──────────────────────
    const buildPayload = useCallback(
        (
            data: CreateOSForm,
            photoUrls: string[],
            damageUrls: string[],
            videoUrlParam: string | null
        ): CreateServiceOrderData => {
            const store = stores.find((s) => s.id === data.location_id);
            const isSaleDept =
                data.department === 'vn' || data.department === 'vd' || data.department === 'vu';
            return {
                plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                vehicle_plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                external_os_number: !isSaleDept
                    ? data.external_os_number?.trim() || undefined
                    : undefined,
                vehicle_model: data.vehicle_model,
                vehicle_model_id: data.vehicle_model_id || undefined,
                vehicle_year: data.vehicle_year || undefined,
                vehicle_color: data.vehicle_color || undefined,
                department: data.department,
                location_id: data.location_id,
                // O backend (ServiceOrderCreate) exige `store_id`; o web envia ambos.
                store_id: data.location_id,
                dealership_id: store?.dealership_id ?? undefined,
                consultant_id: data.consultant_id || undefined,
                items: data.items.map((it) => ({
                    service_id: it.service_id,
                    quantity: it.quantity,
                })),
                notes: data.notes?.trim() || undefined,
                // Fotos remotas (cópia de O.S.) já vêm como URL — em dev o
                // resolveMediaUrl pode ter reescrito o host (no-op em produção https).
                photos: photoUrls,
                // damage_photos: a API aceita; mantemos opcional.
                ...(damageUrls.length > 0 ? { damage_photos: damageUrls } : {}),
                is_galpon: data.is_galpon,
                is_return: data.is_return,
                is_courtesy: data.is_courtesy,
                // Vínculo da O.S. de origem só quando Retorno; caso contrário null
                // (o backend zera o vínculo) — espelha o web QuickCreateModal.
                original_service_order_id: data.is_return
                    ? (data.original_service_order_id ?? null)
                    : null,
                service_date: data.service_date,
                ...(videoUrlParam ? { video_url: videoUrlParam } : {}),
            } as CreateServiceOrderData;
        },
        [stores]
    );

    const submit = useCallback(
        async (data: CreateOSForm, mode: 'close' | 'next' | 'otherDept') => {
            Keyboard.dismiss();

            // Gate de fotos: precisa de ≥1 Foto da OS e TODAS com url.
            if (photos.length === 0) {
                toast.error('Adicione ao menos 1 foto da O.S.');
                return;
            }
            if (!photos.every((p) => !!p.url)) {
                toast.show('Aguarde o envio das fotos terminar.', { variant: 'warning' });
                return;
            }

            const photoUrls = photos.map((p) => p.url as string);
            const damageUrls = damagePhotos
                .map((p) => p.url)
                .filter((u): u is string => !!u);

            const consumedIds = [...photos, ...damagePhotos]
                .filter((p) => !!p.url)
                .map((p) => p.id);

            try {
                await createServiceOrder.mutateAsync(buildPayload(data, photoUrls, damageUrls, videoUrl));
                // Poda os itens já enviados da fila (libera arquivos locais).
                void pruneUploaded(consumedIds);

                if (mode === 'next') {
                    toast.success('O.S. lançada! Próxima O.S...');
                    // partialReset gera novo osDraftId e zera campos/fotos; o
                    // autosave persistirá o novo estado parcial (sem ids antigos).
                    partialReset(data.department, data.location_id, data.service_date);
                } else if (mode === 'otherDept') {
                    // Mesmo carro, outro departamento: mantém veículo e converte as
                    // fotos em remotas ANTES do prune apagar os arquivos locais.
                    toast.success('O.S. lançada! Escolha o próximo departamento.');
                    keepVehicleReset(data);
                } else {
                    // O.S. criada → o rascunho cumpriu seu papel: apaga.
                    void clearOSDraft();
                    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                    toast.success('O.S. lançada com sucesso!');
                    navigation.goBack();
                }
            } catch (err) {
                toast.error(
                    getApiErrorMessage(err as Error, 'Verifique os dados e tente novamente.')
                );
            }
        },
        [
            photos,
            damagePhotos,
            videoUrl,
            createServiceOrder,
            buildPayload,
            partialReset,
            keepVehicleReset,
            navigation,
            toast,
        ]
    );

    const onSave = handleSubmit((data) => submit(data, 'close'));
    const onSaveAndNext = handleSubmit((data) => submit(data, 'next'));
    const onSaveAndOtherDept = handleSubmit((data) => submit(data, 'otherDept'));

    const isBusy = isSubmitting || createServiceOrder.isPending;
    const uploadingPhotos = osPhotosUploading || damageUploading || videoUploading;

    // Rótulo do botão conforme estado das fotos.
    const saveLabel = uploadingPhotos
        ? 'Enviando fotos...'
        : isBusy
          ? 'Salvando...'
          : 'Salvar';

    // ─── Opções dos sheets ───────────────────────────────────────────────────
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

    const selectedConsultantName = consultants.find((c) => c.id === consultantId)?.name;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Lançar O.S" onBack={() => navigation.goBack()} />

            <KeyboardAwareScrollView
                // style (não className): o KeyboardAwareScrollView é de terceiro e
                // o NativeWind não remapeia className nele como faz no ScrollView.
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                // Rola o campo focado para acima do teclado em iOS E Android (o
                // antigo automaticallyAdjustKeyboardInsets só valia no iOS, e sob o
                // edge-to-edge do SDK 54 o Android ficava sem tratamento). Itens 1/2.
                bottomOffset={24}
                keyboardDismissMode="interactive"
            >
                {/* ─── Loja ─────────────────────────────────────────────── */}
                <FieldLabel>Loja *</FieldLabel>
                {stores.length <= 1 ? (
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
                        error={errors.location_id?.message}
                    />
                )}

                {/* ─── Cortesia/Retorno + Galpão ────────────────────────── */}
                <FieldLabel>Tipo *</FieldLabel>
                <View className="mb-1 flex-row flex-wrap gap-2">
                    {COURTESY_RETURN_OPTIONS.map((opt) => (
                        <Chip
                            key={opt.value}
                            label={opt.label}
                            active={courtesyReturn === opt.value}
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
                            disabled={isGalponProfile}
                            onPress={() => {
                                if (!isGalponProfile) setValue('is_galpon', !isGalpon);
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

                {/* ─── O.S. de origem (visível só quando Retorno) ───────── */}
                <ReturnOriginPicker
                    isReturn={isReturn}
                    plateOrChassi={plate ?? ''}
                    isValidPlateOrChassi={isValidPlateOrChassi}
                    onChange={(originId) =>
                        setValue('original_service_order_id', originId ?? undefined, {
                            shouldValidate: true,
                        })
                    }
                    disabled={isBusy}
                    storeId={locationId}
                    department={department}
                />
                {/* Owner pode lançar sem origem, informando o motivo na Observação. */}
                {isReturn && isOwner ? (
                    <Text className="mb-2 -mt-2 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        Como Proprietário, você pode lançar sem O.S. de origem — informe o motivo na
                        Observação.
                    </Text>
                ) : null}
                {/* Erro da trava (não-Owner sem origem) — o picker não exibe erro do form. */}
                {isReturn && errors.original_service_order_id ? (
                    <Text className="mb-2 -mt-2 font-sans text-sm text-error">
                        {errors.original_service_order_id.message}
                    </Text>
                ) : null}

                {/* ─── Departamento ─────────────────────────────────────── */}
                <FieldLabel>Departamento *</FieldLabel>
                <View className="mb-1 flex-row flex-wrap gap-2">
                    {DEPARTMENTS.map((dep) => (
                        <Chip
                            key={dep.value}
                            label={dep.label}
                            active={department === dep.value}
                            onPress={() => {
                                setValue('department', dep.value, { shouldValidate: true });
                                // VN/VD/VU não usam Nº O.S. Concessionária: ocultamos o
                                // campo e DESCARTAMOS qualquer valor digitado antes.
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

                {/* ─── Data do serviço (date picker, default hoje) ──────── */}
                <FieldLabel>Data do serviço *</FieldLabel>
                <PickerField
                    placeholder="Selecionar data..."
                    value={serviceDate ? formatDateBR(serviceDate) : undefined}
                    onPress={() => {
                        Keyboard.dismiss();
                        setShowDatePicker(true);
                    }}
                    error={errors.service_date?.message}
                    disabled={isBusy}
                />
                {showDatePicker && Platform.OS === 'ios' ? (
                    // iOS: o picker inline não se fecha sozinho — envolvemos num Modal
                    // com "Pronto" e toque fora para fechar (mesmo sem alterar a data).
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
                    // Android: diálogo nativo — fecha sozinho ao confirmar/cancelar.
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
                                returnKeyType="next"
                                blurOnSubmit={false}
                                onSubmitEditing={() => plateRef.current?.focus()}
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.external_os_number?.message}
                                editable={!isBusy}
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
                            ref={plateRef}
                            label="Placa / Chassi *"
                            placeholder="ABC1D23"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            returnKeyType="next"
                            // "OK" na Placa fecha o teclado e abre o próximo campo
                            // obrigatório (Modelo, que é um sheet). Item 1.
                            onSubmitEditing={() => {
                                Keyboard.dismiss();
                                modelSheetRef.current?.present();
                            }}
                            value={value}
                            onChangeText={(t) => onChange(t.toUpperCase())}
                            onBlur={onBlur}
                            error={errors.plate?.message}
                            editable={!isBusy}
                        />
                    )}
                />

                {/* Marca não é renderizada: deriva 1:1 da loja (filtra modelo/serviço). */}

                {/* ─── Modelo ───────────────────────────────────────────── */}
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
                    disabled={!storeBrandId}
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
                            returnKeyType="next"
                            // "OK" na Cor fecha o teclado e abre o Consultor. Item 1.
                            onSubmitEditing={() => {
                                Keyboard.dismiss();
                                consultantSheetRef.current?.present();
                            }}
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            error={errors.vehicle_color?.message}
                            editable={!isBusy}
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
                                storeId={locationId}
                                isCourtesy={isCourtesy}
                                value={value as ServiceItemSelection[]}
                                onChange={onChange}
                                error={errors.items?.message}
                            />
                        )}
                    />
                </View>

                {/* ─── Aviso de duplicidade (A3, NÃO bloqueante) ────────── */}
                {hasDuplicates && duplicates ? (
                    <View className="mb-4 rounded-2xl border border-error bg-error-light p-3.5 dark:border-error-dark dark:bg-dark-elevated">
                        <View className="flex-row items-center gap-2">
                            <Ionicons name="warning-outline" size={18} color="#F04438" />
                            <Text className="font-sans-bold text-sm text-error dark:text-error-dark">
                                Possível duplicidade
                            </Text>
                        </View>
                        <Text className="mt-1 font-sans text-xs text-error dark:text-error-dark">
                            Já existem lançamentos para esta placa/data com serviços em comum. Você
                            pode salvar mesmo assim.
                        </Text>
                        <View className="mt-2.5 gap-2">
                            {duplicates.service_orders.map((d) => (
                                <DuplicateRow
                                    key={`os-${d.id}`}
                                    icon="document-text-outline"
                                    title={`O.S. ${d.order_number ?? `#${d.id}`}`}
                                    plate={d.vehicle_plate}
                                    date={d.service_date}
                                    services={d.matched_services}
                                />
                            ))}
                            {duplicates.appointments.map((d) => (
                                <DuplicateRow
                                    key={`agd-${d.id}`}
                                    icon="calendar-outline"
                                    title={`Agendamento #${d.id}`}
                                    plate={d.vehicle_plate}
                                    date={d.delivery_date}
                                    services={d.matched_services}
                                />
                            ))}
                        </View>
                    </View>
                ) : null}

                {/* ─── Fotos (O.S. + avaria) lado a lado p/ economizar rolagem ── */}
                <View className="mb-5 flex-row gap-3">
                    <View className="flex-1">
                        <PhotoCapture
                            label="Foto da O.S."
                            value={photos}
                            onChange={setPhotos}
                            minPhotos={1}
                            maxPhotos={10}
                            osDraftId={osDraftId}
                        />
                    </View>
                    <View className="flex-1">
                        <PhotoCapture
                            label="Foto de avaria (opcional)"
                            value={damagePhotos}
                            onChange={setDamagePhotos}
                            minPhotos={0}
                            maxPhotos={10}
                            osDraftId={osDraftId}
                        />
                    </View>
                </View>

                {/* ─── Vídeo (opcional) ────────────────────────────────── */}
                <View className="mb-5">
                    <VideoAttach
                        value={videoUrl}
                        onChange={setVideoUrl}
                        onUploadingChange={setVideoUploading}
                        disabled={isBusy}
                    />
                </View>

                {/* ─── Observações ──────────────────────────────────────── */}
                <Controller
                    control={control}
                    name="notes"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <TextField
                            label={notesRequired ? 'Observações *' : 'Observações'}
                            placeholder={
                                notesRequired
                                    ? 'Motivo do retorno sem O.S. de origem...'
                                    : 'Notas adicionais...'
                            }
                            multiline
                            numberOfLines={3}
                            style={{ minHeight: 80, textAlignVertical: 'top' }}
                            value={value}
                            onChangeText={onChange}
                            onBlur={onBlur}
                            error={errors.notes?.message}
                            editable={!isBusy}
                        />
                    )}
                />

                {/* ─── Ações ────────────────────────────────────────────── */}
                <View className="mt-2 gap-3">
                    <Button
                        title={saveLabel}
                        icon="checkmark"
                        loading={isBusy}
                        disabled={isBusy || uploadingPhotos}
                        onPress={onSave}
                    />
                    <Button
                        title={uploadingPhotos ? 'Enviando fotos...' : 'Salvar e Próxima'}
                        variant="secondary"
                        icon="add"
                        loading={isBusy}
                        disabled={isBusy || uploadingPhotos}
                        onPress={onSaveAndNext}
                    />
                    <Button
                        title={uploadingPhotos ? 'Enviando fotos...' : 'Salvar e Outro Depto.'}
                        variant="secondary"
                        icon="copy-outline"
                        loading={isBusy}
                        disabled={isBusy || uploadingPhotos}
                        onPress={onSaveAndOtherDept}
                    />
                    {hasContent ? (
                        <Button
                            title="Descartar rascunho"
                            variant="ghost"
                            icon="trash-outline"
                            disabled={isBusy}
                            onPress={discardDraft}
                        />
                    ) : null}
                </View>
            </KeyboardAwareScrollView>

            {/* ─── Sheets de seleção ───────────────────────────────────── */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={storeOptions}
                value={locationId ?? null}
                onChange={(v) => {
                    setValue('location_id', v, { shouldValidate: true });
                    // Trocar de loja pode mudar a marca → invalida o modelo escolhido.
                    setValue('vehicle_model', '');
                    setValue('vehicle_model_id', undefined);
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

// ─── Subcomponentes locais ────────────────────────────────────────────────────

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

/** Campo de "abrir sheet" — aparência de input com chevron (área de toque ≥48). */
function PickerField({ placeholder, value, onPress, error, disabled }: PickerFieldProps) {
    return (
        <View className="mb-4">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={value ?? placeholder}
                disabled={disabled}
                // Item 2 — fecha o teclado antes de abrir o sheet para ele não
                // cobrir o seletor (ex.: vinha de digitar a Cor sem apertar "OK").
                onPress={() => {
                    Keyboard.dismiss();
                    onPress();
                }}
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

interface DuplicateRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    plate: string;
    date: string | null;
    services: string[];
}

/** Linha de um match de duplicidade (O.S. ou agendamento) dentro do alerta. */
function DuplicateRow({ icon, title, plate, date, services }: DuplicateRowProps) {
    const meta = [plate, date ? formatDateBR(date) : null].filter(Boolean).join(' · ');
    return (
        <View className="flex-row items-start gap-2 rounded-xl bg-white/60 px-3 py-2 dark:bg-dark-surface">
            <Ionicons name={icon} size={16} color="#F04438" />
            <View className="flex-1">
                <Text className="font-sans-semibold text-xs text-neutral-800 dark:text-dark-text">
                    {title}
                </Text>
                <Text className="font-sans text-[11px] text-neutral-500 dark:text-dark-text-muted">
                    {meta}
                </Text>
                {services.length > 0 ? (
                    <Text className="mt-0.5 font-sans text-[11px] text-neutral-500 dark:text-dark-text-muted">
                        {`Serviços: ${services.join(', ')}`}
                    </Text>
                ) : null}
            </View>
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
