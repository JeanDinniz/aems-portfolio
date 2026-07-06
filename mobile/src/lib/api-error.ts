import { AxiosError } from 'axios';

/** Portado 1:1 de frontend/src/lib/api-error.ts. */
interface ValidationErrorItem {
    loc: (string | number)[];
    msg: string;
    type: string;
}

interface ApiErrorData {
    detail?: string | ValidationErrorItem[];
    message?: string;
}

/**
 * Extrai uma mensagem legível de um erro Axios/API. Trata `detail` string do
 * FastAPI e arrays de validação (Pydantic) — estes nunca são expostos ao usuário.
 */
export function getApiErrorMessage(error: Error, fallback = 'Tente novamente.'): string {
    if (!isAxiosError(error)) return fallback;

    const data = error.response?.data as ApiErrorData | undefined;

    if (error.response?.status === 403) {
        return 'Você não tem permissão para realizar esta ação.';
    }

    if (!data) return fallback;

    if (typeof data.detail === 'string') return data.detail;

    // Arrays de validação contêm nomes técnicos de campo — nunca expor.
    if (Array.isArray(data.detail)) return fallback;

    if (typeof data.message === 'string') return data.message;

    return fallback;
}

/** Retorna o status HTTP de um erro Axios, ou undefined. */
export function getApiErrorStatus(error: Error): number | undefined {
    if (!isAxiosError(error)) return undefined;
    return error.response?.status;
}

function isAxiosError(error: unknown): error is AxiosError {
    return error instanceof Error && 'isAxiosError' in error;
}
