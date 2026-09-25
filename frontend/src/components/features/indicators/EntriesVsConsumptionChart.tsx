import { memo } from 'react';
import {
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useIsDark } from '@/hooks/useIsDark';
import { CHART_COLORS } from '@/constants/chartColors';
import { formatDateTick, type ChartGranularity } from '@/components/features/dashboard/chartAxis';
import type { EntriesVsConsumptionPoint } from '@/types/indicators.types';

interface EntriesVsConsumptionChartProps {
  data: EntriesVsConsumptionPoint[] | undefined;
  granularity?: ChartGranularity;
}

const EMPTY_STATE = (
  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
    Sem dados para o período
  </div>
);

export const EntriesVsConsumptionChart = memo(function EntriesVsConsumptionChart({
  data,
  granularity = 'month',
}: EntriesVsConsumptionChartProps) {
  const isDark = useIsDark();
  const chartData = data ?? [];

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Entradas × Consumo
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Tendência de variação de estoque mensal
        </p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          EMPTY_STATE
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#2a2a2a' : '#e5e7eb'} />
              <XAxis
                dataKey="period"
                tickFormatter={(v) => formatDateTick(v as string, granularity)}
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
                  border: isDark ? '1px solid #2a2a2a' : '1px solid #e5e7eb',
                  borderRadius: '6px',
                  color: isDark ? '#e5e5e5' : '#111111',
                  fontSize: '12px',
                }}
                formatter={(value, name) => [`${(value as number).toLocaleString('pt-BR')}m`, name as string]}
                labelFormatter={(v) => formatDateTick(v as string, granularity)}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ fontSize: '12px', color: isDark ? '#888' : '#4b5563' }}
              />
              <Bar dataKey="entries_meters" name="Entradas" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Line
                type="monotone"
                dataKey="consumption_meters"
                name="Consumo"
                stroke={CHART_COLORS.blue}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
});
