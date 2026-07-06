import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
    FilmTypeFormSheet,
    type FilmTypeFormSheetRef,
} from '@/components/features/FilmTypeFormSheet';
import { useFilmTypes, useDeleteFilmType } from '@/hooks/useInventory';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { FILM_DEPARTMENT_LABELS } from '@/constants/inventory';
import type { FilmDepartment, FilmType } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-06 — Tipos de película.
 *
 * Lista os tipos (useFilmTypes) com departamento e limiares (amarelo/vermelho) +
 * contagem de serviços vinculados. Filtro por departamento (chips). Criar/editar
 * via FilmTypeFormSheet; excluir (hard) com confirmação (Alert) — o 409 "em uso"
 * vira Toast pelo hook. Tocar num tipo abre os serviços (FilmTypeServices).
 *
 * Tudo gated por can_edit (inventory); a tela só é acessível com a permissão.
 */

const DEPT_FILTERS: ({ value: FilmDepartment | 'all'; label: string })[] = [
    { value: 'all', label: 'Todos' },
    { value: 'film', label: 'Película' },
    { value: 'security_film', label: 'Pel. Segurança' },
    { value: 'ppf', label: 'PPF' },
];

export function FilmTypesScreen({ navigation }: InventoryStackScreenProps<'FilmTypes'>) {
    const canEdit = useCanEdit('inventory');
    const formSheetRef = useRef<FilmTypeFormSheetRef>(null);
    const deleteFilmType = useDeleteFilmType();

    const [deptFilter, setDeptFilter] = useState<FilmDepartment | 'all'>('all');

    const { data: types, isLoading, isError, refetch, isRefetching } = useFilmTypes(
        deptFilter === 'all' ? undefined : deptFilter
    );

    const items = useMemo<FilmType[]>(() => types ?? [], [types]);

    const confirmDelete = (ft: FilmType) => {
        Alert.alert(
            'Excluir tipo de película',
            `"${ft.name}" será excluído permanentemente. Esta ação não pode ser desfeita.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Excluir',
                    style: 'destructive',
                    onPress: () => deleteFilmType.mutate(ft.id),
                },
            ]
        );
    };

    const openServices = (ft: FilmType) => navigation.navigate('FilmTypeServices', { id: ft.id });

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Tipos de película"
                subtitle={isLoading ? 'Carregando...' : `${items.length} tipo(s)`}
                onBack={() => navigation.goBack()}
                right={
                    canEdit ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Novo tipo de película"
                            onPress={() => formSheetRef.current?.present()}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="add" size={22} color="#FFFFFF" />
                        </Pressable>
                    ) : null
                }
            />

            {/* Filtro por departamento */}
            <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-row flex-wrap gap-2">
                    {DEPT_FILTERS.map((f) => (
                        <Pressable
                            key={f.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: deptFilter === f.value }}
                            accessibilityLabel={f.label}
                            onPress={() => setDeptFilter(f.value)}
                            className={[
                                'min-h-[36px] items-center justify-center rounded-full px-3.5 py-1.5 active:opacity-80',
                                deptFilter === f.value ? 'bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated',
                            ].join(' ')}
                        >
                            <Text
                                className={[
                                    'font-sans-semibold text-xs',
                                    deptFilter === f.value
                                        ? 'text-brand-black'
                                        : 'text-neutral-600 dark:text-dark-text',
                                ].join(' ')}
                            >
                                {f.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>

            {isLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} width="100%" height={88} radius={16} />
                    ))}
                </View>
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : items.length === 0 ? (
                <EmptyState
                    icon="layers-outline"
                    title="Nenhum tipo cadastrado"
                    description="Cadastre um tipo de película para controlar limiares e consumo."
                    actionLabel={canEdit ? 'Novo tipo' : undefined}
                    onAction={canEdit ? () => formSheetRef.current?.present() : undefined}
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {items.map((ft) => (
                        <FilmTypeRow
                            key={ft.id}
                            filmType={ft}
                            canEdit={canEdit}
                            onPress={() => openServices(ft)}
                            onEdit={() => formSheetRef.current?.present(ft)}
                            onDelete={() => confirmDelete(ft)}
                        />
                    ))}
                </ScrollView>
            )}

            <FilmTypeFormSheet
                ref={formSheetRef}
                onSaved={(created) => {
                    void refetch();
                    // Recém-criado: leva direto aos serviços para vincular.
                    if (created) navigation.navigate('FilmTypeServices', { id: created.id });
                }}
            />
        </View>
    );
}

function FilmTypeRow({
    filmType,
    canEdit,
    onPress,
    onEdit,
    onDelete,
}: {
    filmType: FilmType;
    canEdit: boolean;
    onPress: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const deptLabel = FILM_DEPARTMENT_LABELS[filmType.department] ?? filmType.department;
    const serviceCount = filmType.services?.length ?? 0;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Tipo ${filmType.name}`}
            onPress={onPress}
            className="mb-3 rounded-2xl border border-neutral-100 bg-white p-4 active:opacity-90 dark:border-dark-border-soft dark:bg-dark-surface"
        >
            <View className="flex-row items-start gap-3">
                <View className="flex-1">
                    <Text className="font-sans-bold text-base text-neutral-900 dark:text-dark-text" numberOfLines={1}>
                        {filmType.name}
                    </Text>
                    <View className="mt-1 flex-row flex-wrap items-center gap-2">
                        <View className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
                            <Text className="font-sans-medium text-xs text-neutral-600 dark:text-dark-text-muted">
                                {deptLabel}
                            </Text>
                        </View>
                        {!filmType.is_active ? (
                            <View className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
                                <Text className="font-sans-medium text-xs text-neutral-400 dark:text-dark-text-muted">
                                    Inativo
                                </Text>
                            </View>
                        ) : null}
                    </View>
                </View>

                {canEdit ? (
                    <View className="flex-row items-center gap-1">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Editar ${filmType.name}`}
                            hitSlop={8}
                            onPress={onEdit}
                            className="h-9 w-9 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                        >
                            <Ionicons name="create-outline" size={18} color="#98A2B3" />
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Excluir ${filmType.name}`}
                            hitSlop={8}
                            onPress={onDelete}
                            className="h-9 w-9 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                        >
                            <Ionicons name="trash-outline" size={18} color="#D92D20" />
                        </Pressable>
                    </View>
                ) : null}
            </View>

            <View className="mt-3 flex-row items-center gap-4 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                <Metric label="Amarelo" value={`${filmType.yellow_threshold_meters}m`} color="#A16207" />
                <Metric label="Vermelho" value={`${filmType.red_threshold_meters}m`} color="#B91C1C" />
                <View className="flex-1 flex-row items-center justify-end gap-1.5">
                    <Ionicons name="cube-outline" size={14} color="#98A2B3" />
                    <Text className="font-sans-medium text-xs text-neutral-500 dark:text-dark-text-muted">
                        {serviceCount} serviço(s)
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <View>
            <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text className="font-sans-bold text-sm" style={{ color }}>
                {value}
            </Text>
        </View>
    );
}
