import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ToggleActiveSwitch } from '@/components/common/ToggleActiveSwitch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { useServicesAdmin, useToggleServiceActive } from '@/hooks/useServicesAdmin';
import { useBrands } from '@/hooks/useBrands';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { DEPARTMENT_LABELS } from '@/constants/scheduling';
import { formatDecimalBRL } from '@/utils/formatNumber';
import { useTheme } from '@/theme';
import type { ServiceItem, ServiceListParams } from '@/services/api/services.service';
import type { AdminStackScreenProps } from '@/navigation/types';

type StatusFilter = 'all' | 'active' | 'inactive';

const STATUS_OPTIONS: SelectOption<StatusFilter>[] = [
    { value: 'all', label: 'Todos os status' },
    { value: 'active', label: 'Somente ativos' },
    { value: 'inactive', label: 'Somente inativos' },
];

const DEPARTMENT_OPTIONS: SelectOption<string>[] = [
    { value: '', label: 'Todos os departamentos' },
    ...Object.entries(DEPARTMENT_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * Serviços do catálogo (Admin — Fatia 5b). Lista com filtros (marca / departamento
 * / status) server-side + busca client-side por nome/código, badge Ativo/Inativo,
 * marcador de cortesia e toggle Ativar/Desativar (gated por `useCanEdit('services')`).
 */
export function ServicesAdminScreen({ navigation }: AdminStackScreenProps<'ServicesAdmin'>) {
    const { colors } = useTheme();
    const canEdit = useCanEdit('services');

    const brandSheet = useRef<SelectRef>(null);
    const departmentSheet = useRef<SelectRef>(null);
    const statusSheet = useRef<SelectRef>(null);

    const [brandId, setBrandId] = useState<number | undefined>(undefined);
    const [department, setDepartment] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');

    const { data: brands } = useBrands();

    const listParams = useMemo<ServiceListParams>(() => {
        const params: ServiceListParams = {};
        if (brandId !== undefined) params.brand_id = brandId;
        if (department) params.department = department;
        if (status !== 'all') params.is_active = status === 'active';
        return params;
    }, [brandId, department, status]);

    const { data, isLoading, isError, refetch, isRefetching } = useServicesAdmin(listParams);
    const toggle = useToggleServiceActive();

    const brandOptions = useMemo<SelectOption<number>[]>(
        () => [
            { value: -1, label: 'Todas as marcas' },
            ...(brands ?? []).map((b) => ({ value: b.id, label: b.name })),
        ],
        [brands]
    );

    const services = useMemo<ServiceItem[]>(() => {
        const all = data ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                (s.code ?? '').toLowerCase().includes(q)
        );
    }, [data, search]);

    const brandLabel = brandId === undefined ? 'Todas as marcas' : brands?.find((b) => b.id === brandId)?.name ?? 'Marca';
    const departmentLabel = DEPARTMENT_OPTIONS.find((o) => o.value === department)?.label ?? 'Departamento';
    const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'Status';

    const renderItem = useCallback(
        ({ item }: { item: ServiceItem }) => (
            <View className="mx-4 mb-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="flex-row items-start gap-3">
                    <View className="flex-1">
                        <Text
                            className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                            numberOfLines={2}
                        >
                            {item.name}
                        </Text>
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            {item.code ? `${item.code} · ` : ''}
                            {DEPARTMENT_LABELS[item.department] ?? item.department}
                        </Text>
                        <Text className="mt-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            {item.has_variable_price ? 'Preço variável' : formatDecimalBRL(item.base_price)}
                        </Text>
                    </View>
                    <View className="items-end gap-2">
                        {canEdit ? (
                            <ToggleActiveSwitch
                                value={item.is_active}
                                itemName={item.name}
                                resourceLabel="serviço"
                                pending={toggle.isPending && toggle.variables?.id === item.id}
                                onToggle={(next) => toggle.mutate({ id: item.id, isActive: next })}
                            />
                        ) : (
                            <Badge
                                variant={item.is_active ? 'success' : 'neutral'}
                                size="sm"
                                label={item.is_active ? 'Ativo' : 'Inativo'}
                            />
                        )}
                        {item.is_courtesy_only ? (
                            <Badge variant="info" size="sm" label="Cortesia" icon="gift-outline" />
                        ) : null}
                    </View>
                </View>
            </View>
        ),
        [canEdit, toggle]
    );

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Serviços"
                subtitle={isLoading ? 'Carregando...' : `${services.length} serviços`}
                onBack={() => navigation.goBack()}
            />

            <View className="border-b border-neutral-100 bg-white px-4 py-2 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="min-h-[44px] flex-row items-center rounded-xl bg-neutral-100 px-3 dark:bg-dark-elevated">
                    <Ionicons name="search" size={18} color="#98A2B3" />
                    <TextInput
                        placeholder="Buscar por nome ou código"
                        value={search}
                        onChangeText={setSearch}
                        autoCorrect={false}
                        className="ml-2 flex-1 py-2.5 font-sans text-base text-neutral-800 dark:text-dark-text"
                        placeholderTextColor="#98A2B3"
                    />
                </View>

                <View className="mt-2 flex-row flex-wrap gap-2">
                    <FilterChip
                        label={brandLabel}
                        active={brandId !== undefined}
                        onPress={() => brandSheet.current?.present()}
                    />
                    <FilterChip
                        label={departmentLabel}
                        active={!!department}
                        onPress={() => departmentSheet.current?.present()}
                    />
                    <FilterChip
                        label={statusLabel}
                        active={status !== 'all'}
                        onPress={() => statusSheet.current?.present()}
                    />
                </View>
            </View>

            <View className="flex-1 pt-3">
                {isLoading ? (
                    <ListSkeleton />
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : services.length === 0 ? (
                    <EmptyState
                        icon="construct-outline"
                        title="Nenhum serviço encontrado"
                        description={search ? 'Ajuste a busca.' : 'Nenhum serviço para os filtros.'}
                    />
                ) : (
                    <FlashList
                        data={services}
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

            <Select
                ref={brandSheet}
                title="Marca"
                options={brandOptions}
                value={brandId ?? -1}
                onChange={(v) => setBrandId(v === -1 ? undefined : v)}
            />
            <Select
                ref={departmentSheet}
                title="Departamento"
                options={DEPARTMENT_OPTIONS}
                value={department}
                onChange={setDepartment}
            />
            <Select
                ref={statusSheet}
                title="Status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={setStatus}
            />
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
            onPress={onPress}
            className={`min-h-[36px] flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
                active
                    ? 'bg-brand-black dark:bg-brand'
                    : 'bg-neutral-100 dark:bg-dark-elevated'
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
            <Ionicons name="chevron-down" size={14} color={active ? '#FFFFFF' : '#98A2B3'} />
        </Pressable>
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
                    <Skeleton width="70%" height={16} />
                    <Skeleton width="40%" height={12} className="mt-2" />
                    <Skeleton width="100%" height={40} radius={10} className="mt-3" />
                </View>
            ))}
        </View>
    );
}
