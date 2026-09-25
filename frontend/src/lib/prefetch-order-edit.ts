import type { QueryClient } from '@tanstack/react-query';
import { consultantsService } from '@/services/api/consultants.service';
import { vehicleModelsService } from '@/services/api/vehicle-models.service';
import { employeesService } from '@/services/api/employees.service';
import { inventoryService } from '@/services/api/inventory.service';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { fetchServicesDeduped } from '@/hooks/useServices';
import {
    CATALOG_STALE_TIME,
    ORDER_DETAIL_STALE_TIME,
    consultantsKey,
    vehicleModelsKey,
    servicesKey,
    employeesByDepartmentKey,
    filmInstallersKey,
    filmTypesKey,
    orderEditDetailKey,
    serviceOrderRouteKey,
} from '@/lib/catalog-queries';

const FILM_DEPARTMENTS = new Set(['film', 'security_film', 'ppf']);

export interface PrefetchOrderEditInput {
    /**
     * Id da O.S. (Conferência/rota) OU do agendamento (Agendamento). No caso
     * do Agendamento, use `detailQuery: 'none'` — esse id NÃO é de uma O.S. e
     * chamar serviceOrdersService.getById nele buscaria a entidade errada.
     */
    id: number;
    storeId?: number | null;
    department?: string | null;
}

export interface PrefetchOrderEditOptions {
    /** brand_id resolvido pelo chamador via availableStores.find(s => s.id === storeId)?.brand_id */
    brandId?: number;
    /**
     * Qual query de detalhe pré-carregar (mesmo endpoint, chaves diferentes
     * conforme a tela que consome):
     * - 'conference' (padrão): ['service-order-edit-detail', id] — usada pelo
     *   EditDialog da Conferência.
     * - 'route': ['service-order', id] — usada por useServiceOrder /
     *   EditServiceOrderPage.
     * - 'none': não busca detalhe algum — usar para o Agendamento, cujo
     *   AppointmentForm recebe o objeto do agendamento já carregado da
     *   lista (sem query própria de detalhe).
     */
    detailQuery?: 'conference' | 'route' | 'none';
}

/**
 * Prefetch "por intenção": chamado em onMouseEnter/onFocus/onPointerDown das
 * linhas/cards que levam a um editor de O.S. (Conferência, Agendamento, lista
 * de O.S.), para que os catálogos relacionais (consultores, modelos,
 * serviços, tipos de película, instaladores/funcionários) já estejam quentes
 * no cache quando o modal/formulário realmente abrir — eliminando o pop-in
 * em cascata.
 *
 * Usa as MESMAS chaves e queryFns dos hooks/consumidores reais (ver
 * lib/catalog-queries.ts) — se um consumidor for alterado, atualize a
 * fábrica correspondente lá, não aqui, para não perder a paridade.
 */
export function prefetchOrderEditData(
    queryClient: QueryClient,
    input: PrefetchOrderEditInput,
    options: PrefetchOrderEditOptions = {}
): void {
    const { id, storeId, department } = input;
    const { brandId, detailQuery = 'conference' } = options;

    // Detalhe da O.S. (não se aplica ao Agendamento — ver doc de detailQuery)
    if (detailQuery === 'conference') {
        void queryClient.prefetchQuery({
            queryKey: orderEditDetailKey(id),
            queryFn: () => serviceOrdersService.getById(id),
            staleTime: ORDER_DETAIL_STALE_TIME,
        });
    } else if (detailQuery === 'route') {
        void queryClient.prefetchQuery({
            queryKey: serviceOrderRouteKey(id),
            queryFn: () => serviceOrdersService.getById(id),
            staleTime: ORDER_DETAIL_STALE_TIME,
        });
    }

    // Consultores da loja + funcionários do departamento — só dá pra montar
    // com a loja resolvida.
    if (storeId) {
        const filters = { store_id: storeId, is_active: true };
        void queryClient.prefetchQuery({
            queryKey: consultantsKey(filters, 1, 100),
            queryFn: () => consultantsService.list(filters, 1, 100),
            staleTime: CATALOG_STALE_TIME,
        });

        if (department) {
            void queryClient.prefetchQuery({
                queryKey: employeesByDepartmentKey(storeId, department),
                queryFn: () => employeesService.listByStoreAndDepartment(storeId, department),
                staleTime: CATALOG_STALE_TIME,
            });
        }
    }

    // Modelos da marca + serviços do departamento — só dá pra montar com a
    // marca resolvida (o chamador resolve via availableStores).
    if (brandId) {
        void queryClient.prefetchQuery({
            queryKey: vehicleModelsKey(brandId, true),
            queryFn: () => vehicleModelsService.list({ brand_id: brandId, active_only: true }),
            staleTime: CATALOG_STALE_TIME,
        });

        if (department) {
            void queryClient.prefetchQuery({
                queryKey: servicesKey(department, brandId),
                queryFn: () => fetchServicesDeduped(department, brandId),
                staleTime: CATALOG_STALE_TIME,
            });
        }
    }

    // Película: tipos + instaladores
    if (department && FILM_DEPARTMENTS.has(department)) {
        const filmDept = department as 'film' | 'security_film' | 'ppf';
        void queryClient.prefetchQuery({
            queryKey: filmTypesKey(filmDept),
            queryFn: () => inventoryService.listFilmTypes({ department: filmDept, limit: 100 }),
            staleTime: CATALOG_STALE_TIME,
        });
        void queryClient.prefetchQuery({
            queryKey: filmInstallersKey(filmDept),
            // Mesmo GOTCHA do hook useFilmInstallers: a API é sempre
            // consultada com 'film' fixo, independente do departamento.
            queryFn: () => employeesService.listByDepartmentAllStores('film'),
            staleTime: CATALOG_STALE_TIME,
        });
    }
}
