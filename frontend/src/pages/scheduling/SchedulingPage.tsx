import { useState, useMemo } from 'react'
import { Plus, CalendarDays, List, Calendar, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertBanner } from '@/components/features/scheduling/AlertBanner'
import { StatusLegend } from '@/components/features/scheduling/StatusLegend'
import { TodaySummaryModal } from '@/components/features/scheduling/TodaySummaryModal'
import { AppointmentListView } from '@/components/features/scheduling/AppointmentListView'
import { CalendarMonthView } from '@/components/features/scheduling/CalendarMonthView'
import { CalendarWeekView } from '@/components/features/scheduling/CalendarWeekView'
import { SchedulingFilters } from '@/components/features/scheduling/SchedulingFilters'
import { AppointmentDetailDrawer } from '@/components/features/scheduling/AppointmentDetailDrawer'
import { AppointmentForm } from '@/components/features/scheduling/AppointmentForm'
import { SchedulingSummaryCards } from '@/components/features/scheduling/SchedulingSummaryCards'
import { useAppointments, useTodaySummary, useSchedulingStoreSummary, useCancelAppointment } from '@/hooks/useScheduling'
import { useCanEdit, useCanDelete } from '@/hooks/useMyPermissions'
import { useStoreStore } from '@/stores/store.store'
import { useStores } from '@/hooks/useStores'
import { cn } from '@/lib/utils'
import type { Appointment, AppointmentDisplayStatus, AppointmentFilters } from '@/types/scheduling.types'

type ViewMode = 'lista' | 'semana' | 'mes'

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0]
}

function shouldShowSummaryModal(): boolean {
  const key = `scheduling_summary_shown_${getTodayKey()}`
  return localStorage.getItem(key) !== 'true'
}

export default function SchedulingPage() {
  const { selectedStoreId } = useStoreStore()

  const [view, setView] = useState<ViewMode>('lista')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [filters, setFilters] = useState<AppointmentFilters>({})
  const [statusFilter, setStatusFilter] = useState<AppointmentDisplayStatus | null>(null)
  const [page] = useState(1)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [showSummaryModal, setShowSummaryModal] = useState(() => shouldShowSummaryModal())
  const [cancelConfirmAppointment, setCancelConfirmAppointment] = useState<Appointment | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)

  // Build effective filters
  const effectiveFilters = useMemo<AppointmentFilters>(() => {
    const f = { ...filters }
    if (statusFilter === 'cancelado') f.include_cancelled = true
    // Terminais (finalizados/cancelados) só são buscados quando o usuário pede — evita
    // truncar os agendamentos ativos pela paginação.
    if (showTerminal || statusFilter === 'finalizado' || statusFilter === 'cancelado') {
      f.include_terminal = true
    }
    return f
  }, [filters, statusFilter, showTerminal])

  // Queries
  const { data: appointmentsData, isLoading: apptLoading } = useAppointments(
    effectiveFilters,
    page,
    200
  )
  const { data: summary } = useTodaySummary(selectedStoreId)
  const { data: storeSummary, isLoading: storeSummaryLoading } = useSchedulingStoreSummary({
    date_from: effectiveFilters.date_from,
    date_to: effectiveFilters.date_to,
    department: effectiveFilters.department,
  })

  const { stores: allStores } = useStores()

  const cancelMutation = useCancelAppointment()

  const canEditScheduling = useCanEdit('scheduling')
  const canCancelScheduling = useCanDelete('scheduling')
  const canGenerateOS = useCanEdit('scheduling_os')

  const allAppointments = appointmentsData?.items ?? []
  const appointments = statusFilter
    ? allAppointments.filter((a) => a.display_status === statusFilter)
    : allAppointments
  const totalCount = appointmentsData?.pagination.total ?? 0

  const safeSummary = summary ?? {
    atrasado: 0,
    atencao: 0,
    agendado: 0,
    em_execucao: 0,
    finalizado: 0,
    cancelado: 0,
  }

  // Handlers
  const handleCloseSummaryModal = () => {
    setShowSummaryModal(false)
  }

  const handleViewAllFromSummary = () => {
    setFilters({})
    setStatusFilter(null)
    setView('lista')
    setShowSummaryModal(false)
  }

  const handleStatusClick = (status: AppointmentDisplayStatus) => {
    setStatusFilter((prev) => (prev === status ? null : status))
  }

  const hasActiveStatusOrFilters =
    statusFilter !== null ||
    !!filters.search ||
    !!filters.store_id ||
    !!filters.department ||
    !!filters.service_category ||
    !!filters.date_from ||
    !!filters.date_to

  const handleClearAll = () => {
    setFilters({})
    setStatusFilter(null)
  }

  const handleSummaryCardClick = (storeId: number, filterType: AppointmentDisplayStatus | 'all') => {
    setFilters((f) => ({ ...f, store_id: storeId }))
    if (filterType !== 'all') {
      setStatusFilter(filterType)
    } else {
      setStatusFilter(null) // limpar filtro de status ao clicar em "total"
    }
  }

  const handleDayClick = (d: Date) => {
    const dateStr = d.toISOString().split('T')[0]
    setFilters((f) => ({ ...f, date_from: dateStr, date_to: dateStr }))
    setView('lista')
  }

  const handleOpenNewForm = () => {
    setEditingAppointment(null)
    setShowForm(true)
  }

  const handleEditAppointment = (appt: Appointment) => {
    setSelectedAppointment(null)
    setEditingAppointment(appt)
    setShowForm(true)
  }

  const handleCancelAppointment = (appt: Appointment) => {
    setSelectedAppointment(null)
    setCancelConfirmAppointment(appt)
  }

  const handleConfirmCancel = () => {
    if (!cancelConfirmAppointment) return
    cancelMutation.mutate({ id: cancelConfirmAppointment.id })
    setCancelConfirmAppointment(null)
  }

  return (
    <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
      {/* Header + AlertBanner + Filters */}
      <div className="space-y-3">
        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" style={{ color: '#F5A800' }} />
            </div>
            <div className="min-w-0">
              <h1
                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
              >
                Agendamento de Serviços
              </h1>
              {!apptLoading && (
                <p className="text-sm text-[#666666] dark:text-zinc-400">
                  {totalCount} veiculo{totalCount !== 1 ? 's' : ''} agendado
                  {totalCount !== 1 ? 's' : ''}
                </p>
              )}
              {apptLoading && (
                <Skeleton className="h-4 w-32 mt-0.5" />
              )}
            </div>
          </div>

          <div className="sm:flex-1 sm:px-4">
            <AlertBanner atrasado={safeSummary.atrasado} atencao={safeSummary.atencao} />
          </div>

          {canEditScheduling && (
            <Button
              onClick={handleOpenNewForm}
              className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5 font-semibold"
              style={{ backgroundColor: '#F5A800', color: '#000' }}
            >
              <Plus className="h-4 w-4" />
              Novo Agendamento
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
          <SchedulingFilters
            filters={filters}
            onFiltersChange={setFilters}
            stores={allStores}
          />
        </div>
      </div>

      {/* Store summary bar */}
      <SchedulingSummaryCards
        summary={storeSummary ?? []}
        isLoading={storeSummaryLoading}
        onFilterClick={handleSummaryCardClick}
      />

      {/* Legend + View tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusLegend
            selectedStatus={statusFilter}
            onStatusClick={handleStatusClick}
          />
          {hasActiveStatusOrFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <X className="h-3 w-3" />
              Limpar filtros
            </button>
          )}
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-1 rounded-lg border dark:border-zinc-700 p-0.5 bg-gray-100 dark:bg-zinc-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setView('mes')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'mes'
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
            aria-pressed={view === 'mes'}
          >
            <Calendar className="h-3.5 w-3.5" />
            Mes
          </button>
          <button
            type="button"
            onClick={() => setView('semana')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'semana'
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
            aria-pressed={view === 'semana'}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Semana
          </button>
          <button
            type="button"
            onClick={() => setView('lista')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'lista'
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
            aria-pressed={view === 'lista'}
          >
            <List className="h-3.5 w-3.5" />
            Lista
          </button>
        </div>
      </div>

      {/* Main content area */}
      {apptLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {view === 'lista' && (
            <AppointmentListView
              appointments={appointments}
              onCardClick={setSelectedAppointment}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal((v) => !v)}
            />
          )}
          {view === 'semana' && (
            <CalendarWeekView
              appointments={appointments}
              currentDate={currentDate}
              onNavigate={setCurrentDate}
              onCardClick={setSelectedAppointment}
            />
          )}
          {view === 'mes' && (
            <CalendarMonthView
              appointments={appointments}
              currentDate={currentDate}
              onNavigate={setCurrentDate}
              onDayClick={handleDayClick}
              onCardClick={setSelectedAppointment}
            />
          )}
        </>
      )}

      {/* Today summary modal */}
      <TodaySummaryModal
        open={showSummaryModal}
        onClose={handleCloseSummaryModal}
        onViewAll={handleViewAllFromSummary}
        summary={safeSummary}
      />

      {/* Detail drawer */}
      <AppointmentDetailDrawer
        appointment={selectedAppointment}
        open={!!selectedAppointment}
        onClose={() => setSelectedAppointment(null)}
        onEdit={handleEditAppointment}
        onCancel={handleCancelAppointment}
        canEdit={canEditScheduling}
        canCancel={canCancelScheduling}
        canGenerateOS={canGenerateOS}
      />

      {/* Create / edit form */}
      <AppointmentForm
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingAppointment(null)
        }}
        appointment={editingAppointment}
        stores={allStores}
      />

      {/* Cancel confirmation dialog */}
      <AlertDialog
        open={!!cancelConfirmAppointment}
        onOpenChange={(open) => { if (!open) setCancelConfirmAppointment(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja cancelar o agendamento da placa{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {cancelConfirmAppointment?.vehicle_plate}
              </span>
              {cancelConfirmAppointment?.vehicle_model && (
                <> — {cancelConfirmAppointment.vehicle_model}</>
              )}
              ? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
