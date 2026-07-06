import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { SchedulingStoreSummary, AppointmentDisplayStatus } from '@/types/scheduling.types'

const PROGRESS_COLOR = '[&>[data-radix-progress-indicator]]:bg-amber-500'

export interface SchedulingSummaryCardsProps {
  summary: SchedulingStoreSummary[]
  isLoading: boolean
  onFilterClick?: (storeId: number, filterType: AppointmentDisplayStatus | 'all') => void
}

export function SchedulingSummaryCards({ summary, isLoading, onFilterClick }: SchedulingSummaryCardsProps) {
  const [expanded, setExpanded] = useState(false)

  if (!isLoading && (!summary || summary.length === 0)) return null

  return (
    <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
      >
        <span className="text-sm font-semibold text-[#111111] dark:text-white">Resumo por Loja</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-[#666666] dark:text-zinc-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[#666666] dark:text-zinc-400" />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-[#E8E8E8] dark:border-[#333333] p-4">
          {isLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex-1 min-w-[200px] max-w-[260px] shrink-0 bg-[#FAFAFA] dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#333333] rounded-xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-24 rounded" />
                    <Skeleton className="h-4 w-8 rounded" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {summary.map((item) => {
                const pct = item.total > 0 ? Math.round((item.finalizado / item.total) * 100) : 0

                return (
                  <div
                    key={item.store_id}
                    className="flex-1 min-w-[200px] max-w-[260px] shrink-0 bg-[#FAFAFA] dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#333333] rounded-xl p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300 truncate max-w-[160px]">
                        {item.store_name}
                      </span>
                      <span className="text-xs font-bold text-[#111111] dark:text-white tabular-nums shrink-0">
                        {pct}%
                      </span>
                    </div>

                    <Progress
                      value={pct}
                      className={`h-2 bg-[#E8E8E8] dark:bg-[#3A3A3A] rounded-full ${PROGRESS_COLOR}`}
                    />

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {item.atrasado > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'atrasado')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-red-500 dark:text-red-400">{item.atrasado}</span> atrasado{item.atrasado !== 1 ? 's' : ''}
                          </span>
                        </button>
                      )}
                      {item.atencao > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'atencao')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-amber-500 dark:text-amber-400">{item.atencao}</span> atenção
                          </span>
                        </button>
                      )}
                      {item.agendado > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'agendado')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-blue-500 dark:text-blue-400">{item.agendado}</span> agendado{item.agendado !== 1 ? 's' : ''}
                          </span>
                        </button>
                      )}
                      {item.em_execucao > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'em_execucao')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-purple-500 dark:text-purple-400">{item.em_execucao}</span> em execução
                          </span>
                        </button>
                      )}
                      {item.finalizado > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'finalizado')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-green-600 dark:text-green-400">{item.finalizado}</span> finalizado{item.finalizado !== 1 ? 's' : ''}
                          </span>
                        </button>
                      )}
                      {item.cancelado > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterClick?.(item.store_id, 'cancelado')}
                          className="flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />
                          <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-zinc-500 dark:text-zinc-400">{item.cancelado}</span> cancelado{item.cancelado !== 1 ? 's' : ''}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onFilterClick?.(item.store_id, 'all')}
                        className="flex items-center gap-1.5 cursor-pointer hover:underline text-left col-span-2"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#D1D1D1] dark:bg-zinc-600 shrink-0" />
                        <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                          <span className="font-semibold text-[#111111] dark:text-white">{item.total}</span> total
                        </span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-[#E8E8E8] dark:border-[#333333]">
          {isLoading ? (
            <div className="px-4 py-3 flex gap-4 overflow-x-auto">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5 w-40 rounded shrink-0" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3">
              {summary.map((item) => (
                <button
                  key={item.store_id}
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300">
                    {item.store_name}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-zinc-400">
                    {item.atrasado > 0 && (
                      <>
                        <span className="font-semibold text-red-500 dark:text-red-400">{item.atrasado}</span>
                        <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                      </>
                    )}
                    <span className="font-semibold text-green-600 dark:text-green-400">{item.finalizado}</span>
                    <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                    <span className="font-semibold text-[#111111] dark:text-white">{item.total}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
