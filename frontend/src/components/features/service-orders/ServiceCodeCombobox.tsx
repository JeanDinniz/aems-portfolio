import { useState, useRef, useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

interface ServiceOption {
  id: number
  name: string
  code?: string | null
}

interface ServiceCodeComboboxProps {
  services: ServiceOption[]
  value: number
  onChange: (id: string) => void
  placeholder?: string
  fallback?: { id: number; name: string }
  disabled?: boolean
  className?: string
  contentClassName?: string
}

export function ServiceCodeCombobox({
  services,
  value,
  onChange,
  placeholder = 'Selecionar...',
  fallback,
  disabled = false,
  className,
  contentClassName,
}: ServiceCodeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setSearch('')
    }
  }, [open])

  const term = search.trim().toLowerCase()
  const filtered = term
    ? services.filter(
        (s) =>
          s.code?.toLowerCase().includes(term) ||
          s.name.toLowerCase().includes(term)
      )
    : services

  const selectedFromList = services.find((s) => s.id === value)
  const selectedCode = selectedFromList?.code
  const selectedName = selectedFromList?.name ?? (fallback?.id === value ? fallback.name : null)
  const label = selectedName
    ? selectedCode
      ? `${selectedCode} - ${selectedName}`
      : selectedName
    : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full h-10 justify-between font-normal text-left overflow-hidden',
            !label && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate min-w-0">{label ?? placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 w-[calc(100vw-2rem)] sm:w-[420px]', contentClassName)}
        align="start"
        side="bottom"
        avoidCollisions
      >
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            placeholder="Buscar por código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="overflow-y-auto max-h-[320px]">
          {fallback && fallback.id === value && !services.some((s) => s.id === value) && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
              onClick={() => { onChange(String(fallback.id)); setOpen(false) }}
            >
              {fallback.name}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Nenhum resultado.
            </div>
          ) : (
            filtered.map((svc) => (
              <button
                key={svc.id}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-accent',
                  svc.id === value && 'bg-accent font-medium'
                )}
                onClick={() => { onChange(String(svc.id)); setOpen(false) }}
              >
                {svc.code ? `${svc.code} - ${svc.name}` : svc.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
