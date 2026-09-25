import { useState } from 'react'
import { Loader2, ClipboardList } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { schedulingService } from '@/services/api/scheduling.service'
import { useCarrosResumo } from '@/hooks/useScheduling'
import { useToast } from '@/hooks/use-toast'
import type { AppointmentFilters } from '@/types/scheduling.types'

interface CarrosParaFazerModalProps {
  open: boolean
  onClose: () => void
  filters: AppointmentFilters
  displayStatuses: string[]
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0]
}

export function CarrosParaFazerModal({
  open,
  onClose,
  filters,
  displayStatuses,
}: CarrosParaFazerModalProps) {
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const { toast } = useToast()

  const { data, isLoading } = useCarrosResumo(filters, displayStatuses, open)
  const items = data?.items ?? []

  const handleGeneratePdf = async () => {
    setIsExportingPdf(true)
    try {
      const blob = await schedulingService.exportCarrosPdf(filters, displayStatuses)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `carros_para_fazer_${getTodayKey()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({
        variant: 'destructive',
        title: 'Erro ao gerar PDF',
        description: 'Não foi possível gerar a lista de carros para fazer.',
      })
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" style={{ color: '#F5A800' }} />
            Carros para Fazer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          {isLoading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum carro para fazer nos filtros selecionados.
            </p>
          )}

          {!isLoading && items.length > 0 && (
            <>
              {items.map((item) => (
                <div
                  key={item.store_id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 bg-gray-50 dark:bg-zinc-800/50"
                >
                  <span className="text-sm font-medium">{item.store_name}</span>
                  <span className="text-lg font-bold tabular-nums">{item.count}</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg border-2 px-3 py-2 mt-2 border-[#F5A800]/40 bg-[#F5A800]/10">
                <span className="text-sm font-semibold">TOTAL</span>
                <span className="text-lg font-bold tabular-nums" style={{ color: '#F5A800' }}>
                  {data?.total ?? 0}
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
          <Button
            size="sm"
            onClick={handleGeneratePdf}
            disabled={isExportingPdf}
            style={{ backgroundColor: '#F5A800', color: '#000' }}
            className="hover:opacity-90 gap-2"
          >
            {isExportingPdf && <Loader2 className="h-4 w-4 animate-spin" />}
            Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
