import { lazy, Suspense, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { StoreSelector } from '@/components/common/StoreSelector';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
    useDashboardOverview,
    useDashboardSla,
    useDashboardQueue,
    useDashboardStoresRanking,
    useDashboardServicesRanking,
    useDashboardDepartmentBreakdown,
    useDashboardEmployeesRanking,
    useDashboardConsultantsRanking,
} from '@/hooks/useDashboard';
import type { DashboardParams } from '@/services/api/analytics.service';
import { isExpoGo } from '@/lib/runtime';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import { useGalponFlags } from '@/navigation/guards';
import { useTheme } from '@/theme';
import { DEPARTMENT_LABELS } from '@/constants/scheduling';
import {
    formatCurrencyBRL,
    formatInt,
    formatMinutes,
    formatPercent,
} from '@/utils/formatNumber';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * Seção de gráficos (Fatia 3b) carregada SOB DEMANDA. Importa victory-native /
 * Skia, que NÃO rodam no Expo Go — por isso só é montada fora dele (ver
 * `isExpoGo`), envolta em <Suspense> para o split de código.
 */
const LazyChartsSection = lazy(
    () => import('@/components/features/dashboard/ChartsSection')
);

/* ────────────────────────── Helpers de período ────────────────────────── */

type PeriodKey = 'today' | 'last7' | 'thisMonth' | 'lastMonth';

interface PeriodPreset {
    key: PeriodKey;
    label: string;
}

const PERIOD_PRESETS: PeriodPreset[] = [
    { key: 'today', label: 'Hoje' },
    { key: 'last7', label: '7 dias' },
    { key: 'thisMonth', label: 'Mês atual' },
    { key: 'lastMonth', label: 'Mês anterior' },
];

function isoDay(d: Date): string {
    // Constrói "YYYY-MM-DD" a partir da data local (evita o deslocamento de
    // fuso de toISOString, que converte para UTC).
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function computeRange(key: PeriodKey): { start_date: string; end_date: string } {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    switch (key) {
        case 'today':
            return { start_date: isoDay(now), end_date: isoDay(now) };
        case 'last7': {
            const start = new Date(y, m, now.getDate() - 6);
            return { start_date: isoDay(start), end_date: isoDay(now) };
        }
        case 'thisMonth':
            return { start_date: isoDay(new Date(y, m, 1)), end_date: isoDay(now) };
        case 'lastMonth':
            return {
                start_date: isoDay(new Date(y, m - 1, 1)),
                // Dia 0 do mês atual = último dia do mês anterior.
                end_date: isoDay(new Date(y, m, 0)),
            };
        default:
            return { start_date: isoDay(now), end_date: isoDay(now) };
    }
}

function departmentLabel(department: string | null | undefined): string {
    if (!department) return '—';
    return DEPARTMENT_LABELS[department] ?? department;
}

/* ────────────────────────────── Subcomponentes ────────────────────────── */

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
    return (
        <View className="mb-2 mt-6 flex-row items-end justify-between px-4">
            <Text className="font-display-bold text-base text-neutral-800 dark:text-dark-text">
                {children}
            </Text>
            {hint ? (
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {hint}
                </Text>
            ) : null}
        </View>
    );
}

/** Badge de variação percentual vs. período anterior. */
function DeltaBadge({ delta }: { delta: number | null }) {
    if (delta === null || !Number.isFinite(delta)) {
        return <Badge variant="neutral" size="sm" label="—" />;
    }
    const positive = delta > 0;
    const negative = delta < 0;
    const variant = positive ? 'success' : negative ? 'error' : 'neutral';
    const icon = positive ? 'arrow-up' : negative ? 'arrow-down' : 'remove';
    const sign = positive ? '+' : '';
    return (
        <Badge
            variant={variant}
            size="sm"
            icon={icon}
            label={`${sign}${delta.toFixed(1).replace('.', ',')}%`}
        />
    );
}

interface KpiTileProps {
    label: string;
    value: string;
    /** Para Receita/Ticket/O.S. concluídas. */
    delta?: number | null;
    /** Badge alternativo (ex.: "X O.S. total" na Taxa de Conclusão). */
    note?: string;
}

function KpiTile({ label, value, delta, note }: KpiTileProps) {
    return (
        <View className="w-1/2 p-1.5">
            <Card className="h-28">
                <Text
                    className="font-sans-medium text-xs text-neutral-400 dark:text-dark-text-muted"
                    numberOfLines={2}
                >
                    {label}
                </Text>
                <Text
                    className="mt-1.5 font-display-bold text-xl text-neutral-900 dark:text-dark-text"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                >
                    {value}
                </Text>
                <View className="mt-2 flex-row items-center">
                    {note !== undefined ? (
                        <Badge variant="neutral" size="sm" label={note} />
                    ) : (
                        <DeltaBadge delta={delta ?? null} />
                    )}
                </View>
                {note === undefined ? (
                    <Text className="mt-1 font-sans text-[10px] text-neutral-400 dark:text-dark-text-muted">
                        vs. período anterior
                    </Text>
                ) : null}
            </Card>
        </View>
    );
}

/** Linha genérica de ranking (posição + título/subtítulo + valor à direita). */
function RankRow({
    position,
    title,
    subtitle,
    value,
    valueMuted,
}: {
    position: number;
    title: string;
    subtitle?: string;
    value: string;
    valueMuted?: string;
}) {
    return (
        <View className="flex-row items-center gap-3 border-b border-neutral-50 px-4 py-3 dark:border-dark-border-soft">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-neutral-100 dark:bg-dark-elevated">
                <Text className="font-sans-bold text-xs text-neutral-600 dark:text-dark-text-muted">
                    {position}
                </Text>
            </View>
            <View className="flex-1">
                <Text
                    className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {subtitle ? (
                    <Text
                        className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted"
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            <View className="items-end">
                <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                    {value}
                </Text>
                {valueMuted ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {valueMuted}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

/** Card de uma seção de ranking, com seus próprios estados. */
function RankingCard<T>({
    title,
    isLoading,
    isError,
    onRetry,
    items,
    renderRow,
    emptyText,
}: {
    title: string;
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    items: T[] | undefined;
    renderRow: (item: T, index: number) => React.ReactNode;
    emptyText: string;
}) {
    return (
        <>
            <SectionTitle>{title}</SectionTitle>
            <View className="mx-4 overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
                {isLoading ? (
                    <View className="p-4">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} width="100%" height={18} className="mb-3" />
                        ))}
                    </View>
                ) : isError ? (
                    <View className="py-6">
                        <ErrorState onRetry={onRetry} description="Não foi possível carregar." />
                    </View>
                ) : !items || items.length === 0 ? (
                    <View className="px-4 py-8">
                        <Text className="text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            {emptyText}
                        </Text>
                    </View>
                ) : (
                    items.map((item, index) => renderRow(item, index))
                )}
            </View>
        </>
    );
}

/** Aviso exibido no Expo Go, onde os gráficos (Skia) não rodam. */
function ChartsUnavailableNotice() {
    return (
        <View className="mx-4">
            <Card>
                <View className="flex-row items-start gap-3">
                    <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-dark-elevated">
                        <Text className="text-lg">📊</Text>
                    </View>
                    <View className="flex-1">
                        <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                            Gráficos indisponíveis aqui
                        </Text>
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Os gráficos estão disponíveis no app instalado (build de
                            desenvolvimento).
                        </Text>
                    </View>
                </View>
            </Card>
        </View>
    );
}

/* ────────────────────────────── Tela principal ────────────────────────── */

export function DashboardScreen({ navigation }: AppStackScreenProps<'Dashboard'>) {
    const { colors } = useTheme();
    const isOwner = useAuthStore((s) => s.isOwner)();
    const { isGalponProfile } = useGalponFlags();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [period, setPeriod] = useState<PeriodKey>('thisMonth');

    const params: DashboardParams = useMemo(() => {
        const range = computeRange(period);
        return {
            ...range,
            ...(selectedStoreId != null ? { store_id: selectedStoreId } : {}),
        };
    }, [period, selectedStoreId]);

    const overview = useDashboardOverview(params);
    const sla = useDashboardSla(params);
    const queue = useDashboardQueue(selectedStoreId ?? undefined);
    const stores = useDashboardStoresRanking(params);
    const services = useDashboardServicesRanking(params);
    const departments = useDashboardDepartmentBreakdown(params);
    const employees = useDashboardEmployeesRanking(params);
    const consultants = useDashboardConsultantsRanking(params);

    const refreshing =
        overview.isRefetching ||
        sla.isRefetching ||
        queue.isRefetching ||
        stores.isRefetching;

    const handleRefresh = () => {
        void overview.refetch();
        void sla.refetch();
        void queue.refetch();
        void stores.refetch();
        void services.refetch();
        void departments.refetch();
        void employees.refetch();
        void consultants.refetch();
    };

    // Gate defensivo de UX (a autorização real é do backend).
    if (!isOwner && !isGalponProfile) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Dashboard" onBack={() => navigation.goBack()} />
                <EmptyState
                    icon="lock-closed-outline"
                    title="Acesso restrito"
                    description="O Dashboard executivo está disponível apenas para o proprietário e perfis de galpão."
                />
            </View>
        );
    }

    const ov = overview.data;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Dashboard"
                subtitle="Indicadores e rankings"
                onBack={() => navigation.goBack()}
            />

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 40 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={colors.textMuted}
                    />
                }
            >
                {/* Filtros */}
                <View className="px-4 pt-4">
                    <View className="mb-3 flex-row items-center justify-between">
                        <Text className="font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                            Loja
                        </Text>
                        <StoreSelector />
                    </View>

                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 8 }}
                    >
                        {PERIOD_PRESETS.map((preset) => {
                            const active = preset.key === period;
                            return (
                                <Pressable
                                    key={preset.key}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={`Período: ${preset.label}`}
                                    onPress={() => setPeriod(preset.key)}
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
                                        {preset.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* KPIs */}
                <SectionTitle>Indicadores</SectionTitle>
                {overview.isLoading ? (
                    <View className="flex-row flex-wrap px-2.5">
                        {[0, 1, 2, 3].map((i) => (
                            <View key={i} className="w-1/2 p-1.5">
                                <Card className="h-28">
                                    <Skeleton width="60%" height={12} />
                                    <Skeleton width="80%" height={22} className="mt-3" />
                                    <Skeleton width="40%" height={14} className="mt-3" />
                                </Card>
                            </View>
                        ))}
                    </View>
                ) : overview.isError ? (
                    <View className="px-4 py-6">
                        <ErrorState onRetry={() => void overview.refetch()} />
                    </View>
                ) : ov ? (
                    <View className="flex-row flex-wrap px-2.5">
                        <KpiTile
                            label="Receita Total"
                            value={formatCurrencyBRL(ov.revenue.current)}
                            delta={ov.revenue.delta_pct}
                        />
                        <KpiTile
                            label="Ticket Médio"
                            value={formatCurrencyBRL(ov.avg_ticket.current)}
                            delta={ov.avg_ticket.delta_pct}
                        />
                        <KpiTile
                            label="Taxa de Conclusão"
                            value={formatPercent(ov.completion_rate.current)}
                            note={`${formatInt(ov.total_orders.current)} O.S. total`}
                        />
                        <KpiTile
                            label="O.S. Concluídas"
                            value={formatInt(ov.completed_orders.current)}
                            delta={ov.completed_orders.delta_pct}
                        />
                    </View>
                ) : null}

                {/* SLA */}
                <SectionTitle>SLA</SectionTitle>
                <View className="mx-4">
                    <Card>
                        {sla.isLoading ? (
                            <>
                                <Skeleton width="70%" height={16} />
                                <Skeleton width="50%" height={16} className="mt-3" />
                            </>
                        ) : sla.isError ? (
                            <ErrorState
                                onRetry={() => void sla.refetch()}
                                description="Não foi possível carregar o SLA."
                            />
                        ) : sla.data ? (
                            <>
                                <View className="flex-row justify-between">
                                    <View className="flex-1 pr-2">
                                        <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                            Tempo médio aguardando
                                        </Text>
                                        <Text className="mt-1 font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                                            {formatMinutes(sla.data.avg_wait_minutes)}
                                        </Text>
                                    </View>
                                    <View className="flex-1 border-l border-neutral-100 pl-3 dark:border-dark-border-soft">
                                        <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                            Tempo médio em execução
                                        </Text>
                                        <Text className="mt-1 font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                                            {formatMinutes(sla.data.avg_execution_minutes)}
                                        </Text>
                                    </View>
                                </View>
                                <View className="mt-4 flex-row flex-wrap gap-2">
                                    <Badge
                                        variant="info"
                                        size="sm"
                                        label={`Retorno ${formatPercent(sla.data.pct_return)}`}
                                    />
                                    <Badge
                                        variant="purple"
                                        size="sm"
                                        label={`Cortesia ${formatPercent(sla.data.pct_courtesy)}`}
                                    />
                                    <Badge
                                        variant="neutral"
                                        size="sm"
                                        label={`Galpão ${formatPercent(sla.data.pct_galpon)}`}
                                    />
                                </View>
                            </>
                        ) : null}
                    </Card>
                </View>

                {/* Fila ao vivo */}
                <SectionTitle hint="Atualiza automaticamente">Fila ao vivo</SectionTitle>
                <View className="mx-4 overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
                    {queue.isLoading ? (
                        <View className="p-4">
                            {[0, 1].map((i) => (
                                <Skeleton key={i} width="100%" height={20} className="mb-3" />
                            ))}
                        </View>
                    ) : queue.isError ? (
                        <View className="py-6">
                            <ErrorState
                                onRetry={() => void queue.refetch()}
                                description="Não foi possível carregar a fila."
                            />
                        </View>
                    ) : !queue.data || queue.data.length === 0 ? (
                        <View className="px-4 py-8">
                            <Text className="text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Nenhuma loja na fila no momento.
                            </Text>
                        </View>
                    ) : (
                        queue.data.map((q) => (
                            <View
                                key={q.store_id}
                                className="border-b border-neutral-50 px-4 py-3 dark:border-dark-border-soft"
                            >
                                <Text
                                    className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                                    numberOfLines={1}
                                >
                                    {q.store_name}
                                </Text>
                                <View className="mt-2 flex-row flex-wrap gap-2">
                                    <Badge
                                        variant="neutral"
                                        size="sm"
                                        label={`Aguardando ${q.waiting}`}
                                    />
                                    <Badge
                                        variant="info"
                                        size="sm"
                                        label={`Em execução ${q.in_progress}`}
                                    />
                                    <Badge
                                        variant="success"
                                        size="sm"
                                        label={`Concluídas ${q.completed}`}
                                    />
                                    {q.overdue > 0 ? (
                                        <Badge
                                            variant="error"
                                            size="sm"
                                            icon="alert-circle"
                                            label={`Atrasadas ${q.overdue}`}
                                        />
                                    ) : null}
                                </View>
                            </View>
                        ))
                    )}
                </View>

                {/* Rankings */}
                <RankingCard
                    title="Lojas"
                    isLoading={stores.isLoading}
                    isError={stores.isError}
                    onRetry={() => void stores.refetch()}
                    items={stores.data}
                    emptyText="Sem dados de lojas no período."
                    renderRow={(item, index) => (
                        <RankRow
                            key={item.store_id}
                            position={index + 1}
                            title={item.store_name}
                            subtitle={`${formatInt(item.orders_count)} O.S.`}
                            value={formatCurrencyBRL(item.revenue)}
                        />
                    )}
                />

                <RankingCard
                    title="Serviços"
                    isLoading={services.isLoading}
                    isError={services.isError}
                    onRetry={() => void services.refetch()}
                    items={services.data}
                    emptyText="Sem dados de serviços no período."
                    renderRow={(item, index) => (
                        <RankRow
                            key={item.service_id}
                            position={index + 1}
                            title={item.service_name}
                            subtitle={`${departmentLabel(item.department)} · ${formatInt(
                                item.count
                            )} O.S.`}
                            value={formatCurrencyBRL(item.revenue)}
                        />
                    )}
                />

                <RankingCard
                    title="Departamentos"
                    isLoading={departments.isLoading}
                    isError={departments.isError}
                    onRetry={() => void departments.refetch()}
                    items={departments.data}
                    emptyText="Sem dados de departamentos no período."
                    renderRow={(item, index) => (
                        <RankRow
                            key={item.department}
                            position={index + 1}
                            title={departmentLabel(item.department)}
                            subtitle={`${formatInt(item.count)} O.S.`}
                            value={formatCurrencyBRL(item.revenue)}
                            valueMuted={formatPercent(item.pct_revenue)}
                        />
                    )}
                />

                <RankingCard
                    title="Funcionários"
                    isLoading={employees.isLoading}
                    isError={employees.isError}
                    onRetry={() => void employees.refetch()}
                    items={employees.data}
                    emptyText="Sem dados de funcionários no período."
                    renderRow={(item, index) => (
                        <RankRow
                            key={item.employee_id}
                            position={index + 1}
                            title={item.employee_name}
                            subtitle={departmentLabel(item.department)}
                            value={`${formatInt(item.orders_count)} O.S.`}
                            valueMuted={`${formatMinutes(item.hours_worked * 60)}`}
                        />
                    )}
                />

                <RankingCard
                    title="Consultores"
                    isLoading={consultants.isLoading}
                    isError={consultants.isError}
                    onRetry={() => void consultants.refetch()}
                    items={consultants.data}
                    emptyText="Sem dados de consultores no período."
                    renderRow={(item, index) => (
                        <RankRow
                            key={item.consultant_id}
                            position={index + 1}
                            title={item.consultant_name}
                            subtitle={item.dealership_name ?? '—'}
                            value={`${formatInt(item.orders_count)} O.S.`}
                            valueMuted={formatCurrencyBRL(item.revenue)}
                        />
                    )}
                />

                {/* Gráficos (Fatia 3b) — Skia/victory-native só fora do Expo Go */}
                <SectionTitle>Gráficos</SectionTitle>
                {isExpoGo() ? (
                    <ChartsUnavailableNotice />
                ) : (
                    <Suspense
                        fallback={
                            <View className="mx-4">
                                <Skeleton width="100%" height={200} />
                            </View>
                        }
                    >
                        <LazyChartsSection params={params} />
                    </Suspense>
                )}
            </ScrollView>
        </View>
    );
}
