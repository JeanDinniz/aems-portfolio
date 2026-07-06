import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ToggleActiveSwitch } from '@/components/common/ToggleActiveSwitch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { useBrands } from '@/hooks/useBrands';
import {
    useVehicleModelsAdmin,
    useToggleVehicleModelActive,
} from '@/hooks/useVehicleModelsAdmin';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useTheme } from '@/theme';
import type { VehicleModelItem } from '@/services/api/vehicle-models.service';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Modelos de veículo (Admin — Fatia 5b). Seletor de marca no topo (obrigatório: o
 * backend exige brand_id para listar/alterar) + lista de modelos daquela marca
 * (inclui inativos) + busca client-side + toggle Ativar/Desativar (gated por
 * `useCanEdit('models')`). O brand_id do modelo é passado nas mutações.
 */
export function VehicleModelsAdminScreen({
    navigation,
}: AdminStackScreenProps<'VehicleModelsAdmin'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('models');

    const brandSheet = useRef<SelectRef>(null);
    const [brandId, setBrandId] = useState<number | undefined>(undefined);
    const [search, setSearch] = useState('');

    const { data: brands } = useBrands();
    const { data, isLoading, isError, refetch, isRefetching } = useVehicleModelsAdmin(brandId);
    const toggle = useToggleVehicleModelActive();

    const brandOptions = useMemo<SelectOption<number>[]>(
        () => (brands ?? []).map((b) => ({ value: b.id, label: b.name })),
        [brands]
    );

    const selectedBrandName = useMemo(
        () => brands?.find((b) => b.id === brandId)?.name,
        [brands, brandId]
    );

    const models = useMemo<VehicleModelItem[]>(() => {
        const all = data ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter((m) => m.name.toLowerCase().includes(q));
    }, [data, search]);

    const renderItem = useCallback(
        ({ item }: { item: VehicleModelItem }) => (
            <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.name}
                    </Text>
                    {item.brand?.name ? (
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            {item.brand.name}
                        </Text>
                    ) : null}
                </View>
                {canEdit ? (
                    <ToggleActiveSwitch
                        value={item.is_active}
                        itemName={item.name}
                        resourceLabel="modelo"
                        pending={toggle.isPending && toggle.variables?.id === item.id}
                        onToggle={(next) =>
                            toggle.mutate({
                                id: item.id,
                                brandId: item.brand_id,
                                isActive: next,
                            })
                        }
                    />
                ) : (
                    <Badge
                        variant={item.is_active ? 'success' : 'neutral'}
                        size="sm"
                        label={item.is_active ? 'Ativo' : 'Inativo'}
                    />
                )}
            </View>
        ),
        [canEdit, toggle]
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Modelos"
                subtitle={brandId ? `${models.length} modelos` : 'Selecione uma marca'}
                onBack={() => navigation.goBack()}
            />

            {/* Seletor de marca + busca */}
            <View className="border-b border-neutral-100 bg-white px-4 py-2 dark:border-dark-border-soft dark:bg-dark-surface">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Selecionar marca"
                    onPress={() => brandSheet.current?.present()}
                    className="min-h-[44px] flex-row items-center gap-2 rounded-xl bg-neutral-100 px-3 dark:bg-dark-elevated"
                >
                    <Ionicons name="pricetags-outline" size={18} color="#98A2B3" />
                    <Text
                        className={`flex-1 font-sans text-base ${
                            selectedBrandName
                                ? 'text-neutral-800 dark:text-dark-text'
                                : 'text-neutral-400 dark:text-dark-text-muted'
                        }`}
                    >
                        {selectedBrandName ?? 'Selecione uma marca'}
                    </Text>
                    <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                </Pressable>

                {brandId ? (
                    <View className="mt-2 min-h-[44px] flex-row items-center rounded-xl bg-neutral-100 px-3 dark:bg-dark-elevated">
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            placeholder="Buscar modelo"
                            value={search}
                            onChangeText={setSearch}
                            autoCorrect={false}
                            className="ml-2 flex-1 py-2.5 font-sans text-base text-neutral-800 dark:text-dark-text"
                            placeholderTextColor="#98A2B3"
                        />
                    </View>
                ) : null}
            </View>

            <View className="flex-1 pt-3">
                {!brandId ? (
                    <EmptyState
                        icon="car-outline"
                        title="Escolha uma marca"
                        description="Selecione uma marca acima para listar seus modelos."
                    />
                ) : isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : models.length === 0 ? (
                    <EmptyState
                        icon="car-outline"
                        title="Nenhum modelo encontrado"
                        description={search ? 'Ajuste a busca.' : 'Esta marca não tem modelos.'}
                    />
                ) : (
                    <FlashList
                        data={models}
                        renderItem={renderItem}
                        keyExtractor={(m) => String(m.id)}
                        contentContainerStyle={{ paddingBottom: 32 }}
                        refreshControl={
                            <RefreshControl
                                refreshing={isRefetching}
                                onRefresh={() => void refetch()}
                                tintColor={colors.textMuted}
                            />
                        }
                    />
                )}
            </View>

            <Select
                ref={brandSheet}
                title="Marca"
                options={brandOptions}
                value={brandId ?? null}
                onChange={(v) => {
                    setBrandId(v);
                    setSearch('');
                }}
            />
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4">
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="mb-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="55%" height={16} />
                    <Skeleton width="30%" height={12} className="mt-2" />
                    <Skeleton width="100%" height={40} radius={10} className="mt-3" />
                </View>
            ))}
        </View>
    );
}
