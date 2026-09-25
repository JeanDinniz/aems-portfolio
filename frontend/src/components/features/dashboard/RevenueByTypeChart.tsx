import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/constants/chartColors';
import { formatCurrency } from '@/lib/utils';
import { formatDateTick, type ChartGranularity } from './chartAxis';
import type { TimeSeriesByTypePoint } from '@/types/dashboard.types';

interface RevenueByTypeChartProps {
  data: TimeSeriesByTypePoint[];
  granularity: ChartGranularity;
}

function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

const EMPTY_STATE = (
  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
    Sem dados para o período
  </div>
);

/** Eixo Y compacto: R$ 12 mil em vez de R$ 12.000,00 */
function formatAxisCurrency(value: number): string {
  if (Math.abs(value) >= 1000) return `R$ ${(value / 1000).toLocaleString('pt-BR')} mil`;
  return `R$ ${value.toLocaleString('pt-BR')}`;
}

export function RevenueByTypeChart({ data, granularity }: RevenueByTypeChartProps) {
  const isDark = useIsDark();

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Faturamento por Tipo de Serviço — Película, PPF e Estética
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          EMPTY_STATE
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? '#2a2a2a' : '#e5e7eb'}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDateTick(v as string, granularity)}
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatAxisCurrency}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
                  border: isDark ? '1px solid #2a2a2a' : '1px solid #e5e7eb',
                  borderRadius: '6px',
                  color: isDark ? '#e5e5e5' : '#111111',
                  fontSize: '12px',
                }}
                formatter={(value, name) => [
                  formatCurrency(value as number),
                  name as string,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: isDark ? '#888' : '#4b5563' }}
              />
              <Line
                type="monotone"
                dataKey="film_revenue"
                name="Película"
                stroke={CHART_COLORS.blue}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="ppf_revenue"
                name="PPF"
                stroke={CHART_COLORS.brand}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="estetica_revenue"
                name="Estética"
                stroke={CHART_COLORS.green}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
