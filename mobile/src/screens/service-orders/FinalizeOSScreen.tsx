import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { FilmRollPicker } from '@/components/features/FilmRollPicker';
import { useServiceOrder, useFinalizeServiceOrder } from '@/hooks/useServiceOrders';
import { useEmployeesByStore } from '@/hooks/useEmployees';
import { getApiErrorMessage } from '@/lib/api-error';
import { pruneUploaded } from '@/services/upload/uploadQueue';
import type { Photo } from '@/types/photo.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';

/**
 * OS-09 — FinalizeOSScreen: tela de finalização da O.S. (status → ready/completed).
 *
 * Espelha o FinalizeOSModal do web:
 *  - ≥1 foto de chancela (PhotoCapture, fila offline; submit só com `url`).
 *  - Para deptos film/ppf: 1 bobina por item (FilmRollPicker, obrigatória).
 *  - Funcionários: multi-select (chips) da loja da O.S.
 *
 * Monta o payload de `useFinalizeServiceOrder().mutateAsync({ id, payload })`:
 *  {
 *    completion_photos: string[]                         // urls das fotos de chancela
 *    film_roll_assignments: {service_id, film_roll_id}[] // só film/ppf; [] caso contrário
 *    employee_ids: number[]
 *  }
 */

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

    const [osDraftId] = useState(() => makeDraftId());
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [rollSelections, setRollSelections] = useState<Record<number, number | undefined>>({});
    const [selectedEmployees, setSelectedEmployees] = useState<number[]>([]);

    const storeId = order?.location_id ?? 0;
    const department = order?.department ?? '';
    const isGalpon = order?.is_galpon ?? false;
    const isFilmDept = department === 'film' || department === 'security_film' || department === 'ppf';
    // Bobina é OBRIGATÓRIA só para `film`; opcional para `ppf` e `security_film`
    // (regra do backend de finalização). A tonalidade segue exigida nos três.
    const rollRequired = department === 'film';
    const items = useMemo(() => order?.items ?? [], [order?.items]);

    const { data: employeesData } = useEmployeesByStore(storeId || undefined);
    const employees = useMemo(
        () => (employeesData ?? []).filter((e) => e.is_active),
        [employeesData]
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
    const missingRoll = rollRequired && items.some((it) => !rollSelections[it.service_id]);

    const canSubmit = hasMinPhoto && allPhotosUploaded && !missingRoll && !finalize.isPending;

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
            toast.error('Selecione uma bobina para cada serviço de película.');
            return;
        }

        const completionPhotos = photos.map((p) => p.url as string);
        const consumedIds = photos.filter((p) => !!p.url).map((p) => p.id);

        const filmRollAssignments = isFilmDept
            ? items
                  .filter((it) => rollSelections[it.service_id] !== undefined)
                  .map((it) => ({
                      service_id: it.service_id,
                      film_roll_id: rollSelections[it.service_id] as number,
                  }))
            : [];

        try {
            await finalize.mutateAsync({
                id,
                payload: {
                    completion_photos: completionPhotos,
                    film_roll_assignments: filmRollAssignments,
                    employee_ids: selectedEmployees,
                },
            });
            void pruneUploaded(consumedIds);
            toast.success('O.S. finalizada com sucesso!');
            navigation.goBack();
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível finalizar a O.S.'));
        }
    }, [
        hasMinPhoto,
        photosUploading,
        allPhotosUploaded,
        missingRoll,
        photos,
        isFilmDept,
        items,
        rollSelections,
        finalize,
        id,
        selectedEmployees,
        toast,
        navigation,
    ]);

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Finalizar O.S" onBack={() => navigation.goBack()} />
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
                <ScreenHeader title="Finalizar O.S" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const submitLabel = photosUploading
        ? 'Enviando fotos...'
        : finalize.isPending
          ? 'Finalizando...'
          : 'Confirmar e Finalizar';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Finalizar O.S" onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
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

                {/* ─── Bobinas (film/ppf) ────────────────────────────────── */}
                {isFilmDept && items.length > 0 ? (
                    <View className="mb-3">
                        <Text className="mb-2 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Bobinas {rollRequired ? <Text className="text-error">*</Text> : null}
                            {!rollRequired ? (
                                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    {'  (opcional)'}
                                </Text>
                            ) : null}
                        </Text>
                        {items.map((it) => (
                            <FilmRollPicker
                                key={it.service_id}
                                storeId={storeId}
                                department={department}
                                serviceId={it.service_id}
                                tonality={it.tonality ?? null}
                                serviceName={
                                    it.service_code
                                        ? `${it.service_code} - ${it.service_name ?? `Serviço #${it.service_id}`}`
                                        : (it.service_name ?? `Serviço #${it.service_id}`)
                                }
                                filmTypeId={it.film_type_id ?? undefined}
                                value={rollSelections[it.service_id]}
                                onChange={(rollId) =>
                                    setRollSelections((prev) => ({
                                        ...prev,
                                        [it.service_id]: rollId,
                                    }))
                                }
                                isGalpon={isGalpon}
                                required={rollRequired}
                            />
                        ))}
                    </View>
                ) : null}

                {/* ─── Funcionários (multi-select via Sheet) ─────────────── */}
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

                {/* ─── Ação ──────────────────────────────────────────────── */}
                <Button
                    title={submitLabel}
                    icon="checkmark-done"
                    loading={finalize.isPending || photosUploading}
                    disabled={!canSubmit || photosUploading}
                    onPress={submit}
                />
            </ScrollView>

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
