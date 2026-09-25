import { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCurrency, formatMeters } from '@/lib/utils';
import type { ProfitabilityResponse } from '@/types/indicators.types';

interface ProfitabilityTableProps {
  data: ProfitabilityResponse | undefined;
}

function formatMarginPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function formatRevenuePerMeter(value: number | null): string {
  return value === null ? '—' : `${formatCurrency(value)}/m`;
}

const marginColor = (value: number | null) =>
  value === null
    ? 'text-gray-500 dark:text-gray-400'
    : value >= 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';

export const ProfitabilityTable = memo(function ProfitabilityTable({
  data,
}: ProfitabilityTableProps) {
  const items = data?.items ?? [];

  return (
    <Card className="overflow-hidden bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div>
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Rentabilidade do Consumo
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            Tipo · Tonalidade · Consumo · Custo · Faturamento · Margem
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
            Sem dados para o período
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-[#1E1E1E]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Tipo
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Tonalidade
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Consumo (m)
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Custo
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Faturamento ↓
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Margem %
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    R$/Metro
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.film_type_id ?? 'none'}-${item.tonality ?? 'none'}`}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                      {item.type_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.tonality ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {formatMeters(item.consumption_meters, 1)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {formatCurrency(item.cost)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] font-medium whitespace-nowrap">
                      {formatCurrency(item.revenue)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right font-medium whitespace-nowrap',
                        marginColor(item.margin_pct)
                      )}
                    >
                      {formatMarginPct(item.margin_pct)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] whitespace-nowrap">
                      {formatRevenuePerMeter(item.revenue_per_meter)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] font-bold">
                    <td className="px-4 py-2.5 text-gray-900 dark:text-white" colSpan={2}>
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 dark:text-white whitespace-nowrap">
                      {formatMeters(data.total.consumption_meters, 1)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(data.total.cost)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] whitespace-nowrap">
                      {formatCurrency(data.total.revenue)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right whitespace-nowrap',
                        marginColor(data.total.margin_pct)
                      )}
                    >
                      {formatMarginPct(data.total.margin_pct)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] whitespace-nowrap">
                      {formatRevenuePerMeter(data.total.revenue_per_meter)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
