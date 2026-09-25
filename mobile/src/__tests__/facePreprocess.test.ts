import { encode as encodeJpeg } from 'jpeg-js';

import {
    MODEL_CHANNELS,
    MODEL_INPUT_SIZE,
    PreprocessError,
    jpegBytesToInputTensor,
    l2Normalize,
} from '@/services/face/preprocess';

/**
 * preprocess — o coração do reconhecimento: ordem RGB, normalização (x-127.5)/128
 * e shape [1,112,112,3]. Geramos um JPEG 112×112 conhecido com jpeg-js e validamos
 * que o tensor sai correto. (JPEG é com perdas: usamos tolerância ampla.)
 */

/** Cria um JPEG 112×112 preenchido com uma cor RGB uniforme. */
function solidColorJpeg(r: number, g: number, b: number): Uint8Array {
    const size = MODEL_INPUT_SIZE;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
    }
    const encoded = encodeJpeg({ data: rgba, width: size, height: size }, 100);
    return new Uint8Array(encoded.data);
}

describe('jpegBytesToInputTensor', () => {
    it('produz um tensor [1,112,112,3] (comprimento correto)', () => {
        const tensor = jpegBytesToInputTensor(solidColorJpeg(128, 128, 128));
        expect(tensor).toBeInstanceOf(Float32Array);
        expect(tensor.length).toBe(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * MODEL_CHANNELS);
    });

    it('normaliza cinza médio (127/128) para ~0', () => {
        const tensor = jpegBytesToInputTensor(solidColorJpeg(128, 128, 128));
        // (128-127.5)/128 ≈ 0.0039; JPEG dá pequena variação → tolerância.
        for (let i = 0; i < 30; i++) {
            expect(Math.abs(tensor[i])).toBeLessThan(0.1);
        }
    });

    it('mapeia branco (255) para ~+1 e preserva a ordem RGB', () => {
        // Cor distinta por canal: R alto, G médio, B baixo — confirma a ordem.
        const tensor = jpegBytesToInputTensor(solidColorJpeg(255, 128, 0));
        const r = tensor[0];
        const g = tensor[1];
        const b = tensor[2];
        // (255-127.5)/128 = 1 ; (128-...)≈0 ; (0-127.5)/128 = -1
        expect(r).toBeGreaterThan(0.8); // R perto de +1
        expect(Math.abs(g)).toBeLessThan(0.3); // G perto de 0
        expect(b).toBeLessThan(-0.8); // B perto de -1
        // Todos dentro de [-1, 1].
        expect(r).toBeLessThanOrEqual(1.001);
        expect(b).toBeGreaterThanOrEqual(-1.001);
    });

    it('rejeita dimensões diferentes de 112×112', () => {
        const size = 64;
        const rgba = new Uint8Array(size * size * 4).fill(200);
        const encoded = encodeJpeg({ data: rgba, width: size, height: size }, 90);
        expect(() => jpegBytesToInputTensor(new Uint8Array(encoded.data))).toThrow(PreprocessError);
    });

    it('rejeita bytes que não são JPEG', () => {
        expect(() => jpegBytesToInputTensor(new Uint8Array([1, 2, 3, 4]))).toThrow(PreprocessError);
    });
});

describe('l2Normalize', () => {
    it('normaliza o vetor para norma unitária', () => {
        const out = l2Normalize([3, 4]);
        const norm = Math.sqrt(out[0] ** 2 + out[1] ** 2);
        expect(norm).toBeCloseTo(1, 6);
        expect(out[0]).toBeCloseTo(0.6, 6);
        expect(out[1]).toBeCloseTo(0.8, 6);
    });

    it('devolve o vetor original se a norma for ~0', () => {
        const zero = [0, 0, 0];
        expect(l2Normalize(zero)).toEqual(zero);
    });
});
