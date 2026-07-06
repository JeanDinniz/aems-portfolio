import { compressPhoto, CompressionError } from '@/services/camera/compressPhoto';
import type { LocalPhotoAsset } from '@/types/photo.types';

/**
 * CAM-02 — compressPhoto (expo-image-manipulator + expo-file-system mockados em
 * jest.setup.js). Testa: resize só quando o maior lado > 1600, JPEG 0.7, mime de
 * saída, serialização (mutex) e validação de 10 MB.
 *
 * `global.mockManipulatorState` e `global.mockFileSize` são definidos no setup.
 */
declare const global: {
    mockManipulatorState: {
        resizeCalls: { width?: number; height?: number }[];
        saveCalls: { compress: number; format: string }[];
        onRender: null | (() => Promise<void> | void);
    };
    mockFileSize: number;
};

const state = global.mockManipulatorState;

beforeEach(() => {
    state.resizeCalls.length = 0;
    state.saveCalls.length = 0;
    state.onRender = null;
    global.mockFileSize = 500 * 1024; // 500 KB
});

function asset(over: Partial<LocalPhotoAsset> = {}): LocalPhotoAsset {
    return { uri: 'file:///big.jpg', width: 4000, height: 3000, ...over };
}

describe('compressPhoto — resize', () => {
    it('redimensiona pelo maior lado quando > 1600 (paisagem → width)', async () => {
        await compressPhoto(asset({ width: 4000, height: 3000 }));
        expect(state.resizeCalls).toHaveLength(1);
        expect(state.resizeCalls[0]).toEqual({ width: 1600 });
    });

    it('redimensiona pela altura quando o lado maior é vertical', async () => {
        await compressPhoto(asset({ width: 3000, height: 4000 }));
        expect(state.resizeCalls[0]).toEqual({ height: 1600 });
    });

    it('NÃO redimensiona imagens já pequenas (maior lado ≤ 1600)', async () => {
        await compressPhoto(asset({ width: 1200, height: 800 }));
        expect(state.resizeCalls).toHaveLength(0);
    });

    it('dimensões desconhecidas → limita a largura por padrão', async () => {
        await compressPhoto(asset({ width: undefined, height: undefined }));
        expect(state.resizeCalls[0]).toEqual({ width: 1600 });
    });
});

describe('compressPhoto — saída', () => {
    it('salva como JPEG com compress 0.7 e retorna mime image/jpeg', async () => {
        const result = await compressPhoto(asset());
        expect(state.saveCalls[0]).toMatchObject({ compress: 0.7, format: 'jpeg' });
        expect(result.mime).toBe('image/jpeg');
        expect(result.name).toBe('photo.jpg');
        expect(result.uri).toContain('.jpg');
    });
});

describe('compressPhoto — serialização (mutex)', () => {
    it('duas chamadas concorrentes NÃO rodam a manipulação em paralelo', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        // onRender simula o trabalho nativo; medimos a concorrência máxima.
        state.onRender = async () => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise((r) => setTimeout(r, 10));
            concurrent -= 1;
        };

        await Promise.all([compressPhoto(asset()), compressPhoto(asset())]);

        // Se fosse paralelo, maxConcurrent chegaria a 2.
        expect(maxConcurrent).toBe(1);
        expect(state.saveCalls).toHaveLength(2);
    });

    it('a 2ª chamada resolve DEPOIS da 1ª (ordem preservada)', async () => {
        const order: string[] = [];
        let n = 0;
        state.onRender = async () => {
            const id = ++n;
            await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1));
            order.push(`render${id}`);
        };

        const p1 = compressPhoto(asset()).then(() => order.push('done1'));
        const p2 = compressPhoto(asset()).then(() => order.push('done2'));
        await Promise.all([p1, p2]);

        // A 1ª termina antes da 2ª começar, apesar do render1 ser mais lento.
        expect(order).toEqual(['render1', 'done1', 'render2', 'done2']);
    });
});

describe('compressPhoto — validação de tamanho (10 MB)', () => {
    it('lança CompressionError quando o resultado excede 10 MB', async () => {
        global.mockFileSize = 11 * 1024 * 1024; // 11 MB
        await expect(compressPhoto(asset())).rejects.toBeInstanceOf(CompressionError);
    });

    it('um erro NÃO trava a cadeia: a próxima compressão ainda funciona', async () => {
        global.mockFileSize = 11 * 1024 * 1024;
        await expect(compressPhoto(asset())).rejects.toBeInstanceOf(CompressionError);

        global.mockFileSize = 500 * 1024;
        const ok = await compressPhoto(asset());
        expect(ok.mime).toBe('image/jpeg');
    });
});
