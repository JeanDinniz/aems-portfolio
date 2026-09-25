/**
 * CAM-02 — Compressão nativa de imagem (substitui imageCompression.ts do web).
 *
 * O web usa `createImageBitmap` + `OffscreenCanvas` (inexistentes no RN). Aqui
 * usamos `expo-image-manipulator`, que delega para a camada nativa — muito mais
 * eficiente em memória. Doc 04 §3.
 *
 * Regras anti-pico de memória (OBRIGATÓRIAS):
 * - Processar UMA foto por vez (serial). NUNCA `Promise.all` de N imagens grandes.
 * - Comprimir imediatamente após capturar.
 * - Alvo: maior lado ~1280px; JPEG `compress: 0.65` (ADR upload moderado 2026-08-31).
 * - Validar o resultado com `utils/fileValidation.ts` antes de enfileirar/enviar.
 *
 * API expo-image-manipulator v14 (contextual/object-oriented):
 *   ImageManipulator.manipulate(uri).resize({ width|height }).renderAsync()
 *   → ImageRef → ref.saveAsync({ compress, format: SaveFormat.JPEG }) → ImageResult
 * (A antiga `manipulateAsync` está DEPRECADA na v14 — não usamos.)
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { validateImageFile } from '@/utils/fileValidation';
import type { LocalPhotoAsset } from '@/types/photo.types';

// Upload mobile "moderado" (ADR 2026-08-31): foto menor = arquivo menor = sobe
// mais rápido em rede de loja/galpão, mantendo legibilidade para a conferência.
// REVERTER para o pré-ADR: MAX_DIMENSION=1600, JPEG_QUALITY=0.7. Ver ADR.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.65;
const OUTPUT_MIME = 'image/jpeg';

/** Erro de compressão (inclui falha de validação do resultado). */
export class CompressionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CompressionError';
    }
}

/**
 * Mutex simples para garantir compressão SERIAL mesmo se chamada de pontos
 * diferentes "ao mesmo tempo". Cada chamada espera a anterior terminar — nunca
 * há duas manipulações nativas de imagens grandes em paralelo.
 */
let chain: Promise<unknown> = Promise.resolve();

function runSerial<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    // Mantém a cadeia viva mesmo se uma tarefa rejeitar (não propaga o erro adiante).
    chain = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}

/**
 * Calcula o `{ width }` ou `{ height }` alvo do resize preservando proporção.
 * Só reduz (nunca amplia). Passando apenas um eixo, o manipulator calcula o outro.
 */
function resizeTarget(
    width?: number,
    height?: number
): { width?: number; height?: number } | null {
    if (!width || !height || width <= 0 || height <= 0) {
        // Dimensões desconhecidas: limita o maior lado pela largura, sem ampliar.
        return { width: MAX_DIMENSION };
    }
    const largest = Math.max(width, height);
    if (largest <= MAX_DIMENSION) return null; // já é pequena o bastante

    return width >= height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION };
}

/**
 * Comprime UM asset: resize para ~1280px no maior lado + JPEG 0.65.
 * Roda serialmente (ver `runSerial`) e valida o resultado (tipo + 10 MB).
 *
 * @throws {CompressionError} se a manipulação falhar ou o resultado for inválido.
 */
export function compressPhoto(asset: LocalPhotoAsset): Promise<LocalPhotoAsset> {
    return runSerial(async () => {
        const target = resizeTarget(asset.width, asset.height);

        let context = ImageManipulator.manipulate(asset.uri);
        if (target) {
            context = context.resize(target);
        }

        let result;
        try {
            const ref = await context.renderAsync();
            result = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
        } catch (error) {
            throw new CompressionError(
                error instanceof Error
                    ? `Falha ao comprimir a imagem: ${error.message}`
                    : 'Falha ao comprimir a imagem.'
            );
        }

        // Tamanho do arquivo comprimido (síncrono na API File da v19) para validar 10 MB.
        let size = 0;
        try {
            size = new File(result.uri).size ?? 0;
        } catch {
            size = 0; // sem tamanho confiável → valida só o tipo (size 0 passa no limite)
        }

        const validation = validateImageFile({ type: OUTPUT_MIME, size });
        if (!validation.valid) {
            throw new CompressionError(validation.error ?? 'Imagem inválida após compressão.');
        }

        return {
            uri: result.uri,
            width: result.width,
            height: result.height,
            mime: OUTPUT_MIME,
            name: 'photo.jpg',
        };
    });
}
