/**
 * faceEmbedding — pipeline COMPLETO: selfie (URI) → embedding (number[]).
 *
 * Etapas (doc de reconhecimento facial do Ponto, Fase 1):
 *   1. Detectar rosto na imagem (`@react-native-ml-kit/face-detection`). Nenhum
 *      rosto → erro claro; vários → usa o MAIOR (maior bounding box).
 *   2. Recortar no bounding box com margem ~20% (clampeado nos limites da imagem)
 *      e redimensionar para 112×112 (`expo-image-manipulator`), saída JPEG.
 *   3. Ler os bytes do JPEG 112×112 (`expo-file-system` File.bytes()), decodificar
 *      com `jpeg-js` → RGBA, montar o tensor Float32 [1,112,112,3] em RGB
 *      normalizado (x-127.5)/128 (ver `preprocess.ts`).
 *   4. Rodar o modelo (`react-native-fast-tflite`) e devolver o embedding.
 *   5. Degradar com elegância: erros são instâncias de `FaceEmbeddingError`
 *      (mensagem pronta p/ UI) ou `FaceModelUnavailableError` — nunca quebram o boot.
 *
 * ⚠️ NÃO alterar o pré-processamento sem revisar `preprocess.ts` — ordem RGB,
 * normalização e shape do tensor são o que faz o reconhecimento funcionar.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { FaceModelUnavailableError, loadFaceModel } from './faceModel';
import {
    MODEL_INPUT_SIZE,
    PreprocessError,
    jpegBytesToInputTensor,
    l2Normalize,
} from './preprocess';

/** Erro do pipeline de embedding com mensagem pronta para exibir ao usuário. */
export class FaceEmbeddingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FaceEmbeddingError';
    }
}

export { FaceModelUnavailableError };

/** Margem relativa aplicada ao bounding box do rosto antes do recorte. */
const CROP_MARGIN = 0.2;

interface FaceFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Detecta rostos na imagem e devolve o frame do MAIOR (maior área). O ML Kit
 * expõe o frame como `{ left, top, width, height }`.
 *
 * @throws {FaceEmbeddingError} se nenhum rosto for detectado.
 */
async function detectLargestFace(uri: string): Promise<FaceFrame> {
    let faces: { frame: { left: number; top: number; width: number; height: number } }[];
    try {
        // Import dinâmico: se o módulo nativo não estiver linkado (Expo Go / build
        // antigo), falha aqui de forma controlada (não no import estático).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FaceDetection = require('@react-native-ml-kit/face-detection').default;
        faces = await FaceDetection.detect(uri, {
            performanceMode: 'accurate',
            landmarkMode: 'none',
            contourMode: 'none',
            classificationMode: 'none',
        });
    } catch (error) {
        throw new FaceModelUnavailableError(
            `Detecção facial indisponível neste build. ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (!faces || faces.length === 0) {
        throw new FaceEmbeddingError('Nenhum rosto detectado, tente novamente.');
    }

    // Maior bounding box (por área).
    let best = faces[0].frame;
    let bestArea = best.width * best.height;
    for (let i = 1; i < faces.length; i++) {
        const f = faces[i].frame;
        const area = f.width * f.height;
        if (area > bestArea) {
            best = f;
            bestArea = area;
        }
    }

    return { x: best.left, y: best.top, width: best.width, height: best.height };
}

/**
 * Aplica margem ao frame e clampa nos limites [0, imgW]×[0, imgH]. Devolve o
 * retângulo de recorte inteiro (originX/originY/width/height) para o manipulator.
 */
function marginCropRect(
    frame: FaceFrame,
    imgWidth: number,
    imgHeight: number
): { originX: number; originY: number; width: number; height: number } {
    const marginX = frame.width * CROP_MARGIN;
    const marginY = frame.height * CROP_MARGIN;

    let left = frame.x - marginX;
    let top = frame.y - marginY;
    let right = frame.x + frame.width + marginX;
    let bottom = frame.y + frame.height + marginY;

    // Clamp nos limites da imagem.
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(imgWidth, right);
    bottom = Math.min(imgHeight, bottom);

    const width = Math.max(1, Math.round(right - left));
    const height = Math.max(1, Math.round(bottom - top));

    return {
        originX: Math.round(left),
        originY: Math.round(top),
        width,
        height,
    };
}

/**
 * Recorta a face (com margem) e redimensiona para 112×112 JPEG. Roda o pipeline
 * nativo do expo-image-manipulator. Retorna a URI do recorte.
 *
 * @throws {FaceEmbeddingError} se a manipulação falhar.
 */
async function cropAndResize(
    uri: string,
    rect: { originX: number; originY: number; width: number; height: number }
): Promise<string> {
    try {
        const ref = await ImageManipulator.manipulate(uri)
            .crop(rect)
            .resize({ width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE })
            .renderAsync();
        // Sem compressão agressiva: qualidade alta preserva os pixels do rosto
        // (o alvo já é 112×112, arquivo minúsculo).
        const result = await ref.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
        return result.uri;
    } catch (error) {
        throw new FaceEmbeddingError(
            `Falha ao processar a imagem do rosto. ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Gera o embedding facial a partir da URI de uma selfie (JPEG).
 *
 * @param uri URI da selfie capturada (file://).
 * @param sourceWidth largura em px da imagem original (do asset da câmera).
 * @param sourceHeight altura em px da imagem original (do asset da câmera).
 * @returns embedding como `number[]` (L2-normalizado), pronto para o backend.
 * @throws {FaceEmbeddingError} rosto ausente / falha de imagem / saída inválida.
 * @throws {FaceModelUnavailableError} módulo nativo/modelo ausente.
 */
export async function generateFaceEmbedding(
    uri: string,
    sourceWidth: number,
    sourceHeight: number
): Promise<number[]> {
    // 1) Detectar rosto (maior, se vários).
    const frame = await detectLargestFace(uri);

    // 2) Recortar (margem + clamp) e redimensionar para 112×112.
    //    Se as dimensões da origem forem desconhecidas, usa o próprio frame como
    //    teto (evita clampar contra 0 e degenerar o recorte).
    const imgW = sourceWidth > 0 ? sourceWidth : frame.x + frame.width;
    const imgH = sourceHeight > 0 ? sourceHeight : frame.y + frame.height;
    const rect = marginCropRect(frame, imgW, imgH);
    const cropUri = await cropAndResize(uri, rect);

    // 3) Ler os bytes do 112×112 e montar o tensor RGB normalizado.
    let tensor: Float32Array;
    try {
        const bytes = await new File(cropUri).bytes();
        tensor = jpegBytesToInputTensor(bytes);
    } catch (error) {
        if (error instanceof PreprocessError) {
            throw new FaceEmbeddingError(error.message);
        }
        throw new FaceEmbeddingError(
            `Falha ao ler a imagem do rosto. ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // 4) Rodar o modelo. `model.run` copia o buffer para memória nativa antes do
    //    dispatch, então é seguro reusar/GC o tensor após a chamada.
    const model = await loadFaceModel();
    let embedding: number[];
    try {
        const outputs = await model.run([tensor.buffer as ArrayBuffer]);
        const out = outputs[0];
        if (!out) {
            throw new FaceEmbeddingError('O modelo não retornou um embedding.');
        }
        embedding = Array.from(new Float32Array(out));
    } catch (error) {
        if (error instanceof FaceEmbeddingError) throw error;
        throw new FaceEmbeddingError(
            `Falha ao gerar o código do rosto. ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Sanidade: o backend aceita 32–2048 números finitos.
    if (embedding.length < 32 || embedding.length > 2048) {
        throw new FaceEmbeddingError(
            `Embedding com tamanho inesperado (${embedding.length}).`
        );
    }
    if (!embedding.every((v) => Number.isFinite(v))) {
        throw new FaceEmbeddingError('Embedding inválido (valores não finitos).');
    }

    // 5) L2-normaliza (opcional; cosseno é invariante a escala) e devolve.
    return l2Normalize(embedding);
}
