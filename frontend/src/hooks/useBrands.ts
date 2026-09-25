import { useQuery } from '@tanstack/react-query';
import brandsService from '@/services/api/brands.service';
import { useAuth } from '@/hooks/useAuth';

/**
 * Marcas ativas, para uso em filtros (ex.: tela Películas). Dados
 * mudam pouco — staleTime de 1h, igual useStores/useDealerships.
 */
export function useBrands() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['brands', 'active'],
    queryFn: () => brandsService.list({ is_active: true }),
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });

  return { brands: data?.items ?? [], isLoading };
}
