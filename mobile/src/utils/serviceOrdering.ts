import type { ServiceItem } from '@/services/api/services.service';

/**
 * Ordenação de serviços na tela de lançamento de O.S.
 *
 * Regra de negócio (2026-08-31): quando o Tipo do lançamento é "Cortesia", o
 * serviço "Lav.cortesia - Lavagem Simples" deve aparecer no TOPO da lista de
 * serviços — e SOMENTE ele. O restante mantém a ordem original.
 */

/**
 * Um serviço é a "lavagem simples de cortesia" quando é exclusivo de cortesia
 * (`is_courtesy_only`) E o nome contém "lavagem simples" (case-insensitive).
 * Espelha o critério de identificação já usado em FechamentoScreen.
 */
export function isCourtesySimpleWash(service: ServiceItem): boolean {
    return service.is_courtesy_only === true && /lavagem simples/i.test(service.name);
}

/**
 * Quando `isCourtesy` é true, sobe ao topo SOMENTE o(s) serviço(s) de "lavagem
 * simples de cortesia", preservando a ordem relativa original do restante (sort
 * estável). Fora de cortesia, devolve a lista inalterada.
 */
export function orderServicesForCourtesy(
    services: ServiceItem[],
    isCourtesy: boolean
): ServiceItem[] {
    if (!isCourtesy) return services;
    const top = services.filter(isCourtesySimpleWash);
    if (top.length === 0) return services;
    const rest = services.filter((s) => !isCourtesySimpleWash(s));
    return [...top, ...rest];
}
