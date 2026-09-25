import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
    key: string;
    direction: SortDirection;
}

/**
 * Hook genérico de ordenação client-side para tabelas.
 *
 * @example
 * const { sorted, sortState, toggle } = useTableSort(data, 'revenue');
 */
export function useTableSort<T extends object>(
    data: T[],
    defaultKey: string,
    defaultDirection: SortDirection = 'desc'
) {
    const [sortState, setSortState] = useState<SortState>({
        key: defaultKey,
        direction: defaultDirection,
    });

    const toggle = (key: string) => {
        setSortState((prev) => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const sorted = useMemo(() => {
        const { key, direction } = sortState;
        return [...data].sort((a, b) => {
            const av = (a as Record<string, unknown>)[key];
            const bv = (b as Record<string, unknown>)[key];

            let cmp: number;
            if (typeof av === 'number' && typeof bv === 'number') {
                cmp = av - bv;
            } else {
                const aStr = av != null ? String(av).toLowerCase() : '';
                const bStr = bv != null ? String(bv).toLowerCase() : '';
                cmp = aStr.localeCompare(bStr, 'pt-BR');
            }
            return direction === 'asc' ? cmp : -cmp;
        });
    }, [data, sortState]);

    return { sorted, sortState, toggle };
}

/**
 * Retorna o caractere indicador de direção do sort para um cabeçalho.
 * Exibe ↑ (asc) ou ↓ (desc) quando a coluna está ativa, ou " ⇅" quando inativa.
 */
export function getSortIndicator(colKey: string, sortState: SortState): string {
    if (sortState.key !== colKey) return ' ⇅';
    return sortState.direction === 'asc' ? ' ↑' : ' ↓';
}
