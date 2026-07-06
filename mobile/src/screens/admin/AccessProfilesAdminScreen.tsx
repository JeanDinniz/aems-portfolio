import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAccessProfilesList } from '@/hooks/useAccessProfiles';
import { useTheme } from '@/theme';
import type { AccessProfile } from '@/types/accessProfile.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Perfis de Acesso (Admin — Fatia 5a). Lista com nome, descrição, contagem de
 * usuários vinculados e badge Ativo/Inativo. Toca → detalhe (matriz read-only).
 */
export function AccessProfilesAdminScreen({
    navigation,
}: AdminStackScreenProps<'AccessProfilesAdmin'>) {
    const { colors } = useTheme();
    const { data, isLoading, isError, refetch, isRefetching } = useAccessProfilesList();

    const profiles = useMemo<AccessProfile[]>(() => data?.items ?? [], [data]);

    const renderItem = useCallback(
        ({ item }: { item: AccessProfile }) => {
            const userCount = item.user_ids?.length ?? 0;
            return (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    onPress={() => navigation.navigate('AccessProfileDetail', { id: item.id })}
                    className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white px-4 py-3.5 active:opacity-80 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View className="flex-1">
                        <Text
                            className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                            numberOfLines={1}
                        >
                            {item.name}
                        </Text>
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted" numberOfLines={1}>
                            {item.description || `${userCount} ${userCount === 1 ? 'usuário' : 'usuários'}`}
                        </Text>
                    </View>
                    <Badge
                        variant={item.is_active ? 'success' : 'neutral'}
                        size="sm"
                        label={item.is_active ? 'Ativo' : 'Inativo'}
                    />
                    <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
                </Pressable>
            );
        },
        [navigation]
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Perfis de acesso"
                subtitle={
                    isLoading
                        ? 'Carregando...'
                        : `${profiles.length} ${profiles.length === 1 ? 'perfil' : 'perfis'}`
                }
                onBack={() => navigation.goBack()}
            />

            <View className="flex-1 pt-3">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : profiles.length === 0 ? (
                    <EmptyState
                        icon="key-outline"
                        title="Nenhum perfil encontrado"
                        description="Ainda não há perfis de acesso cadastrados."
                    />
                ) : (
                    <FlashList
                        data={profiles}
                        renderItem={renderItem}
                        keyExtractor={(p) => p.id}
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
                    <Skeleton width="70%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
