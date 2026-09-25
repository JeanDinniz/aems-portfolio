import { cn, formatPercentPoints } from '@/lib/utils';

interface DeltaBadgeProps {
  delta: number | null;
  /**
   * Unidade do delta: '%' para variação percentual comum, 'pp' para diferença
   * em pontos percentuais (ex.: KPI de margem, onde delta_pct já vem em p.p.).
   */
  suffix?: '%' | 'pp';
}

/**
 * Badge de delta compacto para os KPI strips de Indicadores (Estoque/Faturamento).
 * Mesma lógica de cor do DeltaBadge do KpiCard do Dashboard: verde quando
 * positivo, vermelho quando negativo, cinza neutro quando null (KPIs
 * "snapshot" como estoque/cobertura, onde delta_pct sempre vem null).
 */
export function DeltaBadge({ delta, suffix = '%' }: DeltaBadgeProps) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        —
      </span>
    );
  }

  const isPositive = delta > 0;
  const isNegative = delta < 0;
  const label = suffix === 'pp' ? formatPercentPoints(delta) : `${isPositive ? '+' : ''}${delta.toFixed(1)}%`;

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
        isPositive && 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
        isNegative && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
        !isPositive && !isNegative && 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
      )}
    >
      {label}
    </span>
  );
}
