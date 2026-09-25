/**
 * VID-01 — Upload de vídeo ao backend.
 *
 * Endpoint: POST /upload/video (multipart, campo `file`, máx 50 MB,
 * tipos video/mp4 e video/quicktime). Retorna `{ url }`.
 *
 * Espelha uploadPhoto.ts: mesma estrutura de FormData, timeout e tratamento
 * de erros. Diferenças:
 *   - Endpoint /upload/video (não /upload/photo)
 *   - Limite de tamanho: 50 MB (não 10 MB)
 *   - Tipos aceitos: video/mp4, video/quicktime (MOV)
 */
import { apiClient } from '@/services/api/client';
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/api-error';

const UPLOAD_TIMEOUT_MS = 180_000; // 3 min — vídeos são maiores que fotos
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

/** Erro de upload com mensagem pronta para a UI. */
export class UploadVideoError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = 'UploadVideoError';
        this.status = status;
    }
}

/** Asset de vídeo local selecionado/capturado. */
export interface LocalVideoAsset {
    uri: string;
    name?: string;
    mime?: string;
    /** Tamanho em bytes (preenchido pelo picker quando disponível). */
    fileSize?: number;
}

interface UploadResponse {
    url: string;
}

/** Progresso 0-100 do upload do vídeo. */
export type UploadVideoProgressHandler = (percent: number) => void;

/** Monta o campo `file` do FormData no formato esperado pelo RN (não usa Blob do DOM). */
function buildFormData(asset: LocalVideoAsset): FormData {
    const form = new FormData();
    form.append('file', {
        uri: asset.uri,
        name: asset.name ?? 'video.mp4',
        type: asset.mime ?? 'video/mp4',
    } as unknown as Blob);
    return form;
}

function messageForStatus(status: number | undefined, error: Error): string {
    switch (status) {
        case 413:
            return 'Vídeo muito grande. O limite é 50 MB.';
        case 415:
            return 'Formato de vídeo não suportado. Use MP4 ou MOV.';
        case 422:
            return 'O vídeo não pôde ser processado pelo servidor.';
        default:
            return getApiErrorMessage(error, 'Falha ao enviar o vídeo. Tente novamente.');
    }
}

/**
 * Valida o tamanho do vídeo ANTES do upload (evita enviar 50 MB só para receber 413).
 * @throws {UploadVideoError} se fileSize estiver disponível e exceder 50 MB.
 */
export function validateVideoSize(asset: LocalVideoAsset): void {
    if (asset.fileSize !== undefined && asset.fileSize > MAX_VIDEO_BYTES) {
        const mb = (asset.fileSize / (1024 * 1024)).toFixed(1);
        throw new UploadVideoError(
            `Vídeo muito grande (${mb} MB). O limite é 50 MB. Grave um vídeo mais curto.`
        );
    }
}

/**
 * Envia o vídeo e devolve a `url` no servidor.
 * Valida o tamanho localmente antes de tentar o upload.
 * @param onProgress callback opcional com o progresso 0-100.
 * @throws {UploadVideoError} com mensagem amigável em qualquer falha.
 */
export async function uploadVideo(
    asset: LocalVideoAsset,
    onProgress?: UploadVideoProgressHandler
): Promise<string> {
    // Validação de tamanho local (fail-fast antes de abrir o multipart)
    validateVideoSize(asset);

    const form = buildFormData(asset);

    try {
        const response = await apiClient.post<UploadResponse>('/upload/video', form, {
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
            throw new UploadVideoError('Resposta inválida do servidor ao enviar o vídeo.');
        }
        return url;
    } catch (error) {
        if (error instanceof UploadVideoError) throw error;
        const err = error as Error;
        const status = getApiErrorStatus(err);
        throw new UploadVideoError(messageForStatus(status, err), status);
    }
}
