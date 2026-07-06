import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatCurrency } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  delta: number | null;
  deltaValue?: number | null;
  badgeText?: string;
  subLabel?: string;
}

function DeltaBadge({
  delta,
  deltaValue,
  badgeText,
}: {
  delta: number | null;
  deltaValue?: number | null;
  badgeText?: string;
}) {
  if (badgeText !== undefined) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
        {badgeText}
      </span>
    );
  }

  if (deltaValue !== undefined && deltaValue !== null) {
    const isPositive = deltaValue > 0;
    const isNegative = deltaValue < 0;
    return (
      <span
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
          isPositive && 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
          isNegative && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
          !isPositive && !isNegative && 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
        )}
      >
        {isPositive ? '+' : ''}{formatCurrency(deltaValue)}
      </span>
    );
  }

  if (delta === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        —
      </span>
    );
  }

  const isPositive = delta > 0;
  const isNegative = delta < 0;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        isPositive && 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
        isNegative && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
        !isPositive && !isNegative && 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
      )}
    >
      {isPositive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

export function KpiCard({ label, value, icon: Icon, delta, deltaValue, badgeText, subLabel }: KpiCardProps) {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              {label}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">
              {value}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <DeltaBadge delta={delta} deltaValue={deltaValue} badgeText={badgeText} />
              {subLabel && (
                <span className="text-xs text-gray-500">{subLabel}</span>
              )}
            </div>
          </div>
          <div className="ml-3 flex-shrink-0 p-2 rounded-lg bg-gray-100 dark:bg-[#1E1E1E]">
            <Icon className="h-5 w-5 text-[#F5A800]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
