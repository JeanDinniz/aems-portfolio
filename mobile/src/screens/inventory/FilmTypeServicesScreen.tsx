import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useConfirm } from '@/components/ui';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
    useFilmTypes,
    useAddServiceToFilmType,
    useRemoveServiceFromFilmType,
} from '@/hooks/useInventory';
import { useServices } from '@/hooks/useServices';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { FILM_DEPARTMENT_LABELS } from '@/constants/inventory';
import type { FilmType, FilmTypeServiceLink } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-06 — Serviços vinculados a um tipo de película.
 *
 * Lista os FilmTypeService (service_name + meters_consumed) do tipo, permite
 * adicionar (Select de serviço do mesmo departamento, excluindo os já
 * vinculados, + campo de metros) e remover (Alert). O tipo é lido da lista
 * (useFilmTypes), que é invalidada a cada mutation — refletindo a contagem na
 * tela anterior. Gated por can_edit (inventory).
 */
export function FilmTypeServicesScreen({
    route,
    navigation,
}: InventoryStackScreenProps<'FilmTypeServices'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('inventory');
    const { confirm } = useConfirm();
    const toast = useToast();

    const { data: types, isLoading, isError, refetch } = useFilmTypes();
    const filmType = useMemo<FilmType | undefined>(
        () => (types ?? []).find((t) => t.id === id),
        [types, id]
    );

    const addService = useAddServiceToFilmType();
    const removeService = useRemoveServiceFromFilmType();

    const serviceSheetRef = useRef<SelectRef>(null);
    const [pendingServiceId, setPendingServiceId] = useState<number | null>(null);
    const [meters, setMeters] = useState('');

    // Serviços do mesmo departamento do tipo.
    const { data: services = [], isLoading: servicesLoading } = useServices(filmType?.department);

    const linkedIds = useMemo(
        () => (filmType?.services ?? []).map((s) => s.service_id),
        [filmType]
    );

    const availableOptions = useMemo(
        () =>
            services
                .filter((s) => !linkedIds.includes(s.id))
                .map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
                .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
        [services, linkedIds]
    );

    const pendingServiceName = services.find((s) => s.id === pendingServiceId)?.name;

    const handleAdd = () => {
        const metersNum = Number(meters.replace(',', '.'));
        if (!pendingServiceId) {
            toast.error('Selecione o serviço.');
            return;
        }
        if (!metersNum || metersNum <= 0) {
            toast.error('Informe os metros consumidos.');
            return;
        }
        addService.mutate(
            { filmTypeId: id, payload: { service_id: pendingServiceId, meters_consumed: metersNum } },
            {
                onSuccess: () => {
                    setPendingServiceId(null);
                    setMeters('');
                },
            }
        );
    };

    const confirmRemove = async (link: FilmTypeServiceLink) => {
        const ok = await confirm({
            title: 'Remover serviço',
            message: `Desvincular "${link.service_name}" deste tipo?`,
            confirmLabel: 'Remover',
            destructive: true,
        });
        if (ok) removeService.mutate({ filmTypeId: id, serviceId: link.service_id });
    };

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Serviços" onBack={() => navigation.goBack()} />
                <View className="gap-3 p-4">
                    <Skeleton width="100%" height={120} radius={16} />
                    <Skeleton width="100%" height={80} radius={16} />
                </View>
            </View>
        );
    }

    if (isError || !filmType) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Serviços" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const links = filmType.services ?? [];
    const deptLabel = FILM_DEPARTMENT_LABELS[filmType.department] ?? filmType.department;
    const isBusy = addService.isPending;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={filmType.name}
                subtitle={`${deptLabel} · ${links.length} serviço(s)`}
                onBack={() => navigation.goBack()}
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                showsVerticalScrollIndicator={false}
            >
                {/* Adicionar serviço */}
                {canEdit ? (
                    <View className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                        <Text className="mb-3 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Vincular serviço
                        </Text>

                        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Serviço
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={pendingServiceName ?? 'Selecionar serviço'}
                            disabled={isBusy || availableOptions.length === 0}
                            onPress={() => serviceSheetRef.current?.present()}
                            className={[
                                'mb-3 min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                                'border-neutral-200 bg-white dark:border-dark-border-strong dark:bg-dark-input',
                                isBusy || availableOptions.length === 0 ? 'opacity-60' : '',
                            ].join(' ')}
                        >
                            <Text
                                className={[
                                    'flex-1 font-sans text-base',
                                    pendingServiceName
                                        ? 'text-neutral-900 dark:text-dark-text'
                                        : 'text-neutral-400 dark:text-dark-text-muted',
                                ].join(' ')}
                                numberOfLines={1}
                            >
                                {pendingServiceName ??
                                    (servicesLoading
                                        ? 'Carregando serviços...'
                                        : availableOptions.length === 0
                                          ? 'Nenhum serviço disponível'
                                          : 'Selecionar serviço...')}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color="#98A2B3" />
                        </Pressable>

                        <TextField
                            label="Metros consumidos por serviço"
                            placeholder="Ex: 2.5"
                            keyboardType="numeric"
                            value={meters}
                            onChangeText={setMeters}
                            editable={!isBusy}
                        />

                        <Button
                            title="Adicionar serviço"
                            icon="add"
                            variant="secondary"
                            loading={isBusy}
                            disabled={isBusy || !pendingServiceId}
                            onPress={handleAdd}
                        />
                    </View>
                ) : null}

                {/* Lista de serviços vinculados */}
                <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                    <Text className="mb-3 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                        Serviços vinculados
                    </Text>
                    {links.length === 0 ? (
                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhum serviço vinculado.
                        </Text>
                    ) : (
                        [...links]
                            .sort((a, b) =>
                                `${a.service_code ?? ''} ${a.service_name}`.localeCompare(
                                    `${b.service_code ?? ''} ${b.service_name}`,
                                    'pt-BR'
                                )
                            )
                            .map((link) => (
                                <View
                                    key={link.service_id}
                                    className="flex-row items-center gap-3 border-t border-neutral-100 py-3 first:border-t-0 dark:border-dark-border-soft"
                                >
                                    <View className="flex-1">
                                        <Text
                                            className="font-sans-medium text-sm text-neutral-800 dark:text-dark-text"
                                            numberOfLines={1}
                                        >
                                            {link.service_name}
                                        </Text>
                                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                            {link.service_code ? `${link.service_code} · ` : ''}
                                            {`${link.meters_consumed}m por serviço`}
                                        </Text>
                                    </View>
                                    {canEdit ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Remover ${link.service_name}`}
                                            hitSlop={8}
                                            disabled={removeService.isPending}
                                            onPress={() => confirmRemove(link)}
                                            className="h-9 w-9 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                                        >
                                            <Ionicons name="trash-outline" size={18} color="#D92D20" />
                                        </Pressable>
                                    ) : null}
                                </View>
                            ))
                    )}
                </View>
            </ScrollView>

            <Select<number>
                ref={serviceSheetRef}
                title="Selecionar serviço"
                options={availableOptions}
                value={pendingServiceId}
                onChange={(v) => setPendingServiceId(v)}
            />
        </View>
    );
}
