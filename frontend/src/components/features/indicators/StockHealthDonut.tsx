import { memo } from 'react';
import { Pie, PieChart, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useIsDark } from '@/hooks/useIsDark';
import { CHART_COLORS } from '@/constants/chartColors';
import type { StockHealth, StockHealthStatus } from '@/types/indicators.types';

interface StockHealthDonutProps {
  data: StockHealth | undefined;
}

const STATUS_LABELS: Record<StockHealthStatus, string> = {
  em_estoque: 'Em Estoque',
  em_uso: 'Em Uso',
  alerta: 'Em Alerta',
  esgotada: 'Finalizadas',
};

const STATUS_COLORS: Record<StockHealthStatus, string> = {
  em_estoque: CHART_COLORS.brand,
  em_uso: CHART_COLORS.blue,
  alerta: CHART_COLORS.orange,
  esgotada: CHART_COLORS.neutral,
};

const EMPTY_STATE = (
  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
    Sem dados para o período
  </div>
);

export const StockHealthDonut = memo(function StockHealthDonut({ data }: StockHealthDonutProps) {
  const isDark = useIsDark();

  const chartData = (data?.breakdown ?? []).map((bucket) => ({
    status: bucket.status,
    name: STATUS_LABELS[bucket.status] ?? bucket.status,
    value: bucket.count,
    percentage: bucket.percentage,
    color: STATUS_COLORS[bucket.status] ?? CHART_COLORS.neutral,
  }));

  return (
    <Card className="h-full flex flex-col bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Saúde do Estoque
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {data ? `${data.total_bobinas} bobinas · ${Math.round(data.coverage_days)} dias cobertura` : '—'}
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center">
        {chartData.length === 0 ? (
          EMPTY_STATE
        ) : (
          // `items-center` + altura só em `min-h`/`%` fazia o ResponsiveContainer
          // resolver altura 0 (donut sumia). Container com altura DEFINIDA (h-[220px])
          // + `justify-center` no CardContent centraliza o bloco e preenche o card
          // alto sem deixar vazio, mantendo o donut sempre renderizado.
          <div className="flex items-center gap-4">
            <div className="basis-[55%] shrink-0 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.status} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
                      border: isDark ? '1px solid #2a2a2a' : '1px solid #e5e7eb',
                      borderRadius: '6px',
                      color: isDark ? '#e5e5e5' : '#111111',
                      fontSize: '12px',
                    }}
                    formatter={(value, name, props) => [
                      `${value} bob. (${((props as { payload?: { percentage?: number } })?.payload?.percentage ?? 0).toFixed(1)}%)`,
                      name as string,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-col gap-2 flex-1 py-1">
              {chartData.map((entry) => (
                <div key={entry.status} className="flex items-start gap-2 min-w-0">
                  <span
                    className="mt-0.5 flex-shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {entry.name}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {entry.value} bob. · {entry.percentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
