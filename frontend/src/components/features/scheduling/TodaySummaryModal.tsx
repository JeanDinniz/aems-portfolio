import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { getLocalDateISO } from '@/utils/date'
import { APPOINTMENT_STATUS_CONFIG } from '@/constants/scheduling'
import type { TodaySummary, AppointmentDisplayStatus } from '@/types/scheduling.types'

interface TodaySummaryModalProps {
  open: boolean
  onClose: () => void
  onViewAll: () => void
  summary: TodaySummary
}

const STATUS_ORDER: AppointmentDisplayStatus[] = [
  'atrasado',
  'atencao',
  'agendado',
  'em_execucao',
  'duplicidade',
  'finalizado',
  'cancelado',
]

export function TodaySummaryModal({
  open,
  onClose,
  onViewAll,
  summary,
}: TodaySummaryModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleClose = () => {
    if (dontShowAgain) {
      const today = getLocalDateISO()
      localStorage.setItem(`scheduling_summary_shown_${today}`, 'true')
    }
    onClose()
  }

  const handleViewAll = () => {
    if (dontShowAgain) {
      const today = getLocalDateISO()
      localStorage.setItem(`scheduling_summary_shown_${today}`, 'true')
    }
    onViewAll()
    onClose()
  }

  const total =
    summary.atrasado +
    summary.atencao +
    summary.agendado +
    summary.em_execucao +
    summary.duplicidade

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Resumo de Hoje
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <p className="text-sm text-muted-foreground mb-3">
            {total === 0
              ? 'Nenhum agendamento pendente para hoje.'
              : `${total} agendamento${total > 1 ? 's' : ''} pendente${total > 1 ? 's' : ''} para hoje`}
          </p>

          {STATUS_ORDER.map((status) => {
            const count = summary[status]
            if (count === 0) return null
            const config = APPOINTMENT_STATUS_CONFIG[status]
            return (
              <div
                key={status}
                className="flex items-center justify-between rounded-lg border px-3 py-2 bg-gray-50 dark:bg-zinc-800/50"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', config.bgDot)}
                  />
                  <span className="text-sm font-medium">{config.label}</span>
                </div>
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{ color: config.color }}
                >
                  {count}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="dont-show-today"
            checked={dontShowAgain}
            onCheckedChange={(v) => setDontShowAgain(Boolean(v))}
          />
          <label
            htmlFor="dont-show-today"
            className="text-xs text-muted-foreground cursor-pointer select-none"
          >
            Não mostrar novamente hoje
          </label>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Fechar
          </Button>
          <Button
            size="sm"
            onClick={handleViewAll}
            style={{ backgroundColor: '#F5A800', color: '#000' }}
            className="hover:opacity-90"
          >
            Ver tudo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
