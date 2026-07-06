import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { OSCard } from '@/components/features/OSCard';
import { OSFilterSheet, type OSFilterSheetRef } from '@/components/features/OSFilterSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useServiceOrdersList } from '@/hooks/useServiceOrders';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useTheme } from '@/theme';
import type { ServiceOrder, ServiceOrderFilters } from '@/types/service-order.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';

/**
 * OS-02 — Lista de Ordens de Serviço.
 *
 * Header preto (título + "N ordens cadastradas" + botão de filtro), barra de
 * busca (debounce ~400ms → `filters.search`), FlashList com paginação infinita +
 * pull-to-refresh, FAB âmbar "Nova O.S" (Sprint 3). A loja selecionada é injetada
 * automaticamente pelo hook. Estados Loading/Empty/Error cobertos.
 */

const SEARCH_DEBOUNCE_MS = 400;

/** Conta filtros ativos (exclui search/store, geridos fora do sheet). */
function countActiveFilters(f: ServiceOrderFilters): number {
    let n = 0;
    if (Array.isArray(f.status) ? f.status.length > 0 : !!f.status) n += 1;
    if (f.department) n += 1;
    if (f.date_from) n += 1;
    if (f.date_to) n += 1;
    if (f.flag && f.flag.length > 0) n += 1;
    return n;
}

export function ServiceOrdersListScreen({ navigation }: ServiceOrdersStackScreenProps<'ServiceOrdersList'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('service_orders');
    const filterSheetRef = useRef<OSFilterSheetRef>(null);

    // Filtros do sheet (status/department/datas/flags). `search` é separado.
    const [sheetFilters, setSheetFilters] = useState<ServiceOrderFilters>({});
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const searchRef = useRef<TextInput>(null);

    // Debounce simples da busca (placa/OS).
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters = useMemo<ServiceOrderFilters>(
        () => ({ ...sheetFilters, search: search || undefined }),
        [sheetFilters, search]
    );

    const {
        items,
        total,
        isLoading,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isRefetching,
    } = useServiceOrdersList(filters);

    const activeFilterCount = countActiveFilters(sheetFilters);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const handleView = useCallback(
        (id: number) => navigation.navigate('ServiceOrderDetail', { id }),
        [navigation]
    );

    const handleEdit = useCallback(
        (id: number) => navigation.navigate('EditServiceOrder', { id }),
        [navigation]
    );

    const renderItem = useCallback(
        ({ item }: { item: ServiceOrder }) => (
            <View className="px-4 pb-3">
                <OSCard
                    order={item}
                    canEdit={canEdit}
                    onPressView={() => handleView(item.id)}
                    onPressEdit={canEdit ? () => handleEdit(item.id) : undefined}
                />
            </View>
        ),
        [canEdit, handleView, handleEdit]
    );

    const keyExtractor = useCallback((item: ServiceOrder) => String(item.id), []);

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'ordem cadastrada' : 'ordens cadastradas'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">
                                Ordens de Serviço
                            </Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                {subtitle}
                            </Text>
                        </View>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Filtrar ordens"
                            onPress={() => filterSheetRef.current?.present()}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="funnel-outline" size={20} color="#FFFFFF" />
                            {activeFilterCount > 0 ? (
                                <View className="absolute -right-0.5 -top-0.5 h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1">
                                    <Text className="font-sans-bold text-[11px] text-brand-black">
                                        {activeFilterCount}
                                    </Text>
                                </View>
                            ) : null}
                        </Pressable>
                    </View>

                    {/* Busca — a caixa inteira é tocável e foca o input (área de toque = caixa renderizada) */}
                    <Pressable
                        accessibilityRole="search"
                        accessibilityLabel="Buscar por placa ou O.S."
                        onPress={() => searchRef.current?.focus()}
                        className="mt-3 min-h-[48px] flex-row items-center rounded-xl bg-white/10 px-3"
                    >
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            ref={searchRef}
                            placeholder="Buscar por placa ou O.S."
                            value={searchInput}
                            onChangeText={setSearchInput}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            returnKeyType="search"
                            className="ml-2 flex-1 py-3 font-sans text-base text-white"
                            placeholderTextColor="#98A2B3"
                            style={{ color: '#FFFFFF' }}
                        />
                        {searchInput.length > 0 ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Limpar busca"
                                onPress={() => setSearchInput('')}
                                hitSlop={8}
                                className="p-1 active:opacity-70"
                            >
                                <Ionicons name="close-circle" size={18} color="#98A2B3" />
                            </Pressable>
                        ) : null}
                    </Pressable>
                </View>
            </SafeAreaView>

            {/* Conteúdo */}
            <View className="flex-1">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : items.length === 0 ? (
                    <EmptyState
                        icon="document-text-outline"
                        title="Nenhuma O.S encontrada"
                        description={
                            search || activeFilterCount > 0
                                ? 'Ajuste a busca ou os filtros para ver mais resultados.'
                                : 'Ainda não há ordens de serviço para a loja selecionada.'
                        }
                    />
                ) : (
                    <FlashList
                        data={items}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        contentContainerStyle={{ paddingTop: 12, paddingBottom: 96 }}
                        onEndReached={onEndReached}
                        onEndReachedThreshold={0.5}
                        refreshControl={
                            <RefreshControl
                                refreshing={isRefetching}
                                onRefresh={() => void refetch()}
                                tintColor={colors.textMuted}
                            />
                        }
                        ListFooterComponent={
                            isFetchingNextPage ? (
                                <View className="items-center py-4">
                                    <ActivityIndicator color="#F5B800" />
                                </View>
                            ) : null
                        }
                    />
                )}
            </View>

            {/* FAB Nova O.S (Sprint 3) */}
            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Nova ordem de serviço"
                    onPress={() => navigation.navigate('CreateServiceOrder')}
                    className="absolute bottom-6 right-5 h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-90"
                >
                    <Ionicons name="add" size={24} color="#1A1A1A" />
                    <Text className="font-sans-bold text-base text-brand-black">Nova O.S</Text>
                </Pressable>
            ) : null}

            <OSFilterSheet ref={filterSheetRef} value={sheetFilters} onApply={setSheetFilters} />
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4 pt-3">
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="mb-3 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="50%" height={18} />
                    <View className="mt-3 flex-row gap-3">
                        <Skeleton width="45%" height={14} />
                        <Skeleton width="45%" height={14} />
                    </View>
                    <Skeleton width="100%" height={40} radius={10} className="mt-4" />
                </View>
            ))}
        </View>
    );
}
