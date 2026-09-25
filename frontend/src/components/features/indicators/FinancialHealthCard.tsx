import { memo } from 'react';
import { ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { FinancialHealth } from '@/types/indicators.types';

interface FinancialHealthCardProps {
  data: FinancialHealth | undefined;
}

interface PipelineStep {
  label: string;
  value: number;
  barClassName: string;
  textClassName: string;
}

export const FinancialHealthCard = memo(function FinancialHealthCard({ data }: FinancialHealthCardProps) {
  if (!data) {
    return (
      <Card className="h-full flex flex-col bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Saúde Financeira
          </CardTitle>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Transformação do estoque em receita
          </p>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          <div className="flex items-center justify-center flex-1 text-gray-500 text-sm">
            Sem dados para o período
          </div>
        </CardContent>
      </Card>
    );
  }

  const steps: PipelineStep[] = [
    {
      label: 'Valor Estoque',
      value: data.stock_value,
      barClassName: 'bg-[#F5A800]',
      textClassName: 'text-[#F5A800]',
    },
    {
      label: 'Custo Consumido',
      value: data.cost_consumed,
      barClassName: 'bg-red-500',
      textClassName: 'text-red-600 dark:text-red-400',
    },
    {
      label: 'Faturamento',
      value: data.revenue,
      barClassName: 'bg-green-500',
      textClassName: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Margem',
      value: data.margin,
      barClassName: 'bg-green-800',
      textClassName: 'text-green-800 dark:text-green-300',
    },
  ];

  const maxValue = Math.max(...steps.map((s) => Math.abs(s.value)), 1);

  return (
    <Card className="h-full flex flex-col bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Saúde Financeira
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Transformação do estoque em receita
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        <div className="space-y-1">
          {steps.map((step, index) => {
            const widthPct = Math.max(4, (Math.abs(step.value) / maxValue) * 100);
            return (
              <div key={step.label}>
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-28 flex-shrink-0">
                    {step.label}
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-[#1E1E1E] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${step.barClassName}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold w-28 text-right flex-shrink-0 ${step.textClassName}`}>
                    {formatCurrency(step.value)}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowDown className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-3 flex justify-center">
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
            ROI Médio {data.roi !== null ? `${data.roi.toFixed(2)}×` : '—'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
