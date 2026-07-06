import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS, DEPARTMENT_BADGE_COLORS } from '@/constants/scheduling'
import type { Appointment } from '@/types/scheduling.types'

interface AppointmentCardProps {
  appointment: Appointment
  onClick: () => void
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

export function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  const config = APPOINTMENT_STATUS_CONFIG[appointment.display_status]
  const isCancelled = appointment.display_status === 'cancelado'
  const departmentLabel = DEPARTMENT_LABELS[appointment.department] ?? appointment.department
  const departmentBadge = DEPARTMENT_BADGE_COLORS[appointment.department] ?? 'bg-gray-100 text-gray-800'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border bg-white dark:bg-zinc-900 dark:border-zinc-700',
        'border-l-4 transition-all duration-150 hover:shadow-md hover:border-l-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-amber-400',
        config.borderColor,
        isCancelled && 'opacity-50'
      )}
      style={
        isCancelled
          ? {
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.03) 6px, rgba(0,0,0,0.03) 12px)',
            }
          : undefined
      }
    >
      <div className="px-3 py-2.5 space-y-1">
        {/* Top row: model + badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px]">
            {appointment.vehicle_model ?? 'Veiculo'}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
              departmentBadge
            )}
          >
            {departmentLabel}
          </span>
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-zinc-700 dark:text-gray-300 truncate max-w-[100px]">
            {appointment.store_name}
          </span>
          {appointment.is_galpon && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
              Galpão
            </span>
          )}
          {appointment.is_return && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Retorno
            </span>
          )}
        </div>

        {/* Plate */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-bold tracking-wider text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-zinc-700 rounded px-1.5 py-0.5">
            {appointment.vehicle_plate}
          </span>
          {appointment.vehicle_color && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {appointment.vehicle_color}
            </span>
          )}
        </div>

        {/* Services */}
        {appointment.service_names.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {appointment.service_names.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-zinc-700 dark:text-gray-300"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Footer: consultant + delivery date */}
        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span className="truncate">
            {appointment.consultant_name ?? 'Sem consultor'}
          </span>
          <span className="flex-shrink-0 ml-2 font-medium" style={{ color: config.color }}>
            {appointment.delivery_time
              ? `${appointment.delivery_time} — ${formatDate(appointment.delivery_date)}`
              : formatDate(appointment.delivery_date)
            }
          </span>
        </div>
      </div>
    </button>
  )
}
