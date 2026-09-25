import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Select, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui';
import { MaterialRequestCard } from '@/components/features/MaterialRequestCard';
import { useDeleteMaterialRequest, useMaterialRequests } from '@/hooks/useMaterialRequests';
import { useCanDelete, useCanEdit } from '@/hooks/useMyPermissions';
import { useStores } from '@/hooks/useStores';
import { useStoreStore } from '@/stores/store.store';
import { downloadAndShareExcel } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import type { MaterialRequest, MaterialRequestListParams } from '@/types/materialRequest.types';
import type { MaterialRequestsStackScreenProps } from './navigation';

/**
 * MR-01 — Lista de Pedidos de Material (rota web /pedidos).
 *
 * Header preto (título + contagem + export + filtro); painel de filtros com
 * período (De/Até, AAAA-MM-DD) e loja (quando multi-loja). A loja selecionada
 * globalmente (`selectedStoreId`) é o padrão do filtro. Cards de pedido com
 * películas/ferramentas/histórico; pull-to-refresh, paginação e estados
 * Loading/Empty/Error.
 *
 * FAB "Novo pedido" e ação de excluir só aparecem com `material_requests`
 * can_edit / can_delete. Export Excel via `downloadAndShareExcel` (degrada no
 * Expo Go → toast).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 20;

function firstDayOfMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function MaterialRequestsListScreen({
    navigation,
}: MaterialRequestsStackScreenProps<'MaterialRequestsList'>) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const insets = useSafeAreaInsets();
    const canEdit = useCanEdit('material_requests');
    const canDelete = useCanDelete('material_requests');
    const { stores, isMultiStore } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const storeSheetRef = useRef<SelectRef>(null);

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [dateFrom, setDateFrom] = useState<string>(firstDayOfMonth());
    const [dateTo, setDateTo] = useState<string>(today());
    // Padrão: loja selecionada globalmente ('all' = todas as lojas acessíveis).
    const [filterStoreId, setFilterStoreId] = useState<number | 'all'>(selectedStoreId ?? 'all');
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);

    const resetPage = () => setPage(1);

    const validFrom = DATE_RE.test(dateFrom) ? dateFrom : undefined;
    const validTo = DATE_RE.test(dateTo) ? dateTo : undefined;

    const params = useMemo<MaterialRequestListParams>(
        () => ({
            store_id: filterStoreId !== 'all' ? filterStoreId : undefined,
            date_from: validFrom,
            date_to: validTo,
            page,
            limit: PAGE_SIZE,
        }),
        [filterStoreId, validFrom, validTo, page]
    );

    const { data, isLoading, isError, refetch, isRefetching } = useMaterialRequests(params);
    const deleteMutation = useDeleteMaterialRequest();
    const [pendingId, setPendingId] = useState<number | null>(null);

    const requests = data?.items ?? [];
    const pagination = data?.pagination;
    const totalPages = pagination?.total_pages ?? 1;
    const total = pagination?.total ?? 0;

    const storeOptions = useMemo(
        () => [
            { value: 0, label: 'Todas as lojas' },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
        ],
        [stores]
    );
    const filterStoreName =
        filterStoreId === 'all' ? undefined : stores.find((s) => s.id === filterStoreId)?.name;
    const activeFilters = filterStoreId !== 'all' ? 1 : 0;

    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await downloadAndShareExcel({
                path: '/material-requests/export/excel',
                params: {
                    store_id: params.store_id,
                    date_from: params.date_from,
                    date_to: params.date_to,
                },
                filename: `pedidos-material-${today()}.xlsx`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o Excel.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, params, toast]);

    const handleDelete = useCallback(
        async (req: MaterialRequest) => {
            const ok = await confirm({
                title: 'Excluir pedido?',
                message: `O pedido de ${formatRequestDate(req.request_date)}${
                    req.store_name ? ` da loja ${req.store_name}` : ''
                } será removido. As bobinas já criadas no Estoque permanecem (apenas são desvinculadas). Esta ação é irreversível.`,
                confirmLabel: 'Excluir',
                destructive: true,
            });
            if (ok) {
                setPendingId(req.id);
                deleteMutation.mutate(req.id, { onSettled: () => setPendingId(null) });
            }
        },
        [confirm, deleteMutation]
    );

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'pedido' : 'pedidos'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">
                                Pedidos de material
                            </Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                {subtitle}
                            </Text>
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

                    {/* Painel de filtros (período + loja) */}
                    {filtersOpen ? (
                        <View className="mt-3 gap-3 rounded-xl bg-white/5 p-3">
                            <View className="flex-row gap-3">
                                <View className="flex-1">
                                    <FilterLabel>De</FilterLabel>
                                    <DarkDateInput
                                        label="Data inicial"
                                        value={dateFrom}
                                        onChange={(t) => {
                                            setDateFrom(t);
                                            resetPage();
                                        }}
                                    />
                                </View>
                                <View className="flex-1">
                                    <FilterLabel>Até</FilterLabel>
                                    <DarkDateInput
                                        label="Data final"
                                        value={dateTo}
                                        onChange={(t) => {
                                            setDateTo(t);
                                            resetPage();
                                        }}
                                    />
                                </View>
                            </View>

                            {isMultiStore ? (
                                <View>
                                    <FilterLabel>Loja</FilterLabel>
                                    <DarkPicker
                                        value={filterStoreName ?? 'Todas as lojas'}
                                        onPress={() => storeSheetRef.current?.present()}
                                    />
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            </SafeAreaView>

            {/* Conteúdo */}
            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 96 + insets.bottom }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {requests.length === 0 ? (
                        <EmptyState
                            icon="cube-outline"
                            title="Nenhum pedido encontrado"
                            description="Ajuste o período ou os filtros, ou registre um novo pedido de material."
                        />
                    ) : (
                        <View className="gap-3">
                            {requests.map((req) => (
                                <MaterialRequestCard
                                    key={req.id}
                                    request={req}
                                    canEdit={canEdit}
                                    canDelete={canDelete}
                                    busy={pendingId === req.id}
                                    onEdit={() =>
                                        navigation.navigate('EditMaterialRequest', { id: req.id })
                                    }
                                    onDelete={() => handleDelete(req)}
                                />
                            ))}
                        </View>
                    )}

                    {/* Paginação */}
                    {totalPages > 1 ? (
                        <View className="mt-4 flex-row items-center justify-between">
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                Página {page} de {totalPages}
                            </Text>
                            <View className="flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Página anterior"
                                    accessibilityState={{ disabled: !pagination?.has_prev }}
                                    disabled={!pagination?.has_prev}
                                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        !pagination?.has_prev ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-back" size={20} color="#667085" />
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Próxima página"
                                    accessibilityState={{ disabled: !pagination?.has_next }}
                                    disabled={!pagination?.has_next}
                                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        !pagination?.has_next ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-forward" size={20} color="#667085" />
                                </Pressable>
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            {/* FAB Novo pedido */}
            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Novo pedido"
                    onPress={() => navigation.navigate('CreateMaterialRequest')}
                    style={{ bottom: insets.bottom + 24 }}
                    className="absolute right-5 h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-90"
                >
                    <Ionicons name="add" size={24} color="#1A1A1A" />
                    <Text className="font-sans-bold text-base text-brand-black">Novo pedido</Text>
                </Pressable>
            ) : null}

            {/* Sheet de loja */}
            <Select<number>
                ref={storeSheetRef}
                title="Filtrar por loja"
                options={storeOptions}
                value={filterStoreId === 'all' ? 0 : filterStoreId}
                onChange={(v) => {
                    setFilterStoreId(v === 0 ? 'all' : v);
                    resetPage();
                }}
            />
        </View>
    );
}

// ─── Helpers/subcomponentes ─────────────────────────────────────────────────

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sem criar Date (evita deslocamento de timezone). */
function formatRequestDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
            {children}
        </Text>
    );
}

function DarkDateInput({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (t: string) => void;
}) {
    // Input de data por texto (AAAA-MM-DD), padrão do WithdrawalsScreen — casa
    // com o tema escuro do header sem depender do date picker nativo.
    return (
        <TextInput
            accessibilityLabel={label}
            placeholder="AAAA-MM-DD"
            value={value}
            onChangeText={onChange}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            placeholderTextColor="#98A2B3"
            className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
            style={{ color: '#FFFFFF' }}
        />
    );
}

function DarkPicker({ value, onPress }: { value: string; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={value}
            onPress={onPress}
            className="min-h-[44px] flex-row items-center justify-between rounded-lg bg-white/10 px-3 py-2 active:opacity-70"
        >
            <Text className="flex-1 font-sans text-base text-white" numberOfLines={1}>
                {value}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#98A2B3" />
        </Pressable>
    );
}

function ListSkeleton() {
    return (
        <View className="gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View className="flex-row justify-between">
                        <Skeleton width="40%" height={18} />
                        <Skeleton width={70} height={18} radius={999} />
                    </View>
                    <Skeleton width="55%" height={14} className="mt-3" />
                    <Skeleton width="70%" height={12} className="mt-2" />
                    <Skeleton width="60%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
