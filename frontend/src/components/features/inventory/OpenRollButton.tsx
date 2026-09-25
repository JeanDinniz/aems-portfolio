import { Loader2 } from 'lucide-react'
import { useCanEdit } from '@/hooks/useMyPermissions'
import { useOpenRoll } from '@/hooks/useOpenRoll'

interface OpenRollButtonProps {
  rollId: number
  className?: string
}

/**
 * Botão inline "Abrir para usar" para bobinas lacradas (em_estoque) dentro dos
 * seletores de bobina. Abre a bobina (em_estoque → em_uso) para que passe a ser
 * selecionável. Renderiza nada se o usuário não tiver permissão de estoque
 * (inventory can_edit) — nesse caso ele só vê o aviso "lacrada".
 *
 * `stopPropagation`/`preventDefault` impedem que o clique feche/selecione o item
 * do Radix Select em que o botão está embutido.
 */
export function OpenRollButton({ rollId, className }: OpenRollButtonProps) {
  const canEditInventory = useCanEdit('inventory')
  const openRoll = useOpenRoll()

  if (!canEditInventory) return null

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openRoll.mutate(rollId)
      }}
      disabled={openRoll.isPending}
      className={
        className ??
        'flex shrink-0 items-center gap-1 rounded-md border border-amber-500 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-900/20'
      }
    >
      {openRoll.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      Abrir para usar
    </button>
  )
}
