import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Select, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useFilmTypes, useForecast } from '@/hooks/useInventory';
import { useStores } from '@/hooks/useStores';
import { useStoreStore } from '@/stores/store.store';
import { FILM_DEPARTMENT_LABELS } from '@/constants/inventory';
import type {
    FilmDepartment,
    TonalityForecastDetail,
} from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-07 — Previsão (forecast) de consumo de película.
 *
 * O usuário escolhe um tipo de película (filtro por departamento + Select); a
 * loja vem do seletor global (`selectedStoreId`). O backend exige uma loja
 * específica — se "Todas as Lojas" estiver ativo e houver mais de uma loja
 * acessível, pedimos para selecionar uma loja no topo. Mostra o resumo
 * (disponível vs agendado, will_exhaust) e a lista de tonalidades, cada uma com
 * badge de status (critical/attention/ok), metros e % de uso. Lista também os
 * itens não atribuídos a tonalidade, quando houver. Estados Loading/Empty/Error.
 */

const STATUS_CONFIG: Record<
    TonalityForecastDetail['status'],
    { label: string; solid: string; badgeBg: string; badgeFg: string; track: string }
> = {
    critical: {
        label: 'Crítico',
        solid: '#EF4444',
        badgeBg: '#FEE2E2',
        badgeFg: '#B91C1C',
        track: '#FBE3E3',
    },
    attention: {
        label: 'Atenção',
        solid: '#F59E0B',
        badgeBg: '#FEF3C7',
        badgeFg: '#B45309',
        track: '#FBEFD3',
    },
    ok: {
        label: 'OK',
        solid: '#22C55E',
        badgeBg: '#DCFCE7',
        badgeFg: '#15803D',
        track: '#E3F6E9',
    },
};

const DEPT_FILTERS: { value: FilmDepartment; label: string }[] = [
    { value: 'film', label: 'Película' },
    { value: 'security_film', label: 'Pel. Segurança' },
    { value: 'ppf', label: 'PPF' },
];

function fmtMeters(value: number | null | undefined): string {
    return `${(value ?? 0).toFixed(1)}m`;
}

export function ForecastScreen({ navigation }: InventoryStackScreenProps<'Forecast'>) {
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const filmTypeSheetRef = useRef<SelectRef>(null);

    const [department, setDepartment] = useState<FilmDepartment>('film');
    const [filmTypeId, setFilmTypeId] = useState<number | null>(null);

    const { data: filmTypes = [], isLoading: typesLoading } = useFilmTypes(department);

    // Loja resolvida: o forecast exige uma loja específica. Usamos a loja global;
    // se "Todas" com apenas uma loja acessível, caímos nela.
    const resolvedStoreId = selectedStoreId ?? (stores.length === 1 ? stores[0]?.id : undefined);
    const needsStoreSelection = !resolvedStoreId;

    const {
        data: forecast,
        isLoading: forecastLoading,
        isError,
        refetch,
        isRefetching,
    } = useForecast(filmTypeId ?? undefined, resolvedStoreId);

    const filmTypeOptions = useMemo(
        () => filmTypes.filter((ft) => ft.is_active).map((ft) => ({ value: ft.id, label: ft.name })),
        [filmTypes]
    );
    const selectedFilmTypeName = filmTypes.find((ft) => ft.id === filmTypeId)?.name;
    const storeName = stores.find((s) => s.id === resolvedStoreId)?.name;

    const changeDepartment = (value: FilmDepartment) => {
        if (value === department) return;
        setDepartment(value);
        setFilmTypeId(null); // tipos mudam com o departamento.
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Previsão de consumo"
                subtitle={storeName ?? 'Selecione uma loja'}
                onBack={() => navigation.goBack()}
            />

            {/* Seletor de departamento + tipo de película */}
            <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface">
                <View className="mb-3 flex-row flex-wrap gap-2">
                    {DEPT_FILTERS.map((f) => (
                        <Pressable
                            key={f.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: department === f.value }}
                            accessibilityLabel={f.label}
                            onPress={() => changeDepartment(f.value)}
                            className={[
                                'min-h-[36px] items-center justify-center rounded-full px-3.5 py-1.5 active:opacity-80',
                                department === f.value ? 'bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated',
                            ].join(' ')}
                        >
                            <Text
                                className={[
                                    'font-sans-semibold text-xs',
                                    department === f.value
                                        ? 'text-brand-black'
                                        : 'text-neutral-600 dark:text-dark-text',
                                ].join(' ')}
                            >
                                {f.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={selectedFilmTypeName ?? 'Selecionar tipo de película'}
                    disabled={filmTypeOptions.length === 0}
                    onPress={() => filmTypeSheetRef.current?.present()}
                    className={[
                        'min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-80 dark:border-dark-border-strong dark:bg-dark-input',
                        filmTypeOptions.length === 0 ? 'opacity-60' : '',
                    ].join(' ')}
                >
                    <Text
                        className={[
                            'flex-1 font-sans text-base',
                            selectedFilmTypeName
                                ? 'text-neutral-900 dark:text-dark-text'
                                : 'text-neutral-400 dark:text-dark-text-muted',
                        ].join(' ')}
                        numberOfLines={1}
                    >
                        {selectedFilmTypeName ??
                            (typesLoading
                                ? 'Carregando tipos...'
                                : filmTypeOptions.length === 0
                                  ? 'Nenhum tipo disponível'
                                  : 'Selecionar tipo de película...')}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color="#98A2B3" />
                </Pressable>
            </View>

            {/* Conteúdo */}
            {needsStoreSelection ? (
                <EmptyState
                    icon="storefront-outline"
                    title="Selecione uma loja"
                    description="A previsão é por loja. Escolha uma loja no seletor global do topo para ver o forecast."
                />
            ) : !filmTypeId ? (
                <EmptyState
                    icon="analytics-outline"
                    title="Escolha um tipo de película"
                    description="Selecione um tipo de película acima para ver a previsão de consumo por tonalidade."
                />
            ) : forecastLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} width="100%" height={96} radius={16} />
                    ))}
                </View>
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : !forecast ? (
                <EmptyState
                    icon="analytics-outline"
                    title="Sem dados de previsão"
                    description="Não há previsão disponível para este tipo de película nesta loja."
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
                    {/* Resumo */}
                    <View className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                        <Text
                            className="font-sans-bold text-base text-neutral-900 dark:text-dark-text"
                            numberOfLines={2}
                        >
                            {forecast.film_type_name}
                        </Text>
                        <Text className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            {FILM_DEPARTMENT_LABELS[department]}
                        </Text>

                        <View className="mt-3 flex-row gap-4 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                            <SummaryMetric
                                label="Disponível"
                                value={fmtMeters(forecast.available_meters)}
                                color="#15803D"
                            />
                            <SummaryMetric
                                label="Agendado"
                                value={fmtMeters(forecast.total_scheduled_meters)}
                                color="#B45309"
                            />
                        </View>

                        <View className="mt-3 flex-row flex-wrap items-center gap-2">
                            {forecast.will_exhaust ? (
                                <View className="flex-row items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 dark:bg-red-900/30">
                                    <Ionicons name="alert-circle" size={14} color="#B91C1C" />
                                    <Text className="font-sans-semibold text-[11px] text-red-700 dark:text-red-300">
                                        Vai esgotar
                                    </Text>
                                </View>
                            ) : (
                                <View className="flex-row items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 dark:bg-green-900/30">
                                    <Ionicons name="checkmark-circle" size={14} color="#15803D" />
                                    <Text className="font-sans-semibold text-[11px] text-green-700 dark:text-green-300">
                                        Estoque suficiente
                                    </Text>
                                </View>
                            )}
                            {forecast.tonalities_critical_count > 0 ? (
                                <View className="rounded-full bg-red-100 px-2.5 py-1 dark:bg-red-900/30">
                                    <Text className="font-sans-semibold text-[11px] text-red-700 dark:text-red-300">
                                        {`${forecast.tonalities_critical_count} crítica(s)`}
                                    </Text>
                                </View>
                            ) : null}
                            {forecast.tonalities_attention_count > 0 ? (
                                <View className="rounded-full bg-amber-100 px-2.5 py-1 dark:bg-amber-900/30">
                                    <Text className="font-sans-semibold text-[11px] text-amber-700 dark:text-amber-300">
                                        {`${forecast.tonalities_attention_count} em atenção`}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    </View>

                    {/* Tonalidades */}
                    <Text className="mb-2 font-sans-semibold text-xs uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                        Por tonalidade
                    </Text>
                    {forecast.tonalities.length === 0 ? (
                        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
                            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Nenhuma tonalidade com agendamentos.
                            </Text>
                        </View>
                    ) : (
                        forecast.tonalities.map((t, idx) => (
                            <TonalityRow key={`${t.tonality ?? 'sem'}-${idx}`} detail={t} />
                        ))
                    )}

                    {/* Não atribuídos */}
                    {forecast.unattributed_items.length > 0 || forecast.unattributed_meters > 0 ? (
                        <View className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                            <View className="flex-row items-center gap-2">
                                <Ionicons name="help-circle-outline" size={18} color="#B45309" />
                                <Text className="flex-1 font-sans-semibold text-sm text-amber-800 dark:text-amber-300">
                                    Sem tonalidade definida
                                </Text>
                            </View>
                            <Text className="mt-1 font-sans text-xs text-amber-700 dark:text-amber-300/80">
                                {`${forecast.unattributed_items.length} item(ns) · ${fmtMeters(forecast.unattributed_meters)} previstos sem tonalidade atribuída.`}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            <Select<number>
                ref={filmTypeSheetRef}
                title="Selecionar tipo de película"
                options={filmTypeOptions}
                value={filmTypeId}
                onChange={(v) => setFilmTypeId(v)}
            />
        </View>
    );
}

function SummaryMetric({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <View>
            <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text className="font-sans-bold text-base" style={{ color }}>
                {value}
            </Text>
        </View>
    );
}

function TonalityRow({ detail }: { detail: TonalityForecastDetail }) {
    const cfg = STATUS_CONFIG[detail.status] ?? STATUS_CONFIG.ok;
    const pct = Math.max(0, Math.min(100, detail.usage_percentage));

    return (
        <View className="mb-3 overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
            <View accessible={false} style={{ height: 4, backgroundColor: cfg.solid }} />
            <View className="p-4">
                <View className="flex-row items-center justify-between gap-2">
                    <Text
                        className="flex-1 font-sans-bold text-base text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {detail.tonality ?? 'Sem tonalidade'}
                    </Text>
                    <View
                        className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ backgroundColor: cfg.badgeBg }}
                    >
                        <View
                            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cfg.solid }}
                        />
                        <Text className="font-sans-semibold text-[11px]" style={{ color: cfg.badgeFg }}>
                            {cfg.label}
                        </Text>
                    </View>
                </View>

                <View className="mt-3 flex-row gap-4">
                    <SummaryMetric
                        label="Disponível"
                        value={fmtMeters(detail.available_meters)}
                        color="#15803D"
                    />
                    <SummaryMetric
                        label="Consumido"
                        value={fmtMeters(detail.consumed_meters)}
                        color="#B45309"
                    />
                    <SummaryMetric
                        label="Saldo"
                        value={fmtMeters(detail.balance_meters)}
                        color={detail.balance_meters < 0 ? '#B91C1C' : '#1D4ED8'}
                    />
                </View>

                {/* Barra de uso */}
                <View className="mt-3">
                    <View
                        className="h-2 w-full overflow-hidden rounded-full"
                        style={{ backgroundColor: cfg.track }}
                        accessible={false}
                    >
                        <View
                            style={{
                                width: `${pct}%`,
                                height: '100%',
                                borderRadius: 999,
                                backgroundColor: cfg.solid,
                            }}
                        />
                    </View>
                    <View className="mt-1.5 flex-row items-center justify-between">
                        <Text className="font-sans-semibold text-xs text-neutral-600 dark:text-dark-text">
                            {`${detail.usage_percentage.toFixed(0)}% de uso`}
                        </Text>
                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            {`${detail.scheduled_orders_count} O.S. agendada(s)`}
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    );
}
