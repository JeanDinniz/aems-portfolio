import type { ConsultantFilters } from '@/types/consultant.types';

/**
 * Chaves de cache (queryKey) + tempos de staleTime/gcTime para "dado de
 * referência" — catálogos de baixa volatilidade (consultores, modelos de
 * veículo, serviços, tipos de película, instaladores, funcionários por
 * departamento).
 *
 * Por que centralizar: o prefetch de hover (lib/prefetch-order-edit.ts) só
 * tem efeito se a chave que ele usa para "esquentar" o cache for IDÊNTICA à
 * chave que o hook/consumidor final usa para ler. Se divergirem — mesmo em
 * um detalhe (ordem dos parâmetros, um campo a mais no filtro, undefined vs
 * omitido) — o prefetch aquece uma entrada de cache que ninguém lê, e o
 * pop-in continua acontecendo como se nada tivesse mudado. Por isso os
 * hooks (useConsultants, useVehicleModels, useServices, useEmployees) e as
 * queries inline (AppointmentForm) foram atualizados para IMPORTAR estas
 * fábricas em vez de escrever o array da queryKey à mão — garante paridade
 * por construção, não por convenção.
 */
export const CATALOG_STALE_TIME = 1000 * 60 * 30; // 30 min — catálogo de baixa volatilidade
export const CATALOG_GC_TIME = 1000 * 60 * 60; // 60 min

/**
 * Detalhe de UMA O.S. (não é catálogo — é dado transacional que outra pessoa
 * pode estar editando ao mesmo tempo). Ainda assim usa uma constante
 * compartilhada entre ConferencePage e o prefetch para os dois lados não
 * ficarem dessincronizados por staleTime diferente.
 */
export const ORDER_DETAIL_STALE_TIME = 60_000; // 1 min

// ─── Consultores ────────────────────────────────────────────────────────────
// Chave usada por useConsultants (hooks/useConsultants.ts) — consumida por
// ConferencePage e EditServiceOrderPage. A query inline de AppointmentForm
// (~811-816) foi realinhada para montar os mesmos filtros ({store_id,
// is_active:true}, page=1, pageSize=100) e usar esta fábrica, o que unifica
// as 3 telas na MESMA entrada de cache.
export function consultantsKey(filters: ConsultantFilters | undefined, page = 1, pageSize = 20) {
    return ['consultants', filters, page, pageSize] as const;
}

// ─── Modelos de veículo ─────────────────────────────────────────────────────
// Chave usada por useVehicleModels (hooks/useVehicleModels.ts) — já
// compartilhada hoje por ConferencePage e AppointmentForm (mesmo hook).
export function vehicleModelsKey(brandId: number | undefined, activeOnly: boolean | undefined) {
    return ['vehicle-models', brandId, activeOnly] as const;
}

// ─── Serviços por departamento+marca ────────────────────────────────────────
// Chave usada por useServices (hooks/useServices.ts) — consumida pelo
// ServicePicker de ConferencePage (departamentos não-película) e pelo
// FilmPicker (reaproveitado por ConferencePage e QuickCreateModal).
export function servicesKey(department: string | undefined, brandId: number | undefined) {
    return ['services', department, brandId] as const;
}

// ─── Funcionários por loja+departamento ─────────────────────────────────────
// Chave usada por useEmployeesByDepartment (hooks/useEmployees.ts) —
// consumida pelo select de Instalador/Funcionário do EditServiceOrderPage.
export function employeesByDepartmentKey(storeId: number | undefined, department: string | undefined) {
    return ['employees', 'by-department', storeId, department] as const;
}

// ─── Instaladores de película (todas as lojas) ──────────────────────────────
// Chave usada por useFilmInstallers (hooks/useEmployees.ts) — consumida pelo
// FilmPicker. GOTCHA herdado do hook: a queryFn sempre busca o departamento
// 'film' fixo na API (employeesService.listByDepartmentAllStores('film')),
// ignorando o parâmetro `department` — mantido aqui de propósito (só
// centraliza a chave, não muda o dado retornado).
export function filmInstallersKey(department: 'film' | 'security_film' | 'ppf') {
    return ['employees', 'film-installers', department] as const;
}

// ─── Tipos de película por departamento ─────────────────────────────────────
// PPF usa a chave curta histórica 'film-types-ppf' (sem o departamento no
// array) — já compartilhada hoje entre o FilmPicker e o AppointmentForm.
// film/security_film usa a chave que o FilmPicker já tinha
// ('film-types-for-os', dept); o AppointmentForm usava uma chave própria
// ('film-types-tonality', dept) com a MESMA queryFn/params — foi realinhado
// para esta fábrica, unificando o cache entre Conferência e Agendamento.
export function filmTypesKey(department: 'film' | 'security_film' | 'ppf') {
    return department === 'ppf'
        ? (['film-types-ppf'] as const)
        : (['film-types-for-os', department] as const);
}

// ─── Detalhe da O.S. ────────────────────────────────────────────────────────
// Chave do modal de edição da Conferência (ConferencePage::EditDialog).
// Distinta de serviceOrderRouteKey — são dois hooks/telas diferentes que
// hoje já usam chaves diferentes para o mesmo endpoint (getById); manter
// as duas fábricas separadas evita reescrever esse comportamento existente.
export function orderEditDetailKey(id: number | undefined) {
    return ['service-order-edit-detail', id] as const;
}

// Chave de useServiceOrder (hooks/useServiceOrders.ts) — usada pela rota
// dedicada /service-orders/:id/edit (EditServiceOrderPage).
export function serviceOrderRouteKey(id: number | undefined) {
    return ['service-order', id] as const;
}
