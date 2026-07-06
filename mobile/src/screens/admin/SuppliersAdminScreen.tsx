import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ToggleActiveSwitch } from '@/components/common/ToggleActiveSwitch';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useSuppliersAdmin, useToggleSupplierActive } from '@/hooks/useSuppliersAdmin';
import { useAuthStore } from '@/stores/auth.store';
import { useTheme } from '@/theme';
import type { Supplier } from '@/services/api/suppliers.service';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Fornecedores (Admin — Fatia 5b). Não há submódulo de permissão `suppliers`, então
 * a exibição e as ações são gated por `isOwner()` (o backend também exige Owner).
 * Lista com busca client-side, badge Ativo/Inativo e toggle Ativar/Desativar.
 */
export function SuppliersAdminScreen({ navigation }: AdminStackScreenProps<'SuppliersAdmin'>) {
    const { colors } = useTheme();
    const isOwner = useAuthStore((s) => s.isOwner)();

    const [search, setSearch] = useState('');
    const { data, isLoading, isError, refetch, isRefetching } = useSuppliersAdmin();
    const toggle = useToggleSupplierActive();

    const suppliers = useMemo<Supplier[]>(() => {
        const all = data ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (s) =>
                s.company_name.toLowerCase().includes(q) ||
                (s.cnpj ?? '').toLowerCase().includes(q) ||
                (s.responsible ?? '').toLowerCase().includes(q)
        );
    }, [data, search]);

    const renderItem = useCallback(
        ({ item }: { item: Supplier }) => (
            <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={2}
                    >
                        {item.company_name}
                    </Text>
                    {item.cnpj ? (
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            {item.cnpj}
                        </Text>
                    ) : null}
                    {item.responsible ? (
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            {item.responsible}
                        </Text>
                    ) : null}
                </View>
                <ToggleActiveSwitch
                    value={item.is_active}
                    itemName={item.company_name}
                    resourceLabel="fornecedor"
                    pending={toggle.isPending && toggle.variables?.id === item.id}
                    onToggle={(next) => toggle.mutate({ id: item.id, isActive: next })}
                />
            </View>
        ),
        [toggle]
    );

    if (!isOwner) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Fornecedores" onBack={() => navigation.goBack()} />
                <EmptyState
                    icon="lock-closed-outline"
                    title="Acesso restrito"
                    description="Apenas o proprietário pode gerenciar fornecedores."
                />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Fornecedores"
                subtitle={isLoading ? 'Carregando...' : `${suppliers.length} fornecedores`}
                onBack={() => navigation.goBack()}
            />

            <View className="border-b border-neutral-100 bg-white px-4 py-2 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="min-h-[44px] flex-row items-center rounded-xl bg-neutral-100 px-3 dark:bg-dark-elevated">
                    <Ionicons name="search" size={18} color="#98A2B3" />
                    <TextInput
                        placeholder="Buscar por razão social, CNPJ ou responsável"
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
                ) : suppliers.length === 0 ? (
                    <EmptyState
                        icon="cube-outline"
                        title="Nenhum fornecedor encontrado"
                        description={search ? 'Ajuste a busca.' : 'Ainda não há fornecedores.'}
                    />
                ) : (
                    <FlashList
                        data={suppliers}
                        renderItem={renderItem}
                        keyExtractor={(s) => String(s.id)}
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
                    <Skeleton width="65%" height={16} />
                    <Skeleton width="40%" height={12} className="mt-2" />
                    <Skeleton width="100%" height={40} radius={10} className="mt-3" />
                </View>
            ))}
        </View>
    );
}
