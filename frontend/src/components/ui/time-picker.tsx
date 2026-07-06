import { useState } from 'react'
import { Clock } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface TimePickerProps {
  value?: string | null
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  className?: string
  placeholder?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function parseTime(value: string | null | undefined): { hour: string | null; minute: string | null } {
  if (!value || !value.includes(':')) return { hour: null, minute: null }
  const [h, m] = value.split(':')
  const hour = HOURS.includes(h) ? h : null
  const minute = MINUTES.includes(m) ? m : null
  return { hour, minute }
}

export function TimePicker({
  value,
  onChange,
  id,
  disabled = false,
  className,
  placeholder = 'HH:MM',
}: TimePickerProps) {
  const [open, setOpen] = useState(false)

  const { hour: selectedHour, minute: selectedMinute } = parseTime(value)

  const handleHourClick = (hour: string) => {
    const minute = selectedMinute ?? '00'
    onChange(`${hour}:${minute}`)
  }

  const handleMinuteClick = (minute: string) => {
    const hour = selectedHour ?? '00'
    const newValue = `${hour}:${minute}`
    onChange(newValue)
    // Close popover only when minute is explicitly chosen (both parts are now defined)
    setOpen(false)
  }

  const displayValue = value && value.includes(':') ? value : null

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            // Mirror Input styles exactly
            'flex h-10 w-full items-center justify-between rounded-md border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] px-3 py-2 text-sm text-[#111111] dark:text-white',
            'focus-visible:outline-none focus-visible:border-[#F5A800] focus-visible:ring-4 focus-visible:ring-[rgba(245,168,0,0.15)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !displayValue && 'text-[#999999] dark:text-zinc-500',
            className
          )}
        >
          <span>{displayValue ?? placeholder}</span>
          <Clock className="h-4 w-4 opacity-50 flex-shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-auto p-2"
      >
        <div className="flex gap-2">
          {/* Hours column */}
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground font-medium text-center pb-1 px-1">
              Hora
            </span>
            <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={h === selectedHour}
                  onClick={() => handleHourClick(h)}
                  className={cn(
                    'w-10 rounded-md py-1.5 text-sm font-medium text-center transition-colors',
                    h === selectedHour
                      ? 'bg-[#F5A800] text-black'
                      : 'hover:bg-muted text-[#111111] dark:text-white'
                  )}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="w-px bg-border self-stretch" />

          {/* Minutes column */}
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground font-medium text-center pb-1 px-1">
              Min
            </span>
            <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={m === selectedMinute}
                  onClick={() => handleMinuteClick(m)}
                  className={cn(
                    'w-10 rounded-md py-1.5 text-sm font-medium text-center transition-colors',
                    m === selectedMinute
                      ? 'bg-[#F5A800] text-black'
                      : 'hover:bg-muted text-[#111111] dark:text-white'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
