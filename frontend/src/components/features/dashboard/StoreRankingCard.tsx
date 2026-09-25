import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { CHART_COLORS } from '@/constants/chartColors';
import type { StoreRankingItem } from '@/types/dashboard.types';

interface StoreRankingCardProps {
  data: StoreRankingItem[];
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

export function StoreRankingCard({ data }: StoreRankingCardProps) {
  const isDark = useIsDark();
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);

  const chartData = sorted.map((item) => ({
    name: item.store_name,
    revenue: item.revenue,
    pct_return: item.pct_return,
  }));

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Ranking de Lojas — Receita
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          EMPTY_STATE
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 44)}>
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
                  new Intl.NumberFormat('pt-BR', {
                    notation: 'compact',
                    style: 'currency',
                    currency: 'BRL',
                    minimumFractionDigits: 0,
                  }).format(Number(v))
                }
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={80}
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
                formatter={(value, _name, props) => {
                  const pctReturn = (props as { payload?: { pct_return?: number } })?.payload?.pct_return ?? 0;
                  const pctLabel = pctReturn > 0 ? ` · ${pctReturn.toFixed(1)}% retorno` : '';
                  return [`${formatCurrency((value as number) ?? 0)}${pctLabel}`, 'Receita'];
                }}
              />
              <Bar
                dataKey="revenue"
                radius={[0, 4, 4, 0]}
                maxBarSize={24}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.pct_return > 10 ? CHART_COLORS.red : CHART_COLORS.brand}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {/* Legenda: barra vermelha = % retorno > 10% */}
        {chartData.some((d) => d.pct_return > 10) && (
          <p className="mt-2 text-[10px] text-red-500 dark:text-red-400">
            Barra vermelha = retorno acima de 10%
          </p>
        )}
      </CardContent>
    </Card>
  );
}
