import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

import { StoreSelector } from '@/components/common/StoreSelector';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { useEmployees } from '@/hooks/useEmployees';
import { useEmployeeStats } from '@/hooks/useEmployeesAdmin';
import { useStoreStore } from '@/stores/store.store';
import { useTheme } from '@/theme';
import { HR_STATUS_LABELS } from '@/constants/employees';
import { DEPARTMENT_LABELS } from '@/constants/scheduling';
import { AdminListHeader } from './UsersAdminScreen';
import type { Employee, EmployeeFilters } from '@/types/employee.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Funcionários (Admin — Fatia 5a + UX). Faixa de filtros: StoreSelector (loja
 * ativa), chips de status (Todos/Ativos/Afastados/Demitidos) e Select de
 * departamento. Cards de indicadores (do `getStats`, respeitando a loja) + lista
 * com busca. Toca → ficha do funcionário.
 *
 * Mapeamento de status → backend (`/employees`):
 * - Ativos/Afastados/Demitidos → `hr_status` (active|away|dismissed), que tem
 *   precedência sobre `is_active` no service.
 * - Todos → sem `hr_status` e `is_active: undefined` (não filtra por status).
 */

const SEARCH_DEBOUNCE_MS = 400;

type StatusFilter = 'all' | 'active' | 'away' | 'dismissed';

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'active', label: 'Ativos' },
    { value: 'away', label: 'Afastados' },
    { value: 'dismissed', label: 'Demitidos' },
];

const DEPARTMENT_OPTIONS: SelectOption<string>[] = [
    { value: '', label: 'Todos os departamentos' },
    ...Object.entries(DEPARTMENT_LABELS).map(([value, label]) => ({ value, label })),
];

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }) {
    return (
        <View className="mr-2 min-w-[92px] rounded-xl border border-neutral-100 bg-white px-3 py-2.5 dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className={`font-display-bold text-xl ${tone}`}>{value}</Text>
            <Text className="font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

function statusBadge(item: Employee) {
    const status = item.hr_status ?? (item.is_active ? 'active' : 'dismissed');
    const variant = status === 'active' ? 'success' : status === 'away' ? 'warning' : 'neutral';
    return <Badge variant={variant} size="sm" label={HR_STATUS_LABELS[status] ?? 'Ativo'} />;
}

export function EmployeesAdminScreen({ navigation }: AdminStackScreenProps<'EmployeesAdmin'>) {
    const { colors } = useTheme();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [department, setDepartment] = useState('');
    const departmentSheet = useRef<SelectRef>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters = useMemo<EmployeeFilters>(
        () => ({
            search: search || undefined,
            store_id: selectedStoreId ?? undefined,
            hr_status: status === 'all' ? undefined : status,
            is_active: undefined,
            department: department || undefined,
        }),
        [search, selectedStoreId, status, department]
    );

    const { employees, total, isLoading, isError, refetch, isRefetching } = useEmployees(
        filters,
        1,
        200
    );
    const { data: stats } = useEmployeeStats(selectedStoreId ?? undefined);

    const departmentLabel =
        DEPARTMENT_OPTIONS.find((o) => o.value === department)?.label ?? 'Departamento';

    const renderItem = useCallback(
        ({ item }: { item: Employee }) => (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => navigation.navigate('EmployeeDetail', { id: item.id })}
                className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white px-4 py-3.5 active:opacity-80 dark:border-dark-border-soft dark:bg-dark-surface"
            >
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {[item.name, item.last_name].filter(Boolean).join(' ')}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted" numberOfLines={1}>
                        {[item.position, item.store_name].filter(Boolean).join(' · ') || '—'}
                    </Text>
                </View>
                {statusBadge(item)}
                <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
            </Pressable>
        ),
        [navigation]
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <AdminListHeader
                title="Funcionários"
                subtitle={isLoading ? 'Carregando...' : `${total} ${total === 1 ? 'funcionário' : 'funcionários'}`}
                onBack={() => navigation.goBack()}
                searchInput={searchInput}
                onSearch={setSearchInput}
                placeholder="Buscar por nome"
            />

            {/* Faixa de filtros: loja + status + departamento */}
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
                    <FilterChip
                        label={departmentLabel}
                        active={!!department}
                        chevron
                        onPress={() => departmentSheet.current?.present()}
                    />
                </ScrollView>
            </View>

            {stats ? (
                <View className="border-b border-neutral-100 bg-neutral-50 py-3 dark:border-dark-border-soft dark:bg-dark-bg">
                    <FlashList
                        horizontal
                        data={[
                            { label: 'Total', value: stats.total, tone: 'text-neutral-800 dark:text-dark-text' },
                            { label: 'Ativos', value: stats.active, tone: 'text-success' },
                            { label: 'Afastados', value: stats.away, tone: 'text-warning' },
                            { label: 'Demitidos', value: stats.dismissed, tone: 'text-error' },
                            { label: 'Férias', value: stats.vacations_planned, tone: 'text-info' },
                        ]}
                        renderItem={({ item }) => (
                            <StatChip label={item.label} value={item.value} tone={item.tone} />
                        )}
                        keyExtractor={(s) => s.label}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: 16 }}
                    />
                </View>
            ) : null}

            <View className="flex-1 pt-3">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : employees.length === 0 ? (
                    <EmptyState
                        icon="id-card-outline"
                        title="Nenhum funcionário encontrado"
                        description={
                            search || status !== 'all' || department
                                ? 'Ajuste os filtros.'
                                : 'Ainda não há funcionários para a loja selecionada.'
                        }
                    />
                ) : (
                    <FlashList
                        data={employees}
                        renderItem={renderItem}
                        keyExtractor={(e) => String(e.id)}
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

            <Select
                ref={departmentSheet}
                title="Departamento"
                options={DEPARTMENT_OPTIONS}
                value={department}
                onChange={setDepartment}
            />
        </View>
    );
}

function FilterChip({
    label,
    active,
    onPress,
    chevron,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    chevron?: boolean;
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
            {chevron ? (
                <Ionicons name="chevron-down" size={14} color={active ? '#FFFFFF' : '#98A2B3'} />
            ) : null}
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
