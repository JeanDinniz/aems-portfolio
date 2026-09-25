import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { FilmRollPicker } from '@/components/features/FilmRollPicker';
import { ServiceInstallerPicker } from '@/components/features/ServiceInstallerPicker';
import { useServiceOrder, useFinalizeServiceOrder } from '@/hooks/useServiceOrders';
import { useEmployeesByStore } from '@/hooks/useEmployees';
import { inventoryService, type FilmRoll } from '@/services/api/inventory.service';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import { getApiErrorMessage } from '@/lib/api-error';
import { pruneUploaded } from '@/services/upload/uploadQueue';
import type { Photo } from '@/types/photo.types';
import type { ServiceOrder } from '@/types/service-order.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';
import { useTheme } from '@/theme';
import { cleanConsultantNotes } from '@/utils/serviceOrderNotes';

/**
 * OS-09 — FinalizeOSScreen: tela de finalização da O.S. (status → ready/completed).
 *
 * Espelha o FinalizeOSModal do web:
 *  - ≥1 foto de chancela (PhotoCapture, fila offline; submit só com `url`).
 *  - Para deptos film/ppf: bobina POR TONALIDADE. Item com `film_applications`
 *    (tonalidades por região) gera 1 slot de bobina por tonalidade distinta;
 *    item legado gera 1 slot único (sem tonalidade). Obrigatória só em `film`.
 *  - Funcionários:
 *      · film/security_film/ppf → MÚLTIPLOS INSTALADORES por serviço (≥1
 *        obrigatório), filtrando `position === 'Instalador de Película'`. Vira
 *        `employee_assignments: {service_id, employee_ids}[]`.
 *      · demais deptos → multi-select (chips) da loja. Vira `employee_ids`.
 *
 * RETALHO (sobra): "Retalho (sobra)" é uma OPÇÃO dentro do próprio seletor de bobina
 * de cada slot. Escolhê-la marca o slot como feito com sobra de um corte anterior —
 * já debitada da bobina na época, então o backend NÃO desconta metros de novo (era o
 * que zerava bobinas "no papel" com metros ainda no rolo). Slot em retalho não exige
 * bobina e NÃO tem bobina de origem: envia `used_scrap=true` sem `film_roll_id`.
 *
 * Monta o payload de `useFinalizeServiceOrder().mutateAsync({ id, payload })`:
 *  {
 *    completion_photos: string[]                                    // urls das fotos de chancela
 *    film_roll_assignments: {service_id, film_roll_id, tonality?,   // só film/ppf; [] caso contrário
 *                            used_scrap?}[]
 *    employee_ids: number[]                                         // [] em película (usa assignments)
 *    employee_assignments?: {service_id, employee_ids}[]            // só película; ≥1 por serviço
 *    execution_notes?: string                                       // relato técnico (trim; vazio → omitido)
 *  }
 *
 * RELATO TÉCNICO: campo opcional (máx. 2000) onde o instalador registra avarias
 * prévias/ocorrências da execução. É distinto de `notes` (briefing do consultor),
 * que aparece read-only acima do campo quando existir. Visível na Conferência.
 */

/** Limite do backend para `execution_notes`. */
const EXECUTION_NOTES_MAX = 2000;

type FinalizeItem = NonNullable<ServiceOrder['items']>[number];

/**
 * Slots de bobina: item legado = 1 slot (tonality null); item com tonalidades por
 * região = 1 slot POR tonalidade distinta (juntando as regiões dessa tonalidade).
 * Chave composta `${service_id}|${tonality ?? ''}` identifica o slot. Espelha o web.
 */
interface FinalizeRollSlot {
    item: FinalizeItem;
    tonality: string | null;
    regions: string[];
}

function finalizeRollKey(serviceId: number, tonality: string | null): string {
    return `${serviceId}|${tonality ?? ''}`;
}

function buildFinalizeRollSlots(items: FinalizeItem[]): FinalizeRollSlot[] {
    return items.flatMap((item): FinalizeRollSlot[] => {
        const apps = item.film_applications ?? [];
        if (apps.length === 0) return [{ item, tonality: null, regions: [] }];
        const byTonality = new Map<string, string[]>();
        for (const app of apps) {
            if (!app.tonality) continue;
            const regions = byTonality.get(app.tonality) ?? [];
            if (app.region) regions.push(app.region);
            byTonality.set(app.tonality, regions);
        }
        // Item de película sem tonalidade preenchida nas applications cai no slot legado.
        if (byTonality.size === 0) return [{ item, tonality: null, regions: [] }];
        return [...byTonality.entries()].map(([tonality, regions]) => ({
            item,
            tonality,
            regions,
        }));
    });
}

let finalizeDraftSeq = 0;
function makeDraftId(): string {
    finalizeDraftSeq += 1;
    return `finalize_${Date.now()}_${finalizeDraftSeq}`;
}

export function FinalizeOSScreen({
    route,
    navigation,
}: ServiceOrdersStackScreenProps<'FinalizeOS'>) {
    const { id } = route.params;
    const toast = useToast();

    const { data: order, isLoading, isError, refetch } = useServiceOrder(id);
    const finalize = useFinalizeServiceOrder();

    // Saída segura: se esta tela foi empilhada por dentro da aba O.S. (Lista →
    // Detalhe → Finalizar), volta normalmente. Se foi aberta cross-stack a partir
    // do Agendamento (a pilha da aba O.S. tem só esta tela), o goBack cairia na
    // Home — então reinicia a pilha na Lista de O.S. em vez de estrangular a aba.
    const leave = useCallback(() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.reset({ index: 0, routes: [{ name: 'ServiceOrdersList' }] });
    }, [navigation]);

    const [osDraftId] = useState(() => makeDraftId());
    const [photos, setPhotos] = useState<Photo[]>([]);
    // Chave composta `${service_id}|${tonality}` — itens multi-tonalidade têm um
    // slot de bobina por tonalidade; legados usam tonality vazia. Pré-preenche
    // com a bobina já gravada nas applications/no item (edição de finalize).
    const [rollSelections, setRollSelections] = useState<Record<string, number | undefined>>({});
    // Bobina selecionada por slot (objeto completo) — usada para validar metragem
    // antes de finalizar. Só populada quando o usuário escolhe a bobina na sessão.
    const [selectedRolls, setSelectedRolls] = useState<Record<string, FilmRoll | undefined>>({});
    // Retalho por slot (mesma chave composta). `true` = serviço feito com sobra de
    // corte anterior → nada é debitado da bobina e o slot deixa de exigi-la.
    const [scrapSelections, setScrapSelections] = useState<Record<string, boolean>>({});
    const [selectedEmployees, setSelectedEmployees] = useState<number[]>([]);
    // Multi-instalador por serviço (só película): service_id → employee_ids[].
    const [installerMap, setInstallerMap] = useState<Record<number, number[]>>({});
    // Relato técnico do instalador (opcional). Enviado trimado; vazio → omitido.
    const [executionNotes, setExecutionNotes] = useState('');
    const { colors } = useTheme();
    // Guarda o id da O.S. cujo pré-preenchimento de bobinas já foi aplicado, para
    // rodar o prefill uma única vez quando o detalhe chega (sem effect extra).
    const prefilledFor = useRef<number | null>(null);

    const storeId = order?.location_id ?? 0;
    const department = order?.department ?? '';
    const isGalpon = order?.is_galpon ?? false;
    const isFilmDept = department === 'film' || department === 'security_film' || department === 'ppf';
    const items = useMemo(() => order?.items ?? [], [order?.items]);

    // Slots de bobina (1 por tonalidade distinta; legado = 1 slot único).
    const rollSlots = useMemo(() => buildFinalizeRollSlots(items), [items]);

    // Tipos de película (com os metros por serviço) para validar se a bobina
    // escolhida tem metragem suficiente antes de finalizar.
    const { data: filmTypesData } = useQuery({
        queryKey: ['film-types-finalize', department],
        queryFn: () =>
            inventoryService.listFilmTypes({
                department: department as 'film' | 'security_film' | 'ppf',
                limit: 100,
            }),
        enabled: isFilmDept,
        staleTime: 1000 * 60 * 5,
    });
    const filmTypes = useMemo(() => filmTypesData?.items ?? [], [filmTypesData]);

    // Metros que o serviço consome da bobina neste slot. Item multi-tonalidade
    // divide o consumo por K (tonalidades distintas), espelhando o backend.
    // Retorna null quando não dá para determinar (não bloqueia nesse caso).
    const metersNeededForSlot = useCallback(
        (slot: FinalizeRollSlot, roll: FilmRoll | undefined): number | null => {
            if (!roll) return null;
            const ft = filmTypes.find((t) => t.id === roll.film_type_id);
            const link = ft?.services.find((s) => s.service_id === slot.item.service_id);
            if (!link || !link.meters_consumed) return null;
            if (slot.tonality) {
                const k =
                    rollSlots.filter(
                        (s) => s.item.service_id === slot.item.service_id && s.tonality
                    ).length || 1;
                return link.meters_consumed / k;
            }
            return link.meters_consumed;
        },
        [filmTypes, rollSlots]
    );

    // Pré-preenche bobinas E retalho a partir das applications/item quando o detalhe
    // chega (ex.: reabrir o Finalizar de uma O.S. já finalizada uma vez).
    if (order && prefilledFor.current !== order.id) {
        prefilledFor.current = order.id;
        const pre: Record<string, number | undefined> = {};
        const preScrap: Record<string, boolean> = {};
        for (const item of items) {
            for (const app of item.film_applications ?? []) {
                if (!app.tonality) continue;
                const key = finalizeRollKey(item.service_id, app.tonality);
                if (app.film_roll_id) pre[key] = app.film_roll_id;
                if (app.used_scrap) preScrap[key] = true;
            }
            if (!item.film_applications?.length) {
                const key = finalizeRollKey(item.service_id, null);
                if (item.film_roll_id) pre[key] = item.film_roll_id;
                if (item.used_scrap) preScrap[key] = true;
            }
        }
        // setState durante o render é seguro no React (bail-out), igual ao padrão
        // "derive state from props". Só roda 1× por O.S. (guardado por ref).
        if (Object.keys(pre).length > 0) {
            setRollSelections((prev) => ({ ...pre, ...prev }));
        }
        if (Object.keys(preScrap).length > 0) {
            setScrapSelections((prev) => ({ ...preScrap, ...prev }));
        }
    }

    // Bobina é OBRIGATÓRIA só para serviços do departamento `film`; opcional
    // para `ppf` e `security_film` (mesmo dentro de uma O.S. de Película).
    // Item sem departamento (legado) herda o departamento da O.S.
    const isRollRequiredItem = useCallback(
        (it: { service_department?: string | null }) =>
            (it.service_department ?? department) === 'film',
        [department]
    );
    const hasRollRequiredItem = items.some(isRollRequiredItem);

    const { data: employeesData } = useEmployeesByStore(storeId || undefined);
    const activeEmployees = useMemo(
        () => (employeesData ?? []).filter((e) => e.is_active),
        [employeesData]
    );
    // Película: instaladores por serviço, filtrando pelo cargo (paridade com o web).
    // Demais deptos: multi-select de todos os funcionários ativos da loja.
    const employees = useMemo(
        () =>
            isFilmDept
                ? activeEmployees.filter((e) => e.position === FILM_INSTALLER_POSITION)
                : activeEmployees,
        [activeEmployees, isFilmDept]
    );
    const installerOptions = useMemo(
        () => employees.map((e) => ({ id: e.id, name: e.name })),
        [employees]
    );

    // Funcionários: seleção múltipla via Sheet (dropdown) — muitos funcionários
    // ficariam poluídos como chips lado a lado.
    const employeeSheetRef = useRef<SelectRef>(null);
    const employeeOptions = useMemo(
        () => employees.map((e) => ({ value: e.id, label: e.name })),
        [employees]
    );
    const employeeSummary = useMemo(() => {
        if (selectedEmployees.length === 0) return 'Selecionar funcionários...';
        if (selectedEmployees.length === 1) {
            return employees.find((e) => e.id === selectedEmployees[0])?.name ?? '1 selecionado';
        }
        return `${selectedEmployees.length} funcionários selecionados`;
    }, [selectedEmployees, employees]);

    const removeEmployee = useCallback((empId: number) => {
        setSelectedEmployees((prev) => prev.filter((x) => x !== empId));
    }, []);

    // ─── Gates de submit ──────────────────────────────────────────────────────
    const photosUploading = photos.some((p) => !p.url && !p.error);
    const hasMinPhoto = photos.length >= 1;
    const allPhotosUploaded = photos.length > 0 && photos.every((p) => !!p.url);
    // Bobina obrigatória por SLOT (tonalidade) dos itens de película `film` —
    // EXCETO slots marcados como retalho, onde nada será debitado (a bobina de
    // origem é só rastreabilidade e é opcional).
    const missingRoll = rollSlots
        .filter((slot) => isRollRequiredItem(slot.item))
        .some((slot) => {
            const key = finalizeRollKey(slot.item.service_id, slot.tonality);
            return !scrapSelections[key] && !rollSelections[key];
        });
    // Película: cada serviço precisa de ≥1 instalador (regra do backend → 422 se faltar).
    const missingInstaller =
        isFilmDept && items.some((it) => (installerMap[it.service_id]?.length ?? 0) === 0);

    const canSubmit =
        hasMinPhoto &&
        allPhotosUploaded &&
        !missingRoll &&
        !missingInstaller &&
        !finalize.isPending;

    const submit = useCallback(async () => {
        Keyboard.dismiss();

        if (!hasMinPhoto) {
            toast.error('Adicione pelo menos 1 foto da chancela.');
            return;
        }
        if (photosUploading || !allPhotosUploaded) {
            toast.show('Aguarde o envio das fotos terminar.', { variant: 'warning' });
            return;
        }
        if (missingRoll) {
            toast.error(
                'Selecione uma bobina para cada serviço de película (e cada tonalidade) ' +
                    'ou marque o serviço como feito com retalho.'
            );
            return;
        }
        if (missingInstaller) {
            toast.error('Selecione um instalador para cada serviço.');
            return;
        }

        // Bloqueia finalização com bobina de metragem insuficiente para o serviço.
        // (evita a chamada que ficava "carregando" sem retorno e avisa o motivo).
        // Slot em retalho é ignorado: não há débito, então metragem não importa —
        // inclusive a bobina de origem pode estar esgotada (0m).
        const insufficient = rollSlots
            .map((slot) => {
                const key = finalizeRollKey(slot.item.service_id, slot.tonality);
                if (scrapSelections[key]) return null;
                const roll = selectedRolls[key];
                const needed = metersNeededForSlot(slot, roll);
                return roll && needed != null && roll.remaining_meters < needed
                    ? { roll, needed }
                    : null;
            })
            .filter((x): x is { roll: FilmRoll; needed: number } => x !== null);
        if (insufficient.length > 0) {
            const { roll, needed } = insufficient[0];
            toast.error(
                `Bobina ${roll.visual_id} tem só ${roll.remaining_meters.toFixed(1)}m, ` +
                    `mas o serviço precisa de ${needed.toFixed(1)}m. Selecione outra bobina.`
            );
            return;
        }

        const completionPhotos = photos.map((p) => p.url as string);
        const consumedIds = photos.filter((p) => !!p.url).map((p) => p.id);

        // 1 atribuição por slot com bobina OU marcado como retalho; `tonality` só
        // quando o slot tem tonalidade. Retalho vai SEM `film_roll_id` (o backend
        // exige bobina OU `used_scrap`) e sem bobina de origem.
        const filmRollAssignments = isFilmDept
            ? rollSlots
                  .map((slot) => {
                      const key = finalizeRollKey(slot.item.service_id, slot.tonality);
                      return {
                          slot,
                          rollId: rollSelections[key],
                          usedScrap: !!scrapSelections[key],
                      };
                  })
                  .filter(({ rollId, usedScrap }) => usedScrap || rollId !== undefined)
                  .map(({ slot, rollId, usedScrap }) =>
                      usedScrap
                          ? {
                                service_id: slot.item.service_id,
                                ...(slot.tonality ? { tonality: slot.tonality } : {}),
                                used_scrap: true,
                            }
                          : {
                                service_id: slot.item.service_id,
                                film_roll_id: rollId as number,
                                ...(slot.tonality ? { tonality: slot.tonality } : {}),
                            }
                  )
            : [];

        // Película: employee_assignments por serviço (múltiplos instaladores). Nesse
        // caso o funcionário da O.S. inteira (employee_ids) vai vazio.
        const employeeAssignments = Object.entries(installerMap)
            .filter(([, employeeIds]) => employeeIds.length > 0)
            .map(([serviceId, employeeIds]) => ({
                service_id: Number(serviceId),
                employee_ids: employeeIds,
            }));

        // Relato técnico: só vai no payload quando há conteúdo (após trim).
        const trimmedNotes = executionNotes.trim();
        const notesPayload = trimmedNotes ? { execution_notes: trimmedNotes } : {};

        try {
            await finalize.mutateAsync({
                id,
                payload: isFilmDept
                    ? {
                          completion_photos: completionPhotos,
                          film_roll_assignments: filmRollAssignments,
                          employee_ids: [],
                          employee_assignments: employeeAssignments,
                          ...notesPayload,
                      }
                    : {
                          completion_photos: completionPhotos,
                          film_roll_assignments: filmRollAssignments,
                          employee_ids: selectedEmployees,
                          ...notesPayload,
                      },
            });
            void pruneUploaded(consumedIds);
            toast.success('O.S. finalizada com sucesso!');
            leave();
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível finalizar a O.S.'));
        }
    }, [
        hasMinPhoto,
        photosUploading,
        allPhotosUploaded,
        missingRoll,
        missingInstaller,
        photos,
        isFilmDept,
        rollSlots,
        installerMap,
        rollSelections,
        scrapSelections,
        selectedRolls,
        metersNeededForSlot,
        finalize,
        id,
        selectedEmployees,
        executionNotes,
        toast,
        leave,
    ]);

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Finalizar O.S" onBack={leave} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={120} />
                    <Skeleton width="100%" height={80} />
                    <Skeleton width="100%" height={80} />
                </View>
            </View>
        );
    }

    if (isError || !order) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Finalizar O.S" onBack={leave} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const submitLabel = photosUploading
        ? 'Enviando fotos...'
        : finalize.isPending
          ? 'Finalizando...'
          : 'Confirmar e Finalizar';

    const consultantBriefing = cleanConsultantNotes(order.notes);

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Finalizar O.S" onBack={() => navigation.goBack()} />

            <KeyboardAwareScrollView
                // style (não className): o KeyboardAwareScrollView é de terceiro e
                // o NativeWind não remapeia className nele. Mesmo padrão do "Lançar
                // O.S.": rola o campo focado (relato técnico) para cima do teclado
                // em iOS e Android.
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                bottomOffset={24}
                keyboardDismissMode="interactive"
            >
                {/* ─── Foto da chancela (≥1) ─────────────────────────────── */}
                <View className="mb-5">
                    <PhotoCapture
                        label="Foto da chancela"
                        value={photos}
                        onChange={setPhotos}
                        minPhotos={1}
                        maxPhotos={10}
                        osDraftId={osDraftId}
                    />
                    {!hasMinPhoto ? (
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Pelo menos 1 foto da chancela é obrigatória.
                        </Text>
                    ) : null}
                </View>

                {/* ─── Bobinas por tonalidade (film/security_film/ppf) ─── */}
                {isFilmDept && rollSlots.length > 0 ? (
                    <View className="mb-3">
                        <Text className="mb-2 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Bobinas {hasRollRequiredItem ? <Text className="text-error">*</Text> : null}
                            {!hasRollRequiredItem ? (
                                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    {'  (opcional)'}
                                </Text>
                            ) : null}
                        </Text>
                        {rollSlots.map((slot) => {
                            const key = finalizeRollKey(slot.item.service_id, slot.tonality);
                            const baseName = slot.item.service_code
                                ? `${slot.item.service_code} - ${slot.item.service_name ?? `Serviço #${slot.item.service_id}`}`
                                : (slot.item.service_name ?? `Serviço #${slot.item.service_id}`);
                            // Rótulo inclui a tonalidade e as regiões (ex.: "COD - Serviço — G20 (Portas)").
                            const label = slot.tonality
                                ? `${baseName} — ${slot.tonality}${slot.regions.length > 0 ? ` (${slot.regions.join(', ')})` : ''}`
                                : baseName;
                            const isScrap = !!scrapSelections[key];
                            return (
                                <View
                                    key={key}
                                    className="mb-3 rounded-xl border border-neutral-100 p-3 dark:border-dark-border-soft"
                                >
                                    <FilmRollPicker
                                        storeId={storeId}
                                        department={department}
                                        serviceId={slot.item.service_id}
                                        tonality={slot.tonality ?? slot.item.tonality ?? null}
                                        serviceName={label}
                                        filmTypeId={slot.item.film_type_id ?? undefined}
                                        value={rollSelections[key]}
                                        onChange={(rollId, roll) => {
                                            // Escolher bobina real desmarca o retalho do slot.
                                            setRollSelections((prev) => ({ ...prev, [key]: rollId }));
                                            setSelectedRolls((prev) => ({ ...prev, [key]: roll }));
                                            setScrapSelections((prev) => ({ ...prev, [key]: false }));
                                        }}
                                        onSelectScrap={() => {
                                            // "Retalho (sobra)" → marca o slot e limpa a bobina.
                                            setScrapSelections((prev) => ({ ...prev, [key]: true }));
                                            setRollSelections((prev) => ({
                                                ...prev,
                                                [key]: undefined,
                                            }));
                                            setSelectedRolls((prev) => ({
                                                ...prev,
                                                [key]: undefined,
                                            }));
                                        }}
                                        isGalpon={isGalpon}
                                        required={isRollRequiredItem(slot.item)}
                                        isScrap={isScrap}
                                    />
                                </View>
                            );
                        })}
                    </View>
                ) : null}

                {/* ─── Instaladores por serviço (film/security_film/ppf) ─── */}
                {isFilmDept && items.length > 0 ? (
                    <View className="mb-5">
                        <Text className="mb-2 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Instaladores <Text className="text-error">*</Text>
                        </Text>
                        {items.map((it) => {
                            const serviceLabel = it.service_code
                                ? `${it.service_code} - ${it.service_name ?? `Serviço #${it.service_id}`}`
                                : (it.service_name ?? `Serviço #${it.service_id}`);
                            return (
                                <ServiceInstallerPicker
                                    key={it.service_id}
                                    serviceName={`${serviceLabel}${it.tonality ? ` — ${it.tonality}` : ''}`}
                                    installers={installerOptions}
                                    value={installerMap[it.service_id] ?? []}
                                    onChange={(ids) =>
                                        setInstallerMap((prev) => ({
                                            ...prev,
                                            [it.service_id]: ids,
                                        }))
                                    }
                                    required
                                />
                            );
                        })}
                        {employees.length === 0 ? (
                            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Nenhum instalador de película ativo nesta loja.
                            </Text>
                        ) : null}
                    </View>
                ) : null}

                {/* ─── Funcionários (multi-select via Sheet) — só deptos não-película ─── */}
                {!isFilmDept ? (
                <View className="mb-5">
                    <Text className="mb-2 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                        Funcionários
                    </Text>
                    {employees.length === 0 ? (
                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhum funcionário ativo nesta loja.
                        </Text>
                    ) : (
                        <>
                            {/* Campo "gatilho" que abre a sheet de seleção múltipla */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={employeeSummary}
                                onPress={() => employeeSheetRef.current?.present()}
                                className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-80 dark:border-dark-border-strong dark:bg-dark-input"
                            >
                                <Text
                                    className={[
                                        'flex-1 font-sans text-base',
                                        selectedEmployees.length > 0
                                            ? 'text-neutral-900 dark:text-dark-text'
                                            : 'text-neutral-400 dark:text-dark-text-muted',
                                    ].join(' ')}
                                    numberOfLines={1}
                                >
                                    {employeeSummary}
                                </Text>
                                <Ionicons name="chevron-down" size={20} color="#98A2B3" />
                            </Pressable>

                            {/* Selecionados como chips removíveis (toque no "x" remove) */}
                            {selectedEmployees.length > 0 ? (
                                <View className="mt-2 flex-row flex-wrap gap-2">
                                    {selectedEmployees.map((empId) => {
                                        const emp = employees.find((e) => e.id === empId);
                                        if (!emp) return null;
                                        return (
                                            <Pressable
                                                key={empId}
                                                accessibilityRole="button"
                                                accessibilityLabel={`Remover ${emp.name}`}
                                                onPress={() => removeEmployee(empId)}
                                                className="min-h-[32px] flex-row items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 active:opacity-80"
                                            >
                                                <Text className="font-sans-semibold text-sm text-brand-black">
                                                    {emp.name}
                                                </Text>
                                                <Ionicons name="close" size={14} color="#1A1A1A" />
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ) : null}
                        </>
                    )}
                </View>
                ) : null}

                {/* ─── Relato técnico do instalador (opcional) ───────────── */}
                <View className="mb-5">
                    <View className="mb-1 flex-row items-center gap-2">
                        <Ionicons name="build-outline" size={18} color={colors.warning} />
                        <Text className="font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Relato técnico{' '}
                            <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                (opcional)
                            </Text>
                        </Text>
                    </View>
                    <Text className="mb-2 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        Registre avarias prévias, dificuldades na aplicação ou qualquer ocorrência
                        da execução. Visível para a conferência.
                    </Text>

                    {consultantBriefing ? (
                        <View className="mb-2 rounded-lg border border-neutral-100 bg-neutral-100 p-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                            <Text className="mb-0.5 font-sans-semibold text-[11px] uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                                Briefing do Consultor
                            </Text>
                            <Text className="font-sans text-sm text-neutral-700 dark:text-dark-text">
                                {consultantBriefing}
                            </Text>
                        </View>
                    ) : null}

                    <TextInput
                        accessibilityLabel="Relato técnico"
                        value={executionNotes}
                        onChangeText={setExecutionNotes}
                        multiline
                        maxLength={EXECUTION_NOTES_MAX}
                        textAlignVertical="top"
                        placeholder="Ex.: risco pré-existente na porta traseira esquerda; borracha do vidro ressecada."
                        placeholderTextColor={colors.placeholder}
                        className="min-h-[96px] rounded-lg border border-neutral-200 bg-white px-4 py-3 font-sans text-base text-neutral-900 dark:border-dark-border-strong dark:bg-dark-input dark:text-dark-text"
                    />
                    <Text className="mt-1 self-end font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {`${executionNotes.length}/${EXECUTION_NOTES_MAX}`}
                    </Text>
                </View>

                {/* ─── Ação ──────────────────────────────────────────────── */}
                <Button
                    title={submitLabel}
                    icon="checkmark-done"
                    loading={finalize.isPending || photosUploading}
                    disabled={!canSubmit || photosUploading}
                    onPress={submit}
                />
            </KeyboardAwareScrollView>

            {/* Sheet de seleção múltipla de funcionários */}
            <Select<number>
                ref={employeeSheetRef}
                multiple
                title="Selecionar funcionários"
                options={employeeOptions}
                value={selectedEmployees}
                onChange={setSelectedEmployees}
            />
        </View>
    );
}
