import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useUsersList } from '@/hooks/useUsers';
import { useCanView } from '@/hooks/useMyPermissions';
import { useTheme } from '@/theme';
import type { User, UserFilters } from '@/types/user.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Usuários (Admin — Fatia 5a). Lista com header preto, busca com debounce e
 * paginação (páginas discretas — o backend devolve `pagination.total`). Cada item
 * mostra nome, cargo (Owner/Usuário), loja e badge Ativo/Inativo. Toca → detalhe.
 */

const SEARCH_DEBOUNCE_MS = 400;

function roleLabel(role: User['role']): string {
    return role === 'owner' ? 'Proprietário' : 'Usuário';
}

export function UsersAdminScreen({ navigation }: AdminStackScreenProps<'UsersAdmin'>) {
    const { colors } = useTheme();
    const canView = useCanView('users');

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<User[]>([]);

    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters = useMemo<UserFilters>(
        () => ({ search: search || undefined }),
        [search]
    );

    const { data, isLoading, isError, refetch, isRefetching, isFetching } = useUsersList(
        filters,
        page
    );

    // Acumula páginas (o hook retorna uma página por vez).
    useEffect(() => {
        if (!data) return;
        setItems((prev) => (page === 1 ? data.users : [...prev, ...data.users]));
    }, [data, page]);

    const total = data?.total ?? 0;
    const hasMore = items.length < total;

    const onEndReached = useCallback(() => {
        if (hasMore && !isFetching) setPage((p) => p + 1);
    }, [hasMore, isFetching]);

    const onRefresh = useCallback(() => {
        setPage(1);
        void refetch();
    }, [refetch]);

    const renderItem = useCallback(
        ({ item }: { item: User }) => (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.full_name}
                onPress={() => navigation.navigate('UserDetail', { id: item.id })}
                className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white px-4 py-3.5 active:opacity-80 dark:border-dark-border-soft dark:bg-dark-surface"
            >
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.full_name}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted" numberOfLines={1}>
                        {roleLabel(item.role)}
                        {item.store_name ? ` · ${item.store_name}` : ''}
                    </Text>
                </View>
                <Badge
                    variant={item.is_active ? 'success' : 'neutral'}
                    size="sm"
                    label={item.is_active ? 'Ativo' : 'Inativo'}
                />
                <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
            </Pressable>
        ),
        [navigation]
    );

    if (!canView) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <AdminListHeader
                    title="Usuários"
                    subtitle=""
                    onBack={() => navigation.goBack()}
                    searchInput=""
                    onSearch={() => {}}
                    hideSearch
                />
                <EmptyState
                    icon="lock-closed-outline"
                    title="Acesso restrito"
                    description="Você não tem permissão para ver os usuários."
                />
            </View>
        );
    }

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'usuário' : 'usuários'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <AdminListHeader
                title="Usuários"
                subtitle={subtitle}
                onBack={() => navigation.goBack()}
                searchInput={searchInput}
                onSearch={setSearchInput}
                placeholder="Buscar por nome ou e-mail"
            />

            <View className="flex-1 pt-3">
                {isLoading && items.length === 0 ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : items.length === 0 ? (
                    <EmptyState
                        icon="people-outline"
                        title="Nenhum usuário encontrado"
                        description={search ? 'Ajuste a busca.' : 'Ainda não há usuários cadastrados.'}
                    />
                ) : (
                    <FlashList
                        data={items}
                        renderItem={renderItem}
                        keyExtractor={(u) => String(u.id)}
                        contentContainerStyle={{ paddingBottom: 32 }}
                        onEndReached={onEndReached}
                        onEndReachedThreshold={0.5}
                        refreshControl={
                            <RefreshControl
                                refreshing={isRefetching}
                                onRefresh={onRefresh}
                                tintColor={colors.textMuted}
                            />
                        }
                    />
                )}
            </View>
        </View>
    );
}

/* ─── Header preto reutilizável (título + busca) ─── */

interface AdminListHeaderProps {
    title: string;
    subtitle?: string;
    onBack: () => void;
    searchInput: string;
    onSearch: (v: string) => void;
    placeholder?: string;
    hideSearch?: boolean;
    right?: React.ReactNode;
}

export function AdminListHeader({
    title,
    subtitle,
    onBack,
    searchInput,
    onSearch,
    placeholder = 'Buscar',
    hideSearch,
    right,
}: AdminListHeaderProps) {
    return (
        <SafeAreaView edges={['top']} className="bg-brand-black">
            <View className="px-4 pb-3 pt-2">
                <View className="flex-row items-center gap-3">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        onPress={onBack}
                        className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                    >
                        <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                    </Pressable>
                    <View className="flex-1">
                        <Text className="font-display-bold text-xl text-white" numberOfLines={1}>
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400" numberOfLines={1}>
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                    {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
                </View>

                {!hideSearch ? (
                    <View className="mt-3 min-h-[48px] flex-row items-center rounded-xl bg-white/10 px-3">
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            placeholder={placeholder}
                            value={searchInput}
                            onChangeText={onSearch}
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
                                onPress={() => onSearch('')}
                                hitSlop={8}
                                className="p-1 active:opacity-70"
                            >
                                <Ionicons name="close-circle" size={18} color="#98A2B3" />
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </SafeAreaView>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4">
            {[0, 1, 2, 3, 4].map((i) => (
                <View
                    key={i}
                    className="mb-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="55%" height={16} />
                    <Skeleton width="35%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
