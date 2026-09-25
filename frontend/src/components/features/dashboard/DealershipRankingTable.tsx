import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { useTableSort, getSortIndicator } from '@/hooks/useTableSort';
import type { DealershipRankingItem } from '@/types/dashboard.types';

const thBase =
  'px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-[#F5A800] transition-colors whitespace-nowrap';

interface DealershipRankingTableProps {
  data: DealershipRankingItem[];
}

export function DealershipRankingTable({ data }: DealershipRankingTableProps) {
  const { sorted, sortState, toggle } = useTableSort<DealershipRankingItem>(data, 'revenue', 'desc');

  return (
    <Card className="overflow-hidden bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Concessionárias Parceiras
        </CardTitle>
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
                  <th className={`${thBase} text-left`} onClick={() => toggle('dealership_name')}>
                    Concessionária{getSortIndicator('dealership_name', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('orders_count')}>
                    O.S.{getSortIndicator('orders_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('revenue')}>
                    Receita{getSortIndicator('revenue', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('avg_ticket')}>
                    Ticket Médio{getSortIndicator('avg_ticket', sortState)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, index) => (
                  <tr
                    key={item.dealership_id}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">
                      {index + 1}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                      {item.dealership_name}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.orders_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] font-medium">
                      {formatCurrency(item.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400">
                      {formatCurrency(item.avg_ticket)}
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
