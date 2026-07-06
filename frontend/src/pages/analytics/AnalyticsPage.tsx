import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { Package, CheckCircle, TrendingUp, DollarSign, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { formatCurrency } from '@/lib/utils';
import { STATUS_LABELS } from '@/constants/service-orders';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function formatNumber(value: number): string {
    return value.toLocaleString('pt-BR');
}

function getFirstDayOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

function getToday(): string {
    return new Date().toISOString().split('T')[0];
}

function translateStatus(status: string): string {
    return STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
}

// ────────────────────────────────────────────────────────────────
// Pie chart colours
// ────────────────────────────────────────────────────────────────

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

// ────────────────────────────────────────────────────────────────
// Loading skeleton
// ────────────────────────────────────────────────────────────────

function KPISkeletonRow() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                    <CardContent className="pt-6 space-y-3">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-3 w-20" />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function ChartSkeletonRow() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i}>
                    <CardHeader>
                        <Skeleton className="h-5 w-40" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-64 w-full" />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
    const { startDate, endDate, setStartDate, setEndDate, appliedStart, appliedEnd, apply } =
        useDateRangeFilter({ defaultStart: getFirstDayOfMonth(), defaultEnd: getToday() });

    const { data, isLoading, isError, refetch } = useAnalytics(appliedStart, appliedEnd);

    const handleAtualizar = () => {
        apply();
        refetch();
    };

    // ── Status chart data with translated labels ─────────────────
    const statusChartData = (data?.orders_by_status ?? []).map((item) => ({
        name: translateStatus(item.status),
        count: item.count,
    }));

    // ── Location chart data ───────────────────────────────────────
    const locationChartData = (data?.orders_by_location ?? []).map((item) => ({
        name: item.location_name,
        count: item.count,
    }));

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* ── Header + date filters ───────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Analytics</h1>
                    <p className="text-gray-600">Visão geral de desempenho operacional</p>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                        <label
                            htmlFor="analytics-start-date"
                            className="text-sm font-medium text-gray-700"
                        >
                            Data inicial
                        </label>
                        <Input
                            id="analytics-start-date"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-44"
                        />
                    </div>
                    <div className="space-y-1">
                        <label
                            htmlFor="analytics-end-date"
                            className="text-sm font-medium text-gray-700"
                        >
                            Data final
                        </label>
                        <Input
                            id="analytics-end-date"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-44"
                        />
                    </div>
                    <Button onClick={handleAtualizar} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Atualizar
                    </Button>
                </div>
            </div>

            {/* ── Error state ─────────────────────────────────────── */}
            {isError && (
                <Card>
                    <CardContent className="py-8 text-center">
                        <p className="text-red-500 font-medium">
                            Erro ao carregar dados de analytics.
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            Verifique sua conexão e tente novamente.
                        </p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => refetch()}
                        >
                            Tentar novamente
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* ── Loading: KPI skeleton ───────────────────────────── */}
            {isLoading && (
                <>
                    <KPISkeletonRow />
                    <ChartSkeletonRow />
                </>
            )}

            {/* ── Data loaded ─────────────────────────────────────── */}
            {!isLoading && !isError && data && (
                <>
                    {/* Row 1 – KPI cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Total O.S. */}
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-gray-600">Total O.S.</p>
                                        <p className="text-3xl font-bold">
                                            {formatNumber(data.total_orders)}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            {formatNumber(data.pending_orders)} pendentes
                                        </p>
                                    </div>
                                    <Package className="h-10 w-10 text-blue-500" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* O.S. Concluídas */}
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-gray-600">O.S. Concluídas</p>
                                        <p className="text-3xl font-bold text-green-600">
                                            {formatNumber(data.completed_orders)}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            {data.total_orders > 0
                                                ? `${((data.completed_orders / data.total_orders) * 100).toFixed(1)}% do total`
                                                : '—'}
                                        </p>
                                    </div>
                                    <CheckCircle className="h-10 w-10 text-green-500" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Receita Total */}
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-gray-600">Receita Total</p>
                                        <p className="text-3xl font-bold">
                                            {formatCurrency(data.total_revenue)}
                                        </p>
                                        <p className="text-sm text-gray-500">no período</p>
                                    </div>
                                    <DollarSign className="h-10 w-10 text-yellow-500" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Ticket Médio */}
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-gray-600">Ticket Médio</p>
                                        <p className="text-3xl font-bold">
                                            {formatCurrency(data.average_order_value)}
                                        </p>
                                        <p className="text-sm text-gray-500">por ordem</p>
                                    </div>
                                    <TrendingUp className="h-10 w-10 text-purple-500" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Row 2 – Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Receita por Mês */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Receita por Mês</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {data.revenue_by_month.length === 0 ? (
                                    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                                        Sem dados para o período
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart
                                            data={data.revenue_by_month}
                                            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                                            <YAxis
                                                tick={{ fontSize: 11 }}
                                                tickFormatter={(v) =>
                                                    new Intl.NumberFormat('pt-BR', {
                                                        notation: 'compact',
                                                        style: 'currency',
                                                        currency: 'BRL',
                                                        minimumFractionDigits: 0,
                                                    }).format(Number(v))
                                                }
                                            />
                                            <Tooltip
                                                formatter={(value) =>
                                                    formatCurrency(Number(value))
                                                }
                                            />
                                            <Bar
                                                dataKey="revenue"
                                                name="Receita"
                                                fill="#3b82f6"
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        {/* O.S. por Status */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">O.S. por Status</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {statusChartData.length === 0 ? (
                                    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                                        Sem dados para o período
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <PieChart>
                                            <Pie
                                                data={statusChartData}
                                                dataKey="count"
                                                nameKey="name"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                label={({ name, percent }: PieLabelRenderProps) =>
                                                    `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                                                }
                                                labelLine={false}
                                            >
                                                {statusChartData.map((_, index) => (
                                                    <Cell
                                                        key={index}
                                                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value) => [
                                                    formatNumber(Number(value)),
                                                    'O.S.',
                                                ]}
                                            />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Row 3 – O.S. por Localização (conditional) */}
                    {locationChartData.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">O.S. por Localização</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer
                                    width="100%"
                                    height={Math.max(300, locationChartData.length * 48)}
                                >
                                    <BarChart
                                        data={locationChartData}
                                        layout="vertical"
                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" tick={{ fontSize: 12 }} />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            width={120}
                                            tick={{ fontSize: 12 }}
                                        />
                                        <Tooltip
                                            formatter={(value) => [
                                                formatNumber(Number(value)),
                                                'O.S.',
                                            ]}
                                        />
                                        <Bar
                                            dataKey="count"
                                            name="Ordens"
                                            fill="#3b82f6"
                                            radius={[0, 4, 4, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}
