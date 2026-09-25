import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { usePendencias } from '@/hooks/useEpi';
import { useStores } from '@/hooks/useStores';
import { formatDateBR } from '@/utils/formatDate';
import type { PendenciaEstado, PendenciaItem } from '@/types/epi.types';

/**
 * Relatório de pendências de EPI (paridade com a web `PendenciasTab`).
 *
 * Filtra por estado (Todos/Vencido/Pendente/Em dia) e por loja (respeitando as
 * lojas acessíveis). Backend já ordena vencidos → pendentes → em dia. Cada item
 * é um card (funcionário, cargo, EPI, loja, vencimento, dias restantes) com
 * badge de estado colorido.
 */

const ALL = '__all__';

const ESTADO_LABEL: Record<PendenciaEstado, string> = {
    PENDENTE: 'Pendente',
    VENCIDO: 'Vencido',
    EM_DIA: 'Em dia',
};

const ESTADO_COLORS: Record<PendenciaEstado, { bg: string; fg: string }> = {
    VENCIDO: { bg: '#FEE4E2', fg: '#B42318' },
    PENDENTE: { bg: '#FEF0C7', fg: '#B54708' },
    EM_DIA: { bg: '#DCFAE6', fg: '#067647' },
};

const ESTADO_OPTIONS: SelectOption<string>[] = [
    { value: ALL, label: 'Todos os estados' },
    { value: 'VENCIDO', label: 'Vencido' },
    { value: 'PENDENTE', label: 'Pendente' },
    { value: 'EM_DIA', label: 'Em dia' },
];

export function PendenciasTab() {
    const { stores } = useStores();
    const [estado, setEstado] = useState<string>(ALL);
    const [storeId, setStoreId] = useState<string>(ALL);

    const estadoSelectRef = useRef<SelectRef>(null);
    const storeSelectRef = useRef<SelectRef>(null);

    const storeOptions = useMemo<SelectOption<string>[]>(
        () => [
            { value: ALL, label: 'Todas as lojas' },
            ...stores.map((s) => ({ value: String(s.id), label: s.name })),
        ],
        [stores]
    );

    const { data, isLoading, isError, refetch, isRefetching } = usePendencias(
        estado === ALL ? undefined : (estado as PendenciaEstado),
        storeId === ALL ? undefined : [Number(storeId)]
    );

    const items = data?.items ?? [];

    const estadoLabel =
        ESTADO_OPTIONS.find((o) => o.value === estado)?.label ?? 'Todos os estados';
    const storeLabel = storeOptions.find((o) => o.value === storeId)?.label ?? 'Todas as lojas';

    return (
        <View className="flex-1">
            {/* Filtros */}
            <View className="flex-row gap-2 px-4 pb-2 pt-3">
                <FilterButton
                    label={estadoLabel}
                    icon="filter-outline"
                    onPress={() => estadoSelectRef.current?.present()}
                />
                <FilterButton
                    label={storeLabel}
                    icon="storefront-outline"
                    onPress={() => storeSelectRef.current?.present()}
                />
            </View>

            {isLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2, 3].map((i) => (
                        <View
                            key={i}
                            className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                        >
                            <Skeleton width="55%" height={16} />
                            <Skeleton width="35%" height={12} className="mt-2" />
                            <Skeleton width="100%" height={28} radius={8} className="mt-3" />
                        </View>
                    ))}
                </View>
            ) : isError ? (
                <ErrorState
                    title="Falha ao carregar"
                    description="Não foi possível carregar as pendências."
                    onRetry={() => void refetch()}
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {items.length === 0 ? (
                        <EmptyState
                            icon="checkmark-done-outline"
                            title="Nenhuma pendência"
                            description="Nenhuma pendência para os filtros atuais."
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((it) => (
                                <PendenciaCard key={`${it.employee_id}-${it.epi_id}`} item={it} />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            <Select<string>
                ref={estadoSelectRef}
                title="Filtrar por estado"
                options={ESTADO_OPTIONS}
                value={estado}
                onChange={setEstado}
            />
            <Select<string>
                ref={storeSelectRef}
                title="Filtrar por loja"
                options={storeOptions}
                value={storeId}
                onChange={setStoreId}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

function FilterButton({
    label,
    icon,
    onPress,
}: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="min-h-[40px] flex-1 flex-row items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
        >
            <Ionicons name={icon} size={16} color="#98A2B3" />
            <Text
                className="flex-1 font-sans text-sm text-neutral-700 dark:text-dark-text"
                numberOfLines={1}
            >
                {label}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#98A2B3" />
        </Pressable>
    );
}

function PendenciaCard({ item }: { item: PendenciaItem }) {
    const colors = ESTADO_COLORS[item.estado];
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.employee_name}
                    </Text>
                    <Text className="mt-0.5 font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                        {item.cargo || '—'}
                        {item.store_name ? ` · ${item.store_name}` : ''}
                    </Text>
                </View>
                <View
                    className="self-start rounded-full px-2.5 py-1"
                    style={{ backgroundColor: colors.bg }}
                >
                    <Text
                        className="font-sans-semibold text-[11px]"
                        style={{ color: colors.fg }}
                    >
                        {ESTADO_LABEL[item.estado]}
                    </Text>
                </View>
            </View>

            <View className="mt-3 flex-row items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-dark-elevated">
                <View className="flex-1">
                    <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                        EPI
                    </Text>
                    <Text
                        className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.epi_name}
                    </Text>
                </View>
                <View className="items-end">
                    <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                        Vencimento
                    </Text>
                    <Text
                        className="font-sans-semibold text-sm"
                        style={{
                            color: item.estado === 'VENCIDO' ? '#B42318' : undefined,
                        }}
                    >
                        {item.data_vencimento ? formatDateBR(item.data_vencimento) : '—'}
                    </Text>
                </View>
            </View>

            {item.dias_restantes !== null ? (
                <Text className="mt-2 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                    {item.dias_restantes < 0
                        ? `Vencido há ${Math.abs(item.dias_restantes)} dia(s)`
                        : `Vence em ${item.dias_restantes} dia(s)`}
                </Text>
            ) : (
                <Text className="mt-2 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                    Sem entrega registrada
                </Text>
            )}
        </View>
    );
}
