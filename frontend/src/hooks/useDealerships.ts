import { useQuery } from '@tanstack/react-query';
import { dealershipsService } from '@/services/api/dealerships.service';
import { useAuth } from '@/hooks/useAuth';

/**
 * Lista de concessionárias ativas, para uso em filtros (ex.: Indicadores de
 * Películas). Dados mudam pouco — staleTime de 1h, igual useStores.
 */
export function useDealerships() {
  const { user } = useAuth();

  const { data: dealerships = [], isLoading } = useQuery({
    queryKey: ['dealerships'],
    queryFn: () => dealershipsService.list(),
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });

  return { dealerships, isLoading };
}
