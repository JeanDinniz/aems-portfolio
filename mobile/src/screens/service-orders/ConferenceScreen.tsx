import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
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

import { OSStatusBadge } from '@/components/ui/OSStatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
    useConferenceList,
    useConferenceSummary,
    useConferenceSummaryByStore,
    useVerifyServiceOrder,
    useUnverifyServiceOrder,
    useUpdateServiceOrderStatus,
    type ConferenceVerifiedFilter,
} from '@/hooks/useServiceOrders';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { StoreSelector } from '@/components/common/StoreSelector';
import { useStoreStore } from '@/stores/store.store';
import { useTheme } from '@/theme';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { formatDateBR, formatDateTimeBR } from '@/utils/formatDate';
import { getApiErrorMessage } from '@/lib/api-error';
import type { Department, ServiceOrder } from '@/types/service-order.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * OS-10 — Conferência de O.S.
 *
 * Lista as O.S. finalizadas (status `completed`) para auditoria, espelhando o
 * essencial do web `ConferencePage`. Funcionalidades:
 * - Filtro de verificação: Pendentes (is_verified=false) / Conferidas
 *   (is_verified=true) / Todas.
 * - Filtro "Somente cortesia" (flag courtesy).
 * - Busca por placa + período (date_from/date_to, formato AAAA-MM-DD).
 * - Respeita a loja selecionada globalmente (injetada pelo hook) e mostra os
 *   chips de galpão/retorno/cortesia.
 * - Marcar/desmarcar "Conferida" via PATCH /service-orders/{id} { is_verified }.
 * - Resumo por departamento (GET /service-orders/conference/summary).
 *
 * Acessível pelo menu "Mais" (rota `Conference` no AppStack), com header próprio
 * (preto) — o AppStack usa `headerShown: false`.
 */

const SEARCH_DEBOUNCE_MS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VERIFIED_TABS: { value: ConferenceVerifiedFilter; label: string }[] = [
    { value: 'pending', label: 'Pendentes' },
    { value: 'verified', label: 'Conferidas' },
    { value: 'all', label: 'Todas' },
];

function defaultDateFrom(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}
function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function ConferenceScreen({ navigation }: AppStackScreenProps<'Conference'>) {
    const toast = useToast();
    const { colors } = useTheme();
    const canEdit = useCanEdit('conference');
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [verified, setVerified] = useState<ConferenceVerifiedFilter>('pending');
    const [onlyCourtesy, setOnlyCourtesy] = useState(false);
    const [dateFrom, setDateFrom] = useState(defaultDateFrom());
    const [dateTo, setDateTo] = useState(today());
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const searchRef = useRef<TextInput>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Só envia datas válidas (AAAA-MM-DD) ao backend.
    const validFrom = DATE_RE.test(dateFrom) ? dateFrom : undefined;
    const validTo = DATE_RE.test(dateTo) ? dateTo : undefined;

    const listFilters = useMemo(
        () => ({
            verified,
            is_courtesy: onlyCourtesy || undefined,
            date_from: validFrom,
            date_to: validTo,
            plate: search || undefined,
        }),
        [verified, onlyCourtesy, validFrom, validTo, search]
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
    } = useConferenceList(listFilters);

    const summaryFilters = {
        store_ids: selectedStoreId ? [selectedStoreId] : undefined,
        date_from: validFrom,
        date_to: validTo,
        plate: search || undefined,
        include_cancelled: true,
        is_courtesy: onlyCourtesy ? true : undefined,
    };

    const { data: summary, isLoading: summaryLoading } = useConferenceSummary(summaryFilters);

    // A4 — resumo por LOJA só faz sentido quando "Todas as Lojas" está selecionada.
    const allStores = selectedStoreId === null;
    const { data: storeSummary, isLoading: storeSummaryLoading } = useConferenceSummaryByStore(
        summaryFilters,
        allStores
    );

    const verifyMutation = useVerifyServiceOrder();
    const unverifyMutation = useUnverifyServiceOrder();
    const resolveDuplicateMutation = useUpdateServiceOrderStatus();
    const [pendingId, setPendingId] = useState<number | null>(null);

    const handleResolveDuplicate = useCallback(
        (order: ServiceOrder) => {
            setPendingId(order.id);
            resolveDuplicateMutation.mutate(
                { id: order.id, status: 'waiting' },
                {
                    onSuccess: () => toast.success('Duplicidade resolvida.'),
                    onError: (err) =>
                        toast.error(
                            getApiErrorMessage(err as Error, 'Não foi possível resolver a duplicidade.')
                        ),
                    onSettled: () => setPendingId(null),
                }
            );
        },
        [resolveDuplicateMutation, toast]
    );

    const handleToggleVerify = useCallback(
        (order: ServiceOrder) => {
            const mutation = order.is_verified ? unverifyMutation : verifyMutation;
            setPendingId(order.id);
            mutation.mutate(order.id, {
                onSuccess: () => {
                    toast.success(order.is_verified ? 'Verificação desfeita.' : 'O.S conferida!');
                },
                onError: (err) => {
                    toast.error(getApiErrorMessage(err as Error, 'Não foi possível atualizar a O.S.'));
                },
                onSettled: () => setPendingId(null),
            });
        },
        [verifyMutation, unverifyMutation, toast]
    );

    const [exporting, setExporting] = useState(false);
    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await serviceOrdersService.exportConferencia({
                store_id: selectedStoreId ?? undefined,
                date_from: validFrom,
                date_to: validTo,
                is_verified:
                    verified === 'verified' ? true : verified === 'pending' ? false : undefined,
                flag: onlyCourtesy ? ['courtesy'] : undefined,
                plate: search || undefined,
            });
            toast.success('Excel gerado.');
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o Excel.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, selectedStoreId, validFrom, validTo, verified, onlyCourtesy, search, toast]);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const renderItem = useCallback(
        ({ item }: { item: ServiceOrder }) => (
            <View className="px-4 pb-3">
                <ConferenceCard
                    order={item}
                    canEdit={canEdit}
                    busy={pendingId === item.id}
                    onToggleVerify={() => handleToggleVerify(item)}
                    onResolveDuplicate={() => handleResolveDuplicate(item)}
                />
            </View>
        ),
        [canEdit, pendingId, handleToggleVerify, handleResolveDuplicate]
    );

    const keyExtractor = useCallback((item: ServiceOrder) => String(item.id), []);

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'O.S finalizada' : 'O.S finalizadas'}`;

    const activeFilters = (onlyCourtesy ? 1 : 0) + (verified !== 'pending' ? 1 : 0);

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Voltar"
                            onPress={() => navigation.goBack()}
                            hitSlop={8}
                            className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                        >
                            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                        </Pressable>
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">Conferência</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Exportar Excel"
                            accessibilityState={{ busy: exporting, disabled: exporting }}
                            disabled={exporting}
                            onPress={() => void handleExport()}
                            className={`h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70 ${
                                exporting ? 'opacity-50' : ''
                            }`}
                        >
                            {exporting ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                            )}
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Mostrar filtros"
                            onPress={() => setFiltersOpen((v) => !v)}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="options-outline" size={20} color="#FFFFFF" />
                            {activeFilters > 0 ? (
                                <View className="absolute -right-0.5 -top-0.5 h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1">
                                    <Text className="font-sans-bold text-[11px] text-brand-black">
                                        {activeFilters}
                                    </Text>
                                </View>
                            ) : null}
                        </Pressable>
                    </View>

                    {/* Abas de verificação */}
                    <View className="mt-3 flex-row gap-2">
                        {VERIFIED_TABS.map((tab) => {
                            const active = verified === tab.value;
                            return (
                                <Pressable
                                    key={tab.value}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={tab.label}
                                    onPress={() => setVerified(tab.value)}
                                    className={`min-h-[40px] flex-1 items-center justify-center rounded-xl px-3 active:opacity-80 ${
                                        active ? 'bg-brand' : 'bg-white/10'
                                    }`}
                                >
                                    <Text
                                        className={`font-sans-semibold text-sm ${
                                            active ? 'text-brand-black' : 'text-neutral-300'
                                        }`}
                                    >
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Busca */}
                    <Pressable
                        accessibilityRole="search"
                        accessibilityLabel="Buscar por placa"
                        onPress={() => searchRef.current?.focus()}
                        className="mt-3 min-h-[48px] flex-row items-center rounded-xl bg-white/10 px-3"
                    >
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            ref={searchRef}
                            placeholder="Buscar por placa"
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

                    {/* Painel de filtros (loja + período + cortesia) */}
                    {filtersOpen ? (
                        <View className="mt-3 gap-3 rounded-xl bg-white/5 p-3">
                            <View>
                                <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                    Loja
                                </Text>
                                <StoreSelector />
                            </View>
                            <View className="flex-row gap-3">
                                <View className="flex-1">
                                    <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                        De
                                    </Text>
                                    <TextInput
                                        accessibilityLabel="Data inicial"
                                        placeholder="AAAA-MM-DD"
                                        value={dateFrom}
                                        onChangeText={setDateFrom}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="numbers-and-punctuation"
                                        placeholderTextColor="#98A2B3"
                                        className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                        style={{ color: '#FFFFFF' }}
                                    />
                                </View>
                                <View className="flex-1">
                                    <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                        Até
                                    </Text>
                                    <TextInput
                                        accessibilityLabel="Data final"
                                        placeholder="AAAA-MM-DD"
                                        value={dateTo}
                                        onChangeText={setDateTo}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="numbers-and-punctuation"
                                        placeholderTextColor="#98A2B3"
                                        className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                        style={{ color: '#FFFFFF' }}
                                    />
                                </View>
                            </View>
                            <Pressable
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: onlyCourtesy }}
                                accessibilityLabel="Somente cortesia"
                                onPress={() => setOnlyCourtesy((v) => !v)}
                                className="min-h-[44px] flex-row items-center gap-2.5 active:opacity-70"
                            >
                                <View
                                    className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                                        onlyCourtesy ? 'border-brand bg-brand' : 'border-neutral-500'
                                    }`}
                                >
                                    {onlyCourtesy ? (
                                        <Ionicons name="checkmark" size={16} color="#1A1A1A" />
                                    ) : null}
                                </View>
                                <Text className="font-sans-medium text-base text-white">
                                    Somente cortesia
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}
                </View>
            </SafeAreaView>

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
                        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
                        ListHeaderComponent={
                            <View>
                                {allStores ? (
                                    <ConferenceStoreSummaryHeader
                                        summary={storeSummary}
                                        loading={storeSummaryLoading}
                                    />
                                ) : null}
                                <ConferenceSummaryHeader summary={summary} loading={summaryLoading} />
                            </View>
                        }
                        ListEmptyComponent={
                            <EmptyState
                                icon="checkmark-done-outline"
                                title="Nenhuma O.S para conferir"
                                description={
                                    search || activeFilters > 0
                                        ? 'Ajuste a busca ou os filtros para ver mais resultados.'
                                        : 'Não há ordens finalizadas para a loja e o período selecionados.'
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
        </View>
    );
}

// ─── Resumo por departamento ────────────────────────────────────────────────

interface SummaryItem {
    department: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

function ConferenceSummaryHeader({
    summary,
    loading,
}: {
    summary: SummaryItem[] | undefined;
    loading: boolean;
}) {
    if (loading) {
        return (
            <View className="px-4 pb-2">
                <Skeleton width="100%" height={92} radius={16} />
            </View>
        );
    }
    if (!summary || summary.length === 0) return null;

    return (
        <View className="px-4 pb-3">
            <Text className="mb-2 font-sans-semibold text-xs uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                Resumo por departamento
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
            >
                {summary.map((s) => {
                    const pending = Math.max(s.total - s.verified, 0);
                    return (
                        <View
                            key={s.department}
                            className="w-40 rounded-2xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface"
                        >
                            <Text
                                className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text"
                                numberOfLines={1}
                            >
                                {DEPARTMENTS_MAP[s.department as Department] ?? s.department}
                            </Text>
                            <Text className="mt-1 font-display-bold text-2xl text-neutral-900 dark:text-dark-text">
                                {s.total}
                            </Text>
                            <View className="mt-1.5 flex-row items-center gap-3">
                                <View className="flex-row items-center gap-1">
                                    <View className="h-2 w-2 rounded-full bg-success" />
                                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                        {s.verified} ok
                                    </Text>
                                </View>
                                <View className="flex-row items-center gap-1">
                                    <View className="h-2 w-2 rounded-full bg-warning" />
                                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                        {pending} pend.
                                    </Text>
                                </View>
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

// ─── Resumo por loja (A4) ───────────────────────────────────────────────────

interface StoreSummaryItem {
    store_id: number;
    store_name: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

function ConferenceStoreSummaryHeader({
    summary,
    loading,
}: {
    summary: StoreSummaryItem[] | undefined;
    loading: boolean;
}) {
    if (loading) {
        return (
            <View className="px-4 pb-2">
                <Skeleton width="100%" height={92} radius={16} />
            </View>
        );
    }
    if (!summary || summary.length === 0) return null;

    return (
        <View className="px-4 pb-3">
            <Text className="mb-2 font-sans-semibold text-xs uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                Resumo por loja
            </Text>
            <View className="gap-2">
                {summary.map((s) => {
                    const pending = Math.max(s.total - s.verified, 0);
                    return (
                        <View
                            key={s.store_id}
                            className="flex-row items-center justify-between rounded-2xl border border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface"
                        >
                            <View className="flex-1 pr-3">
                                <Text
                                    className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text"
                                    numberOfLines={1}
                                >
                                    {s.store_name}
                                </Text>
                                <View className="mt-1 flex-row items-center gap-3">
                                    <View className="flex-row items-center gap-1">
                                        <View className="h-2 w-2 rounded-full bg-success" />
                                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                            {s.verified} ok
                                        </Text>
                                    </View>
                                    <View className="flex-row items-center gap-1">
                                        <View className="h-2 w-2 rounded-full bg-warning" />
                                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                            {pending} pend.
                                        </Text>
                                    </View>
                                </View>
                            </View>
                            <View className="items-end">
                                <Text className="font-display-bold text-xl text-neutral-900 dark:text-dark-text">
                                    {s.total}
                                </Text>
                                <Text className="font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                                    {`${Math.round(s.percent_verified)}% conf.`}
                                </Text>
                            </View>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// ─── Card de conferência ────────────────────────────────────────────────────

interface ConferenceCardProps {
    order: ServiceOrder;
    canEdit: boolean;
    busy: boolean;
    onToggleVerify: () => void;
    onResolveDuplicate: () => void;
}

function ConferenceCardComponent({
    order,
    canEdit,
    busy,
    onToggleVerify,
    onResolveDuplicate,
}: ConferenceCardProps) {
    const isDuplicate = order.status === 'duplicate';
    const vehicle = [order.vehicle_model, order.vehicle_color].filter(Boolean).join(' · ') || '—';
    const osNumber = order.external_os_number || '—';
    const dateValue = order.service_date ?? order.completed_at ?? order.entry_time;
    const verifiedLabel = order.is_verified ? 'Conferida' : 'Marcar conferida';

    return (
        <View className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="p-4">
                <View className="mb-3 flex-row items-start justify-between gap-2">
                    <Text
                        className="flex-1 font-display-bold text-base text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {`OS ${osNumber}`}
                    </Text>
                    {order.is_verified ? (
                        <View className="flex-row items-center gap-1 rounded-full bg-success-light px-2 py-0.5 dark:bg-dark-elevated">
                            <Ionicons name="checkmark-circle" size={14} color="#12B76A" />
                            <Text className="font-sans-semibold text-[11px] text-success">Conferida</Text>
                        </View>
                    ) : (
                        <OSStatusBadge status={order.status} size="sm" />
                    )}
                </View>

                <View className="flex-row flex-wrap">
                    <Field label="Placa" value={order.plate} mono />
                    <Field label="Depto" value={DEPARTMENTS_MAP[order.department] ?? '—'} />
                    <Field label="Loja" value={order.location_name || '—'} />
                    <Field label="Data" value={formatDateBR(dateValue)} />
                    <Field label="Veículo" value={vehicle} full />
                </View>

                {(order.is_galpon || order.is_return || order.is_courtesy) && (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {order.is_galpon ? <Chip label="Galpão" /> : null}
                        {order.is_return ? <Chip label="Retorno" /> : null}
                        {order.is_courtesy ? <Chip label="Cortesia" /> : null}
                    </View>
                )}

                {/* A5 — Observações + foto de avaria + atualização */}
                {order.notes ? (
                    <View className="mt-3">
                        <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                            Observações
                        </Text>
                        <Text
                            className="font-sans text-sm text-neutral-700 dark:text-dark-text"
                            numberOfLines={3}
                        >
                            {order.notes}
                        </Text>
                    </View>
                ) : null}

                {order.internal_notes ? (
                    <View className="mt-2 rounded-xl bg-warning-light p-2.5 dark:bg-dark-elevated">
                        <Text className="mb-0.5 font-sans-semibold text-[11px] uppercase tracking-wide text-primary-700 dark:text-brand">
                            Nota interna
                        </Text>
                        <Text
                            className="font-sans text-sm text-primary-800 dark:text-dark-text"
                            numberOfLines={3}
                        >
                            {order.internal_notes}
                        </Text>
                    </View>
                ) : null}

                {order.damage_photos && order.damage_photos.length > 0 ? (
                    <View className="mt-3">
                        <Text className="mb-1 font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                            Avaria
                        </Text>
                        <Image
                            source={{ uri: order.damage_photos[0] }}
                            accessibilityLabel="Foto de avaria"
                            className="h-20 w-20 rounded-xl bg-neutral-100 dark:bg-dark-elevated"
                            resizeMode="cover"
                        />
                    </View>
                ) : null}

                {order.updated_at ? (
                    <Text className="mt-3 font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                        {`Atualizado em ${formatDateTimeBR(order.updated_at)}`}
                        {order.updated_by_name ? ` por ${order.updated_by_name}` : ''}
                    </Text>
                ) : null}

                {canEdit && isDuplicate ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Resolver duplicidade"
                        accessibilityState={{ busy }}
                        disabled={busy}
                        onPress={onResolveDuplicate}
                        className={`mt-4 min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-purple px-4 py-2.5 active:opacity-80 ${
                            busy ? 'opacity-50' : ''
                        }`}
                    >
                        {busy ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <>
                                <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
                                <Text className="font-sans-bold text-sm text-white">
                                    Resolver duplicidade
                                </Text>
                            </>
                        )}
                    </Pressable>
                ) : canEdit ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={verifiedLabel}
                        accessibilityState={{ busy, checked: order.is_verified }}
                        disabled={busy}
                        onPress={onToggleVerify}
                        className={`mt-4 min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg px-4 py-2.5 active:opacity-80 ${
                            order.is_verified
                                ? 'bg-neutral-100 dark:bg-dark-elevated'
                                : 'bg-success'
                        } ${busy ? 'opacity-50' : ''}`}
                    >
                        {busy ? (
                            <ActivityIndicator color={order.is_verified ? '#667085' : '#FFFFFF'} />
                        ) : (
                            <>
                                <Ionicons
                                    name={order.is_verified ? 'close-circle-outline' : 'checkmark-circle'}
                                    size={18}
                                    color={order.is_verified ? '#667085' : '#FFFFFF'}
                                />
                                <Text
                                    className={`font-sans-bold text-sm ${
                                        order.is_verified
                                            ? 'text-neutral-600 dark:text-dark-text'
                                            : 'text-white'
                                    }`}
                                >
                                    {order.is_verified ? 'Desfazer conferência' : 'Marcar conferida'}
                                </Text>
                            </>
                        )}
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

const ConferenceCard = memo(ConferenceCardComponent);

interface FieldProps {
    label: string;
    value: string;
    mono?: boolean;
    full?: boolean;
}

function Field({ label, value, mono = false, full = false }: FieldProps) {
    return (
        <View className={full ? 'mt-2 w-full' : 'mt-2 w-1/2 pr-2'}>
            <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className={`font-sans-semibold text-sm text-neutral-800 dark:text-dark-text ${
                    mono ? 'font-mono tracking-wider' : ''
                }`}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

function Chip({ label }: { label: string }) {
    return (
        <View className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
            <Text className="font-sans-medium text-[11px] text-neutral-500 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="px-4 pt-3">
            {[0, 1, 2].map((i) => (
                <View
                    key={i}
                    className="mb-3 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="50%" height={18} />
                    <View className="mt-3 flex-row gap-3">
                        <Skeleton width="45%" height={14} />
                        <Skeleton width="45%" height={14} />
                    </View>
                    <Skeleton width="100%" height={44} radius={10} className="mt-4" />
                </View>
            ))}
        </View>
    );
}
