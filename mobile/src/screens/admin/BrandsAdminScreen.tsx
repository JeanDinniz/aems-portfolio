import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ToggleActiveSwitch } from '@/components/common/ToggleActiveSwitch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useBrandsAdmin, useToggleBrandActive } from '@/hooks/useBrandsAdmin';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useTheme } from '@/theme';
import type { BrandItem } from '@/services/api/brands.service';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Marcas (Admin — Fatia 5b). Lista completa (inclui inativas) com busca
 * client-side, badge Ativo/Inativo e ação Ativar/Desativar inline (gated por
 * `useCanEdit('brands')`).
 */
export function BrandsAdminScreen({ navigation }: AdminStackScreenProps<'BrandsAdmin'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('brands');

    const [search, setSearch] = useState('');
    const { data, isLoading, isError, refetch, isRefetching } = useBrandsAdmin();
    const toggle = useToggleBrandActive();

    const brands = useMemo<BrandItem[]>(() => {
        const all = data ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)
        );
    }, [data, search]);

    const renderItem = useCallback(
        ({ item }: { item: BrandItem }) => (
            <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.name}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {item.code}
                    </Text>
                </View>
                {canEdit ? (
                    <ToggleActiveSwitch
                        value={item.is_active}
                        itemName={item.name}
                        resourceLabel="marca"
                        activeLabel="Ativa"
                        inactiveLabel="Inativa"
                        pending={toggle.isPending && toggle.variables?.id === item.id}
                        onToggle={(next) => toggle.mutate({ id: item.id, isActive: next })}
                    />
                ) : (
                    <Badge
                        variant={item.is_active ? 'success' : 'neutral'}
                        size="sm"
                        label={item.is_active ? 'Ativa' : 'Inativa'}
                    />
                )}
            </View>
        ),
        [canEdit, toggle]
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Marcas"
                subtitle={isLoading ? 'Carregando...' : `${brands.length} marcas`}
                onBack={() => navigation.goBack()}
            />

            <View className="border-b border-neutral-100 bg-white px-4 py-2 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="min-h-[44px] flex-row items-center rounded-xl bg-neutral-100 px-3 dark:bg-dark-elevated">
                    <Ionicons name="search" size={18} color="#98A2B3" />
                    <TextInput
                        placeholder="Buscar por nome ou código"
                        value={search}
                        onChangeText={setSearch}
                        autoCorrect={false}
                        className="ml-2 flex-1 py-2.5 font-sans text-base text-neutral-800 dark:text-dark-text"
                        placeholderTextColor="#98A2B3"
                    />
                </View>
            </View>

            <View className="flex-1 pt-3">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : brands.length === 0 ? (
                    <EmptyState
                        icon="pricetags-outline"
                        title="Nenhuma marca encontrada"
                        description={search ? 'Ajuste a busca.' : 'Ainda não há marcas cadastradas.'}
                    />
                ) : (
                    <FlashList
                        data={brands}
                        renderItem={renderItem}
                        keyExtractor={(b) => String(b.id)}
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
