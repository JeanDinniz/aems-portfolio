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
import type { TimeSeriesByTypePoint } from '@/types/dashboard.types';

interface RevenueTrendChartProps {
  data: TimeSeriesByTypePoint[];
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

export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  const isDark = useIsDark();

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Evolução por Tipo — Película, PPF e Estética
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
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
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
                  (value as number).toLocaleString('pt-BR'),
                  name as string,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: isDark ? '#888' : '#4b5563' }}
              />
              <Line
                type="monotone"
                dataKey="film_count"
                name="Película"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="ppf_count"
                name="PPF"
                stroke="#F5A800"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="estetica_count"
                name="Estética"
                stroke="#10b981"
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
