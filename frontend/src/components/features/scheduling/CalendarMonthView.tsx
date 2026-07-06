import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS, DEPARTMENT_BADGE_COLORS } from '@/constants/scheduling'
import type { Appointment } from '@/types/scheduling.types'

interface CalendarMonthViewProps {
  appointments: Appointment[]
  currentDate: Date
  onNavigate: (d: Date) => void
  onDayClick: (d: Date) => void
  onCardClick: (appt: Appointment) => void
}

const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

const MAX_CARDS_PER_DAY = 3

export function CalendarMonthView({
  appointments,
  currentDate,
  onNavigate,
  onDayClick,
  onCardClick,
}: CalendarMonthViewProps) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const today = getTodayString()

  // Build map of delivery_date → appointments
  const apptsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appt of appointments) {
      const key = appt.delivery_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(appt)
    }
    return map
  }, [appointments])

  // Calendar grid: find first weekday of month
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  // Build 6x7 grid
  const cells: Array<{ day: number; currentMonth: boolean; dateStr: string }> = []
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const prevMonth = month === 0 ? 11 : month - 1
    const prevYear = month === 0 ? year - 1 : year
    cells.push({ day: d, currentMonth: false, dateStr: toDateString(prevYear, prevMonth, d) })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, currentMonth: true, dateStr: toDateString(year, month, d) })
  }
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 0 : month + 1
    const nextYear = month === 11 ? year + 1 : year
    cells.push({ day: d, currentMonth: false, dateStr: toDateString(nextYear, nextMonth, d) })
  }

  const prevMonth = () => onNavigate(new Date(year, month - 1, 1))
  const nextMonth = () => onNavigate(new Date(year, month + 1, 1))
  const goToday = () => onNavigate(new Date())

  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {MONTH_NAMES[month]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Mês anterior" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} className="h-7 px-2 text-xs">
            Hoje
          </Button>
          <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Próximo mês" className="h-7 w-7">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b dark:border-zinc-700">
        {WEEKDAY_HEADERS.map((h, i) => (
          <div
            key={i}
            className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
          >
            {h}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          const isToday = cell.dateStr === today
          const dayAppts = apptsByDate.get(cell.dateStr) ?? []
          const visible = dayAppts.slice(0, MAX_CARDS_PER_DAY)
          const overflow = dayAppts.length - visible.length

          return (
            <div
              key={idx}
              className={cn(
                'relative min-h-[80px] p-1 text-left border-b border-r dark:border-zinc-700/50',
                !cell.currentMonth && 'opacity-30',
                isToday && 'bg-amber-50 dark:bg-amber-900/20',
                !isToday && 'bg-white dark:bg-zinc-900'
              )}
            >
              {/* Day number */}
              <button
                type="button"
                onClick={() => {
                  if (cell.currentMonth) {
                    const [y, m, d] = cell.dateStr.split('-').map(Number)
                    onDayClick(new Date(y, m - 1, d))
                  }
                }}
                disabled={!cell.currentMonth}
                className={cn(
                  'inline-flex items-center justify-center text-xs font-medium w-5 h-5 rounded-full mb-0.5',
                  isToday
                    ? 'bg-amber-400 text-white font-bold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700'
                )}
              >
                {cell.day}
              </button>

              {/* Mini cards */}
              <div className="flex flex-col gap-0.5">
                {visible.map((appt) => {
                  const config = APPOINTMENT_STATUS_CONFIG[appt.display_status]
                  return (
                    <button
                      key={appt.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCardClick(appt)
                      }}
                      className={cn(
                        'w-full text-left rounded border-l-2 px-1 py-0.5 transition-opacity hover:opacity-80',
                        config.bgCard
                      )}
                      style={{ borderLeftColor: config.color }}
                    >
                      <div className="flex items-center gap-0.5 flex-wrap">
                        <span className="text-[9px] font-semibold text-gray-800 dark:text-gray-200 truncate max-w-[60px]">
                          {appt.vehicle_model ?? 'Veículo'}
                        </span>
                        <span className={cn(
                          'text-[8px] font-medium px-0.5 rounded',
                          DEPARTMENT_BADGE_COLORS[appt.department]
                        )}>
                          {DEPARTMENT_LABELS[appt.department] ?? appt.department}
                        </span>
                      </div>
                      <p className="text-[8px] font-mono text-gray-500 dark:text-gray-400 truncate">
                        {appt.vehicle_plate}
                      </p>
                    </button>
                  )
                })}
                {overflow > 0 && (
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 pl-1">
                    +{overflow} mais
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
