/**
 * CAM-05 — uploadQueue (fila offline persistente).
 *
 * Mocka `uploadPhoto` (sucesso/erro) e usa os mocks globais de expo-file-system
 * (copy/exists em memória) e netinfo (listeners disparáveis). Cobre: enqueue +
 * cópia + persistência, processamento serial, retry com backoff exponencial,
 * reprocesso em reconexão de rede, helpers de rascunho de O.S., persistência
 * entre "sessões" (rehidratação) e poda.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalPhotoAsset } from '@/types/photo.types';

// Globais expostos pelos mocks de jest.setup.js (FileSystem em memória + netinfo).
declare const global: {
    mockFileSystemFiles: Set<string>;
    mockNetInfo: { listeners: Set<(state: { isConnected: boolean }) => void> };
};

const mockUpload = jest.fn();
jest.mock('@/services/upload/uploadPhoto', () => ({
    uploadPhoto: (...a: unknown[]) => mockUpload(...a),
    UploadError: class UploadError extends Error {},
}));

// Import dinâmico para permitir resetModules entre os blocos de rehidratação.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queue: typeof import('@/services/upload/uploadQueue');

const asset: LocalPhotoAsset = {
    uri: 'file:///comp.jpg',
    mime: 'image/jpeg',
    name: 'photo.jpg',
};

/**
 * Drena a cadeia de processamento serial (enqueue → processQueue → hydrate →
 * uploadPhoto → persist → notify), que encadeia vários awaits. Sob real timers,
 * cada `setTimeout(0)` cede um macrotask e esvazia a fila de microtasks entre eles.
 */
async function flush() {
    for (let i = 0; i < 25; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

beforeEach(async () => {
    jest.useRealTimers();
    jest.clearAllMocks();
    global.mockFileSystemFiles = new Set(['file:///comp.jpg']); // o asset de origem "existe"
    await AsyncStorage.clear();
    queue = require('@/services/upload/uploadQueue');
    await queue.resetForTests();
    mockUpload.mockResolvedValue('https://cdn/aems/photo.jpg');
});

afterEach(async () => {
    // Evita vazamento de timers de backoff/listeners de ciclo de vida entre suítes
    // (o worker do Jest reclama de "active timers" se um setTimeout ficar pendente).
    queue.stopLifecycle();
    await queue.resetForTests();
    jest.useRealTimers();
});

describe('enqueue', () => {
    it('copia o arquivo para o diretório do app, persiste e retorna o id', async () => {
        const id = await queue.enqueue(asset, { id: 'p1', osDraftId: 'os-1' });
        expect(id).toBe('p1');

        // Arquivo copiado para o diretório da fila.
        const item = queue.getItem('p1');
        expect(item).toBeDefined();
        expect(item!.localUri).toContain('aems-upload-queue');
        expect(global.mockFileSystemFiles.has(item!.localUri)).toBe(true);

        // Persistido em AsyncStorage.
        const raw = await AsyncStorage.getItem('aems_upload_queue_v1');
        expect(raw).toContain('p1');
        expect(raw).toContain('os-1');
    });

    it('processa e marca como enviado, guardando a url', async () => {
        await queue.enqueue(asset, { id: 'p1' });
        await flush();
        const item = queue.getItem('p1');
        expect(item!.status).toBe('uploaded');
        expect(item!.url).toBe('https://cdn/aems/photo.jpg');
        expect(item!.progress).toBe(100);
        expect(mockUpload).toHaveBeenCalledTimes(1);
    });
});

describe('processamento serial', () => {
    it('envia um por vez (nunca dois uploads simultâneos)', async () => {
        let inFlight = 0;
        let maxConcurrent = 0;
        mockUpload.mockImplementation(async () => {
            inFlight += 1;
            maxConcurrent = Math.max(maxConcurrent, inFlight);
            await Promise.resolve();
            inFlight -= 1;
            return 'https://cdn/x.jpg';
        });

        await queue.enqueue(asset, { id: 'a' });
        await queue.enqueue(asset, { id: 'b' });
        await queue.enqueue(asset, { id: 'c' });
        await flush();
        await flush();

        expect(maxConcurrent).toBe(1);
        expect(queue.getItem('a')!.status).toBe('uploaded');
        expect(queue.getItem('b')!.status).toBe('uploaded');
        expect(queue.getItem('c')!.status).toBe('uploaded');
    });
});

describe('retry com backoff exponencial', () => {
    it('em falha marca erro, incrementa attempts e reagenda (1s)', async () => {
        jest.useFakeTimers();
        mockUpload.mockRejectedValueOnce(new Error('rede caiu'));
        mockUpload.mockResolvedValueOnce('https://cdn/ok.jpg');

        await queue.enqueue(asset, { id: 'p1' });
        // deixa a 1ª tentativa falhar
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        let item = queue.getItem('p1');
        expect(item!.status).toBe('error');
        expect(item!.attempts).toBe(1);

        // 1ª retry agendada em 1s (2^0 * 1000)
        await jest.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        item = queue.getItem('p1');
        expect(item!.status).toBe('uploaded');
        expect(item!.url).toBe('https://cdn/ok.jpg');
        expect(mockUpload).toHaveBeenCalledTimes(2);
        jest.useRealTimers();
    });

    it('o atraso cresce 1→2→4s entre tentativas seguidas', async () => {
        jest.useFakeTimers();
        mockUpload.mockRejectedValue(new Error('offline'));

        await queue.enqueue(asset, { id: 'p1' });
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(queue.getItem('p1')!.attempts).toBe(1);

        // após 1s → 2ª tentativa (falha) → attempts 2
        await jest.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(queue.getItem('p1')!.attempts).toBe(2);

        // após 2s → 3ª tentativa (falha) → attempts 3
        await jest.advanceTimersByTimeAsync(2_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(queue.getItem('p1')!.attempts).toBe(3);

        // antes de 4s não dispara a 4ª
        await jest.advanceTimersByTimeAsync(3_999);
        await Promise.resolve();
        expect(queue.getItem('p1')!.attempts).toBe(3);
        jest.useRealTimers();
    });

    it('retry() manual zera o backoff e reenvia imediatamente', async () => {
        mockUpload.mockRejectedValueOnce(new Error('falhou'));
        await queue.enqueue(asset, { id: 'p1' });
        await flush();
        expect(queue.getItem('p1')!.status).toBe('error');

        mockUpload.mockResolvedValueOnce('https://cdn/manual.jpg');
        await queue.retry('p1');
        await flush();
        expect(queue.getItem('p1')!.status).toBe('uploaded');
        expect(queue.getItem('p1')!.url).toBe('https://cdn/manual.jpg');
    });
});

describe('reprocesso em reconexão de rede', () => {
    it('NetInfo online dispara processQueue de itens em erro', async () => {
        jest.useFakeTimers();
        mockUpload.mockRejectedValueOnce(new Error('offline'));
        queue.startLifecycle();

        await queue.enqueue(asset, { id: 'p1' });
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(queue.getItem('p1')!.status).toBe('error');

        // Volta a rede: o listener dispara o processamento.
        mockUpload.mockResolvedValueOnce('https://cdn/back.jpg');
        for (const l of global.mockNetInfo.listeners) {
            l({ isConnected: true });
        }
        await Promise.resolve();
        await Promise.resolve();
        // o item estava em 'error' (com timer); o reprocesso só pega 'queued',
        // mas o timer de backoff (1s) o devolve a 'queued' e então sobe.
        await jest.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(queue.getItem('p1')!.status).toBe('uploaded');

        queue.stopLifecycle();
        jest.useRealTimers();
    });
});

describe('helpers de rascunho de O.S.', () => {
    it('isDraftComplete por osDraftId só é true quando todas têm url', async () => {
        mockUpload.mockResolvedValueOnce('https://cdn/1.jpg');
        mockUpload.mockRejectedValueOnce(new Error('falhou')); // a 2ª falha
        await queue.enqueue(asset, { id: 'p1', osDraftId: 'os-9' });
        await queue.enqueue(asset, { id: 'p2', osDraftId: 'os-9' });
        await flush();

        expect(queue.getItem('p1')!.status).toBe('uploaded');
        expect(queue.getItem('p2')!.status).toBe('error');
        expect(queue.isDraftComplete('os-9')).toBe(false);
        expect(queue.isDraftComplete('os-9', ['p1', 'p2'])).toBe(false);
    });

    it('getDraftUrls devolve as urls na ordem dos ids (null se pendente)', async () => {
        mockUpload.mockResolvedValueOnce('https://cdn/a.jpg');
        mockUpload.mockRejectedValueOnce(new Error('x'));
        await queue.enqueue(asset, { id: 'a', osDraftId: 'os-x' });
        await queue.enqueue(asset, { id: 'b', osDraftId: 'os-x' });
        await flush();

        expect(queue.getDraftUrls('os-x', ['a', 'b'])).toEqual(['https://cdn/a.jpg', null]);
    });

    it('isDraftComplete true quando todas as fotos do conjunto têm url', async () => {
        await queue.enqueue(asset, { id: 'a', osDraftId: 'os-ok' });
        await queue.enqueue(asset, { id: 'b', osDraftId: 'os-ok' });
        await flush();
        expect(queue.isDraftComplete('os-ok', ['a', 'b'])).toBe(true);
        expect(queue.getDraftUrls('os-ok', ['a', 'b'])).toEqual([
            'https://cdn/aems/photo.jpg',
            'https://cdn/aems/photo.jpg',
        ]);
    });
});

describe('remover e podar', () => {
    it('remove apaga o item e o arquivo local', async () => {
        await queue.enqueue(asset, { id: 'p1' });
        const localUri = queue.getItem('p1')!.localUri;
        await queue.remove('p1');
        expect(queue.getItem('p1')).toBeUndefined();
        expect(global.mockFileSystemFiles.has(localUri)).toBe(false);
    });

    it('pruneUploaded remove os itens consumidos e seus arquivos', async () => {
        await queue.enqueue(asset, { id: 'p1', osDraftId: 'os-1' });
        await queue.enqueue(asset, { id: 'p2', osDraftId: 'os-1' });
        await flush();
        const u1 = queue.getItem('p1')!.localUri;

        await queue.pruneUploaded(['p1', 'p2']);
        expect(queue.getItem('p1')).toBeUndefined();
        expect(queue.getItem('p2')).toBeUndefined();
        expect(global.mockFileSystemFiles.has(u1)).toBe(false);
    });
});

describe('persistência entre sessões (rehidratação)', () => {
    it('um item em uploading ao matar o app volta para queued e reprocessa', async () => {
        // Simula um app anterior que deixou um item "uploading" persistido.
        const persisted = [
            {
                id: 'p1',
                localUri: 'file:///app-documents/aems-upload-queue/p1.jpg',
                mime: 'image/jpeg',
                name: 'photo.jpg',
                status: 'uploading',
                attempts: 0,
                progress: 30,
                createdAt: Date.now(),
            },
        ];
        global.mockFileSystemFiles.add('file:///app-documents/aems-upload-queue/p1.jpg');

        // "Reabre o app": novo módulo, novo estado em memória. O resetModules dá uma
        // instância NOVA (e vazia) do mock de AsyncStorage, então a chave persistida
        // precisa ser gravada DEPOIS, na instância que o módulo recarregado enxerga.
        jest.resetModules();
        const mod = require('@react-native-async-storage/async-storage');
        const freshStorage = (mod.default ?? mod) as typeof AsyncStorage;
        await freshStorage.setItem('aems_upload_queue_v1', JSON.stringify(persisted));
        queue = require('@/services/upload/uploadQueue');

        await queue.processQueue();
        await flush();

        const item = queue.getItem('p1');
        expect(item!.status).toBe('uploaded');
        expect(mockUpload).toHaveBeenCalledTimes(1);
    });
});

describe('subscribe', () => {
    it('notifica o listener global em cada mudança', async () => {
        const seen: string[] = [];
        const unsub = queue.subscribe((items) => {
            const p1 = items.find((i) => i.id === 'p1');
            if (p1) seen.push(p1.status);
        });
        await queue.enqueue(asset, { id: 'p1' });
        await flush();
        expect(seen).toContain('uploaded');
        unsub();
    });
});
