import { useState } from 'react';
import { useStores } from '@/hooks/useStores';
import {
  DollarSign,
  CheckCircle,
  TrendingUp,
  Percent,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import {
  useDashboardOverview,
  useDashboardStoresRanking,
  useDashboardServicesRanking,
  useDashboardDepartmentBreakdown,
  useDashboardEmployeesRanking,
  useDashboardConsultantsRanking,
  useDashboardSla,
  useDashboardQueue,
  useDashboardTimeseriesByType,
  useDashboardFilmPpfRanking,
} from '@/hooks/useDashboard';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { RevenueTrendChart } from '@/components/features/dashboard/RevenueTrendChart';
import { StoreRankingCard } from '@/components/features/dashboard/StoreRankingCard';
import { ServicesTopCard } from '@/components/features/dashboard/ServicesTopCard';
import { DepartmentDonut } from '@/components/features/dashboard/DepartmentDonut';
import { ConsultantsRankingTable } from '@/components/features/dashboard/ConsultantsRankingTable';
import { EmployeesRankingTable } from '@/components/features/dashboard/EmployeesRankingTable';
import { SlaSummary } from '@/components/features/dashboard/SlaSummary';
import { LiveQueueCard } from '@/components/features/dashboard/LiveQueueCard';
import { FilmPpfRankingTable } from '@/components/features/dashboard/FilmPpfRankingTable';

// ─────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getFirstDayOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

function getFirstDayOfLastMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
}

function getLastDayOfLastMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
}

function getLast7DaysStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
          <CardContent className="pt-5 pb-4 space-y-3">
            <Skeleton className="h-3 w-24 bg-gray-200 dark:bg-[#2a2a2a]" />
            <Skeleton className="h-7 w-32 bg-gray-200 dark:bg-[#2a2a2a]" />
            <Skeleton className="h-4 w-16 bg-gray-200 dark:bg-[#2a2a2a]" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="pt-4 space-y-3">
        <Skeleton className="h-4 w-40 bg-gray-200 dark:bg-[#2a2a2a]" />
        <Skeleton className="h-64 w-full bg-gray-200 dark:bg-[#2a2a2a]" />
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="pt-4 space-y-2">
        <Skeleton className="h-4 w-48 bg-gray-200 dark:bg-[#2a2a2a]" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full bg-gray-200 dark:bg-[#2a2a2a]" />
        ))}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Granularity selector
// ─────────────────────────────────────────────────────────────

type Granularity = 'day' | 'week' | 'month';

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [servicesDept, setServicesDept] = useState<string | null>(null);
  const [employeesDept, setEmployeesDept] = useState<string | null>(null);

  const { stores } = useStores();
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  const {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    appliedStart,
    appliedEnd,
    apply,
  } = useDateRangeFilter({
    defaultStart: getFirstDayOfMonth(),
    defaultEnd: getToday(),
  });

  const params = {
    start_date: appliedStart,
    end_date: appliedEnd,
    ...(selectedStoreId !== null && { store_id: selectedStoreId }),
  };

  const overviewQuery = useDashboardOverview(params);
  const storesQuery = useDashboardStoresRanking(params);
  const servicesQuery = useDashboardServicesRanking(params, servicesDept ?? undefined);
  const departmentsQuery = useDashboardDepartmentBreakdown(params);
  const employeesQuery = useDashboardEmployeesRanking(params, employeesDept ?? undefined);
  const consultantsQuery = useDashboardConsultantsRanking(params);
  const slaQuery = useDashboardSla(params);
  const queueQuery = useDashboardQueue();
  const timeseriesQuery = useDashboardTimeseriesByType(params, granularity);
  const filmPpfQuery = useDashboardFilmPpfRanking(params);

  const overview = overviewQuery.data;

  // ── Quick-date shortcuts ─────────────────────────────────────
  function applyPreset(start: string, end: string) {
    setStartDate(start);
    setEndDate(end);
    // apply immediately via the store state trick — we call apply after state flush
    // by setting both and triggering apply in next tick via effect-free approach
    // Since useDateRangeFilter keeps startDate/endDate as local state, we need to
    // trigger apply after the state updates. We do this by exposing a controlled
    // version: just update both and rely on user confirming, OR we use a simpler
    // workaround of also calling apply() (which will capture the *previous* values).
    // The cleanest approach is to not rely on `apply` here and instead sync directly.
  }

  // Cleaner approach: have a separate "applied" state driven by button clicks
  const handlePreset = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    // We need to call apply with the NEW values, but useDateRangeFilter's apply()
    // reads from local state (which hasn't flushed yet). So we track an override.
    // Instead, bypass the hook for presets by directly setting applied values:
    void applyPreset; // suppress unused warning
    setTimeout(() => apply(), 0);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#111111]">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Executivo</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Visão consolidada da operação
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Quick presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-[#F5A800]"
                onClick={() => handlePreset(getToday(), getToday())}
              >
                Hoje
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-[#F5A800]"
                onClick={() => handlePreset(getLast7DaysStart(), getToday())}
              >
                7 dias
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-[#F5A800]"
                onClick={() => handlePreset(getFirstDayOfMonth(), getToday())}
              >
                Mês atual
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-[#F5A800]"
                onClick={() => handlePreset(getFirstDayOfLastMonth(), getLastDayOfLastMonth())}
              >
                Mês anterior
              </Button>
            </div>

            {/* Custom date range */}
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label htmlFor="dash-start" className="text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                  De
                </label>
                <Input
                  id="dash-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 w-36 text-xs bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:border-[#F5A800]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="dash-end" className="text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                  Até
                </label>
                <Input
                  id="dash-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 w-36 text-xs bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:border-[#F5A800]"
                />
              </div>
              <Button
                size="sm"
                onClick={apply}
                className="h-8 text-xs bg-[#F5A800] hover:bg-[#d48f00] text-black font-semibold"
              >
                Aplicar
              </Button>
            </div>

            {/* Granularity */}
            <div className="flex flex-col gap-1">
              <span className="block text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                Granularidade
              </span>
              <Select
                value={granularity}
                onValueChange={(v) => setGranularity(v as Granularity)}
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Store filter */}
            {stores.length > 1 && (
              <div className="flex flex-col gap-1">
                <label htmlFor="dashboard-store-filter" className="block text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                  Loja
                </label>
                <Select
                  value={selectedStoreId !== null ? String(selectedStoreId) : 'all'}
                  onValueChange={(v) => setSelectedStoreId(v === 'all' ? null : Number(v))}
                >
                  <SelectTrigger id="dashboard-store-filter" className="h-8 w-40 text-xs">
                    <SelectValue placeholder="Todas as lojas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todas as lojas</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* ── KPI Cards ──────────────────────────────────────── */}
        {overviewQuery.isLoading ? (
          <KpiSkeleton />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Receita Total"
              value={overview ? formatCurrency(overview.revenue.current) : '—'}
              icon={DollarSign}
              delta={overview?.revenue.delta_pct ?? null}
              deltaValue={overview ? overview.revenue.current - overview.revenue.previous : null}
              subLabel="vs. período anterior"
            />
            <KpiCard
              label="Ticket Médio"
              value={overview ? formatCurrency(overview.avg_ticket.current) : '—'}
              icon={TrendingUp}
              delta={overview?.avg_ticket.delta_pct ?? null}
              subLabel="por O.S."
            />
            <KpiCard
              label="Taxa de Conclusão"
              value={overview ? `${overview.completion_rate.current.toFixed(1)}%` : '—'}
              icon={Percent}
              delta={null}
              badgeText={overview ? `${overview.total_orders.current.toLocaleString('pt-BR')} O.S. total` : undefined}
            />
            <KpiCard
              label="O.S. Concluídas"
              value={overview ? overview.completed_orders.current.toLocaleString('pt-BR') : '—'}
              icon={CheckCircle}
              delta={overview?.completed_orders.delta_pct ?? null}
              subLabel="vs. período anterior"
            />
          </div>
        )}

        {/* ── Revenue Trend + Store Ranking ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {timeseriesQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <RevenueTrendChart data={timeseriesQuery.data ?? []} />
          )}
          {storesQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <StoreRankingCard data={storesQuery.data ?? []} />
          )}
        </div>

        {/* ── Services Top + Department Donut ───────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {servicesQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <ServicesTopCard
              data={servicesQuery.data ?? []}
              department={servicesDept}
              onDepartmentChange={setServicesDept}
            />
          )}
          {departmentsQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <DepartmentDonut data={departmentsQuery.data ?? []} />
          )}
        </div>

        {/* ── Consultants + Employees Rankings ──────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {consultantsQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <ConsultantsRankingTable data={consultantsQuery.data ?? []} />
          )}
          {employeesQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <EmployeesRankingTable
              data={employeesQuery.data ?? []}
              department={employeesDept}
              onDepartmentChange={setEmployeesDept}
            />
          )}
        </div>

        {/* ── SLA Summary + Film/PPF Ranking ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {slaQuery.isLoading ? (
            <ChartSkeleton />
          ) : slaQuery.data ? (
            <SlaSummary data={slaQuery.data} />
          ) : null}
          {filmPpfQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <FilmPpfRankingTable data={filmPpfQuery.data ?? []} />
          )}
        </div>

        {/* ── Live Queue ────────────────────────────────────── */}
        {queueQuery.isLoading ? (
          <ChartSkeleton />
        ) : (
          <LiveQueueCard data={queueQuery.data ?? []} />
        )}
      </div>
    </div>
  );
}
