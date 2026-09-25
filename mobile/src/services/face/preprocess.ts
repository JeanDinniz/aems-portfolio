/**
 * preprocess — pré-processamento da selfie para o tensor de entrada do modelo.
 *
 * ⚠️ CRÍTICO: se qualquer detalhe aqui divergir do treinamento do modelo, o
 * embedding vira lixo e o reconhecimento não funciona. Contrato EXATO:
 *   - Entrada do modelo: 112×112, RGB (3 canais, sem alpha).
 *   - Normalização por pixel: (valor - 127.5) / 128  → faixa ≈ [-1, 1].
 *   - Shape do tensor: [1, 112, 112, 3] (NHWC), Float32.
 *   - Ordem dos pixels: linha a linha (row-major), R, G, B por pixel.
 *
 * Contrato do MobileFaceNet (InsightFace) confirmado no código-fonte do modelo
 * (MyUtil.normalizeImage: imageMean=127.5, imageStd=128; INPUT_IMAGE_SIZE=112).
 *
 * O decode do JPEG 112×112 vem de `jpeg-js` (JS puro) como RGBA (4 canais). Aqui
 * descartamos o canal alpha e aplicamos a normalização, montando o Float32Array
 * no formato esperado pelo TFLite.
 */

import { decode as decodeJpeg } from 'jpeg-js';

import { base64ToUint8Array } from './base64';

export { base64ToUint8Array };

/** Lado do quadrado de entrada do modelo (px). MobileFaceNet = 112. */
export const MODEL_INPUT_SIZE = 112;
/** Canais de cor esperados pelo modelo (RGB, sem alpha). */
export const MODEL_CHANNELS = 3;
/** Normalização por pixel: (x - MEAN) / STD → ≈[-1, 1]. MobileFaceNet: mean 127.5, std 128. */
const NORM_MEAN = 127.5;
const NORM_STD = 128;

/** Falha ao decodificar/converter os pixels da selfie. */
export class PreprocessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PreprocessError';
    }
}

/**
 * Decodifica os BYTES de um JPEG 112×112 e devolve o tensor Float32 [1,112,112,3]
 * em RGB normalizado para ≈[-1, 1], pronto para `model.run([tensor.buffer])`.
 *
 * @param bytes conteúdo do arquivo JPEG 112×112 (Uint8Array cru).
 * @throws {PreprocessError} se o decode falhar ou as dimensões não baterem.
 */
export function jpegBytesToInputTensor(bytes: Uint8Array): Float32Array {
    let raw: { width: number; height: number; data: Uint8Array };
    try {
        // useTArray:true → `data` como Uint8Array (evita cópia extra do Buffer).
        raw = decodeJpeg(bytes, { useTArray: true });
    } catch (error) {
        throw new PreprocessError(
            `Falha ao decodificar a imagem do rosto. ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const { width, height, data } = raw;
    if (width !== MODEL_INPUT_SIZE || height !== MODEL_INPUT_SIZE) {
        throw new PreprocessError(
            `Dimensão inesperada do recorte (${width}×${height}); esperado ${MODEL_INPUT_SIZE}×${MODEL_INPUT_SIZE}.`
        );
    }

    const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
    // jpeg-js sempre devolve RGBA (4 bytes/pixel).
    const expectedRgba = pixelCount * 4;
    if (data.length < expectedRgba) {
        throw new PreprocessError(
            `Buffer de pixels curto (${data.length} < ${expectedRgba}).`
        );
    }

    // Tensor [1,112,112,3] em ordem RGB, normalizado. Percorremos os pixels em
    // sequência (row-major) e descartamos o alpha (índice +3 do RGBA).
    const tensor = new Float32Array(pixelCount * MODEL_CHANNELS);
    for (let p = 0; p < pixelCount; p++) {
        const src = p * 4; // R,G,B,A no buffer de origem
        const dst = p * 3; // R,G,B no tensor de destino
        tensor[dst] = (data[src] - NORM_MEAN) / NORM_STD; // R
        tensor[dst + 1] = (data[src + 1] - NORM_MEAN) / NORM_STD; // G
        tensor[dst + 2] = (data[src + 2] - NORM_MEAN) / NORM_STD; // B
    }

    return tensor;
}

/**
 * Conveniência: decodifica um JPEG 112×112 em base64 (fallback quando só há a
 * string base64, ex.: `saveAsync({ base64: true })`). Reaproveita o decoder puro.
 *
 * @throws {PreprocessError} se o decode falhar ou as dimensões não baterem.
 */
export function jpegBase64ToInputTensor(base64: string): Float32Array {
    return jpegBytesToInputTensor(base64ToUint8Array(base64));
}

/**
 * L2-normaliza um embedding in-place-safe (retorna novo array). Opcional: o
 * backend compara por cosseno (invariante a escala), mas normalizar deixa os
 * valores num range estável. Se a norma for ~0 (degenerado), devolve o original.
 */
export function l2Normalize(vector: number[]): number[] {
    let sumSq = 0;
    for (const v of vector) sumSq += v * v;
    const norm = Math.sqrt(sumSq);
    if (!Number.isFinite(norm) || norm < 1e-10) return vector;
    return vector.map((v) => v / norm);
}
