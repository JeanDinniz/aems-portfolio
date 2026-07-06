import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Area, BarGroup, CartesianChart, Line, Pie, PolarChart } from 'victory-native';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
    useDashboardTimeseries,
    useDashboardTimeseriesByType,
    useDashboardDepartmentBreakdown,
    useDashboardFilmPpfRanking,
} from '@/hooks/useDashboard';
import type { DashboardParams, DashboardGranularity } from '@/services/api/analytics.service';
import { DEPARTMENT_LABELS } from '@/constants/scheduling';
import { brand, neutral, semantic } from '@/theme/tokens';
import { useTheme } from '@/theme';
import { formatCurrencyBRL } from '@/utils/formatNumber';

/* ────────────────────────────── Tipos / props ─────────────────────────── */

interface ChartsSectionProps {
    params: DashboardParams;
}

/**
 * Linha de dados para os gráficos cartesianos. A index signature satisfaz a
 * restrição `Record<string, unknown>` do CartesianChart (victory-native v41).
 */
type ChartRow = Record<string, number>;

interface GranularityChip {
    key: DashboardGranularity;
    label: string;
}

const GRANULARITIES: GranularityChip[] = [
    { key: 'day', label: 'Dia' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mês' },
];

/**
 * Paleta categórica do dashboard (mesma família dos tokens semânticos).
 * Cores estáveis por índice para que a legenda case com as fatias/barras.
 */
const CATEGORY_PALETTE = [
    brand.DEFAULT, // âmbar (marca)
    semantic.info.light, // azul
    semantic.success.light, // verde
    semantic.purple.light, // roxo
    semantic.warning.light, // laranja
    semantic.error.light, // vermelho
    neutral[400], // cinza
    neutral[600],
];

const CHART_HEIGHT = 220;
const DONUT_HEIGHT = 240;

/* ─────────────────────────── Helpers de formatação ────────────────────── */

function departmentLabel(department: string | null | undefined): string {
    if (!department) return '—';
    return DEPARTMENT_LABELS[department] ?? department;
}

/**
 * Rótulo curto de eixo X a partir de uma data ISO ("YYYY-MM-DD") conforme a
 * granularidade. Mês → "jun/26"; demais → "DD/MM".
 */
function shortDateLabel(iso: string, granularity: DashboardGranularity): string {
    // Parse manual (evita fuso): "YYYY-MM-DD".
    const [y, m, d] = iso.split('-').map((p) => parseInt(p, 10));
    if (!y || !m) return iso;
    if (granularity === 'month') {
        const months = [
            'jan',
            'fev',
            'mar',
            'abr',
            'mai',
            'jun',
            'jul',
            'ago',
            'set',
            'out',
            'nov',
            'dez',
        ];
        return `${months[m - 1] ?? m}/${String(y).slice(2)}`;
    }
    return `${String(d ?? 1).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/* ────────────────────────────── Subcomponentes ────────────────────────── */

function ChartTitle({ children, hint }: { children: string; hint?: string }) {
    return (
        <View className="mb-1 flex-row items-end justify-between">
            <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                {children}
            </Text>
            {hint ? (
                <Text className="font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                    {hint}
                </Text>
            ) : null}
        </View>
    );
}

/** Item de legenda: bolinha colorida + rótulo + valor opcional. */
function LegendItem({ color, label, value }: { color: string; label: string; value?: string }) {
    return (
        <View className="flex-row items-center gap-1.5">
            <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }}
            />
            <Text
                className="font-sans text-xs text-neutral-600 dark:text-dark-text-muted"
                numberOfLines={1}
            >
                {label}
            </Text>
            {value ? (
                <Text
                    className="font-sans-semibold text-xs text-neutral-800 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {value}
                </Text>
            ) : null}
        </View>
    );
}

/**
 * Linha de rótulos do eixo X renderizada FORA do canvas Skia (RN <Text>),
 * distribuída uniformemente. Evita depender de fontes nativas (useFont) e
 * mantém os rótulos legíveis e acessíveis.
 */
function AxisLabels({ labels }: { labels: string[] }) {
    if (labels.length === 0) return null;
    // Limita a no máx. 6 rótulos para não poluir telas estreitas.
    const max = 6;
    const step = labels.length > max ? Math.ceil(labels.length / max) : 1;
    const shown = labels.filter((_, i) => i % step === 0);
    return (
        <View className="mt-1.5 flex-row justify-between">
            {shown.map((l, i) => (
                <Text
                    key={`${l}-${i}`}
                    className="font-sans text-[10px] text-neutral-400 dark:text-dark-text-muted"
                >
                    {l}
                </Text>
            ))}
        </View>
    );
}

/** Card de gráfico com estados (loading/erro/vazio) padronizados. */
function ChartCard({
    title,
    hint,
    isLoading,
    isError,
    isEmpty,
    onRetry,
    emptyText,
    children,
}: {
    title: string;
    hint?: string;
    isLoading: boolean;
    isError: boolean;
    isEmpty: boolean;
    onRetry: () => void;
    emptyText: string;
    children: React.ReactNode;
}) {
    return (
        <View className="mx-4 mb-3">
            <Card>
                <ChartTitle hint={hint}>{title}</ChartTitle>
                {isLoading ? (
                    <View className="py-4">
                        <Skeleton width="100%" height={CHART_HEIGHT - 40} />
                    </View>
                ) : isError ? (
                    <View className="py-2">
                        <ErrorState
                            onRetry={onRetry}
                            description="Não foi possível carregar o gráfico."
                        />
                    </View>
                ) : isEmpty ? (
                    <View className="py-2">
                        <EmptyState
                            icon="bar-chart-outline"
                            title="Sem dados"
                            description={emptyText}
                        />
                    </View>
                ) : (
                    children
                )}
            </Card>
        </View>
    );
}

/* ─────────────────────────── Gráficos individuais ─────────────────────── */

/** 1) Série temporal: O.S. (área) + Receita (linha) em eixos próprios. */
function TimeseriesChart({
    params,
    granularity,
}: {
    params: DashboardParams;
    granularity: DashboardGranularity;
}) {
    const { isDark } = useTheme();
    const query = useDashboardTimeseries(params, granularity);
    const raw = useMemo(() => query.data ?? [], [query.data]);

    const ordersColor = brand.DEFAULT;
    const revenueColor = isDark ? semantic.info.dark : semantic.info.light;

    // xKey numérico (`idx`) para escala cartesiana estável; os rótulos de data
    // são renderizados fora do canvas (AxisLabels).
    const data = useMemo<ChartRow[]>(
        () => raw.map((p, i) => ({ idx: i, orders_count: p.orders_count, revenue: p.revenue })),
        [raw]
    );
    const labels = useMemo(
        () => raw.map((p) => shortDateLabel(p.date, granularity)),
        [raw, granularity]
    );

    return (
        <ChartCard
            title="O.S. e Receita no período"
            hint="série temporal"
            isLoading={query.isLoading}
            isError={query.isError}
            isEmpty={data.length === 0}
            onRetry={() => void query.refetch()}
            emptyText="Sem movimento no período selecionado."
        >
            <View className="mb-2 flex-row flex-wrap gap-x-4 gap-y-1">
                <LegendItem color={ordersColor} label="O.S." />
                <LegendItem color={revenueColor} label="Receita" />
            </View>
            <View style={{ height: CHART_HEIGHT }}>
                <CartesianChart
                    data={data}
                    xKey="idx"
                    yKeys={['orders_count', 'revenue']}
                    domainPadding={{ top: 16, left: 8, right: 8 }}
                >
                    {({ points, chartBounds }) => (
                        <>
                            <Area
                                points={points.orders_count}
                                y0={chartBounds.bottom}
                                color={ordersColor}
                                opacity={0.18}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                            <Line
                                points={points.orders_count}
                                color={ordersColor}
                                strokeWidth={2.5}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                            <Line
                                points={points.revenue}
                                color={revenueColor}
                                strokeWidth={2.5}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                        </>
                    )}
                </CartesianChart>
            </View>
            <AxisLabels labels={labels} />
        </ChartCard>
    );
}

/** 2) Por tipo: 3 linhas (Película / PPF / Estética). */
function TypeTimeseriesChart({
    params,
    granularity,
}: {
    params: DashboardParams;
    granularity: DashboardGranularity;
}) {
    const query = useDashboardTimeseriesByType(params, granularity);
    const raw = useMemo(() => query.data ?? [], [query.data]);

    const filmColor = CATEGORY_PALETTE[0];
    const ppfColor = CATEGORY_PALETTE[1];
    const esteticaColor = CATEGORY_PALETTE[2];

    const data = useMemo<ChartRow[]>(
        () =>
            raw.map((p, i) => ({
                idx: i,
                film_count: p.film_count,
                ppf_count: p.ppf_count,
                estetica_count: p.estetica_count,
            })),
        [raw]
    );
    const labels = useMemo(
        () => raw.map((p) => shortDateLabel(p.date, granularity)),
        [raw, granularity]
    );

    const hasAny = raw.some(
        (p) => p.film_count > 0 || p.ppf_count > 0 || p.estetica_count > 0
    );

    return (
        <ChartCard
            title="O.S. por tipo"
            hint="série temporal"
            isLoading={query.isLoading}
            isError={query.isError}
            isEmpty={data.length === 0 || !hasAny}
            onRetry={() => void query.refetch()}
            emptyText="Sem O.S. por tipo no período."
        >
            <View className="mb-2 flex-row flex-wrap gap-x-4 gap-y-1">
                <LegendItem color={filmColor} label="Película" />
                <LegendItem color={ppfColor} label="PPF" />
                <LegendItem color={esteticaColor} label="Estética" />
            </View>
            <View style={{ height: CHART_HEIGHT }}>
                <CartesianChart
                    data={data}
                    xKey="idx"
                    yKeys={['film_count', 'ppf_count', 'estetica_count']}
                    domainPadding={{ top: 16, left: 8, right: 8 }}
                >
                    {({ points }) => (
                        <>
                            <Line
                                points={points.film_count}
                                color={filmColor}
                                strokeWidth={2.5}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                            <Line
                                points={points.ppf_count}
                                color={ppfColor}
                                strokeWidth={2.5}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                            <Line
                                points={points.estetica_count}
                                color={esteticaColor}
                                strokeWidth={2.5}
                                animate={{ type: 'timing', duration: 250 }}
                            />
                        </>
                    )}
                </CartesianChart>
            </View>
            <AxisLabels labels={labels} />
        </ChartCard>
    );
}

/** 3) Distribuição de receita por departamento (donut). */
function DepartmentDonutChart({ params }: { params: DashboardParams }) {
    const query = useDashboardDepartmentBreakdown(params);
    const raw = useMemo(() => query.data ?? [], [query.data]);

    const slices = useMemo(
        () =>
            raw
                .filter((d) => d.revenue > 0)
                .map((d, i) => ({
                    label: departmentLabel(d.department),
                    value: d.revenue,
                    revenue: d.revenue,
                    pct: d.pct_revenue,
                    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
                })),
        [raw]
    );

    return (
        <ChartCard
            title="Receita por departamento"
            hint="distribuição"
            isLoading={query.isLoading}
            isError={query.isError}
            isEmpty={slices.length === 0}
            onRetry={() => void query.refetch()}
            emptyText="Sem receita por departamento no período."
        >
            <View style={{ height: DONUT_HEIGHT }}>
                <PolarChart
                    data={slices}
                    labelKey="label"
                    valueKey="value"
                    colorKey="color"
                >
                    <Pie.Chart innerRadius="58%">
                        {() => <Pie.Slice />}
                    </Pie.Chart>
                </PolarChart>
            </View>
            <View className="mt-2 gap-1.5">
                {slices.map((s) => (
                    <LegendItem
                        key={s.label}
                        color={s.color}
                        label={s.label}
                        value={`${formatCurrencyBRL(s.revenue)} · ${s.pct.toFixed(0)}%`}
                    />
                ))}
            </View>
        </ChartCard>
    );
}

/** 4) Película/PPF por loja: barras agrupadas (Loja vs Galpão). */
function FilmPpfStoreChart({ params }: { params: DashboardParams }) {
    const { isDark } = useTheme();
    const query = useDashboardFilmPpfRanking(params);
    const raw = useMemo(() => query.data ?? [], [query.data]);

    const lojaColor = brand.DEFAULT;
    const galponColor = isDark ? semantic.purple.dark : semantic.purple.light;

    // Eixo X precisa de chave categórica simples: usamos o índice e mostramos os
    // nomes via rótulos próprios fora do canvas.
    const data = useMemo<ChartRow[]>(
        () =>
            raw.map((s, i) => ({
                idx: i,
                loja_count: s.loja_count,
                galpon_count: s.galpon_count,
            })),
        [raw]
    );
    const labels = useMemo(() => raw.map((s) => s.store_name), [raw]);

    const hasAny = raw.some((s) => s.loja_count > 0 || s.galpon_count > 0);

    return (
        <ChartCard
            title="Película/PPF por loja"
            hint="Loja vs. Galpão"
            isLoading={query.isLoading}
            isError={query.isError}
            isEmpty={raw.length === 0 || !hasAny}
            onRetry={() => void query.refetch()}
            emptyText="Sem O.S. de Película/PPF por loja no período."
        >
            <View className="mb-2 flex-row flex-wrap gap-x-4 gap-y-1">
                <LegendItem color={lojaColor} label="Loja" />
                <LegendItem color={galponColor} label="Galpão" />
            </View>
            <View style={{ height: CHART_HEIGHT }}>
                <CartesianChart
                    data={data}
                    xKey="idx"
                    yKeys={['loja_count', 'galpon_count']}
                    domainPadding={{ top: 16, left: 32, right: 32 }}
                >
                    {({ points, chartBounds }) => (
                        <BarGroup
                            chartBounds={chartBounds}
                            betweenGroupPadding={0.3}
                            withinGroupPadding={0.15}
                            roundedCorners={{ topLeft: 4, topRight: 4 }}
                        >
                            <BarGroup.Bar points={points.loja_count} color={lojaColor} />
                            <BarGroup.Bar points={points.galpon_count} color={galponColor} />
                        </BarGroup>
                    )}
                </CartesianChart>
            </View>
            <AxisLabels labels={labels} />
        </ChartCard>
    );
}

/* ────────────────────────────── Seção raiz ────────────────────────────── */

/**
 * Seção de gráficos do Dashboard (Fatia 3b). ÚNICO arquivo que importa
 * victory-native / Skia — carregado via React.lazy SÓ fora do Expo Go
 * (ver DashboardScreen + src/lib/runtime.ts). A granularidade é estado local.
 */
export default function ChartsSection({ params }: ChartsSectionProps) {
    const [granularity, setGranularity] = useState<DashboardGranularity>('month');

    return (
        <View>
            {/* Seletor de granularidade */}
            <View className="mb-1 px-4">
                <View className="flex-row gap-2">
                    {GRANULARITIES.map((g) => {
                        const active = g.key === granularity;
                        return (
                            <Pressable
                                key={g.key}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                accessibilityLabel={`Granularidade: ${g.label}`}
                                onPress={() => setGranularity(g.key)}
                                className={`rounded-full border px-4 py-2 active:opacity-80 ${
                                    active
                                        ? 'border-brand bg-brand'
                                        : 'border-neutral-200 bg-white dark:border-dark-border-soft dark:bg-dark-surface'
                                }`}
                            >
                                <Text
                                    className={`font-sans-semibold text-xs ${
                                        active
                                            ? 'text-brand-black'
                                            : 'text-neutral-600 dark:text-dark-text-muted'
                                    }`}
                                >
                                    {g.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <TimeseriesChart params={params} granularity={granularity} />
            <TypeTimeseriesChart params={params} granularity={granularity} />
            <DepartmentDonutChart params={params} />
            <FilmPpfStoreChart params={params} />
        </View>
    );
}
