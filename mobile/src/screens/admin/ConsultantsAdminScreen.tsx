import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { StoreSelector } from '@/components/common/StoreSelector';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { consultantsService } from '@/services/api/consultants.service';
import { useConsultants } from '@/hooks/useConsultants';
import { useStoreStore } from '@/stores/store.store';
import { downloadAndShareExcel } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { useTheme } from '@/theme';
import { AdminListHeader } from './UsersAdminScreen';
import type { Consultant, ConsultantFilters } from '@/types/consultant.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Consultores (Admin — Fatia 5a + UX). Faixa de filtros: StoreSelector (loja
 * ativa) + chips de status (Todos/Ativos/Inativos → `is_active`). Busca por nome.
 * Botão Exportar Excel no header (reusa `downloadAndShareExcel`). Read + export.
 */

const SEARCH_DEBOUNCE_MS = 400;

type StatusFilter = 'all' | 'active' | 'inactive';

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'active', label: 'Ativos' },
    { value: 'inactive', label: 'Inativos' },
];

function isoDate(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function ConsultantsAdminScreen({ navigation }: AdminStackScreenProps<'ConsultantsAdmin'>) {
    const { colors } = useTheme();
    const toast = useToast();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters = useMemo<ConsultantFilters>(
        () => ({
            search: search || undefined,
            store_id: selectedStoreId ?? undefined,
            is_active: status === 'all' ? undefined : status === 'active',
        }),
        [search, selectedStoreId, status]
    );

    const { consultants, total, isLoading, isError, refetch, isRefetching } = useConsultants(
        filters,
        1,
        200
    );

    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await downloadAndShareExcel({
                path: consultantsService.exportPath(),
                params: {
                    store_id: selectedStoreId ?? undefined,
                    search: search || undefined,
                },
                filename: `consultores_${isoDate()}.xlsx`,
            });
            toast.success('Excel gerado.');
        } catch (error) {
            toast.error(getApiErrorMessage(error as Error, 'Erro ao gerar o Excel.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, selectedStoreId, search, toast]);

    const renderItem = useCallback(
        ({ item }: { item: Consultant }) => (
            <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white px-4 py-3.5 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.name}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted" numberOfLines={1}>
                        {[item.store_name, item.phone].filter(Boolean).join(' · ') || '—'}
                    </Text>
                </View>
                <Badge
                    variant={item.is_active ? 'success' : 'neutral'}
                    size="sm"
                    label={item.is_active ? 'Ativo' : 'Inativo'}
                />
            </View>
        ),
        []
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <AdminListHeader
                title="Consultores"
                subtitle={isLoading ? 'Carregando...' : `${total} ${total === 1 ? 'consultor' : 'consultores'}`}
                onBack={() => navigation.goBack()}
                searchInput={searchInput}
                onSearch={setSearchInput}
                placeholder="Buscar por nome"
                right={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Exportar Excel"
                        onPress={handleExport}
                        disabled={exporting}
                        className={`h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70 ${
                            exporting ? 'opacity-50' : ''
                        }`}
                    >
                        <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                    </Pressable>
                }
            />

            {/* Faixa de filtros: loja + status */}
            <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface">
                <StoreSelector />

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="mt-3"
                    contentContainerStyle={{ gap: 8 }}
                >
                    {STATUS_CHIPS.map((chip) => (
                        <FilterChip
                            key={chip.value}
                            label={chip.label}
                            active={status === chip.value}
                            onPress={() => setStatus(chip.value)}
                        />
                    ))}
                </ScrollView>
            </View>

            <View className="flex-1 pt-3">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : consultants.length === 0 ? (
                    <EmptyState
                        icon="briefcase-outline"
                        title="Nenhum consultor encontrado"
                        description={
                            search || status !== 'all'
                                ? 'Ajuste os filtros.'
                                : 'Ainda não há consultores para a loja selecionada.'
                        }
                    />
                ) : (
                    <FlashList
                        data={consultants}
                        renderItem={renderItem}
                        keyExtractor={(c) => String(c.id)}
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

function FilterChip({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={onPress}
            className={`min-h-[36px] flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
                active ? 'bg-brand-black dark:bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated'
            }`}
        >
            <Text
                className={`font-sans-semibold text-xs ${
                    active ? 'text-white dark:text-brand-black' : 'text-neutral-600 dark:text-dark-text-muted'
                }`}
                numberOfLines={1}
            >
                {label}
            </Text>
        </Pressable>
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
                    <Skeleton width="40%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
