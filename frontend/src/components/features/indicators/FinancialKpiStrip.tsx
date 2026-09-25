import { memo } from 'react';
import { Banknote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { DeltaBadge } from './DeltaBadge';
import type { FinancialKpis } from '@/types/indicators.types';

interface FinancialKpiStripProps {
  data: FinancialKpis | undefined;
}

function CompactKpi({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">
        {label}
      </span>
      <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{value}</span>
      {badge}
    </div>
  );
}

export const FinancialKpiStrip = memo(function FinancialKpiStrip({ data }: FinancialKpiStripProps) {
  return (
    <Card className="h-full flex flex-col bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="flex-1 flex flex-col justify-center pt-5 pb-4">
        {/* Grade 3×2 (hero Faturamento + 5 KPIs) — preenche a altura do card,
            alinhando com o card de saúde ao lado (sem vazio embaixo). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
          {/* Hero: Faturamento */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-lg bg-[#F5A800]/10 dark:bg-[#F5A800]/15 shrink-0">
              <Banknote className="h-6 w-6 text-[#F5A800]" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Faturamento
              </span>
              <span className="text-2xl font-bold text-[#F5A800] leading-tight truncate">
                {data ? formatCurrency(data.revenue.current) : '—'}
              </span>
              <DeltaBadge delta={data?.revenue.delta_pct ?? null} />
            </div>
          </div>

          <CompactKpi
            label="Margem"
            value={data ? `${data.margin_pct.current.toFixed(1)}%` : '—'}
            badge={<DeltaBadge delta={data?.margin_pct.delta_pct ?? null} suffix="pp" />}
          />
          <CompactKpi
            label="Lucro"
            value={data ? formatCurrency(data.profit.current) : '—'}
            badge={<DeltaBadge delta={data?.profit.delta_pct ?? null} />}
          />
          <CompactKpi
            label="Ticket Médio"
            value={data ? formatCurrency(data.avg_ticket.current) : '—'}
            badge={<DeltaBadge delta={data?.avg_ticket.delta_pct ?? null} />}
          />
          <CompactKpi
            label="R$/Metro"
            value={data ? `${formatCurrency(data.revenue_per_meter.current)}/m` : '—'}
            badge={<DeltaBadge delta={data?.revenue_per_meter.delta_pct ?? null} />}
          />
          <CompactKpi
            label="Aplicações"
            value={data ? data.applications_count.current.toLocaleString('pt-BR') : '—'}
            badge={<DeltaBadge delta={data?.applications_count.delta_pct ?? null} />}
          />
        </div>
      </CardContent>
    </Card>
  );
});
