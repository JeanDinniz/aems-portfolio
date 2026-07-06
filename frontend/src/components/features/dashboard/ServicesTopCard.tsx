import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { ServiceRankingItem } from '@/types/dashboard.types';

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'film', label: 'Película' },
  { value: 'security_film', label: 'Pel. Segurança' },
  { value: 'bodywork', label: 'Funilaria' },
  { value: 'vn', label: 'Estética VN' },
  { value: 'vu', label: 'Estética VU' },
  { value: 'workshop', label: 'Oficina' },
];

interface ServicesTopCardProps {
  data: ServiceRankingItem[];
  department?: string | null;
  onDepartmentChange?: (d: string | null) => void;
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

export function ServicesTopCard({
  data,
  department,
  onDepartmentChange,
}: ServicesTopCardProps) {
  const isDark = useIsDark();

  const top10 = [...data]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const chartData = top10.map((item) => ({
    name: item.service_name.length > 18 ? item.service_name.slice(0, 16) + '…' : item.service_name,
    fullName: item.service_name,
    revenue: item.revenue,
    count: item.count,
  }));

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Top Serviços — Receita
          </CardTitle>
          {onDepartmentChange && (
            <select
              value={department ?? ''}
              onChange={(e) => onDepartmentChange(e.target.value || null)}
              className="text-xs bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-gray-400 rounded-md px-2 py-1 focus:outline-none focus:border-[#F5A800]"
              aria-label="Filtrar por departamento"
            >
              {DEPARTMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          EMPTY_STATE
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 8, left: 8, bottom: 40 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? '#2a2a2a' : '#e5e7eb'}
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? '#6b7280' : '#4b5563' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  new Intl.NumberFormat('pt-BR', {
                    notation: 'compact',
                    style: 'currency',
                    currency: 'BRL',
                    minimumFractionDigits: 0,
                  }).format(Number(v))
                }
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
                  const p = props as { payload?: { fullName?: string; count?: number } };
                  const fullName = p?.payload?.fullName ?? '';
                  const count = p?.payload?.count ?? 0;
                  return [
                    `${formatCurrency((value as number) ?? 0)} (${count} O.S.)`,
                    fullName,
                  ];
                }}
                labelFormatter={() => ''}
              />
              <Bar
                dataKey="revenue"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
