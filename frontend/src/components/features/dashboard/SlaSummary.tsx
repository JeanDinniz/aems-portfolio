import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SLAMetrics } from '@/types/dashboard.types';

interface StatBlockProps {
  label: string;
  value: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

function StatBlock({ label, value, colorClass, bgClass, borderClass }: StatBlockProps) {
  return (
    <div className={`rounded-xl border px-5 py-4 flex flex-col gap-1 ${bgClass} ${borderClass}`}>
      <span className={`text-[11px] font-semibold uppercase tracking-wider ${colorClass} opacity-80`}>
        {label}
      </span>
      <span className={`text-3xl font-bold ${colorClass}`}>
        {value}
      </span>
    </div>
  );
}

interface SlaSummaryProps {
  data: SLAMetrics;
}

export function SlaSummary({ data }: SlaSummaryProps) {
  return (
    <Card className="h-full bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Retorno, Cortesia e Galpão
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StatBlock
          label="% Retorno"
          value={`${data.pct_return.toFixed(1)}%`}
          colorClass="text-orange-600 dark:text-orange-400"
          bgClass="bg-orange-50 dark:bg-orange-900/20"
          borderClass="border-orange-200 dark:border-orange-800/40"
        />
        <StatBlock
          label="% Cortesia"
          value={`${data.pct_courtesy.toFixed(1)}%`}
          colorClass="text-blue-600 dark:text-blue-400"
          bgClass="bg-blue-50 dark:bg-blue-900/20"
          borderClass="border-blue-200 dark:border-blue-800/40"
        />
        <StatBlock
          label="% Galpão"
          value={`${data.pct_galpon.toFixed(1)}%`}
          colorClass="text-purple-600 dark:text-purple-400"
          bgClass="bg-purple-50 dark:bg-purple-900/20"
          borderClass="border-purple-200 dark:border-purple-800/40"
        />
      </CardContent>
    </Card>
  );
}
