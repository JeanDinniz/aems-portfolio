/**
 * Test Utilities
 *
 * Common utilities for testing React components with all necessary providers.
 */

import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

/**
 * Create a new QueryClient for testing
 */
export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
                staleTime: 0,
            },
            mutations: {
                retry: false,
            },
        },
    });
}

/**
 * Wrapper component with all necessary providers
 */
interface AllProvidersProps {
    children: React.ReactNode;
    queryClient?: QueryClient;
}

export function AllProviders({ children, queryClient }: AllProvidersProps) {
    const client = queryClient || createTestQueryClient();

    return (
        <BrowserRouter>
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        </BrowserRouter>
    );
}

/**
 * Custom render function that wraps with all providers
 */
export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient }
) {
    const { queryClient, ...renderOptions } = options || {};

    return render(ui, {
        wrapper: ({ children }) => (
            <AllProviders queryClient={queryClient}>{children}</AllProviders>
        ),
        ...renderOptions,
    });
}

/**
 * Create a wrapper component for hook testing
 */
export function createWrapper(queryClient?: QueryClient) {
    const client = queryClient || createTestQueryClient();

    return ({ children }: { children: React.ReactNode }) => (
        <AllProviders queryClient={client}>{children}</AllProviders>
    );
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
