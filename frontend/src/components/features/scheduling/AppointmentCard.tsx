import { Link2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS, DEPARTMENT_BADGE_COLORS } from '@/constants/scheduling'
import { useStoreStore } from '@/stores/store.store'
import { prefetchOrderEditData } from '@/lib/prefetch-order-edit'
import type { Appointment, FilmEntryItem } from '@/types/scheduling.types'

interface AppointmentCardProps {
  appointment: Appointment
  onClick: () => void
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

// Reproduz o label dos serviços exatamente como o backend monta em service_names
// (app/modules/scheduling/service.py :: _label → "CODE - Nome"), para o chip de
// película bater com o texto já usado hoje.
function filmEntryLabel(fe: FilmEntryItem): string {
  const name = fe.service_name ?? `Serviço #${fe.service_id}`
  return fe.service_code ? `${fe.service_code} - ${name}` : name
}

export function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  const config = APPOINTMENT_STATUS_CONFIG[appointment.display_status]
  const isCancelled = appointment.display_status === 'cancelado'
  const departmentLabel = DEPARTMENT_LABELS[appointment.department] ?? appointment.department
  const departmentBadge = DEPARTMENT_BADGE_COLORS[appointment.department] ?? 'bg-gray-100 text-gray-800'

  const queryClient = useQueryClient()
  const availableStores = useStoreStore((s) => s.availableStores)

  // Prefetch por intenção: hover/foco/pointerdown do card, antes do clique
  // que abre a drawer de detalhe (e, dali, o AppointmentForm de edição) —
  // esquenta consultores/modelos/[película] para o form abrir sem pop-in.
  // detailQuery:'none' — o id aqui é do AGENDAMENTO, não de uma O.S.
  const handlePrefetch = () => {
    const brandId = availableStores.find((s) => s.id === appointment.store_id)?.brand_id
    prefetchOrderEditData(
      queryClient,
      { id: appointment.id, storeId: appointment.store_id, department: appointment.department },
      { brandId, detailQuery: 'none' }
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onPointerDown={handlePrefetch}
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
          {/* Só destaca o CASO ESPECIAL "em execução, porém atrasado": a O.S. já está
              sendo trabalhada (borda verde) mas a data de entrega venceu. Status simples
              (Agendado, Duplicidade, etc.) ficam só pela cor da borda — sem selo escrito,
              p/ não poluir o card. */}
          {appointment.display_status === 'em_execucao' && appointment.is_overdue && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              Atrasado
            </span>
          )}
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
          {appointment.appointment_group_id && (
            <span
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              title="Agendamento combinado"
            >
              <Link2 className="h-2.5 w-2.5" />
              {(appointment.group_siblings?.length ?? 0) > 0
                ? `+${appointment.group_siblings!.length} depto`
                : null}
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

        {/* Services — película mostra a tonalidade num badge ao lado de cada serviço.
            film_entries (quando presente) traz tonality por serviço; serviços sem
            tonalidade e departamentos sem película caem no render simples por nome. */}
        {(() => {
          const filmEntries = appointment.film_entries ?? []
          if (filmEntries.length > 0) {
            const filmLabels = new Set(filmEntries.map(filmEntryLabel))
            // Serviços não-película do mesmo agendamento (raro) seguem sem badge.
            const otherNames = appointment.service_names.filter((n) => !filmLabels.has(n))
            return (
              <div className="flex flex-wrap gap-1.5">
                {filmEntries.map((fe) => (
                  <span key={fe.service_id} className="inline-flex items-center gap-1">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-zinc-700 dark:text-gray-300">
                      {filmEntryLabel(fe)}
                    </span>
                    {fe.tonality && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        {fe.tonality}
                      </span>
                    )}
                  </span>
                ))}
                {otherNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-zinc-700 dark:text-gray-300"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )
          }
          if (appointment.service_names.length > 0) {
            return (
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
            )
          }
          return null
        })()}

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
