import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { ConsultantRankingItem } from '@/types/dashboard.types';

interface ConsultantsRankingTableProps {
  data: ConsultantRankingItem[];
}

export function ConsultantsRankingTable({ data }: ConsultantsRankingTableProps) {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Ranking de Consultores
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
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Nome
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Concessionária
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    O.S.
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Receita
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, index) => (
                  <tr
                    key={item.consultant_id}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">
                      {index + 1}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                      {item.consultant_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                      {item.dealership_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.orders_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#F5A800] font-medium">
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
