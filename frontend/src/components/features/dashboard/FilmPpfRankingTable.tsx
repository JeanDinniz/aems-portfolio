import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { useTableSort, getSortIndicator } from '@/hooks/useTableSort';
import type { FilmPpfStoreRankingItem } from '@/types/dashboard.types';

const thBase =
  'px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-[#F5A800] transition-colors whitespace-nowrap';

interface FilmPpfRankingTableProps {
  data: FilmPpfStoreRankingItem[];
}

export function FilmPpfRankingTable({ data }: FilmPpfRankingTableProps) {
  const { sorted, sortState, toggle } = useTableSort<FilmPpfStoreRankingItem>(data, 'revenue', 'desc');

  const totals = useMemo(
    () =>
      data.reduce(
        (acc, item) => ({
          services_count: acc.services_count + item.services_count,
          orders_count: acc.orders_count + item.orders_count,
          revenue: acc.revenue + item.revenue,
          loja_count: acc.loja_count + item.loja_count,
          galpon_count: acc.galpon_count + item.galpon_count,
        }),
        { services_count: 0, orders_count: 0, revenue: 0, loja_count: 0, galpon_count: 0 }
      ),
    [data]
  );

  return (
    <Card className="h-full overflow-hidden bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
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
                  <th className={`${thBase} text-left`} onClick={() => toggle('store_name')}>
                    Loja{getSortIndicator('store_name', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('services_count')}>
                    Serviços{getSortIndicator('services_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('orders_count')}>
                    Qtd O.S.{getSortIndicator('orders_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('revenue')}>
                    Valor{getSortIndicator('revenue', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('loja_count')}>
                    Em Loja{getSortIndicator('loja_count', sortState)}
                  </th>
                  <th className={`${thBase} text-right`} onClick={() => toggle('galpon_count')}>
                    Galpão{getSortIndicator('galpon_count', sortState)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr
                    key={item.store_id}
                    className="border-b border-gray-100 dark:border-[#1a1a1a] odd:bg-gray-50 dark:odd:bg-[#1a1a1a] transition-colors hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                      {item.store_name}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      {item.services_count.toLocaleString('pt-BR')}
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
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-[#2A2A2A] bg-gray-100/70 dark:bg-[#1E1E1E] font-semibold">
                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200">Total</td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {totals.services_count.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {totals.orders_count.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {formatCurrency(totals.revenue)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {totals.loja_count.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {totals.galpon_count.toLocaleString('pt-BR')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
