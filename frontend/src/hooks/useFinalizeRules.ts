import { useAuthStore } from '@/stores/auth.store'

/**
 * Regras de finalização de O.S. compartilhadas entre os dois caminhos de UI
 * (FinalizeOSModal na tela de O.S. e AppointmentDetailDrawer no Agendamento).
 *
 * Fonte da verdade da REGRA é o backend (`finalize_service_order`): foto da
 * chancela e bobina (película comum) são obrigatórias para NÃO-Owner; Owner é
 * isento (limpeza de backlog). Instalador é obrigatório APENAS para película
 * (film/security_film/ppf) — estética não exige funcionário; essa regra vive
 * nos componentes (FinalizeOSModal/AppointmentDetailDrawer), não neste hook.
 *
 * Centralizar aqui evita que uma mudança de regra precise ser replicada nos dois
 * componentes — foi a duplicação que gerou o bug do Owner não finalizar pelo
 * Agendamento.
 */
export function useFinalizeRules() {
  const currentUser = useAuthStore((s) => s.user)
  const isOwner = currentUser?.role === 'owner'

  return {
    isOwner,
    /** Mínimo de fotos da chancela exigido (0 para Owner, 1 para os demais). */
    requiredPhotos: isOwner ? 0 : 1,
    /**
     * Bobina é obrigatória só para Película comum (department/category 'film')
     * e nunca para Owner. O chamador resolve a categoria efetiva do item
     * (ex.: `item.category ?? department`) antes de passar aqui.
     */
    isRollRequired: (effectiveCategory: string | null | undefined) =>
      !isOwner && effectiveCategory === 'film',
  }
}
