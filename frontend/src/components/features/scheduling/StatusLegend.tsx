import { APPOINTMENT_STATUS_CONFIG } from '@/constants/scheduling'
import { cn } from '@/lib/utils'
import type { AppointmentDisplayStatus } from '@/types/scheduling.types'

const ALL_STATUSES: AppointmentDisplayStatus[] = [
  'atrasado',
  'atencao',
  'agendado',
  'em_execucao',
  'duplicidade',
  'finalizado',
  'cancelado',
]

interface StatusLegendProps {
  selectedStatuses?: AppointmentDisplayStatus[]
  onStatusClick?: (status: AppointmentDisplayStatus) => void
}

export function StatusLegend({ selectedStatuses = [], onStatusClick }: StatusLegendProps) {
  const isInteractive = !!onStatusClick
  const hasSelection = selectedStatuses.length > 0

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {ALL_STATUSES.map((status) => {
        const config = APPOINTMENT_STATUS_CONFIG[status]
        const isSelected = selectedStatuses.includes(status)
        const isSecondary = status === 'finalizado' || status === 'cancelado' || status === 'duplicidade'
        const isDimmed = !isSelected && isSecondary && !hasSelection

        if (isInteractive) {
          return (
            <button
              key={status}
              type="button"
              onClick={() => onStatusClick(status)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all',
                isSelected
                  ? 'bg-gray-100 dark:bg-zinc-800 font-medium'
                  : 'hover:bg-gray-100 dark:hover:bg-zinc-800',
                isDimmed && 'opacity-50',
              )}
              style={isSelected ? { outline: `2px solid ${config.color}`, outlineOffset: '2px' } : undefined}
              aria-pressed={isSelected}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', config.bgDot)} />
              <span className={cn(
                isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
              )}>
                {config.label}
              </span>
            </button>
          )
        }

        return (
          <div key={status} className={cn('flex items-center gap-1.5', isDimmed && 'opacity-60')}>
            <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', config.bgDot)} />
            <span className="text-gray-700 dark:text-gray-300">{config.label}</span>
          </div>
        )
      })}
    </div>
  )
}
