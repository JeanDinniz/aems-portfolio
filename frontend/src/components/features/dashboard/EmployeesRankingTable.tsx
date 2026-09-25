import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MultiSelectFilter } from '@/components/common/MultiSelectFilter';
import { formatCurrency } from '@/lib/utils';
import { useTableSort, getSortIndicator } from '@/hooks/useTableSort';
import type { EmployeeRankingItem } from '@/types/dashboard.types';

// Filtro pelo departamento da O.S. em que o serviço foi feito (não pelo
// cadastro do funcionário) — só os departamentos de instalação interessam.
const DEPARTMENT_OPTIONS = [
  { value: 'film', label: 'Película' },
  { value: 'security_film', label: 'Pel. Segurança' },
  { value: 'ppf', label: 'PPF' },
];

const thBase =
  'px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-[#F5A800] transition-colors whitespace-nowrap';

interface EmployeesRankingTableProps {
  data: EmployeeRankingItem[];
  departments?: string[];
  onDepartmentsChange?: (d: string[]) => void;
}

export function EmployeesRankingTable({
  data,
  departments = [],
  onDepartmentsChange,
}: EmployeesRankingTableProps) {
  const { sorted, sortState, toggle } = useTableSort<EmployeeRankingItem>(data, 'services_count', 'desc');

  return (
    <Card className="overflow-hidden bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Ranking de Funcionários
          </CardTitle>
          {onDepartmentsChange && (
            <MultiSelectFilter
              options={DEPARTMENT_OPTIONS}
              value={departments}
              onChange={onDepartmentsChange}
              allLabel="Todos"
              countLabel={(n) => `${n} departamentos`}
              triggerClassName="w-40 !h-7 text-xs"
            />
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
                  <th className={`${thBase} text-left`} onClick={() => toggle('employee_name')}>
                    Nome{getSortIndicator('employee_name', sortState)}
                  </th>
                  <th className={`${thBase} text-left`} onClick={() => toggle('department')}>
                    Depto.{getSortIndicator('department', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('orders_count')}>
                    O.S.{getSortIndicator('orders_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('services_count')}>
                    Serviços{getSortIndicator('services_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('revenue')}>
                    Valor{getSortIndicator('revenue', sortState)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, index) => (
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
                      {item.services_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {formatCurrency(item.revenue)}
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
