import { AxiosError } from 'axios';

/**
 * FastAPI validation error item shape.
 */
interface ValidationErrorItem {
    loc: (string | number)[];
    msg: string;
    type: string;
}

/**
 * Possible shapes of FastAPI error responses.
 */
interface ApiErrorData {
    detail?: string | ValidationErrorItem[];
    message?: string;
}

/**
 * Extract a human-readable error message from an Axios/API error.
 * Handles both FastAPI string details and validation error arrays.
 */
export function getApiErrorMessage(error: unknown, fallback = 'Tente novamente.'): string {
    if (!isAxiosError(error)) return fallback;

    const data = error.response?.data as ApiErrorData | undefined;
    if (!data) return fallback;

    if (error.response?.status === 403) {
        return 'Você não tem permissão para realizar esta ação.';
    }

    if (typeof data.detail === 'string') return data.detail;

    // Pydantic validation arrays contain technical field names — never expose them
    if (Array.isArray(data.detail)) return fallback;

    if (typeof data.message === 'string') return data.message;

    return fallback;
}

/**
 * Como `getApiErrorMessage`, mas para requests com `responseType: 'blob'`
 * (ex.: export de PDF/Excel): quando a resposta de erro chega, o axios ainda
 * entrega `error.response.data` como Blob (não como JSON já parseado) — dá
 * pra ler o texto e tentar extrair o `detail` do FastAPI antes de desistir.
 */
export async function getApiErrorMessageFromBlob(
    error: unknown,
    fallback = 'Tente novamente.'
): Promise<string> {
    if (!isAxiosError(error)) return fallback;

    const data: unknown = error.response?.data;
    if (data instanceof Blob) {
        try {
            const text = await data.text();
            const parsed = JSON.parse(text) as ApiErrorData;
            if (typeof parsed.detail === 'string') return parsed.detail;
            if (typeof parsed.message === 'string') return parsed.message;
        } catch {
            // corpo do erro não era JSON legível — cai no fallback abaixo
        }
        return fallback;
    }

    return getApiErrorMessage(error, fallback);
}

/** Returns the HTTP status code from an Axios error, or undefined. */
export function getApiErrorStatus(error: unknown): number | undefined {
    if (!isAxiosError(error)) return undefined;
    return error.response?.status;
}

function isAxiosError(error: unknown): error is AxiosError {
    return error instanceof Error && 'isAxiosError' in error;
}
