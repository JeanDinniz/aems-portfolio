import { TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { RevenueGoal } from '@/types/dashboard.types';

interface MetaGoalCardProps {
  goal?: RevenueGoal | null;
}

/**
 * Card "Meta de Faturamento" (Modelo B): faturamento do período, barra de
 * progresso até a próxima meta e quanto falta. Substitui o card O.S. Concluídas.
 * As metas = valor por funcionário × Nº de funcionários (sem instaladores).
 */
export function MetaGoalCard({ goal }: MetaGoalCardProps) {
  const hasEmployees = !!goal && goal.employee_count > 0;
  const progress = goal ? Math.min(100, Math.max(0, goal.progress_pct)) : 0;

  const leftTick =
    goal && goal.reached_tier > 0 ? `Meta ${goal.reached_tier} ✓` : 'Meta 1';
  const rightTick = goal?.next_tier ? `Meta ${goal.next_tier}` : 'Concluído';

  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              Meta de Faturamento
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight mt-1">
              {hasEmployees ? formatCurrency(goal!.revenue) : '—'}
            </p>
          </div>
          <div className="ml-3 flex-shrink-0 p-2 rounded-lg bg-gray-100 dark:bg-[#1E1E1E]">
            <TrendingUp className="h-5 w-5 text-[#F5A800]" />
          </div>
        </div>

        {hasEmployees ? (
          <>
            <div
              className="mt-3 h-2 w-full rounded-full bg-gray-200 dark:bg-[#2A2A2A] overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[#F5A800] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold text-gray-400 dark:text-zinc-500">
              <span>{leftTick}</span>
              <span>{Math.round(progress)}%</span>
              <span>{rightTick}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {goal!.next_target !== null && goal!.next_tier !== null ? (
                <>
                  Faltam{' '}
                  <span className="font-semibold text-[#B45309] dark:text-amber-400">
                    {formatCurrency(goal!.remaining ?? 0)}
                  </span>{' '}
                  para a Meta {goal!.next_tier} ({formatCurrency(goal!.next_target)})
                </>
              ) : (
                'Todas as metas do período foram batidas'
              )}
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            Sem funcionários no quadro para calcular a meta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
