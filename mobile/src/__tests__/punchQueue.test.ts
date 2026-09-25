/**
 * punchQueue — fila offline PERSISTENTE da batida de ponto (MTP 671/2021).
 *
 * Diferente do uploadQueue (que enfileira só a foto), aqui cada item é a BATIDA
 * INTEIRA: selfie + GPS + embedding + `client_reported_at`. O processador faz
 * upload da foto e chama `POST /time-clock/punch` preservando o horário do
 * aparelho. Mocka `uploadPhoto`, `timeClockService.punch` e usa os mocks globais
 * de expo-file-system (copy/exists) e netinfo (listeners disparáveis).
 *
 * Cobre: enqueue + cópia + persistência, upload→punch em sucesso (some da fila),
 * client_reported_at preservado no punch, retry com backoff, erro permanente
 * (422 sem vínculo) que não reprocessa, reprocesso em reconexão de rede e
 * rehidratação entre sessões.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalPhotoAsset } from '@/types/photo.types';

declare const global: {
    mockFileSystemFiles: Set<string>;
    mockNetInfo: { listeners: Set<(state: { isConnected: boolean }) => void> };
};

const mockUpload = jest.fn();
jest.mock('@/services/upload/uploadPhoto', () => ({
    uploadPhoto: (...a: unknown[]) => mockUpload(...a),
    UploadError: class UploadError extends Error {
        status?: number;
    },
}));

const mockPunch = jest.fn();
jest.mock('@/services/api/time-clock.service', () => ({
    timeClockService: {
        punch: (...a: unknown[]) => mockPunch(...a),
    },
}));

// getApiErrorStatus: lê o status de um AxiosError-like.
jest.mock('@/lib/api-error', () => ({
    getApiErrorStatus: (err: { response?: { status?: number } }) => err?.response?.status,
    getApiErrorMessage: (_e: unknown, fb: string) => fb,
}));

let queue: typeof import('@/services/time-clock/punchQueue');

const asset: LocalPhotoAsset = {
    uri: 'file:///selfie.jpg',
    mime: 'image/jpeg',
    name: 'ponto.jpg',
};

function baseInput() {
    return {
        type: 'in' as const,
        asset,
        latitude: -23.5,
        longitude: -46.6,
        accuracy_m: 12,
        client_reported_at: '2026-08-05T08:00:00-03:00',
    };
}

async function flush() {
    for (let i = 0; i < 25; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

beforeEach(async () => {
    jest.useRealTimers();
    jest.clearAllMocks();
    global.mockFileSystemFiles = new Set(['file:///selfie.jpg']);
    await AsyncStorage.clear();
    queue = require('@/services/time-clock/punchQueue');
    await queue.resetForTests();
    mockUpload.mockResolvedValue('https://srv/selfie.jpg');
    mockPunch.mockResolvedValue({ id: 1, type: 'in', recorded_at: '...', is_within_radius: true });
});

afterEach(async () => {
    queue.stopLifecycle();
    await queue.resetForTests();
    jest.useRealTimers();
});

describe('enqueue', () => {
    it('copia a selfie para o diretório do app e persiste a batida inteira', async () => {
        const id = await queue.enqueue(baseInput());
        const item = queue.getItems().find((i) => i.id === id);
        expect(item).toBeDefined();
        expect(item!.localUri).toContain('aems-punch-queue');
        expect(global.mockFileSystemFiles.has(item!.localUri)).toBe(true);
        expect(item!.client_reported_at).toBe('2026-08-05T08:00:00-03:00');

        const raw = await AsyncStorage.getItem('aems_punch_queue_v1');
        expect(raw).toContain('aems-punch-queue');
        expect(raw).toContain('2026-08-05T08:00:00-03:00');
    });
});

describe('processamento (upload → punch)', () => {
    it('em sucesso faz upload, chama punch com o client_reported_at e SAI da fila', async () => {
        await queue.enqueue(baseInput());
        await flush();

        expect(mockUpload).toHaveBeenCalledTimes(1);
        expect(mockPunch).toHaveBeenCalledTimes(1);
        const payload = mockPunch.mock.calls[0][0];
        expect(payload).toMatchObject({
            type: 'in',
            photo_url: 'https://srv/selfie.jpg',
            latitude: -23.5,
            longitude: -46.6,
            accuracy_m: 12,
            client_reported_at: '2026-08-05T08:00:00-03:00',
        });
        // Concluída → não fica pendente.
        expect(queue.pendingCount()).toBe(0);
    });

    it('marca a batida sincronizada como offline (is_offline: true)', async () => {
        await queue.enqueue(baseInput());
        await flush();

        expect(mockPunch).toHaveBeenCalledTimes(1);
        expect(mockPunch).toHaveBeenCalledWith(
            expect.objectContaining({ is_offline: true })
        );
    });

    it('envia uma por vez (serial)', async () => {
        let inFlight = 0;
        let maxConcurrent = 0;
        mockPunch.mockImplementation(async () => {
            inFlight += 1;
            maxConcurrent = Math.max(maxConcurrent, inFlight);
            await Promise.resolve();
            inFlight -= 1;
            return { id: 1 };
        });

        await queue.enqueue(baseInput());
        await queue.enqueue({ ...baseInput(), type: 'out' });
        await flush();
        await flush();

        expect(maxConcurrent).toBe(1);
        expect(queue.pendingCount()).toBe(0);
    });
});

describe('retry com backoff', () => {
    it('falha transitória marca erro, incrementa attempts e reagenda (1s)', async () => {
        jest.useFakeTimers();
        mockPunch.mockRejectedValueOnce(new Error('rede caiu'));

        const id = await queue.enqueue(baseInput());
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        let item = queue.getItems().find((i) => i.id === id);
        expect(item!.status).toBe('error');
        expect(item!.attempts).toBe(1);

        // 1ª retry em 1s → sucesso.
        await jest.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        item = queue.getItems().find((i) => i.id === id);
        expect(item).toBeUndefined(); // concluída, saiu da fila
        expect(mockPunch).toHaveBeenCalledTimes(2);
        jest.useRealTimers();
    });

    it('retry() manual zera o backoff e reenvia imediatamente', async () => {
        mockPunch.mockRejectedValueOnce(new Error('falhou'));
        const id = await queue.enqueue(baseInput());
        await flush();
        expect(queue.getItems().find((i) => i.id === id)!.status).toBe('error');

        await queue.retry(id);
        await flush();
        expect(queue.pendingCount()).toBe(0);
    });
});

describe('erro permanente (4xx)', () => {
    it('422 sem vínculo NÃO reprocessa — para em erro sem loop', async () => {
        jest.useFakeTimers();
        mockPunch.mockRejectedValue({ response: { status: 422 } });

        const id = await queue.enqueue(baseInput());
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        const item = queue.getItems().find((i) => i.id === id);
        expect(item!.status).toBe('error');
        expect(item!.permanent).toBe(true);
        expect(mockPunch).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(60_000);
        await Promise.resolve();
        expect(mockPunch).toHaveBeenCalledTimes(1); // nunca re-tentou
        jest.useRealTimers();
    });
});

describe('reconexão de rede', () => {
    it('NetInfo online dispara o reprocesso de itens em erro', async () => {
        jest.useFakeTimers();
        mockPunch.mockRejectedValueOnce(new Error('offline'));
        queue.startLifecycle();

        const id = await queue.enqueue(baseInput());
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(queue.getItems().find((i) => i.id === id)!.status).toBe('error');

        mockPunch.mockResolvedValueOnce({ id: 9 });
        for (const l of global.mockNetInfo.listeners) l({ isConnected: true });
        await Promise.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(queue.pendingCount()).toBe(0);

        queue.stopLifecycle();
        jest.useRealTimers();
    });
});

describe('rehidratação entre sessões', () => {
    it('uma batida em "sending" ao matar o app volta a "queued" e reprocessa', async () => {
        const persisted = [
            {
                id: 'punch_1',
                type: 'in',
                localUri: 'file:///app-documents/aems-punch-queue/punch_1.jpg',
                mime: 'image/jpeg',
                name: 'ponto.jpg',
                latitude: -23.5,
                longitude: -46.6,
                accuracy_m: 12,
                client_reported_at: '2026-08-05T08:00:00-03:00',
                status: 'sending',
                attempts: 0,
                createdAt: Date.now(),
            },
        ];
        global.mockFileSystemFiles.add('file:///app-documents/aems-punch-queue/punch_1.jpg');

        jest.resetModules();
        const mod = require('@react-native-async-storage/async-storage');
        const freshStorage = (mod.default ?? mod) as typeof AsyncStorage;
        await freshStorage.setItem('aems_punch_queue_v1', JSON.stringify(persisted));
        queue = require('@/services/time-clock/punchQueue');

        await queue.processQueue();
        await flush();

        expect(queue.pendingCount()).toBe(0);
        expect(mockUpload).toHaveBeenCalledTimes(1);
        expect(mockPunch).toHaveBeenCalledTimes(1);
        // O horário do aparelho foi preservado no reenvio.
        expect(mockPunch.mock.calls[0][0].client_reported_at).toBe('2026-08-05T08:00:00-03:00');
    });
});
