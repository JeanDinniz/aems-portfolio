/**
 * Adaptado para React Native (Bloco B).
 *
 * Diferenças em relação ao web (frontend/src/utils/fileValidation.ts):
 * - Assinatura agora aceita `{ type: string; size: number }` em vez de `File` (DOM).
 * - Limite ajustado para 10 MB (limite real do backend: POST /upload/photo).
 *   O web usava 25 MB.
 * - Tipos aceitos ampliados para incluir HEIC/HEIF (câmeras iOS).
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — limite real do backend
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export interface ValidatableFile {
    type: string;
    size: number;
}

export function validateImageFile(file: ValidatableFile): { valid: boolean; error?: string } {
    if (!ACCEPTED_TYPES.includes(file.type)) {
        return {
            valid: false,
            error: 'Formato não suportado. Use JPG, PNG, WebP ou HEIC.',
        };
    }

    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: `Arquivo muito grande. Máximo: 10MB. Tamanho: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        };
    }

    return { valid: true };
}
