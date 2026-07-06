import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { FilmPpfStoreRankingItem } from '@/types/dashboard.types';

interface FilmPpfRankingTableProps {
  data: FilmPpfStoreRankingItem[];
}

export function FilmPpfRankingTable({ data }: FilmPpfRankingTableProps) {
  return (
    <Card className="h-full bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Ranking Película × PPF por Loja
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
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Loja
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Qtd O.S.
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Valor
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Em Loja
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Galpão
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr
                    key={item.store_id}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                      {item.store_name}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.orders_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {formatCurrency(item.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.loja_count.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.galpon_count.toLocaleString('pt-BR')}
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
