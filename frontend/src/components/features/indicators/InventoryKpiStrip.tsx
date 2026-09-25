import { memo } from 'react';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatMeters } from '@/lib/utils';
import { DeltaBadge } from './DeltaBadge';
import type { InventoryKpis } from '@/types/indicators.types';

interface InventoryKpiStripProps {
  data: InventoryKpis | undefined;
}

function CompactKpi({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">
        {label}
      </span>
      <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{value}</span>
      <DeltaBadge delta={delta} />
    </div>
  );
}

export const InventoryKpiStrip = memo(function InventoryKpiStrip({ data }: InventoryKpiStripProps) {
  return (
    <Card className="h-full flex flex-col bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="flex-1 flex flex-col justify-center pt-5 pb-4">
        {/* Grade de 3 colunas (hero Estoque + 6 KPIs) — preenche a altura do card,
            alinhando com o card de saúde ao lado (sem vazio embaixo). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
          {/* Hero: Estoque */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-lg bg-[#F5A800]/10 dark:bg-[#F5A800]/15 shrink-0">
              <Package className="h-6 w-6 text-[#F5A800]" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Estoque
              </span>
              <span className="text-2xl font-bold text-[#F5A800] leading-tight truncate">
                {data ? formatMeters(data.stock_meters.current) : '—'}
              </span>
              <DeltaBadge delta={data?.stock_meters.delta_pct ?? null} />
            </div>
          </div>

          <CompactKpi
            label="Valor em Estoque"
            value={data ? formatCurrency(data.stock_value.current) : '—'}
            delta={data?.stock_value.delta_pct ?? null}
          />
          <CompactKpi
            label="Cobertura"
            value={data ? `${Math.round(data.coverage_days.current)} dias` : '—'}
            delta={data?.coverage_days.delta_pct ?? null}
          />
          <CompactKpi
            label="Consumo"
            value={data ? formatMeters(data.consumption_meters.current) : '—'}
            delta={data?.consumption_meters.delta_pct ?? null}
          />
          <CompactKpi
            label="Aplicações"
            value={data ? data.applications_count.current.toLocaleString('pt-BR') : '—'}
            delta={data?.applications_count.delta_pct ?? null}
          />
          <CompactKpi
            label="Entradas"
            value={data ? formatMeters(data.entries_meters.current) : '—'}
            delta={data?.entries_meters.delta_pct ?? null}
          />
          <CompactKpi
            label="Bobinas"
            value={data ? data.bobinas_count.current.toLocaleString('pt-BR') : '—'}
            delta={data?.bobinas_count.delta_pct ?? null}
          />
        </div>
      </CardContent>
    </Card>
  );
});
