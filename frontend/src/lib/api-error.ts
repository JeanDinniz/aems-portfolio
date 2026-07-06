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
export function getApiErrorMessage(error: Error, fallback = 'Tente novamente.'): string {
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

/** Returns the HTTP status code from an Axios error, or undefined. */
export function getApiErrorStatus(error: Error): number | undefined {
    if (!isAxiosError(error)) return undefined;
    return error.response?.status;
}

function isAxiosError(error: unknown): error is AxiosError {
    return error instanceof Error && 'isAxiosError' in error;
}
