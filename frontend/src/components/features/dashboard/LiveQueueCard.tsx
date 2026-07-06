import { Clock, RefreshCw, Wrench, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { QueueSnapshotItem } from '@/types/dashboard.types';

interface CounterProps {
  icon: typeof Clock;
  label: string;
  value: number;
  danger?: boolean;
  success?: boolean;
}

function Counter({ icon: Icon, label, value, danger = false, success = false }: CounterProps) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          danger && value > 0 ? 'text-red-400' : success ? 'text-green-500' : 'text-gray-500'
        )}
      />
      <span
        className={cn(
          'text-lg font-bold leading-tight',
          danger && value > 0
            ? 'text-red-400'
            : success
              ? 'text-green-500 dark:text-green-400'
              : 'text-gray-700 dark:text-gray-200'
        )}
      >
        {value}
      </span>
      <span className="text-[10px] text-gray-600 leading-tight">{label}</span>
    </div>
  );
}

interface StoreQueueCardProps {
  item: QueueSnapshotItem;
}

function StoreQueueCard({ item }: StoreQueueCardProps) {
  const hasActivity =
    item.waiting > 0 || item.in_progress > 0 || item.overdue > 0 || item.completed > 0;

  return (
    <div
      className={cn(
        'bg-gray-50 dark:bg-[#1a1a1a] rounded-lg p-3 border',
        item.overdue > 0 ? 'border-red-900/50' : 'border-gray-200 dark:border-[#2a2a2a]'
      )}
    >
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate mb-3 border-b border-gray-200 dark:border-[#2a2a2a] pb-2">
        {item.store_name}
      </p>
      {hasActivity ? (
        <div className="grid grid-cols-4 gap-1">
          <Counter icon={Clock} label="Aguard." value={item.waiting} />
          <Counter icon={Wrench} label="Fazendo" value={item.in_progress} />
          <Counter icon={AlertTriangle} label="Atraso" value={item.overdue} danger />
          <Counter icon={CheckCircle} label="Concluído" value={item.completed} success />
        </div>
      ) : (
        <p className="text-xs text-gray-600 text-center py-2">Sem O.S. ativa</p>
      )}
    </div>
  );
}

interface LiveQueueCardProps {
  data: QueueSnapshotItem[];
}

export function LiveQueueCard({ data }: LiveQueueCardProps) {
  return (
    <Card className="bg-white dark:bg-[#161616] border-gray-200 dark:border-[#1E1E1E]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Fila em Tempo Real
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 text-gray-500 dark:text-gray-600 animate-pulse" />
            <span className="text-[10px] text-gray-500 dark:text-gray-600">Atualiza a cada 30s</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
            Nenhuma O.S. em andamento
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.map((item) => (
              <StoreQueueCard key={item.store_id} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
