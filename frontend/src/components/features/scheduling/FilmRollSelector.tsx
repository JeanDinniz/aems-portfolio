import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { inventoryService } from '@/services/api/inventory.service'
import type { FilmRoll } from '@/services/api/inventory.service'

interface FilmRollSelectorProps {
  storeId: number
  department: string
  serviceId: number
  tonality: string | null
  serviceName: string
  filmTypeId?: number
  value: number | undefined
  onChange: (rollId: number | undefined) => void
  required?: boolean
  showLabel?: boolean
  isGalpon?: boolean
}

export function FilmRollSelector({
  storeId,
  department,
  serviceId,
  tonality,
  serviceName,
  filmTypeId,
  value,
  onChange,
  required = false,
  showLabel = true,
  isGalpon = false,
}: FilmRollSelectorProps) {
  const includeRollIds = value ? [value] : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['film-rolls-for-os', isGalpon ? 'galpon' : storeId, department, serviceId, filmTypeId, tonality, isGalpon, includeRollIds],
    queryFn: async () => {
      const rollParams = isGalpon
        ? { use_galpon_store: true as const }
        : { store_id: storeId }

      // Omitir department quando filmTypeId ou serviceId estão disponíveis —
      // filmTypeId já determina o departamento, e serviceId resolve via FilmTypeService (independente de dept)
      const deptParam = (filmTypeId || serviceId) ? {} : { department: department as 'film' | 'ppf' | 'security_film' }
      const svcParam = filmTypeId ? {} : { service_id: serviceId }
      const [inStock, inUse] = await Promise.all([
        inventoryService.listRolls({
          ...rollParams,
          ...deptParam,
          ...svcParam,
          film_type_id: filmTypeId,
          status: 'em_estoque',
          include_roll_ids: includeRollIds,
          limit: 100,
        }),
        inventoryService.listRolls({
          ...rollParams,
          ...deptParam,
          ...svcParam,
          film_type_id: filmTypeId,
          status: 'em_uso',
          include_roll_ids: includeRollIds,
          limit: 100,
        }),
      ])
      const all = [...inStock.items, ...inUse.items] as FilmRoll[]
      // Filtrar por tonalidade (comparação normalizada — dados legados podem ter
      // espaços/case divergentes), mas nunca remover a bobina já selecionada
      if (!tonality) return { rolls: all, rawCount: all.length }
      const norm = (s: string) => s.trim().toUpperCase()
      const filtered = all.filter(
        (r) =>
          (r.tonality != null && norm(r.tonality) === norm(tonality)) ||
          (includeRollIds?.includes(r.id) ?? false)
      )
      return { rolls: filtered, rawCount: all.length }
    },
    enabled: isGalpon ? true : !!storeId,
    staleTime: 1000 * 60,
  })

  const rolls = data?.rolls ?? []
  const rawCount = data?.rawCount ?? 0

  // Mensagem específica por causa: sem vínculo do serviço com tipo de película
  // (backend não resolve nenhum tipo), sem estoque do tipo, ou sem a tonalidade
  const emptyMessage =
    rawCount === 0 && !filmTypeId
      ? 'Nenhuma bobina encontrada para este serviço. Verifique o vínculo do serviço em Admin → Tipos de Película e o estoque da loja.'
      : rawCount === 0
        ? 'Nenhuma bobina deste tipo de película em estoque nesta loja.'
        : `Nenhuma bobina com a tonalidade ${tonality} disponível nesta loja.`

  return (
    <div className="space-y-1">
      {showLabel && (
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {serviceName}
          {tonality && (
            <span className="ml-1.5 text-xs text-muted-foreground font-normal">({tonality})</span>
          )}
        </p>
      )}
      {isLoading ? (
        <div className="h-9 rounded-md bg-gray-100 dark:bg-zinc-800 animate-pulse" />
      ) : (
        <Select
          value={value?.toString() ?? 'none'}
          onValueChange={(v) => onChange(v === 'none' ? undefined : Number(v))}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={required ? 'Selecionar bobina...' : 'Bobina (opcional)'} />
          </SelectTrigger>
          <SelectContent>
            {!required && (
              <SelectItem value="none">Bobina (opcional)</SelectItem>
            )}
            {rolls.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground max-w-[280px]">
                {emptyMessage}
              </div>
            ) : (
              rolls.map((roll) => (
                <SelectItem key={roll.id} value={roll.id.toString()}>
                  {roll.visual_id} — {roll.remaining_meters.toFixed(1)}m
                  {roll.status === 'em_uso' && (
                    <span className="ml-1 text-xs text-amber-600">(em uso)</span>
                  )}
                  {roll.status === 'esgotada' && (
                    <span className="ml-1 text-xs text-red-600 dark:text-red-400">(esgotada)</span>
                  )}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
