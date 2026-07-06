export interface CompressionOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number; // 0-1
}

export async function compressImage(
    file: File,
    options: CompressionOptions
): Promise<Blob> {
    // Probe leve a 32px para obter proporção sem decodificar a imagem inteira.
    // Foto de 12MP decodificada na resolução original = ~46MB; aqui = ~3KB.
    const probe = await createImageBitmap(file, { resizeWidth: 32 })
    const ratio = probe.height / probe.width
    const isPortrait = probe.height > probe.width
    probe.close()

    // Dimensões alvo mantendo proporção dentro dos limites configurados
    let targetW: number
    let targetH: number
    if (isPortrait) {
        targetH = Math.min(options.maxHeight, Math.round(options.maxWidth * ratio))
        targetW = Math.round(targetH / ratio)
    } else {
        targetW = Math.min(options.maxWidth, Math.round(options.maxHeight / ratio))
        targetH = Math.round(targetW * ratio)
    }

    // Decodifica direto no tamanho alvo — pico de memória ~8MB (era ~46MB)
    const bitmap = await createImageBitmap(file, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
    })

    const canvas = new OffscreenCanvas(targetW, targetH)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        bitmap.close()
        throw new Error('Failed to get canvas context')
    }

    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    const blob = await canvas.convertToBlob({ type: file.type, quality: options.quality })
    if (!blob) {
        throw new Error('Failed to compress image')
    }

    return blob
}
