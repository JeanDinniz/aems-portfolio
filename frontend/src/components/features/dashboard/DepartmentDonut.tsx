import { useState, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCurrency } from '@/lib/utils';
import { DEPT_COLORS, DEPT_FALLBACK_COLORS } from '@/constants/chartColors';
import type { DepartmentBreakdownItem } from '@/types/dashboard.types';

const DEPT_LABELS: Record<string, string> = {
  film: 'Película',
  security_film: 'Película de Segurança',
  ppf: 'PPF',
  bodywork: 'Funilaria',
  vn: 'Estética VN',
  vu: 'Estética VU',
  vd: 'Venda Direta',
  workshop: 'Oficina',
};

interface DepartmentDonutProps {
  data: DepartmentBreakdownItem[];
  /** Departamento atualmente selecionado pelo drill-down (null = nenhum) */
  selectedDept?: string | null;
  /** Callback ao clicar numa fatia/legenda */
  onDeptSelect?: (dept: string | null) => void;
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

export function DepartmentDonut({ data, selectedDept, onDeptSelect }: DepartmentDonutProps) {
  const isDark = useIsDark();

  const chartData = [...data]
    .sort((a, b) => b.revenue - a.revenue)
    .map((item, index) => ({
      name: DEPT_LABELS[item.department] ?? item.department,
      value: item.revenue,
      pct: item.pct_revenue,
      department: item.department,
      color: DEPT_COLORS[item.department] ?? DEPT_FALLBACK_COLORS[index % DEPT_FALLBACK_COLORS.length],
    }));

  const handleClick = (dept: string) => {
    if (!onDeptSelect) return;
    onDeptSelect(selectedDept === dept ? null : dept);
  };

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Receita por Departamento
          </CardTitle>
          {selectedDept && onDeptSelect && (
            <button
              onClick={() => onDeptSelect(null)}
              className="text-[10px] text-gray-400 hover:text-[#F5A800] transition-colors underline"
            >
              Limpar filtro
            </button>
          )}
        </div>
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
                    onClick={(entry: { department?: string }) => {
                      if (entry?.department) handleClick(entry.department);
                    }}
                    style={onDeptSelect ? { cursor: 'pointer' } : undefined}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.department}
                        fill={entry.color}
                        opacity={selectedDept && selectedDept !== entry.department ? 0.35 : 1}
                        stroke={selectedDept === entry.department ? '#fff' : 'none'}
                        strokeWidth={selectedDept === entry.department ? 2 : 0}
                      />
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

            {/* Legenda customizada à direita — clicável para drill-down.
                max-h-full mantém a lista dentro do card (com scroll quando há
                muitos itens); sem isso, com items-center no pai, a legenda
                cresce além dos 280px e o hover do último item vaza o card. */}
            <div className="flex flex-col gap-2 overflow-y-auto flex-1 py-1 max-h-full">
              {chartData.map((entry) => {
                const isSelected = selectedDept === entry.department;
                const isDimmed = selectedDept !== null && !isSelected;
                return (
                  <button
                    key={entry.department}
                    onClick={() => handleClick(entry.department)}
                    className={cn(
                      'flex items-start gap-2 min-w-0 text-left rounded px-1 py-0.5 transition-opacity',
                      onDeptSelect ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#222]' : 'cursor-default',
                      isDimmed ? 'opacity-40' : 'opacity-100',
                      isSelected ? 'ring-1 ring-inset ring-gray-300 dark:ring-[#2a2a2a] rounded' : ''
                    )}
                    disabled={!onDeptSelect}
                  >
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
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
