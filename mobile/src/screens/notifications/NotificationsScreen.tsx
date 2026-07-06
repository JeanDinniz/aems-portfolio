import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useNotifications, useMarkRead, useMarkAllRead } from '@/hooks/useNotifications';
import { useTheme } from '@/theme';
import { getNotificationTypeConfig, getNotificationTarget } from '@/constants/notifications';
import { formatRelativeTime } from '@/utils/formatDate';
import type { AppNotification } from '@/types/notification.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * NOT-02/03 — Lista de Notificações (in-app).
 *
 * Header preto com ação "Marcar todas como lidas" (desabilitada sem não-lidas).
 * FlashList: não lidas destacadas (fundo âmbar + ponto), ícone/cor por tipo,
 * título, corpo (2 linhas) e tempo relativo. Tap → marca lida + navega pela aba
 * de destino do tipo (NOT-03). Estados Loading/Empty/Error, pull-to-refresh e
 * scroll infinito. Atualização ao vivo via WebSocket (queryKeys ['notifications']).
 */

export function NotificationsScreen({ navigation }: AppStackScreenProps<'Notifications'>) {
    const { colors } = useTheme();
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
    } = useNotifications();

    const markRead = useMarkRead();
    const markAllRead = useMarkAllRead();

    const unreadCount = items.filter((n) => !n.is_read).length;

    const handlePress = useCallback(
        (item: AppNotification) => {
            if (!item.is_read) markRead.mutate(item.id);
            const target = getNotificationTarget(item.type);
            if (target) {
                navigation.navigate('Tabs', { screen: target.tab });
            }
        },
        [markRead, navigation]
    );

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const renderItem = useCallback(
        ({ item }: { item: AppNotification }) => (
            <NotificationRow item={item} onPress={() => handlePress(item)} />
        ),
        [handlePress]
    );

    const keyExtractor = useCallback((item: AppNotification) => String(item.id), []);

    const subtitle = isLoading
        ? 'Carregando...'
        : unreadCount > 0
          ? `${unreadCount} não ${unreadCount === 1 ? 'lida' : 'lidas'}`
          : `${total} ${total === 1 ? 'notificação' : 'notificações'}`;

    const markAllDisabled = unreadCount === 0 || markAllRead.isPending;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Notificações"
                subtitle={subtitle}
                onBack={() => navigation.goBack()}
                right={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Marcar todas como lidas"
                        accessibilityState={{ disabled: markAllDisabled }}
                        disabled={markAllDisabled}
                        onPress={() => markAllRead.mutate()}
                        hitSlop={8}
                        className={`h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70 ${
                            markAllDisabled ? 'opacity-40' : ''
                        }`}
                    >
                        <Ionicons name="checkmark-done" size={20} color="#FFFFFF" />
                    </Pressable>
                }
            />

            <View className="flex-1">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : (
                    <FlashList
                        data={items}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        contentContainerStyle={{ paddingVertical: 8 }}
                        ListEmptyComponent={
                            <EmptyState
                                icon="notifications-outline"
                                title="Sem notificações"
                                description="Você está em dia. Novos alertas aparecerão aqui."
                            />
                        }
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
        </View>
    );
}

interface NotificationRowProps {
    item: AppNotification;
    onPress: () => void;
}

function NotificationRow({ item, onPress }: NotificationRowProps) {
    const cfg = getNotificationTypeConfig(item.type);
    const unread = !item.is_read;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityHint={unread ? 'Não lida. Toque para abrir.' : 'Toque para abrir.'}
            onPress={onPress}
            className={`mx-4 mb-2 flex-row gap-3 rounded-2xl border p-3.5 active:opacity-80 ${
                unread
                    ? 'border-warning-light bg-warning-light dark:border-dark-border-soft dark:bg-dark-elevated'
                    : 'border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface'
            }`}
        >
            {/* Ícone por tipo */}
            <View
                className="h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: cfg.iconBg }}
            >
                <Ionicons name={cfg.icon} size={20} color={cfg.color} />
            </View>

            <View className="flex-1">
                <View className="flex-row items-start gap-2">
                    <Text
                        className={`flex-1 text-base text-neutral-900 dark:text-dark-text ${
                            unread ? 'font-sans-bold' : 'font-sans-semibold'
                        }`}
                        numberOfLines={2}
                    >
                        {item.title}
                    </Text>
                    {unread ? (
                        <View
                            accessibilityLabel="Não lida"
                            className="mt-1.5 h-2.5 w-2.5 rounded-full bg-brand"
                        />
                    ) : null}
                </View>

                {item.body ? (
                    <Text
                        className="mt-0.5 font-sans text-sm text-neutral-500 dark:text-dark-text-muted"
                        numberOfLines={2}
                    >
                        {item.body}
                    </Text>
                ) : null}

                <Text className="mt-1.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {formatRelativeTime(item.created_at)}
                </Text>
            </View>
        </Pressable>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4 pt-3">
            {[0, 1, 2, 3, 4].map((i) => (
                <View
                    key={i}
                    className="mb-2 flex-row gap-3 rounded-2xl border border-neutral-100 bg-white p-3.5 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width={40} height={40} radius={12} />
                    <View className="flex-1">
                        <Skeleton width="60%" height={16} />
                        <Skeleton width="90%" height={12} className="mt-2" />
                        <Skeleton width="30%" height={10} className="mt-2" />
                    </View>
                </View>
            ))}
        </View>
    );
}
