import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EmployeeRankingItem } from '@/types/dashboard.types';

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'film', label: 'Película' },
  { value: 'security_film', label: 'Pel. Segurança' },
  { value: 'bodywork', label: 'Funilaria' },
  { value: 'vn', label: 'Estética VN' },
  { value: 'vu', label: 'Estética VU' },
  { value: 'workshop', label: 'Oficina' },
];

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface EmployeesRankingTableProps {
  data: EmployeeRankingItem[];
  department?: string | null;
  onDepartmentChange?: (d: string | null) => void;
}

export function EmployeesRankingTable({
  data,
  department,
  onDepartmentChange,
}: EmployeesRankingTableProps) {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Ranking de Funcionários
          </CardTitle>
          {onDepartmentChange && (
            <select
              value={department ?? ''}
              onChange={(e) => onDepartmentChange(e.target.value || null)}
              className="text-xs bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-gray-400 rounded-md px-2 py-1 focus:outline-none focus:border-[#F5A800]"
              aria-label="Filtrar funcionários por departamento"
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
      <CardContent className="p-0">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
            Sem dados para o período
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-[#1E1E1E]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-8">
                    #
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Nome
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Depto.
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    O.S.
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Horas
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    h/O.S.
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, index) => (
                  <tr
                    key={item.employee_id}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">
                      {index + 1}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                      {item.employee_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 capitalize">
                      {item.department ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.orders_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {formatHours(item.hours_worked)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400">
                      {formatHours(item.avg_hours_per_order)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
