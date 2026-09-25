import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Package, Banknote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getApiErrorMessageFromBlob } from '@/lib/api-error';
import { toast } from '@/hooks/use-toast';
import { downloadBlob } from '@/utils/downloadBlob';
import { indicatorsService } from '@/services/api/indicators.service';
import {
  useInventoryKpis,
  useInventoryProfitability,
  useInventoryHealth,
  useEntriesVsConsumption,
  useFinancialKpis,
  useCommercialPerformance,
  useFinancialHealth,
  useFinancialEvolution,
} from '@/hooks/useIndicators';
import type {
  CommercialSortBy,
  FinancialEvolutionGranularity,
  IndicatorsBaseParams,
} from '@/types/indicators.types';
import { InventoryKpiStrip } from '@/components/features/indicators/InventoryKpiStrip';
import { ProfitabilityTable } from '@/components/features/indicators/ProfitabilityTable';
import { StockHealthDonut } from '@/components/features/indicators/StockHealthDonut';
import { EntriesVsConsumptionChart } from '@/components/features/indicators/EntriesVsConsumptionChart';
import { FinancialKpiStrip } from '@/components/features/indicators/FinancialKpiStrip';
import { CommercialPerformanceCard } from '@/components/features/indicators/CommercialPerformanceCard';
import { FinancialHealthCard } from '@/components/features/indicators/FinancialHealthCard';
import { FinancialEvolutionChart } from '@/components/features/indicators/FinancialEvolutionChart';
import { PeliculasFiltersBar } from '@/components/features/indicators/PeliculasFiltersBar';
import { usePeliculasFiltersStore, COMPARE_PREV } from '@/stores/peliculasFilters.store';

// ─────────────────────────────────────────────────────────────
// Helpers de data / período
// ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Gera os últimos N meses (o corrente primeiro) como opções "YYYY-MM". */
function buildMonthOptions(count = 13): { value: string; label: string }[] {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const label = d
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^\w/, (c) => c.toUpperCase());
    options.push({ value, label });
  }
  return options;
}

/** Converte "YYYY-MM" em { start_date, end_date } (fim = hoje se for o mês corrente). */
function monthValueToRange(monthValue: string): { start_date: string; end_date: string } {
  const [yearStr, monthStr] = monthValue.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  return {
    start_date: toIsoDate(firstDay),
    end_date: isCurrentMonth ? toIsoDate(today) : toIsoDate(lastDay),
  };
}

/** Opacidade discreta enquanto reaplica filtros (mantém dado antigo na tela). */
function fetchingClass(query: { isFetching: boolean; isPlaceholderData: boolean }): string {
  return cn('transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60');
}

// ─────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────

function KpiStripSkeleton() {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="pt-5 pb-4">
        <div className="flex flex-wrap gap-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16 bg-gray-200 dark:bg-[#2a2a2a]" />
              <Skeleton className="h-6 w-20 bg-gray-200 dark:bg-[#2a2a2a]" />
              <Skeleton className="h-3 w-12 bg-gray-200 dark:bg-[#2a2a2a]" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
// Página
// ─────────────────────────────────────────────────────────────

export default function PeliculasPage() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  // Seletor atômico (shallow) — o objeto só muda quando algum campo aplicado
  // muda de fato (a store inteira não é desestruturada aqui).
  const applied = usePeliculasFiltersStore(
    useShallow((s) => ({
      monthValue: s.monthValue,
      compareValue: s.compareValue,
      brandIds: s.brandIds,
      storeIds: s.storeIds,
      departments: s.departments,
      filmTypeIds: s.filmTypeIds,
      tonalities: s.tonalities,
    }))
  );

  const { start_date, end_date } = useMemo(
    () => monthValueToRange(applied.monthValue),
    [applied.monthValue]
  );

  const baseParams: IndicatorsBaseParams = useMemo(() => {
    const params: IndicatorsBaseParams = { start_date, end_date };
    if (applied.storeIds.length) params.store_ids = applied.storeIds;
    if (applied.brandIds.length) params.brand_ids = applied.brandIds;
    if (applied.departments.length) params.departments = applied.departments;
    if (applied.filmTypeIds.length) params.film_type_ids = applied.filmTypeIds;
    if (applied.tonalities.length) params.tonalities = applied.tonalities;
    return params;
  }, [
    start_date,
    end_date,
    applied.storeIds,
    applied.brandIds,
    applied.departments,
    applied.filmTypeIds,
    applied.tonalities,
  ]);

  // "Comparar com" só afeta os KPIs comparativos (E1 Estoque e E5 Financeiro).
  // Os demais cards usam baseParams puro — assim mudar o mês de comparação NÃO
  // invalida (nem re-busca) as 6 queries que ignoram compare_*.
  const compareParams: IndicatorsBaseParams = useMemo(() => {
    if (applied.compareValue === COMPARE_PREV) return baseParams;
    const cmp = monthValueToRange(applied.compareValue);
    return { ...baseParams, compare_start_date: cmp.start_date, compare_end_date: cmp.end_date };
  }, [baseParams, applied.compareValue]);

  // ── Parâmetros de visualização dos cards (não são recorte de dados) ────
  const [commSortBy, setCommSortBy] = useState<CommercialSortBy>('revenue');
  const [evolutionGranularity, setEvolutionGranularity] =
    useState<FinancialEvolutionGranularity>('month');

  // ── Queries — Estoque ───────────────────────────────────────
  const inventoryKpisQuery = useInventoryKpis(compareParams);
  const profitabilityQuery = useInventoryProfitability(baseParams);
  const stockHealthQuery = useInventoryHealth(baseParams);
  const entriesVsConsumptionQuery = useEntriesVsConsumption({ ...baseParams, granularity: 'month' });

  // ── Queries — Faturamento ────────────────────────────────────
  const financialKpisQuery = useFinancialKpis(compareParams);
  const commercialPerformanceQuery = useCommercialPerformance({
    ...baseParams,
    sort_by: commSortBy,
  });
  const financialHealthQuery = useFinancialHealth(baseParams);
  const financialEvolutionQuery = useFinancialEvolution({
    ...baseParams,
    granularity: evolutionGranularity,
  });

  // ── Exportar PDF ─────────────────────────────────────────────
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      // Mesmo formato de nome do backend: peliculas_YYYYMMDD_YYYYMMDD.pdf
      // (só usado se a resposta não trouxer Content-Disposition).
      const fallbackFilename = `peliculas_${start_date.replaceAll('-', '')}_${end_date.replaceAll('-', '')}.pdf`;
      const { blob, filename } = await indicatorsService.exportPdf(
        {
          ...compareParams,
          commercial_sort_by: commSortBy,
          evolution_granularity: evolutionGranularity,
        },
        fallbackFilename
      );
      downloadBlob(blob, filename);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao gerar PDF',
        description: await getApiErrorMessageFromBlob(err, 'Não foi possível gerar o PDF.'),
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#111111]">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── Header (padrão Dashboard: título à esquerda, filtros na
            mesma linha à direita) ────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Películas</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Estoque, consumo e faturamento das aplicações de película
            </p>
          </div>

          <PeliculasFiltersBar
            monthOptions={monthOptions}
            onExportPdf={handleExportPdf}
            isExportingPdf={isExportingPdf}
          />
        </div>

        {/* ── Seção: Estoque ─────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-[#F5A800]" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Estoque</h2>
              <p className="text-xs text-gray-500">
                Entrada, consumo e rendimento do material.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-stretch">
            <div className={fetchingClass(inventoryKpisQuery)}>
              {inventoryKpisQuery.isLoading ? (
                <KpiStripSkeleton />
              ) : (
                <InventoryKpiStrip data={inventoryKpisQuery.data} />
              )}
            </div>
            <div className={fetchingClass(stockHealthQuery)}>
              {stockHealthQuery.isLoading ? (
                <ChartSkeleton />
              ) : (
                <StockHealthDonut data={stockHealthQuery.data} />
              )}
            </div>
          </div>

          <div className={fetchingClass(profitabilityQuery)}>
            {profitabilityQuery.isLoading ? (
              <TableSkeleton />
            ) : (
              <ProfitabilityTable data={profitabilityQuery.data} />
            )}
          </div>

          <div className={fetchingClass(entriesVsConsumptionQuery)}>
            {entriesVsConsumptionQuery.isLoading ? (
              <ChartSkeleton />
            ) : (
              <EntriesVsConsumptionChart data={entriesVsConsumptionQuery.data} granularity="month" />
            )}
          </div>
        </section>

        {/* ── Seção: Faturamento ─────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-[#F5A800]" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Faturamento</h2>
              <p className="text-xs text-gray-500">
                Receita, custos e rentabilidade das aplicações.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-stretch">
            <div className={fetchingClass(financialKpisQuery)}>
              {financialKpisQuery.isLoading ? (
                <KpiStripSkeleton />
              ) : (
                <FinancialKpiStrip data={financialKpisQuery.data} />
              )}
            </div>
            <div className={fetchingClass(financialHealthQuery)}>
              {financialHealthQuery.isLoading ? (
                <ChartSkeleton />
              ) : (
                <FinancialHealthCard data={financialHealthQuery.data} />
              )}
            </div>
          </div>

          <div className={fetchingClass(commercialPerformanceQuery)}>
            {commercialPerformanceQuery.isLoading ? (
              <TableSkeleton />
            ) : (
              <CommercialPerformanceCard
                data={commercialPerformanceQuery.data}
                sortBy={commSortBy}
                onSortByChange={setCommSortBy}
              />
            )}
          </div>

          <div className={fetchingClass(financialEvolutionQuery)}>
            {financialEvolutionQuery.isLoading ? (
              <ChartSkeleton />
            ) : (
              <FinancialEvolutionChart
                data={financialEvolutionQuery.data}
                granularity={evolutionGranularity}
                onGranularityChange={setEvolutionGranularity}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
