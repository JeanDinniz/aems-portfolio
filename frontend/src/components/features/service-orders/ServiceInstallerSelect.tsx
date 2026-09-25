import { useState } from 'react'
import { Plus, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface InstallerOption {
  id: number
  name: string
  last_name?: string | null
}

interface ServiceInstallerSelectProps {
  /** Rótulo do serviço (código + nome + tonalidade) exibido acima dos selects */
  label: string
  employees: InstallerOption[]
  /** Instaladores selecionados para este serviço (≥1 obrigatório) */
  value: number[]
  onChange: (ids: number[]) => void
}

function displayName(emp: InstallerOption): string {
  return emp.last_name ? `${emp.name} ${emp.last_name}` : emp.name
}

/**
 * Seleção de 1..N instaladores para um serviço no Finalizar.
 *
 * Quando mais de um instalador faz o mesmo serviço, a produção é dividida
 * igualmente entre eles no módulo Desempenho (valor/K e 1/K serviço cada).
 * Usado pelo FinalizeOSModal e pelo AppointmentDetailDrawer.
 */
export function ServiceInstallerSelect({
  label,
  employees,
  value,
  onChange,
}: ServiceInstallerSelectProps) {
  // Slot vazio extra aberto pelo botão "+ instalador" (aguardando escolha)
  const [pendingSlot, setPendingSlot] = useState(false)

  const optionsFor = (currentId: number | undefined) =>
    employees.filter((emp) => emp.id === currentId || !value.includes(emp.id))

  const handleChangeAt = (index: number, newId: number) => {
    const next = [...value]
    next[index] = newId
    onChange([...new Set(next)])
  }

  const handleRemoveAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const handlePendingChoice = (newId: number) => {
    setPendingSlot(false)
    if (!value.includes(newId)) onChange([...value, newId])
  }

  const slots: Array<{ id: number | undefined; index: number }> = value.map((id, index) => ({
    id,
    index,
  }))
  // Sempre há ao menos um select visível (vazio quando nada foi escolhido)
  const showEmptyFirst = value.length === 0
  const canAddMore = !pendingSlot && value.length >= 1 && value.length < employees.length

  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground font-medium truncate block">
        <User className="inline h-3 w-3 mr-1 opacity-60" />
        {label}
      </span>

      {showEmptyFirst && (
        <Select value="" onValueChange={(val) => handlePendingChoice(Number(val))}>
          <SelectTrigger className="w-full h-9 text-sm">
            <SelectValue placeholder="Selecionar instalador..." />
          </SelectTrigger>
          <SelectContent>
            {employees.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Nenhum instalador disponível
              </div>
            ) : (
              employees.map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)} className="text-sm">
                  {displayName(emp)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      {slots.map(({ id, index }) => (
        <div key={index} className="flex items-center gap-1.5">
          <Select
            value={id !== undefined ? String(id) : ''}
            onValueChange={(val) => handleChangeAt(index, Number(val))}
          >
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="Selecionar instalador..." />
            </SelectTrigger>
            <SelectContent>
              {optionsFor(id).map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)} className="text-sm">
                  {displayName(emp)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {index > 0 && (
            <button
              type="button"
              onClick={() => handleRemoveAt(index)}
              aria-label="Remover instalador"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      {pendingSlot && (
        <div className="flex items-center gap-1.5">
          <Select value="" onValueChange={(val) => handlePendingChoice(Number(val))}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="Selecionar instalador..." />
            </SelectTrigger>
            <SelectContent>
              {optionsFor(undefined).map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)} className="text-sm">
                  {displayName(emp)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setPendingSlot(false)}
            aria-label="Remover instalador"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {canAddMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPendingSlot(true)}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          instalador
        </Button>
      )}
    </div>
  )
}
