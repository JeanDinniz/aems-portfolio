import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS, DEPARTMENT_BADGE_COLORS } from '@/constants/scheduling'
import type { Appointment } from '@/types/scheduling.types'

interface CalendarWeekViewProps {
  appointments: Appointment[]
  currentDate: Date
  onNavigate: (d: Date) => void
  onCardClick: (appt: Appointment) => void
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function getWeekStart(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day
  const start = new Date(d)
  start.setDate(diff)
  start.setHours(0, 0, 0, 0)
  return start
}

function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatShortDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

export function CalendarWeekView({
  appointments,
  currentDate,
  onNavigate,
  onCardClick,
}: CalendarWeekViewProps) {
  const weekStart = getWeekStart(currentDate)
  const today = getTodayString()

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    })
  }, [weekStart])

  const apptsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appt of appointments) {
      const key = appt.delivery_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(appt)
    }
    return map
  }, [appointments])

  const weekEndDate = weekDays[6]
  const headerLabel = `Semana de ${formatShortDate(weekStart)} a ${formatShortDate(weekEndDate)}`

  const prevWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    onNavigate(d)
  }

  const nextWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    onNavigate(d)
  }

  const goToday = () => onNavigate(new Date())

  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{headerLabel}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={prevWeek} aria-label="Semana anterior" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} className="h-7 px-2 text-xs">
            Hoje
          </Button>
          <Button variant="ghost" size="icon" onClick={nextWeek} aria-label="Próxima semana" className="h-7 w-7">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Week grid */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[560px]">
          {weekDays.map((day, idx) => {
            const dateStr = toDateString(day)
            const isToday = dateStr === today
            const dayAppts = apptsByDate.get(dateStr) ?? []

            return (
              <div
                key={idx}
                className="border-r dark:border-zinc-700 last:border-r-0 min-h-[180px] flex flex-col"
              >
                {/* Day header */}
                <div
                  className={cn(
                    'px-2 py-2 text-center border-b dark:border-zinc-700',
                    isToday
                      ? 'bg-amber-50 dark:bg-amber-900/20'
                      : 'bg-gray-50 dark:bg-zinc-800/50'
                  )}
                >
                  <p
                    className={cn(
                      'text-[10px] font-medium',
                      isToday ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {WEEKDAY_NAMES[idx]}
                  </p>
                  <p
                    className={cn(
                      'text-lg font-bold leading-tight',
                      isToday ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                    )}
                  >
                    {day.getDate()}
                  </p>
                  <p
                    className={cn(
                      'text-[10px]',
                      isToday ? 'text-amber-500 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'
                    )}
                  >
                    {dayAppts.length} veículo{dayAppts.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Appointments */}
                <div className="flex flex-col gap-1 p-1.5 flex-1">
                  {dayAppts.length === 0 ? (
                    <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center mt-2">—</p>
                  ) : (
                    dayAppts.map((appt) => {
                      const config = APPOINTMENT_STATUS_CONFIG[appt.display_status]
                      const deptLabel = DEPARTMENT_LABELS[appt.department] ?? appt.department
                      const deptColors = DEPARTMENT_BADGE_COLORS[appt.department] ?? ''
                      const [, dlvMonth, dlvDay] = appt.delivery_date.split('-')
                      const shortDate = `${dlvDay}/${dlvMonth}`

                      return (
                        <button
                          key={appt.id}
                          type="button"
                          onClick={() => onCardClick(appt)}
                          className={cn(
                            'w-full text-left rounded border-l-2 px-1.5 py-1 text-[10px] transition-opacity hover:opacity-80',
                            config.bgCard
                          )}
                          style={{ borderLeftColor: config.color }}
                        >
                          {/* Model + dept badge */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                              {appt.vehicle_model ?? 'Veículo'}
                            </span>
                            <span className={cn('text-[9px] font-medium px-1 py-0.5 rounded', deptColors)}>
                              {deptLabel}
                            </span>
                          </div>
                          {/* Plate */}
                          <p className="font-mono text-gray-500 dark:text-gray-400">
                            {appt.vehicle_plate}
                          </p>
                          {/* Store + date */}
                          <p className="text-gray-400 dark:text-gray-500 truncate">
                            {appt.store_name ?? '—'} • {shortDate}
                          </p>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
