import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { inventoryService } from '@/services/api/inventory.service'
import type { FilmRoll, FilmRollStatus } from '@/services/api/inventory.service'
import { formatFilmRollName, formatMeters, formatReceiptDate } from '@/utils/filmRoll'

interface FilmRollSelectorProps {
  storeId: number
  department: string
  serviceId: number
  tonality: string | null
  serviceName: string
  filmTypeId?: number
  value: number | undefined
  onChange: (rollId: number | undefined) => void
  /** Oferece a opção "Sem bobina" no dropdown. Ligado só para categorias de
   * bobina opcional (PPF / Película de Segurança); na Película comum fica off. */
  allowNoRoll?: boolean
  showLabel?: boolean
  isGalpon?: boolean
  /** Estado do modo retalho — controlado pelo componente pai. */
  usedScrap?: boolean
  /** Quando omitido, o seletor não oferece a opção "Retalho (sobra)" no dropdown —
   * usado também em AppointmentDetailDrawer/AppointmentForm, que não têm esse conceito. */
  onUsedScrapChange?: (v: boolean) => void
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
  allowNoRoll = false,
  showLabel = true,
  isGalpon = false,
  usedScrap = false,
  onUsedScrapChange,
}: FilmRollSelectorProps) {
  // Retalho só existe quando o pai passa o handler — caso contrário o campo
  // se comporta exatamente como antes (usado em telas que não têm essa opção).
  const scrapModeAvailable = !!onUsedScrapChange
  const isScrap = scrapModeAvailable && usedScrap
  const includeRollIds = value ? [value] : undefined
  // "Sem bobina" é semanticamente igual a "vazio" para o pai (rollId undefined),
  // então guardamos localmente que o usuário ESCOLHEU a opção — só para o campo
  // exibir "Sem bobina" em vez do placeholder. Vive enquanto o seletor está
  // montado; ao fechar/trocar de agendamento o efeito de reset em
  // AppointmentDetailDrawer volta o step para "detail" e este seletor desmonta,
  // então o estado nasce zerado a cada finalização. Uma seleção real (bobina ou
  // retalho) tem prioridade na exibição abaixo, então não precisa de reset manual.
  const [chosenNone, setChosenNone] = useState(false)

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
      const statuses: FilmRollStatus[] = ['em_estoque', 'em_uso']
      const result = await inventoryService.listRolls({
        ...rollParams,
        ...deptParam,
        ...svcParam,
        film_type_id: filmTypeId,
        statuses,
        include_roll_ids: includeRollIds,
        limit: 300,
      })
      const all = (result.items ?? []) as FilmRoll[]
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
  const selectedRoll = value != null ? rolls.find((r) => r.id === value) : undefined

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
        <>
        <Select
          // Sem seleção o campo fica VAZIO (placeholder) — nada de pré-selecionar
          // "opcional", senão ninguém abre para ver se há bobina disponível.
          value={isScrap ? 'scrap' : value != null ? value.toString() : chosenNone ? 'none' : ''}
          onValueChange={(v) => {
            if (v === 'scrap') {
              onUsedScrapChange?.(true)
              onChange(undefined)
              setChosenNone(false)
            } else if (v === 'none') {
              onUsedScrapChange?.(false)
              onChange(undefined)
              setChosenNone(true)
            } else {
              onUsedScrapChange?.(false)
              onChange(Number(v))
              setChosenNone(false)
            }
          }}
        >
          <SelectTrigger className="h-9">
            {/* Children explícitos: o item tem 2 linhas, mas o campo fechado mostra resumo de 1 linha */}
            <SelectValue placeholder="Selecionar bobina...">
              {isScrap
                ? 'Retalho (sobra)'
                : selectedRoll
                  ? `${formatFilmRollName(selectedRoll)} · ${formatReceiptDate(selectedRoll.receipt_date)} · ${formatMeters(selectedRoll.remaining_meters)}`
                  : value == null && chosenNone
                    ? 'Sem bobina'
                    : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {scrapModeAvailable && (
              <SelectItem value="scrap">Retalho (sobra)</SelectItem>
            )}
            {allowNoRoll && (
              <SelectItem value="none">Sem bobina</SelectItem>
            )}
            {rolls.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground max-w-[280px]">
                {emptyMessage}
              </div>
            ) : (
              rolls.map((roll) =>
                roll.status === 'em_estoque' ? (
                  // Bobina lacrada: aparece TRAVADA (não selecionável), apenas para
                  // visualização. Abrir a bobina é ação da tela de Estoque.
                  <div
                    key={roll.id}
                    className="flex flex-col items-start px-2 py-1.5 opacity-60"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      <Lock className="h-3 w-3" />
                      {formatFilmRollName(roll)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (em estoque)
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatReceiptDate(roll.receipt_date)} · restam {formatMeters(roll.remaining_meters)}
                    </span>
                  </div>
                ) : (
                  <SelectItem
                    key={roll.id}
                    value={roll.id.toString()}
                    textValue={`${formatFilmRollName(roll)} ${formatReceiptDate(roll.receipt_date)}`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-medium">
                        {formatFilmRollName(roll)}
                        {roll.status === 'em_uso' && (
                          <span className="ml-1 text-xs font-normal text-amber-600">(em uso)</span>
                        )}
                        {roll.status === 'esgotada' && (
                          <span className="ml-1 text-xs font-normal text-red-600 dark:text-red-400">(esgotada)</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatReceiptDate(roll.receipt_date)} · restam {formatMeters(roll.remaining_meters)}
                      </span>
                    </div>
                  </SelectItem>
                )
              )
            )}
          </SelectContent>
        </Select>
        {isScrap && (
          <p className="text-[11px] text-muted-foreground leading-tight">
            A sobra já foi descontada no corte anterior — a bobina não será debitada.
          </p>
        )}
        </>
      )}
    </div>
  )
}
