import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { AppointmentCard } from '@/components/features/AppointmentCard';
import {
    SchedulingFilterSheet,
    type SchedulingFilterSheetRef,
} from '@/components/features/SchedulingFilterSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
    useAppointments,
    useSchedulingStoreSummary,
} from '@/hooks/useScheduling';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useTheme } from '@/theme';
import {
    APPOINTMENT_STATUS_CONFIG,
    STATUS_PRIORITY,
} from '@/constants/scheduling';
import type {
    Appointment,
    AppointmentDisplayStatus,
    AppointmentFilters,
    SchedulingStoreSummary,
} from '@/types/scheduling.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-02 — Lista de Agendamentos.
 *
 * Header preto (título + contagem + filtro), busca (placa/OS externa, debounce
 * 400ms), banner "N atrasados", resumo por loja (6 contadores), toggle de
 * itens finalizados/cancelados ocultos, e a lista AGRUPADA por `delivery_date`
 * com cabeçalhos de seção ("Hoje"/"Amanhã"/DD/MM/AAAA); dentro de cada dia os
 * cards são ordenados por `STATUS_PRIORITY`. FlashList com itens intercalados
 * (header de seção + card) + `getItemType` (padrão do projeto). Pull-to-refresh,
 * paginação infinita, estados Loading/Empty/Error.
 */

const SEARCH_DEBOUNCE_MS = 400;

const STATUS_ORDER: AppointmentDisplayStatus[] = [
    'atrasado',
    'atencao',
    'agendado',
    'em_execucao',
    'finalizado',
    'cancelado',
];

/** Status escondidos por padrão (revelados pelo toggle). */
const HIDDEN_BY_DEFAULT: AppointmentDisplayStatus[] = ['finalizado', 'cancelado'];

/** Conta filtros ativos do sheet (exclui search/store). */
function countActiveFilters(f: AppointmentFilters): number {
    let n = 0;
    if (f.department) n += 1;
    if (f.service_category) n += 1;
    if (f.date_from) n += 1;
    if (f.date_to) n += 1;
    return n;
}

// ─── Agrupamento por data ────────────────────────────────────────────────────

type ListRow =
    | { type: 'header'; key: string; label: string }
    | { type: 'card'; key: string; appointment: Appointment };

function ymdLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Rótulo do cabeçalho de dia: "Hoje" / "Amanhã" / DD/MM/AAAA. */
function dayLabel(deliveryDate: string): string {
    const today = new Date();
    const todayStr = ymdLocal(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = ymdLocal(tomorrow);

    // `delivery_date` chega como YYYY-MM-DD; compara só a parte da data.
    const key = (deliveryDate ?? '').slice(0, 10);
    if (key === todayStr) return 'Hoje';
    if (key === tomorrowStr) return 'Amanhã';
    const [y, m, d] = key.split('-');
    if (y && m && d) return `${d}/${m}/${y}`;
    return 'Sem data';
}

/**
 * Achata os agendamentos em linhas (header de dia + cards), ordenando os dias
 * cronologicamente e os cards de cada dia por STATUS_PRIORITY.
 */
function buildRows(items: Appointment[]): ListRow[] {
    const byDay = new Map<string, Appointment[]>();
    for (const a of items) {
        const key = (a.delivery_date ?? '').slice(0, 10) || 'sem-data';
        const arr = byDay.get(key);
        if (arr) arr.push(a);
        else byDay.set(key, [a]);
    }

    const sortedDays = Array.from(byDay.keys()).sort((a, b) => {
        if (a === 'sem-data') return 1;
        if (b === 'sem-data') return -1;
        return a.localeCompare(b);
    });

    const rows: ListRow[] = [];
    for (const day of sortedDays) {
        const dayItems = (byDay.get(day) ?? []).slice().sort((a, b) => {
            const pa = STATUS_PRIORITY[a.display_status] ?? 99;
            const pb = STATUS_PRIORITY[b.display_status] ?? 99;
            if (pa !== pb) return pa - pb;
            // Empate: por horário (delivery_time) crescente.
            return (a.delivery_time ?? '').localeCompare(b.delivery_time ?? '');
        });
        rows.push({
            type: 'header',
            key: `header-${day}`,
            label: day === 'sem-data' ? 'Sem data' : dayLabel(day),
        });
        for (const a of dayItems) {
            rows.push({ type: 'card', key: `card-${a.id}`, appointment: a });
        }
    }
    return rows;
}

export function SchedulingListScreen({
    navigation,
}: SchedulingStackScreenProps<'SchedulingList'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('scheduling');
    const filterSheetRef = useRef<SchedulingFilterSheetRef>(null);

    const [sheetFilters, setSheetFilters] = useState<AppointmentFilters>({});
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const searchRef = useRef<TextInput>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Cancelados só vêm do backend se include_cancelled = true.
    const filters = useMemo<AppointmentFilters>(
        () => ({
            ...sheetFilters,
            search: search || undefined,
            include_cancelled: showHidden || undefined,
        }),
        [sheetFilters, search, showHidden]
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
    } = useAppointments(filters);

    const { data: storeSummary, isLoading: summaryLoading } = useSchedulingStoreSummary({
        date_from: sheetFilters.date_from,
        date_to: sheetFilters.date_to,
        department: sheetFilters.department,
    });

    const activeFilterCount = countActiveFilters(sheetFilters);

    // Contagem de atrasados + de itens ocultos (finalizado/cancelado).
    const lateCount = useMemo(
        () => items.filter((a) => a.display_status === 'atrasado').length,
        [items]
    );
    const hiddenCount = useMemo(
        () => items.filter((a) => HIDDEN_BY_DEFAULT.includes(a.display_status)).length,
        [items]
    );

    // Itens efetivamente exibidos (esconde finalizado/cancelado por padrão).
    const visibleItems = useMemo(
        () =>
            showHidden
                ? items
                : items.filter((a) => !HIDDEN_BY_DEFAULT.includes(a.display_status)),
        [items, showHidden]
    );

    const rows = useMemo(() => buildRows(visibleItems), [visibleItems]);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const handleOpen = useCallback(
        (id: number) => navigation.navigate('AppointmentDetail', { id }),
        [navigation]
    );

    const renderItem = useCallback(
        ({ item }: { item: ListRow }) => {
            if (item.type === 'header') {
                return (
                    <View className="px-4 pb-2 pt-3">
                        <Text className="font-sans-bold text-sm uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                            {item.label}
                        </Text>
                    </View>
                );
            }
            return (
                <View className="px-4 pb-3">
                    <AppointmentCard
                        appointment={item.appointment}
                        onPress={() => handleOpen(item.appointment.id)}
                    />
                </View>
            );
        },
        [handleOpen]
    );

    const keyExtractor = useCallback((item: ListRow) => item.key, []);
    const getItemType = useCallback((item: ListRow) => item.type, []);

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'agendamento' : 'agendamentos'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">Agendamentos</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                {subtitle}
                            </Text>
                        </View>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Filtrar agendamentos"
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

                    {/* Busca */}
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
                ) : (
                    <FlashList
                        data={rows}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        getItemType={getItemType}
                        contentContainerStyle={{ paddingTop: 4, paddingBottom: 96 }}
                        ListHeaderComponent={
                            <ListHeader
                                summary={storeSummary}
                                summaryLoading={summaryLoading}
                                lateCount={lateCount}
                                hiddenCount={hiddenCount}
                                showHidden={showHidden}
                                onToggleHidden={() => setShowHidden((v) => !v)}
                            />
                        }
                        ListEmptyComponent={
                            <EmptyState
                                icon="calendar-outline"
                                title="Nenhum agendamento"
                                description={
                                    search || activeFilterCount > 0
                                        ? 'Ajuste a busca ou os filtros para ver mais resultados.'
                                        : 'Ainda não há agendamentos para a loja selecionada.'
                                }
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

            {/* FAB Novo agendamento (stub na próxima ronda) */}
            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Novo agendamento"
                    onPress={() => navigation.navigate('CreateAppointment')}
                    className="absolute bottom-6 right-5 h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-90"
                >
                    <Ionicons name="add" size={24} color="#1A1A1A" />
                    <Text className="font-sans-bold text-base text-brand-black">Novo</Text>
                </Pressable>
            ) : null}

            <SchedulingFilterSheet
                ref={filterSheetRef}
                value={sheetFilters}
                onApply={setSheetFilters}
            />
        </View>
    );
}

// ─── Cabeçalho da lista: banner + resumo + toggle ────────────────────────────

interface ListHeaderProps {
    summary: SchedulingStoreSummary[] | undefined;
    summaryLoading: boolean;
    lateCount: number;
    hiddenCount: number;
    showHidden: boolean;
    onToggleHidden: () => void;
}

function ListHeader({
    summary,
    summaryLoading,
    lateCount,
    hiddenCount,
    showHidden,
    onToggleHidden,
}: ListHeaderProps) {
    return (
        <View>
            {/* Banner de atrasados */}
            {lateCount > 0 ? (
                <View className="mx-4 mb-1 mt-3 flex-row items-center gap-2 rounded-xl bg-error-light px-3 py-2.5 dark:bg-dark-elevated">
                    <Ionicons name="alert-circle" size={18} color="#EF4444" />
                    <Text className="font-sans-semibold text-sm text-error">
                        {lateCount} {lateCount === 1 ? 'atrasado' : 'atrasados'}
                    </Text>
                </View>
            ) : null}

            {/* Resumo por loja */}
            <StoreSummaryCard summary={summary} loading={summaryLoading} />

            {/* Toggle de itens ocultos */}
            {hiddenCount > 0 || showHidden ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        showHidden
                            ? 'Ocultar finalizados e cancelados'
                            : `Mostrar ${hiddenCount} finalizados ou cancelados ocultos`
                    }
                    accessibilityState={{ expanded: showHidden }}
                    onPress={onToggleHidden}
                    className="mx-4 mb-1 mt-2 flex-row items-center justify-center gap-1.5 rounded-xl bg-neutral-100 px-3 py-2.5 active:opacity-70 dark:bg-dark-elevated"
                >
                    <Ionicons
                        name={showHidden ? 'eye-off-outline' : 'eye-outline'}
                        size={16}
                        color="#667085"
                    />
                    <Text className="font-sans-semibold text-sm text-neutral-600 dark:text-dark-text">
                        {showHidden
                            ? 'Ocultar finalizados/cancelados'
                            : `Mostrar ${hiddenCount} finalizados/cancelados`}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

function StoreSummaryCard({
    summary,
    loading,
}: {
    summary: SchedulingStoreSummary[] | undefined;
    loading: boolean;
}) {
    // Agrega todas as lojas retornadas no contexto atual em 6 contadores.
    const totals = useMemo(() => {
        const acc: Record<AppointmentDisplayStatus, number> = {
            atrasado: 0,
            atencao: 0,
            agendado: 0,
            em_execucao: 0,
            finalizado: 0,
            cancelado: 0,
        };
        for (const s of summary ?? []) {
            for (const st of STATUS_ORDER) acc[st] += s[st] ?? 0;
        }
        return acc;
    }, [summary]);

    if (loading) {
        return (
            <View className="px-4 pb-1 pt-3">
                <Skeleton width="100%" height={72} radius={16} />
            </View>
        );
    }
    if (!summary || summary.length === 0) return null;

    return (
        <View className="mx-4 mb-1 mt-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className="mb-2.5 font-sans-semibold text-xs uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                Resumo da loja
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14 }}
            >
                {STATUS_ORDER.map((st) => {
                    const cfg = APPOINTMENT_STATUS_CONFIG[st];
                    return (
                        <View key={st} className="items-center" accessibilityLabel={`${cfg.label}: ${totals[st]}`}>
                            <View className="flex-row items-center gap-1.5">
                                <View
                                    style={{
                                        width: 9,
                                        height: 9,
                                        borderRadius: 5,
                                        backgroundColor: cfg.dot,
                                    }}
                                />
                                <Text className="font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                                    {totals[st]}
                                </Text>
                            </View>
                            <Text className="mt-0.5 font-sans text-[11px] text-neutral-500 dark:text-dark-text-muted">
                                {cfg.label}
                            </Text>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4 pt-3">
            <Skeleton width="100%" height={72} radius={16} className="mb-4" />
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="mb-3 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="40%" height={18} />
                    <View className="mt-3 flex-row gap-3">
                        <Skeleton width="45%" height={14} />
                        <Skeleton width="35%" height={14} />
                    </View>
                    <Skeleton width="100%" height={28} radius={8} className="mt-4" />
                </View>
            ))}
        </View>
    );
}
