import { QueryClient } from '@tanstack/react-query';

/**
 * Configuração do TanStack Query (Bloco B).
 * Persistência (AsyncStorage) fica para um passo posterior.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 2, // 2 min
            gcTime: 1000 * 60 * 5, // 5 min
            retry: 2,
            refetchOnReconnect: true,
        },
    },
});
