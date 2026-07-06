const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — câmeras modernas geram JPEG de 5-15MB; compressImage reduz antes do upload
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImageFile(file: File): { valid: boolean; error?: string } {
    if (!ACCEPTED_TYPES.includes(file.type)) {
        return {
            valid: false,
            error: 'Formato não suportado. Use JPG, PNG ou WebP.',
        };
    }

    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: `Arquivo muito grande. Máximo: 25MB. Tamanho: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        };
    }

    return { valid: true };
}
