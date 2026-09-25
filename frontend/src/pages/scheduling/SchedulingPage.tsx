import { useState, useMemo } from 'react'
import { Plus, CalendarDays, List, Calendar, X, ClipboardList, Loader2, Link2, FileSpreadsheet } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertBanner } from '@/components/features/scheduling/AlertBanner'
import { StatusLegend } from '@/components/features/scheduling/StatusLegend'
import { TodaySummaryModal } from '@/components/features/scheduling/TodaySummaryModal'
import { CarrosParaFazerModal } from '@/components/features/scheduling/CarrosParaFazerModal'
import { AppointmentListView } from '@/components/features/scheduling/AppointmentListView'
import { CalendarMonthView } from '@/components/features/scheduling/CalendarMonthView'
import { CalendarWeekView } from '@/components/features/scheduling/CalendarWeekView'
import { SchedulingFilters } from '@/components/features/scheduling/SchedulingFilters'
import { AppointmentDetailDrawer } from '@/components/features/scheduling/AppointmentDetailDrawer'
import { AppointmentForm } from '@/components/features/scheduling/AppointmentForm'
import { schedulingService } from '@/services/api/scheduling.service'
import { useToast } from '@/hooks/use-toast'
import { useAppointments, useTodaySummary, useCancelAppointment } from '@/hooks/useScheduling'
import { DEPARTMENT_LABELS } from '@/constants/scheduling'
import { useCanEdit, useCanDelete, useSchedulingDepartments } from '@/hooks/useMyPermissions'
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
  const [view, setView] = useState<ViewMode>('lista')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [filters, setFilters] = useState<AppointmentFilters>({})
  const [statusFilters, setStatusFilters] = useState<AppointmentDisplayStatus[]>([])
  const [page] = useState(1)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [showSummaryModal, setShowSummaryModal] = useState(() => shouldShowSummaryModal())
  const [cancelConfirmAppointment, setCancelConfirmAppointment] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [showTerminal, setShowTerminal] = useState(false)
  const [showCarrosPreview, setShowCarrosPreview] = useState(false)
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const { toast } = useToast()

  // Uma busca por placa/O.S. procura um carro específico, que pode já estar
  // finalizado ou cancelado. Nesse caso incluímos/exibimos os terminais
  // automaticamente, sem exigir o toggle "Mostrar finalizados/cancelados".
  const hasSearch = !!filters.search?.trim()

  // Build effective filters
  const effectiveFilters = useMemo<AppointmentFilters>(() => {
    const f = { ...filters }
    if (hasSearch || statusFilters.includes('cancelado')) f.include_cancelled = true
    // Terminais (finalizados/cancelados) só são buscados quando o usuário pede — evita
    // truncar os agendamentos ativos pela paginação. A busca textual é um pedido explícito.
    if (
      showTerminal ||
      hasSearch ||
      statusFilters.includes('finalizado') ||
      statusFilters.includes('cancelado')
    ) {
      f.include_terminal = true
    }
    return f
  }, [filters, statusFilters, showTerminal, hasSearch])

  // Queries
  const { data: appointmentsData, isLoading: apptLoading } = useAppointments(
    effectiveFilters,
    page,
    200
  )
  const { data: summary } = useTodaySummary(filters.store_id ?? null)

  const { stores: allStores } = useStores()

  const cancelMutation = useCancelAppointment()

  const canEditScheduling = useCanEdit('scheduling')
  const canCancelScheduling = useCanDelete('scheduling')
  const canGenerateOS = useCanEdit('scheduling_os')
  const allowedDepartments = useSchedulingDepartments()

  const allAppointments = appointmentsData?.items ?? []
  const appointments = statusFilters.length
    ? allAppointments.filter((a) => statusFilters.includes(a.display_status))
    : allAppointments
  const totalCount = appointmentsData?.pagination.total ?? 0

  const safeSummary = summary ?? {
    atrasado: 0,
    atencao: 0,
    agendado: 0,
    em_execucao: 0,
    duplicidade: 0,
    finalizado: 0,
    cancelado: 0,
  }

  // Handlers
  const handleCloseSummaryModal = () => {
    setShowSummaryModal(false)
  }

  const handleViewAllFromSummary = () => {
    setFilters({})
    setStatusFilters([])
    setView('lista')
    setShowSummaryModal(false)
  }

  // Multi-seleção: clicar num status alterna ele na lista, mantendo os demais.
  const handleStatusClick = (status: AppointmentDisplayStatus) => {
    setStatusFilters((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    )
  }

  const hasActiveStatusOrFilters =
    statusFilters.length > 0 ||
    !!filters.search ||
    !!filters.store_id ||
    !!filters.department ||
    !!filters.service_category ||
    !!filters.date_from ||
    !!filters.date_to

  const handleClearAll = () => {
    setFilters({})
    setStatusFilters([])
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
    setCancelReason('')
    setCancelConfirmAppointment(appt)
  }

  const handleConfirmCancel = () => {
    if (!cancelConfirmAppointment) return
    const reason = cancelReason.trim()
    if (!reason) return
    cancelMutation.mutate({ id: cancelConfirmAppointment.id, reason })
    setCancelConfirmAppointment(null)
    setCancelReason('')
  }

  // "Carros para fazer" = status pendentes selecionados na legenda (ou nenhum filtro = todos os pendentes)
  const pendingCarrosStatuses = useMemo(
    () =>
      (['atrasado', 'atencao', 'agendado', 'em_execucao'] as AppointmentDisplayStatus[]).filter(
        (s) => statusFilters.includes(s)
      ),
    [statusFilters]
  )

  const handleExportExcel = async () => {
    setIsExportingExcel(true)
    try {
      // Espelha a tela: os mesmos filtros efetivos (incl. toggle de terminais) e a
      // seleção de status da legenda (todos os status marcados, não só pendentes).
      const blob = await schedulingService.exportExcel(effectiveFilters, statusFilters)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const range =
        filters.date_from && filters.date_to
          ? `${filters.date_from}_${filters.date_to}`
          : getTodayKey()
      a.download = `agendamento_${range}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar Excel',
        description: 'Não foi possível gerar a planilha de agendamentos.',
      })
    } finally {
      setIsExportingExcel(false)
    }
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto shrink-0">
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={isExportingExcel}
              className="w-full sm:w-auto font-semibold gap-2 shrink-0 border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
            >
              {isExportingExcel ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Exportar Excel
            </Button>

            <Button
              variant="outline"
              onClick={() => setShowCarrosPreview(true)}
              className="w-full sm:w-auto font-semibold gap-2 shrink-0 border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
            >
              <ClipboardList className="h-4 w-4" />
              Carros para fazer
            </Button>

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
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
          <SchedulingFilters
            filters={filters}
            onFiltersChange={setFilters}
            stores={allStores}
            allowedDepartments={allowedDepartments}
          />
        </div>
      </div>

      {/* Legend + View tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusLegend
            selectedStatuses={statusFilters}
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
              showTerminal={showTerminal || hasSearch}
              onToggleTerminal={() => setShowTerminal((v) => !v)}
              hideToggle={hasSearch}
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

      {/* Carros para fazer — preview do resumo antes de gerar o PDF */}
      <CarrosParaFazerModal
        open={showCarrosPreview}
        onClose={() => setShowCarrosPreview(false)}
        filters={effectiveFilters}
        displayStatuses={pendingCarrosStatuses}
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
        onOpenSibling={async (siblingId) => {
          try {
            const sibling = await schedulingService.getById(siblingId)
            setSelectedAppointment(sibling)
          } catch {
            toast({
              variant: 'destructive',
              title: 'Sem acesso ao agendamento vinculado',
              description: 'Não foi possível abrir o agendamento do outro departamento.',
            })
          }
        }}
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
        onOpenChange={(open) => { if (!open) { setCancelConfirmAppointment(null); setCancelReason('') } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Deseja cancelar o agendamento da placa{' '}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {cancelConfirmAppointment?.vehicle_plate}
                  </span>
                  {cancelConfirmAppointment?.vehicle_model && (
                    <> — {cancelConfirmAppointment.vehicle_model}</>
                  )}
                  ? Esta ação não pode ser desfeita.
                </p>
                {/* Aviso sobre O.S. vinculada */}
                {cancelConfirmAppointment?.service_order_id && (
                  cancelConfirmAppointment.display_status === 'finalizado' ? (
                    <div className="flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
                      <span>
                        A O.S. vinculada está finalizada e <strong>não será cancelada</strong>.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-300">
                      <span>
                        A O.S. vinculada também será cancelada.
                      </span>
                    </div>
                  )
                )}
                {(cancelConfirmAppointment?.group_siblings?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Somente este agendamento de{' '}
                      <strong>{DEPARTMENT_LABELS[cancelConfirmAppointment!.department] ?? cancelConfirmAppointment!.department}</strong>{' '}
                      será cancelado; os demais agendamentos do grupo permanecem.
                    </span>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason" className="text-sm font-medium">
              Motivo do cancelamento <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Descreva o motivo do cancelamento…"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={!cancelReason.trim()}
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
