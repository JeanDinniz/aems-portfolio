const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — câmeras modernas geram JPEG de 5-15MB; compressImage reduz antes do upload

// Extensões aceitas quando o navegador não informa o MIME type (file.type === '').
// Celulares (galeria/compartilhamento) frequentemente entregam o arquivo sem MIME,
// especialmente no Android. HEIC/HEIF é o formato padrão de fotos do iPhone.
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'];

export function validateImageFile(file: File): { valid: boolean; error?: string } {
    // Aceita qualquer imagem que o navegador reconheça (image/jpeg, image/png,
    // image/heic, etc.). Quando o MIME vem vazio — comum na galeria do celular —
    // valida pela extensão do nome; a decodificação real fica a cargo do
    // compressImage (createImageBitmap), que é o juiz final do que dá para abrir.
    const type = file.type?.toLowerCase() ?? '';
    if (type === '') {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            return {
                valid: false,
                error: 'Formato não suportado. Envie uma foto (JPG, PNG, HEIC ou WebP).',
            };
        }
    } else if (!type.startsWith('image/')) {
        return {
            valid: false,
            error: 'Formato não suportado. Envie uma foto (JPG, PNG, HEIC ou WebP).',
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
