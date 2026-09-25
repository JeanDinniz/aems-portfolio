import { useState } from 'react';
import { useStores } from '@/hooks/useStores';
import {
  DollarSign,
  TrendingUp,
  ClipboardCheck,
  CalendarClock,
  ChevronDown,
  ChevronUp,
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
import { cn, formatCurrency } from '@/lib/utils';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { useDashboardFiltersStore } from '@/stores/filters.store';
import {
  useDashboardOverview,
  useDashboardStoresRanking,
  useDashboardServicesRanking,
  useDashboardDepartmentBreakdown,
  useDashboardEmployeesRanking,
  useDashboardTimeseriesByType,
  useDashboardFilmPpfRanking,
  useDashboardDealershipsRanking,
  useDashboardRevenueForecast,
} from '@/hooks/useDashboard';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { MetaGoalCard } from '@/components/features/dashboard/MetaGoalCard';
import { RevenueTrendChart } from '@/components/features/dashboard/RevenueTrendChart';
import { RevenueByTypeChart } from '@/components/features/dashboard/RevenueByTypeChart';
import { StoreRankingCard } from '@/components/features/dashboard/StoreRankingCard';
import { ServicesTopCard } from '@/components/features/dashboard/ServicesTopCard';
import { DepartmentDonut } from '@/components/features/dashboard/DepartmentDonut';
import { EmployeesRankingTable } from '@/components/features/dashboard/EmployeesRankingTable';
import { FilmPpfRankingTable } from '@/components/features/dashboard/FilmPpfRankingTable';
import { DealershipRankingTable } from '@/components/features/dashboard/DealershipRankingTable';

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

/**
 * True quando o período aplicado é o mês corrente (do 1º dia do mês até hoje ou
 * além). Só nesse caso o card mostra a Previsão; nos demais, o faturamento realizado.
 */
function isCurrentMonthPeriod(start: string, end: string): boolean {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];
  return start === firstDay && end >= today;
}

function formatUpdatedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────

function KpiSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
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
// Preset button style
// ─────────────────────────────────────────────────────────────
const presetBtnClass =
  'h-8 text-xs border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-[#F5A800]';

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  // Drill-down departamento
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [servicesDept, setServicesDept] = useState<string | null>(null);
  // Ranking de funcionários: multi-select de departamentos DA O.S. (film/security_film/ppf)
  const [employeesDepts, setEmployeesDepts] = useState<string[]>([]);

  // Filtros colapsáveis (mobile)
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { stores } = useStores();

  // ── Filtros persistidos (Zustand + sessionStorage) ───────────
  const {
    appliedStart: persistedStart,
    appliedEnd: persistedEnd,
    storeId: persistedStoreId,
    granularity: persistedGranularity,
    setRange: persistRange,
    setStoreId: persistStoreId,
    setGranularity: persistGranularity,
  } = useDashboardFiltersStore();

  const {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    appliedStart,
    appliedEnd,
    apply,
    applyRange,
  } = useDateRangeFilter({
    defaultStart: persistedStart,
    defaultEnd: persistedEnd,
  });

  // Sincroniza a store quando aplica (wrapping apply/applyRange)
  const handleApply = () => {
    apply();
    persistRange(startDate, endDate);
  };

  const handleApplyRange = (start: string, end: string) => {
    applyRange(start, end);
    persistRange(start, end);
  };

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(persistedStoreId);
  const [granularity, setGranularity] = useState<Granularity>(persistedGranularity as Granularity);

  const handleStoreChange = (v: string) => {
    const id = v === 'all' ? null : Number(v);
    setSelectedStoreId(id);
    persistStoreId(id);
  };

  const handleGranularityChange = (v: string) => {
    const g = v as Granularity;
    setGranularity(g);
    persistGranularity(g);
  };

  const params = {
    start_date: appliedStart,
    end_date: appliedEnd,
    ...(selectedStoreId !== null && { store_id: selectedStoreId }),
  };

  // ── Queries ──────────────────────────────────────────────────
  const overviewQuery = useDashboardOverview(params);
  const storesQuery = useDashboardStoresRanking(params);
  const servicesQuery = useDashboardServicesRanking(params, servicesDept ?? undefined);
  const departmentsQuery = useDashboardDepartmentBreakdown(params);
  const employeesQuery = useDashboardEmployeesRanking(
    params,
    employeesDepts.length > 0 ? employeesDepts : undefined
  );
  const typeSeriesQuery = useDashboardTimeseriesByType(params, granularity);
  const filmPpfQuery = useDashboardFilmPpfRanking(params);
  const dealershipsQuery = useDashboardDealershipsRanking(params);
  const forecastQuery = useDashboardRevenueForecast(selectedStoreId);

  const overview = overviewQuery.data;
  const forecast = forecastQuery.data;

  // Drill-down: clicar numa fatia do donut aplica como filtro de departamento
  const handleDeptSelect = (dept: string | null) => {
    setSelectedDept(dept);
    setServicesDept(dept);
    // Ranking de funcionários só filtra departamentos de instalação;
    // fatias de outros departamentos limpam o filtro (= Todos)
    setEmployeesDepts(
      dept && ['film', 'security_film', 'ppf'].includes(dept) ? [dept] : []
    );
  };

  // Timestamp de atualização (da query de overview)
  const updatedAt = overviewQuery.dataUpdatedAt;

  // Card de faturamento: Previsão (run-rate) no mês corrente; realizado nos demais períodos
  const showForecast = isCurrentMonthPeriod(appliedStart, appliedEnd);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#111111]">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Executivo</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-gray-500">Visão consolidada da operação</p>
              {updatedAt > 0 && (
                <span className="text-[11px] text-gray-400 dark:text-gray-600">
                  · Atualizado às {formatUpdatedAt(updatedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Toggle filtros em mobile */}
          <div className="lg:hidden">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFiltersOpen((o) => !o)}
              className="h-8 text-xs gap-1.5"
            >
              Filtros
              {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {/* Filters — sempre visíveis no desktop, colapsáveis no mobile */}
          <div
            className={cn(
              'flex-wrap items-end gap-3',
              'lg:flex',
              filtersOpen ? 'flex' : 'hidden lg:flex'
            )}
          >
            {/* Quick presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" variant="outline" className={presetBtnClass}
                onClick={() => handleApplyRange(getToday(), getToday())}>
                Hoje
              </Button>
              <Button size="sm" variant="outline" className={presetBtnClass}
                onClick={() => handleApplyRange(getLast7DaysStart(), getToday())}>
                7 dias
              </Button>
              <Button size="sm" variant="outline" className={presetBtnClass}
                onClick={() => handleApplyRange(getFirstDayOfMonth(), getToday())}>
                Mês atual
              </Button>
              <Button size="sm" variant="outline" className={presetBtnClass}
                onClick={() => handleApplyRange(getFirstDayOfLastMonth(), getLastDayOfLastMonth())}>
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
                onClick={handleApply}
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
              <Select value={granularity} onValueChange={handleGranularityChange}>
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
                  onValueChange={handleStoreChange}
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

        {/* ── 1) KPI Cards (5) ───────────────────────────────── */}
        {overviewQuery.isLoading ? (
          <KpiSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
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
              label="O.S. Conferidas"
              value={overview ? overview.verified_orders.current.toLocaleString('pt-BR') : '—'}
              icon={ClipboardCheck}
              delta={overview?.verified_orders.delta_pct ?? null}
              badgeText={
                overview && overview.total_orders.current > 0
                  ? `${((overview.verified_orders.current / overview.total_orders.current) * 100).toFixed(0)}% de ${overview.total_orders.current.toLocaleString('pt-BR')} O.S.`
                  : undefined
              }
            />
            <MetaGoalCard goal={overview?.revenue_goal} />
            {/* KPI de faturamento: no mês corrente é a Previsão (run-rate por dias
                úteis); em qualquer outro período vira o Faturamento realizado do
                intervalo (assim o valor acompanha o filtro). */}
            {showForecast ? (
              <KpiCard
                label="Previsão de Faturamento"
                value={forecast ? formatCurrency(forecast.forecast) : '—'}
                icon={CalendarClock}
                delta={null}
                badgeText={
                  forecast
                    ? `${forecast.business_days_elapsed}/${forecast.business_days_total} dias úteis`
                    : undefined
                }
                subLabel="projeção do mês corrente"
              />
            ) : (
              <KpiCard
                label="Faturamento do Período"
                value={overview ? formatCurrency(overview.revenue.current) : '—'}
                icon={CalendarClock}
                delta={overview?.revenue.delta_pct ?? null}
                subLabel="realizado no período"
              />
            )}
          </div>
        )}

        {/* ── 2) Volume + Faturamento por Tipo (empilhados) | Ranking de Lojas ──
            Coluna esquerda: quantidade em cima, valor faturado embaixo (mesmas
            séries, pedido do chefe); coluna direita: Ranking de Lojas (comprido).
            Empilhar os dois gráficos de tipo preenche o espaço vertical do
            ranking, que cresce com o nº de lojas. ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            {typeSeriesQuery.isLoading ? (
              <ChartSkeleton />
            ) : (
              <RevenueTrendChart data={typeSeriesQuery.data ?? []} granularity={granularity} />
            )}
            {typeSeriesQuery.isLoading ? (
              <ChartSkeleton />
            ) : (
              <RevenueByTypeChart data={typeSeriesQuery.data ?? []} granularity={granularity} />
            )}
          </div>
          {storesQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <StoreRankingCard data={storesQuery.data ?? []} />
          )}
        </div>

        {/* ── 3) Departamentos (donut) + Top Serviços ─────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {departmentsQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <DepartmentDonut
              data={departmentsQuery.data ?? []}
              selectedDept={selectedDept}
              onDeptSelect={handleDeptSelect}
            />
          )}
          {servicesQuery.isLoading ? (
            <ChartSkeleton />
          ) : (
            <ServicesTopCard
              data={servicesQuery.data ?? []}
              department={servicesDept}
              onDepartmentChange={setServicesDept}
            />
          )}
        </div>

        {/* ── 4) Concessionárias + Funcionários ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {dealershipsQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <DealershipRankingTable data={dealershipsQuery.data ?? []} />
          )}
          {employeesQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <EmployeesRankingTable
              data={employeesQuery.data ?? []}
              departments={employeesDepts}
              onDepartmentsChange={setEmployeesDepts}
            />
          )}
        </div>

        {/* ── 5) Película×PPF ───────────────────────────────── */}
        {filmPpfQuery.isLoading ? (
          <TableSkeleton />
        ) : (
          <FilmPpfRankingTable data={filmPpfQuery.data ?? []} />
        )}
      </div>
    </div>
  );
}
