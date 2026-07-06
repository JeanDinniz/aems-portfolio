import { useState, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { DepartmentBreakdownItem } from '@/types/dashboard.types';

const DEPT_COLORS: Record<string, string> = {
  film: '#3b82f6',
  security_film: '#818cf8',
  ppf: '#6366f1',
  bodywork: '#f59e0b',
  vn: '#10b981',
  vu: '#8b5cf6',
  workshop: '#ef4444',
};

const DEPT_LABELS: Record<string, string> = {
  film: 'Película',
  security_film: 'Película de Segurança',
  ppf: 'PPF',
  bodywork: 'Funilaria',
  vn: 'Estética VN',
  vu: 'Estética VU',
  workshop: 'Oficina',
};

const FALLBACK_COLORS = ['#14b8a6', '#f97316', '#ec4899', '#84cc16'];

interface DepartmentDonutProps {
  data: DepartmentBreakdownItem[];
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

export function DepartmentDonut({ data }: DepartmentDonutProps) {
  const isDark = useIsDark();

  // Ordenar por receita decrescente (maior → menor)
  const chartData = [...data]
    .sort((a, b) => b.revenue - a.revenue)
    .map((item, index) => ({
      name: DEPT_LABELS[item.department] ?? item.department,
      value: item.revenue,
      pct: item.pct_revenue,
      department: item.department,
      color: DEPT_COLORS[item.department] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    }));

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Receita por Departamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          EMPTY_STATE
        ) : (
          <div className="flex items-center gap-4" style={{ height: 280 }}>
            {/* Donut — ocupa ~55% da largura */}
            <div className="flex-shrink-0" style={{ width: '55%', height: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.department} fill={entry.color} />
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
                    formatter={(value, _name, props) => [
                      `${formatCurrency((value as number) ?? 0)} (${((props as { payload?: { pct?: number } })?.payload?.pct ?? 0).toFixed(1)}%)`,
                      _name as string,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legenda customizada à direita — ordenada maior → menor */}
            <div className="flex flex-col gap-2 overflow-y-auto flex-1 py-1">
              {chartData.map((entry) => (
                <div key={entry.department} className="flex items-start gap-2 min-w-0">
                  <span
                    className="mt-0.5 flex-shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {entry.name}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {formatCurrency(entry.value)} · {entry.pct.toFixed(1)}%
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
}
