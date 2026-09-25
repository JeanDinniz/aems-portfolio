import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { visibleDepartmentEntries } from '@/constants/scheduling'
import type { AppointmentFilters } from '@/types/scheduling.types'
import type { Store } from '@/services/api/stores.service'

interface SchedulingFiltersProps {
  filters: AppointmentFilters
  onFiltersChange: (filters: AppointmentFilters) => void
  stores: Store[]
  allowedDepartments?: string[]
}

export function SchedulingFilters({
  filters,
  onFiltersChange,
  stores,
  allowedDepartments,
}: SchedulingFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const departmentEntries = visibleDepartmentEntries(allowedDepartments)

  const hasActiveFilters =
    !!filters.search ||
    !!filters.store_id ||
    !!filters.department ||
    !!filters.service_category ||
    !!filters.date_from ||
    !!filters.date_to

  const clearFilters = () => {
    onFiltersChange({})
    if (searchRef.current) searchRef.current.value = ''
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, search: e.target.value || undefined })
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end w-full">
      {/* Search */}
      <div className="col-span-2 space-y-1 sm:flex-1 sm:min-w-[180px] sm:max-w-xs">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">BUSCA</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Buscar placa, OS..."
            defaultValue={filters.search ?? ''}
            onChange={handleSearchChange}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Store filter */}
      {stores.length > 1 && (
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">LOJA</Label>
          <Select
            value={filters.store_id?.toString() ?? 'all'}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                store_id: v === 'all' ? undefined : Number(v),
              })
            }
          >
            <SelectTrigger className="h-8 text-sm w-full sm:w-36">
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Department filter */}
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">DEPARTAMENTO</Label>
        <Select
          value={filters.department ?? 'all'}
          onValueChange={(v) =>
            onFiltersChange({
              ...filters,
              department: v === 'all' ? undefined : v,
            })
          }
        >
          <SelectTrigger className="h-8 text-sm w-full sm:w-36">
            <SelectValue placeholder="Departamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {departmentEntries.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category filter */}
      <div className="space-y-1 col-span-2 sm:col-span-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">CATEGORIA</Label>
        <Select
          value={filters.service_category ?? 'all'}
          onValueChange={(v) =>
            onFiltersChange({
              ...filters,
              service_category: v === 'all' ? undefined : v,
            })
          }
        >
          <SelectTrigger className="h-8 text-sm w-full sm:w-[170px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="insulfilm">Película</SelectItem>
            <SelectItem value="pelicula_seguranca">Película de Segurança</SelectItem>
            <SelectItem value="ppf">PPF</SelectItem>
            <SelectItem value="estetica">Estética</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Date from */}
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">DATA INÍCIO</Label>
        <Input
          type="date"
          value={filters.date_from ?? ''}
          onChange={(e) =>
            onFiltersChange({ ...filters, date_from: e.target.value || undefined })
          }
          className="h-8 text-sm w-full sm:w-[150px] [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:dark:invert"
        />
      </div>

      {/* Date to */}
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">DATA FIM</Label>
        <Input
          type="date"
          value={filters.date_to ?? ''}
          onChange={(e) =>
            onFiltersChange({ ...filters, date_to: e.target.value || undefined })
          }
          className="h-8 text-sm w-full sm:w-[150px] [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:dark:invert"
        />
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        </div>
      )}
    </div>
  )
}
