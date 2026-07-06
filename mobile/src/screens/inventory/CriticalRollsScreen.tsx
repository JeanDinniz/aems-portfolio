import { useCallback } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { RollCard } from '@/components/features/RollCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useCriticalRolls } from '@/hooks/useInventory';
import { useStoreStore } from '@/stores/store.store';
import { useTheme } from '@/theme';
import type { FilmRoll } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-07 — Bobinas críticas.
 *
 * Lista as bobinas em nível crítico (cor vermelha — calculada pelo backend) via
 * `useCriticalRolls`, reaproveitando o `RollCard` (e suas cores de status). A
 * loja global (`selectedStoreId`) é injetada como `store_id`. Tocar numa bobina
 * abre o detalhe (RollDetail). Estados Loading/Empty/Error.
 */
export function CriticalRollsScreen({ navigation }: InventoryStackScreenProps<'CriticalRolls'>) {
    const { colors } = useTheme();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const { data: rolls, isLoading, isError, refetch, isRefetching } = useCriticalRolls(
        selectedStoreId ?? undefined
    );

    const items = rolls ?? [];

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

    const subtitle = isLoading
        ? 'Carregando...'
        : `${items.length} ${items.length === 1 ? 'bobina crítica' : 'bobinas críticas'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Bobinas críticas"
                subtitle={subtitle}
                onBack={() => navigation.goBack()}
            />

            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : items.length === 0 ? (
                <EmptyState
                    icon="checkmark-circle-outline"
                    title="Nenhuma bobina crítica"
                    description="Não há bobinas em nível crítico para a loja selecionada."
                />
            ) : (
                <FlashList
                    data={items}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
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
