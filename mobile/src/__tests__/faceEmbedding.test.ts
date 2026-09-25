import { encode as encodeJpeg } from 'jpeg-js';

import {
    generateFaceEmbedding,
    FaceEmbeddingError,
    FaceModelUnavailableError,
} from '@/services/face/faceEmbedding';
import { MODEL_INPUT_SIZE } from '@/services/face/preprocess';
import { __resetFaceModelForTests } from '@/services/face/faceModel';

declare const global: {
    mockFileBytes: Uint8Array | null;
    mockFaceDetect: {
        faces: Array<{ frame: { left: number; top: number; width: number; height: number } }>;
        detectThrows: boolean;
    };
    mockTflite: {
        loadThrows: boolean;
        runThrows: boolean;
        output: Float32Array;
    };
    mockManipulatorState: {
        resizeCalls: Array<{ width?: number; height?: number }>;
        cropCalls: Array<{ originX: number; originY: number; width: number; height: number }>;
        saveCalls: Array<{ compress: number; format: string }>;
        onRender: null | (() => Promise<void> | void);
    };
};

/**
 * faceEmbedding — pipeline completo (detecção → recorte → decode → modelo).
 *
 * Mocks nativos vêm do jest.setup.js:
 *   - expo-image-manipulator: crop/resize/save (não altera bytes).
 *   - expo-file-system: File.bytes() → global.mockFileBytes.
 *   - react-native-fast-tflite: model.run() → global.mockTflite.output.
 *   - @react-native-ml-kit/face-detection: detect() → global.mockFaceDetect.faces.
 * Colocamos em global.mockFileBytes um JPEG 160×160 real para o preprocess rodar.
 */

function jpeg160(): Uint8Array {
    const size = MODEL_INPUT_SIZE;
    const rgba = new Uint8Array(size * size * 4).fill(150);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // alpha
    const encoded = encodeJpeg({ data: rgba, width: size, height: size }, 90);
    return new Uint8Array(encoded.data);
}

beforeEach(() => {
    global.mockFileBytes = jpeg160();
    global.mockFaceDetect = {
        faces: [{ frame: { left: 40, top: 60, width: 200, height: 200 } }],
        detectThrows: false,
    };
    global.mockTflite = {
        loadThrows: false,
        runThrows: false,
        output: new Float32Array(512).fill(0.1),
    };
    jest.clearAllMocks();
    __resetFaceModelForTests();
});

afterEach(() => {
    // Restaura spies de `jest.spyOn` (ex.: ImageManipulator.manipulate no teste
    // do "maior rosto") sem afetar os mocks de `jest.mock` do jest.setup.js.
    jest.restoreAllMocks();
});

describe('generateFaceEmbedding', () => {
    it('gera um embedding (L2-normalizado) no caminho feliz', async () => {
        const embedding = await generateFaceEmbedding('file:///selfie.jpg', 720, 1280);

        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding.length).toBe(512);
        // L2-normalizado: norma ~1.
        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
        expect(norm).toBeCloseTo(1, 5);
        expect(embedding.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('erro claro quando nenhum rosto é detectado', async () => {
        global.mockFaceDetect.faces = [];
        await expect(generateFaceEmbedding('file:///s.jpg', 720, 1280)).rejects.toThrow(
            FaceEmbeddingError
        );
        await expect(generateFaceEmbedding('file:///s.jpg', 720, 1280)).rejects.toThrow(
            /nenhum rosto/i
        );
    });

    it('escolhe o MAIOR rosto quando há vários', async () => {
        global.mockManipulatorState.cropCalls = [];
        global.mockFaceDetect.faces = [
            { frame: { left: 0, top: 0, width: 50, height: 50 } }, // pequeno
            { frame: { left: 100, top: 100, width: 300, height: 300 } }, // MAIOR
        ];

        await generateFaceEmbedding('file:///s.jpg', 1000, 1000);

        // O recorte deve ter usado o frame do rosto MAIOR (origin perto de 100 - margem).
        const calls = global.mockManipulatorState.cropCalls;
        const rect = calls[calls.length - 1];
        expect(rect).toBeDefined();
        expect(rect.originX).toBeGreaterThan(0);
        expect(rect.originX).toBeLessThan(100); // 100 - margem (60), clampeado a >=0
        expect(rect.width).toBeGreaterThan(300); // 300 + 2*margem, clampeado a 1000
    });

    it('propaga FaceModelUnavailableError quando o modelo não carrega', async () => {
        global.mockTflite.loadThrows = true;
        await expect(generateFaceEmbedding('file:///s.jpg', 720, 1280)).rejects.toThrow(
            FaceModelUnavailableError
        );
    });

    it('propaga FaceModelUnavailableError quando a detecção nativa falha', async () => {
        global.mockFaceDetect.detectThrows = true;
        await expect(generateFaceEmbedding('file:///s.jpg', 720, 1280)).rejects.toThrow(
            FaceModelUnavailableError
        );
    });

    it('erro claro quando o embedding tem tamanho fora do aceito (< 32)', async () => {
        global.mockTflite.output = new Float32Array(8).fill(0.5);
        await expect(generateFaceEmbedding('file:///s.jpg', 720, 1280)).rejects.toThrow(
            /tamanho inesperado/i
        );
    });
});
