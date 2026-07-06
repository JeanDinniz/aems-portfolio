import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { RollCard } from '@/components/features/RollCard';
import {
    InventoryFilterSheet,
    type InventoryFilterSheetRef,
    type InventoryFilters,
} from '@/components/features/InventoryFilterSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useFilmRolls } from '@/hooks/useInventory';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useStoreStore } from '@/stores/store.store';
import { useTheme } from '@/theme';
import type { FilmRoll, FilmRollListParams } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-02 — Lista de bobinas (LISTA PLANA, v1 pragmática).
 *
 * SEM agrupamento por loja/tipo/tonalidade nem merge de estoque compartilhado
 * (isso fica para uma ronda futura). Header preto (título + contagem + filtro),
 * busca por `visual_id` (debounce 400ms, CLIENT-SIDE — o backend não expõe busca
 * textual em /inventory/rolls), filtros em bottom-sheet (departamento, tipo de
 * película, status, galpão), pull-to-refresh e estados Loading/Empty/Error.
 *
 * A loja selecionada globalmente (`selectedStoreId`) é injetada como `store_id`
 * nos params do hook. FAB "Nova bobina" e atalho "Tipos de película" só com
 * `can_edit` (inventory). Ambos navegam para stubs "Em breve" (INV-04/06).
 */

const SEARCH_DEBOUNCE_MS = 400;

/** Conta filtros ativos (exclui a busca textual, gerida fora do sheet). */
function countActiveFilters(f: InventoryFilters): number {
    let n = 0;
    if (f.department) n += 1;
    if (f.film_type_id !== undefined) n += 1;
    if (f.status) n += 1;
    if (f.use_galpon_store) n += 1;
    return n;
}

export function InventoryRollsScreen({ navigation }: InventoryStackScreenProps<'InventoryRolls'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('inventory');
    const filterSheetRef = useRef<InventoryFilterSheetRef>(null);
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [sheetFilters, setSheetFilters] = useState<InventoryFilters>({});
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const searchRef = useRef<TextInput>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Injeta a loja selecionada globalmente. `selectedStoreId === null` → todas.
    const params = useMemo<FilmRollListParams>(
        () => ({
            store_id: selectedStoreId ?? undefined,
            department: sheetFilters.department,
            film_type_id: sheetFilters.film_type_id,
            status: sheetFilters.status,
            use_galpon_store: sheetFilters.use_galpon_store,
        }),
        [selectedStoreId, sheetFilters]
    );

    const { data: rolls, isLoading, isError, refetch, isRefetching } = useFilmRolls(params);

    const activeFilterCount = countActiveFilters(sheetFilters);

    // Busca textual por `visual_id` é client-side sobre a página atual (o backend
    // de /inventory/rolls não tem param de busca textual).
    const items = useMemo<FilmRoll[]>(() => {
        const list = rolls ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return list;
        return list.filter((r) => r.visual_id.toLowerCase().includes(q));
    }, [rolls, search]);

    const handleOpen = useCallback(
        (id: number) => navigation.navigate('RollDetail', { id }),
        [navigation]
    );

    const renderItem = useCallback(
        ({ item }: { item: FilmRoll }) => (
            <View className="px-4 pb-3">
                <RollCard roll={item} onPress={() => handleOpen(item.id)} />
            </View>
        ),
        [handleOpen]
    );

    const keyExtractor = useCallback((item: FilmRoll) => String(item.id), []);

    const total = items.length;
    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'bobina' : 'bobinas'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">Estoque</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                        </View>

                        {/* Atalho: Bobinas críticas (INV-07) */}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Bobinas críticas"
                            onPress={() => navigation.navigate('CriticalRolls')}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="alert-circle-outline" size={20} color="#FFFFFF" />
                        </Pressable>

                        {/* Atalho: Previsão de consumo (INV-07) */}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Previsão de consumo"
                            onPress={() => navigation.navigate('Forecast')}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="analytics-outline" size={20} color="#FFFFFF" />
                        </Pressable>

                        {/* Atalho: Tipos de película (INV-06) */}
                        {canEdit ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Tipos de película"
                                onPress={() => navigation.navigate('FilmTypes')}
                                className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                            >
                                <Ionicons name="layers-outline" size={20} color="#FFFFFF" />
                            </Pressable>
                        ) : null}

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Filtrar bobinas"
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

                    {/* Busca por visual_id (client-side) */}
                    <Pressable
                        accessibilityRole="search"
                        accessibilityLabel="Buscar por código da bobina"
                        onPress={() => searchRef.current?.focus()}
                        className="mt-3 min-h-[48px] flex-row items-center rounded-xl bg-white/10 px-3"
                    >
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            ref={searchRef}
                            placeholder="Buscar por código da bobina"
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
                        icon="cube-outline"
                        title="Nenhuma bobina encontrada"
                        description={
                            search || activeFilterCount > 0
                                ? 'Ajuste a busca ou os filtros para ver mais resultados.'
                                : 'Ainda não há bobinas para a loja selecionada.'
                        }
                    />
                ) : (
                    <FlashList
                        data={items}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        contentContainerStyle={{ paddingTop: 12, paddingBottom: 96 }}
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

            {/* FAB Nova bobina (INV-04) */}
            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Nova bobina"
                    onPress={() => navigation.navigate('CreateRoll')}
                    className="absolute bottom-6 right-5 h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-90"
                >
                    <Ionicons name="add" size={24} color="#1A1A1A" />
                    <Text className="font-sans-bold text-base text-brand-black">Nova bobina</Text>
                </Pressable>
            ) : null}

            <InventoryFilterSheet
                ref={filterSheetRef}
                value={sheetFilters}
                onApply={setSheetFilters}
            />
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
                    <Skeleton width="45%" height={18} />
                    <View className="mt-3 flex-row gap-3">
                        <Skeleton width="55%" height={14} />
                    </View>
                    <Skeleton width="100%" height={8} radius={4} className="mt-4" />
                    <Skeleton width="35%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
