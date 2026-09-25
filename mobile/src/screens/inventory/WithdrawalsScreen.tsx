import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useConfirm } from '@/components/ui';
import { Select, type SelectRef } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
    CreateWithdrawalSheet,
    type CreateWithdrawalSheetRef,
} from '@/components/features/CreateWithdrawalSheet';
import {
    useFilmTypes,
    useReverseWithdrawal,
    useWithdrawals,
    useWithdrawalsSummary,
} from '@/hooks/useInventory';
import { useCanDelete } from '@/hooks/useMyPermissions';
import { useStores } from '@/hooks/useStores';
import { useStoreStore } from '@/stores/store.store';
import { employeesService } from '@/services/api/employees.service';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import { downloadAndShareExcel } from '@/utils/exportShare';
import { formatDateTimeBR } from '@/utils/formatDate';
import { getApiErrorMessage } from '@/lib/api-error';
import type { FilmWithdrawal } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * Saída Avulsa de Película — lista + registro + estorno + export (paridade com o
 * web `WithdrawalsSection`).
 *
 * - Filtros: período (date_from/date_to, AAAA-MM-DD), loja, funcionário, tipo.
 * - Cards de resumo por funcionário no período (base do desconto; exclui
 *   estornadas — o backend já filtra).
 * - Lista paginada de saídas com badge Ativa/Estornada, quem registrou e ação
 *   Estornar (só em ativas e se `inventory` can_delete permitir).
 * - Export Excel via `downloadAndShareExcel` (degrada no Expo Go → toast).
 * - FAB "Nova saída" abre o `CreateWithdrawalSheet`.
 *
 * Header próprio (preto) — o InventoryStack usa `headerShown: false`.
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
function fmtMeters(value: number): string {
    return `${value.toFixed(1)}m`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sem criar Date (evita deslocamento de timezone). */
function formatReceiptDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

/** Bobina em rótulo legível: "06/04/2026 · 15.0m" (a película tem coluna própria). */
function rollLabel(w: FilmWithdrawal): string {
    if (!w.roll_receipt_date) return w.roll_visual_id;
    const base = formatReceiptDate(w.roll_receipt_date);
    return w.roll_total_meters != null ? `${base} · ${fmtMeters(w.roll_total_meters)}` : base;
}

export function WithdrawalsScreen({ navigation }: InventoryStackScreenProps<'Withdrawals'>) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const insets = useSafeAreaInsets();
    const canDelete = useCanDelete('inventory');
    const { stores, isMultiStore } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const sheetRef = useRef<CreateWithdrawalSheetRef>(null);
    const storeSheetRef = useRef<SelectRef>(null);
    const employeeSheetRef = useRef<SelectRef>(null);
    const filmTypeSheetRef = useRef<SelectRef>(null);

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [dateFrom, setDateFrom] = useState<string>(firstDayOfMonth());
    const [dateTo, setDateTo] = useState<string>(today());
    const [filterStoreId, setFilterStoreId] = useState<number | 'all'>('all');
    const [filterEmployeeId, setFilterEmployeeId] = useState<number | 'all'>('all');
    const [filterFilmTypeId, setFilterFilmTypeId] = useState<number | 'all'>('all');
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);

    const resetPage = () => setPage(1);

    const validFrom = DATE_RE.test(dateFrom) ? dateFrom : undefined;
    const validTo = DATE_RE.test(dateTo) ? dateTo : undefined;

    const filters = useMemo(
        () => ({
            store_id: filterStoreId !== 'all' ? filterStoreId : undefined,
            employee_id: filterEmployeeId !== 'all' ? filterEmployeeId : undefined,
            film_type_id: filterFilmTypeId !== 'all' ? filterFilmTypeId : undefined,
            date_from: validFrom,
            date_to: validTo,
        }),
        [filterStoreId, filterEmployeeId, filterFilmTypeId, validFrom, validTo]
    );

    const {
        data: listData,
        isLoading,
        isError,
        refetch,
        isRefetching,
    } = useWithdrawals({ ...filters, page, limit: PAGE_SIZE });

    const { data: summaryData } = useWithdrawalsSummary(filters);

    const { data: filmTypes = [] } = useFilmTypes();

    // Instaladores ativos (todas as lojas) para o filtro de funcionário.
    const { data: installers = [] } = useQuery({
        queryKey: ['employees-installers-all'],
        queryFn: async () => {
            const res = await employeesService.list(
                { is_active: true, position: FILM_INSTALLER_POSITION },
                1,
                500
            );
            return res.employees;
        },
        staleTime: 1000 * 60 * 5,
    });

    const reverseMutation = useReverseWithdrawal();
    const [pendingId, setPendingId] = useState<number | null>(null);

    const items = listData?.items ?? [];
    const total = listData?.total ?? 0;
    const totalPages = listData?.total_pages ?? 1;
    const summaryItems = summaryData?.items ?? [];

    // Opções dos sheets de filtro.
    const storeOptions = useMemo(
        () => [
            { value: 0, label: 'Todas as lojas' },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
        ],
        [stores]
    );
    const employeeOptions = useMemo(
        () => [
            { value: 0, label: 'Todos' },
            ...installers.map((e) => ({ value: e.id, label: e.name })),
        ],
        [installers]
    );
    const filmTypeOptions = useMemo(
        () => [
            { value: 0, label: 'Todos os tipos' },
            ...filmTypes.map((ft) => ({ value: ft.id, label: ft.name })),
        ],
        [filmTypes]
    );

    const filterStoreName =
        filterStoreId === 'all' ? undefined : stores.find((s) => s.id === filterStoreId)?.name;
    const filterEmployeeName =
        filterEmployeeId === 'all'
            ? undefined
            : installers.find((e) => e.id === filterEmployeeId)?.name;
    const filterFilmTypeName =
        filterFilmTypeId === 'all'
            ? undefined
            : filmTypes.find((ft) => ft.id === filterFilmTypeId)?.name;

    const activeFilters =
        (filterStoreId !== 'all' ? 1 : 0) +
        (filterEmployeeId !== 'all' ? 1 : 0) +
        (filterFilmTypeId !== 'all' ? 1 : 0);

    const handleReverse = useCallback(
        async (w: FilmWithdrawal) => {
            const ok = await confirm({
                title: 'Estornar saída?',
                message: `Os ${fmtMeters(w.meters)} retirados para ${w.employee_name ?? 'o funcionário'} serão devolvidos à bobina de ${w.film_type_name ?? 'película'}${w.tonality ? ` ${w.tonality}` : ''}. A saída fica marcada como estornada e sai do total do funcionário. Bobina marcada como esgotada não é restaurada automaticamente.`,
                confirmLabel: 'Estornar',
                destructive: true,
            });
            if (ok) {
                setPendingId(w.id);
                reverseMutation.mutate(w.id, {
                    onSettled: () => setPendingId(null),
                });
            }
        },
        [confirm, reverseMutation]
    );

    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await downloadAndShareExcel({
                path: '/inventory/withdrawals/export',
                params: {
                    store_id: filters.store_id,
                    employee_id: filters.employee_id,
                    film_type_id: filters.film_type_id,
                    date_from: filters.date_from,
                    date_to: filters.date_to,
                },
                filename: `saidas-pelicula-${today()}.xlsx`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o Excel.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, filters, toast]);

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'saída' : 'saídas'} no período`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
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
                            <Text className="font-display-bold text-xl text-white">Saídas avulsas</Text>
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

                    {/* Painel de filtros (período + loja + funcionário + tipo) */}
                    {filtersOpen ? (
                        <View className="mt-3 gap-3 rounded-xl bg-white/5 p-3">
                            <View className="flex-row gap-3">
                                <View className="flex-1">
                                    <FilterLabel>De</FilterLabel>
                                    <TextInput
                                        accessibilityLabel="Data inicial"
                                        placeholder="AAAA-MM-DD"
                                        value={dateFrom}
                                        onChangeText={(t) => {
                                            setDateFrom(t);
                                            resetPage();
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="numbers-and-punctuation"
                                        placeholderTextColor="#98A2B3"
                                        className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                        style={{ color: '#FFFFFF' }}
                                    />
                                </View>
                                <View className="flex-1">
                                    <FilterLabel>Até</FilterLabel>
                                    <TextInput
                                        accessibilityLabel="Data final"
                                        placeholder="AAAA-MM-DD"
                                        value={dateTo}
                                        onChangeText={(t) => {
                                            setDateTo(t);
                                            resetPage();
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="numbers-and-punctuation"
                                        placeholderTextColor="#98A2B3"
                                        className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                        style={{ color: '#FFFFFF' }}
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

                            <View>
                                <FilterLabel>Funcionário</FilterLabel>
                                <DarkPicker
                                    value={filterEmployeeName ?? 'Todos'}
                                    onPress={() => employeeSheetRef.current?.present()}
                                />
                            </View>

                            <View>
                                <FilterLabel>Tipo</FilterLabel>
                                <DarkPicker
                                    value={filterFilmTypeName ?? 'Todos os tipos'}
                                    onPress={() => filmTypeSheetRef.current?.present()}
                                />
                            </View>
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
                    {/* Totais por funcionário */}
                    {summaryItems.length > 0 ? (
                        <View className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                            <View className="mb-3 flex-row items-center gap-1.5">
                                <Ionicons name="people-outline" size={15} color="#98A2B3" />
                                <Text className="font-sans-semibold text-xs uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                                    Totais por funcionário no período
                                </Text>
                            </View>
                            <View className="gap-2">
                                {summaryItems.map((s) => (
                                    <View
                                        key={s.employee_id}
                                        className="flex-row items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-dark-elevated"
                                    >
                                        <Text
                                            className="flex-1 font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                                            numberOfLines={1}
                                        >
                                            {s.employee_name}
                                        </Text>
                                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                            {fmtMeters(s.total_meters)} · {s.withdrawal_count}{' '}
                                            {s.withdrawal_count === 1 ? 'saída' : 'saídas'}
                                        </Text>
                                    </View>
                                ))}
                                <View className="mt-1 flex-row items-center justify-between rounded-lg border border-brand/40 bg-brand/10 px-3 py-2">
                                    <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                                        Total
                                    </Text>
                                    <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                                        {fmtMeters(summaryData?.total_meters ?? 0)}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    ) : null}

                    {/* Lista de saídas */}
                    {items.length === 0 ? (
                        <EmptyState
                            icon="cut-outline"
                            title="Nenhuma saída no período"
                            description="Ajuste o período ou os filtros, ou registre uma nova saída de película."
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((w) => (
                                <WithdrawalCard
                                    key={w.id}
                                    withdrawal={w}
                                    canDelete={canDelete}
                                    busy={pendingId === w.id}
                                    onReverse={() => handleReverse(w)}
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
                                    accessibilityState={{ disabled: page <= 1 }}
                                    disabled={page <= 1}
                                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        page <= 1 ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-back" size={20} color="#667085" />
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Próxima página"
                                    accessibilityState={{ disabled: page >= totalPages }}
                                    disabled={page >= totalPages}
                                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        page >= totalPages ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-forward" size={20} color="#667085" />
                                </Pressable>
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            {/* FAB Nova saída */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Nova saída"
                onPress={() => sheetRef.current?.present()}
                style={{ bottom: insets.bottom + 24 }}
                className="absolute right-5 h-14 flex-row items-center gap-2 rounded-full bg-brand px-5 shadow-lg active:opacity-90"
            >
                <Ionicons name="add" size={24} color="#1A1A1A" />
                <Text className="font-sans-bold text-base text-brand-black">Nova saída</Text>
            </Pressable>

            {/* Sheet de criação */}
            <CreateWithdrawalSheet ref={sheetRef} defaultStoreId={selectedStoreId} />

            {/* Sheets de filtro */}
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
            <Select<number>
                ref={employeeSheetRef}
                title="Filtrar por funcionário"
                options={employeeOptions}
                value={filterEmployeeId === 'all' ? 0 : filterEmployeeId}
                onChange={(v) => {
                    setFilterEmployeeId(v === 0 ? 'all' : v);
                    resetPage();
                }}
            />
            <Select<number>
                ref={filmTypeSheetRef}
                title="Filtrar por tipo"
                options={filmTypeOptions}
                value={filterFilmTypeId === 'all' ? 0 : filterFilmTypeId}
                onChange={(v) => {
                    setFilterFilmTypeId(v === 0 ? 'all' : v);
                    resetPage();
                }}
            />
        </View>
    );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
            {children}
        </Text>
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

interface WithdrawalCardProps {
    withdrawal: FilmWithdrawal;
    canDelete: boolean;
    busy: boolean;
    onReverse: () => void;
}

function WithdrawalCard({ withdrawal: w, canDelete, busy, onReverse }: WithdrawalCardProps) {
    const filmLabel = `${w.film_type_name ?? 'Película'}${w.tonality ? ` · ${w.tonality}` : ''}`;
    return (
        <View
            className={`overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-dark-border-soft dark:bg-dark-surface ${
                w.is_reversed ? 'opacity-60' : ''
            }`}
        >
            {/* Cabeçalho: metros + status */}
            <View className="flex-row items-center justify-between gap-2">
                <Text className="font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                    {fmtMeters(w.meters)}
                </Text>
                {w.is_reversed ? (
                    <Badge label="Estornada" variant="neutral" icon="arrow-undo-outline" size="sm" />
                ) : (
                    <Badge label="Ativa" variant="success" icon="checkmark-circle" size="sm" />
                )}
            </View>

            {/* Película + tonalidade */}
            <Text
                className="mt-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text"
                numberOfLines={1}
            >
                {filmLabel}
            </Text>

            {/* Funcionário */}
            <View className="mt-2 flex-row items-center gap-1.5">
                <Ionicons name="person-outline" size={14} color="#98A2B3" />
                <Text
                    className="flex-1 font-sans text-sm text-neutral-600 dark:text-dark-text-muted"
                    numberOfLines={1}
                >
                    {w.employee_name ?? '—'}
                </Text>
            </View>

            {/* Loja + bobina */}
            <View className="mt-1 flex-row items-center gap-1.5">
                <Ionicons name="storefront-outline" size={14} color="#98A2B3" />
                <Text
                    className="flex-1 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                    numberOfLines={1}
                >
                    {(w.store_name ?? '—') + ' · ' + rollLabel(w)}
                </Text>
            </View>

            {/* Motivo */}
            {w.reason ? (
                <View className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-dark-elevated">
                    <Text
                        className="font-sans text-xs text-neutral-600 dark:text-dark-text-muted"
                        numberOfLines={3}
                    >
                        {w.reason}
                    </Text>
                </View>
            ) : null}

            {/* Rodapé: data/quem registrou + estornar */}
            <View className="mt-3 flex-row items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                <View className="flex-1">
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {formatDateTimeBR(w.created_at)}
                    </Text>
                    {w.created_by_name ? (
                        <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            por {w.created_by_name}
                        </Text>
                    ) : null}
                </View>
                {canDelete && !w.is_reversed ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Estornar saída"
                        accessibilityState={{ busy, disabled: busy }}
                        disabled={busy}
                        onPress={onReverse}
                        className={`min-h-[40px] flex-row items-center gap-1.5 rounded-lg bg-error-light px-3 active:opacity-80 dark:bg-dark-elevated ${
                            busy ? 'opacity-50' : ''
                        }`}
                    >
                        {busy ? (
                            <ActivityIndicator size="small" color="#F04438" />
                        ) : (
                            <Ionicons name="arrow-undo-outline" size={16} color="#F04438" />
                        )}
                        <Text className="font-sans-semibold text-sm text-error dark:text-error-dark">
                            Estornar
                        </Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
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
                        <Skeleton width="30%" height={20} />
                        <Skeleton width={70} height={18} radius={999} />
                    </View>
                    <Skeleton width="55%" height={14} className="mt-3" />
                    <Skeleton width="45%" height={12} className="mt-2" />
                    <Skeleton width="70%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
