import { useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { AppointmentCard } from './AppointmentCard'
import { STATUS_PRIORITY } from '@/constants/scheduling'
import { cn } from '@/lib/utils'
import type { Appointment, AppointmentDisplayStatus } from '@/types/scheduling.types'

interface AppointmentListViewProps {
  appointments: Appointment[]
  onCardClick: (appt: Appointment) => void
  // Controlado pelo pai: os terminais (finalizados/cancelados) são carregados sob demanda
  // do servidor (include_terminal), para não truncar os agendamentos ativos na paginação.
  showTerminal: boolean
  onToggleTerminal: () => void
  // Oculta o botão de toggle quando os terminais já são exibidos incondicionalmente
  // (ex.: durante uma busca por placa/O.S., em que o toggle seria inócuo).
  hideToggle?: boolean
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

function getTomorrowString(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function formatDateLabel(dateStr: string): string {
  const today = getTodayString()
  const tomorrow = getTomorrowString()
  if (dateStr === today) return 'Hoje'
  if (dateStr === tomorrow) return 'Amanhã'
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function isLateDate(dateStr: string): boolean {
  return dateStr < getTodayString()
}

function sortByStatus(a: Appointment, b: Appointment): number {
  return (
    STATUS_PRIORITY[a.display_status] - STATUS_PRIORITY[b.display_status]
  )
}

const TERMINAL_STATUSES: AppointmentDisplayStatus[] = ['finalizado', 'cancelado']

export function AppointmentListView({
  appointments,
  onCardClick,
  showTerminal,
  onToggleTerminal,
  hideToggle = false,
}: AppointmentListViewProps) {
  // Group by delivery_date
  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appt of appointments) {
      const key = appt.delivery_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(appt)
    }
    // Sort dates
    const sortedDates = Array.from(map.keys()).sort()
    return sortedDates.map((date) => ({
      date,
      items: map.get(date)!.sort(sortByStatus),
    }))
  }, [appointments])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">Nenhum agendamento encontrado.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(({ date, items }) => {
        const activeItems = items.filter(
          (a) => !TERMINAL_STATUSES.includes(a.display_status)
        )
        const terminalItems = items.filter((a) =>
          TERMINAL_STATUSES.includes(a.display_status)
        )
        const label = formatDateLabel(date)
        const isLate = isLateDate(date) && date !== getTodayString()
        const visibleItems = showTerminal ? items : activeItems

        if (!showTerminal && activeItems.length === 0) return null

        return (
          <div key={date}>
            <div className="flex items-center justify-between mb-2">
              <h3
                className={cn(
                  'text-sm font-semibold',
                  isLate
                    ? 'text-red-600 dark:text-red-400'
                    : label === 'Hoje'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-700 dark:text-gray-300'
                )}
              >
                {label}
                {isLate && (
                  <span className="ml-1.5 text-xs font-normal text-red-400">(atrasado)</span>
                )}
              </h3>
              <span className="text-xs text-muted-foreground">
                {visibleItems.length} veiculo{visibleItems.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleItems.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appointment={appt}
                  onClick={() => onCardClick(appt)}
                />
              ))}
            </div>

            {terminalItems.length > 0 && !showTerminal && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                +{terminalItems.length} finalizado
                {terminalItems.length > 1 ? 's/cancelados' : '/cancelado'} oculto
                {terminalItems.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
        )
      })}

      {!hideToggle && (
      <button
        type="button"
        onClick={onToggleTerminal}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {showTerminal ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            Ocultar finalizados/cancelados
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            Mostrar finalizados/cancelados
          </>
        )}
      </button>
      )}
    </div>
  )
}
