import { useEffect, useState } from 'react';

/**
 * Retorna o valor "atrasado" em `delay` ms — a digitação atualiza o input na
 * hora, mas queries que dependem do valor debounced só disparam quando o
 * usuário para de digitar (evita 1 request por tecla).
 */
export function useDebounce<T>(value: T, delay = 350): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
