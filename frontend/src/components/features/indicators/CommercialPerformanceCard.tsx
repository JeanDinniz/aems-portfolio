import { memo } from 'react';
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsDark } from '@/hooks/useIsDark';
import { CHART_COLORS } from '@/constants/chartColors';
import { formatCurrency, formatMeters } from '@/lib/utils';
import type { CommercialPerformanceItem, CommercialSortBy } from '@/types/indicators.types';

interface CommercialPerformanceCardProps {
  data: CommercialPerformanceItem[] | undefined;
  sortBy: CommercialSortBy;
  onSortByChange: (value: CommercialSortBy) => void;
}

const SORT_LABELS: Record<CommercialSortBy, string> = {
  revenue: 'Faturamento',
  meters: 'Metros Aplicados',
  applications: 'Aplicações',
};

const BAR_COLORS = [CHART_COLORS.brand, CHART_COLORS.orange, CHART_COLORS.green];

const EMPTY_STATE = (
  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
    Sem dados para o período
  </div>
);

export const CommercialPerformanceCard = memo(function CommercialPerformanceCard({
  data,
  sortBy,
  onSortByChange,
}: CommercialPerformanceCardProps) {
  const isDark = useIsDark();
  const items = data ?? [];

  const chartMetricKey: keyof CommercialPerformanceItem =
    sortBy === 'revenue' ? 'revenue' : sortBy === 'meters' ? 'meters' : 'applications';

  const chartData = items.map((item) => ({
    name: item.store_name,
    metric: item[chartMetricKey] as number,
  }));

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div>
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Performance Comercial
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            Ranking de lojas por desempenho
          </p>
        </div>

        <Tabs value={sortBy} onValueChange={(v) => onSortByChange(v as CommercialSortBy)} className="mt-2">
          <TabsList className="h-8 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]">
            <TabsTrigger value="revenue" className="text-xs h-6 px-3">
              Faturamento
            </TabsTrigger>
            <TabsTrigger value="meters" className="text-xs h-6 px-3">
              Metros Aplicados
            </TabsTrigger>
            <TabsTrigger value="applications" className="text-xs h-6 px-3">
              Aplicações
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          EMPTY_STATE
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Tabela */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#1E1E1E]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Loja
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Tipo
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Metros
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Aplic.
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Fat.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.store_id}
                      className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                    >
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                        {item.store_name}
                      </td>
                      <td
                        className="px-3 py-2 text-gray-600 dark:text-gray-400 truncate max-w-[160px]"
                        title={item.types}
                      >
                        {item.types || '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {formatMeters(item.meters, 1)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {item.applications.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-3 py-2 text-right text-[#F5A800] font-medium whitespace-nowrap">
                        {formatCurrency(item.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ranking (barra horizontal) */}
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Ranking — {SORT_LABELS[sortBy]}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? '#2a2a2a' : '#e5e7eb'}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                    tickFormatter={(v) =>
                      sortBy === 'revenue'
                        ? formatCurrency(Number(v))
                        : Number(v).toLocaleString('pt-BR')
                    }
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
                    contentStyle={{
                      backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
                      border: isDark ? '1px solid #2a2a2a' : '1px solid #e5e7eb',
                      borderRadius: '6px',
                      color: isDark ? '#e5e5e5' : '#111111',
                      fontSize: '12px',
                    }}
                    formatter={(value) => [
                      sortBy === 'revenue'
                        ? formatCurrency(value as number)
                        : sortBy === 'meters'
                          ? formatMeters(value as number, 1)
                          : (value as number).toLocaleString('pt-BR'),
                      SORT_LABELS[sortBy],
                    ]}
                  />
                  <Bar dataKey="metric" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {chartData.map((_, index) => (
                      <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
