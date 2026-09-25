/**
 * CAM-03 — Upload de foto ao backend.
 *
 * Endpoint: POST /upload/photo (multipart, campo `file`, máx 10 MB,
 * tipos JPEG/PNG/WebP/HEIC). Retorna `{ url }`.
 *
 * Diferenças vs web: no RN o `file` do FormData é o objeto
 * `{ uri, name, type }` (não um `Blob`/`File` do DOM). Timeout de 60s por
 * request (o apiClient global usa 30s — sobrescrevemos aqui).
 *
 * Tratamento de erro: 413 (muito grande), 415 (tipo não suportado), 422
 * (validação) recebem mensagens claras; demais erros reaproveitam
 * `getApiErrorMessage` de `@/lib/api-error`.
 */
import { apiClient } from '@/services/api/client';
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/api-error';
import type { LocalPhotoAsset } from '@/types/photo.types';

// Upload mobile "moderado" (ADR 2026-08-31): 60s em vez de 120s para uma conexão
// morta cair no backoff/retry da fila mais cedo (rede instável de galpão), em vez
// de "pendurar" até 2min. REVERTER = 120_000. Ver ADR.
const UPLOAD_TIMEOUT_MS = 60_000;

/** Progresso 0-100 do upload de uma foto. */
export type UploadProgressHandler = (percent: number) => void;

/** Erro de upload com mensagem pronta para a UI. */
export class UploadError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = 'UploadError';
        this.status = status;
    }
}

interface UploadResponse {
    url: string;
}

/** Monta o campo `file` do FormData no formato esperado pelo RN. */
function buildFormData(asset: LocalPhotoAsset): FormData {
    const form = new FormData();
    form.append('file', {
        uri: asset.uri,
        name: asset.name ?? 'photo.jpg',
        type: asset.mime ?? 'image/jpeg',
        // O React Native aceita este shape para multipart; o typing do DOM não.
    } as unknown as Blob);
    return form;
}

function messageForStatus(status: number | undefined, error: Error): string {
    switch (status) {
        case 413:
            return 'Imagem muito grande. O limite é 10 MB.';
        case 415:
            return 'Formato de imagem não suportado. Use JPG, PNG, WebP ou HEIC.';
        case 422:
            return 'A imagem não pôde ser processada pelo servidor.';
        default:
            return getApiErrorMessage(error, 'Falha ao enviar a foto. Tente novamente.');
    }
}

/**
 * Envia o asset (idealmente já comprimido) e devolve a `url` no servidor.
 * @param onProgress callback opcional com o progresso 0-100.
 * @throws {UploadError} com mensagem amigável em qualquer falha.
 */
export async function uploadPhoto(
    asset: LocalPhotoAsset,
    onProgress?: UploadProgressHandler
): Promise<string> {
    const form = buildFormData(asset);

    try {
        const response = await apiClient.post<UploadResponse>('/upload/photo', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: UPLOAD_TIMEOUT_MS,
            onUploadProgress: (event) => {
                if (!onProgress) return;
                const total = event.total ?? 0;
                if (total > 0) {
                    onProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
                }
            },
        });

        const url = response.data?.url;
        if (!url) {
            throw new UploadError('Resposta inválida do servidor ao enviar a foto.');
        }
        return url;
    } catch (error) {
        if (error instanceof UploadError) throw error;
        const err = error as Error;
        const status = getApiErrorStatus(err);
        throw new UploadError(messageForStatus(status, err), status);
    }
}
