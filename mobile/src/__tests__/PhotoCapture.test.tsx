import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PhotoCapture } from '@/components/features/PhotoCapture';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import type { LocalPhotoAsset, Photo } from '@/types/photo.types';
import type { QueueItem } from '@/services/upload/uploadQueue';

/**
 * CAM-04 / CAM-05 — PhotoCapture (componente).
 * Mocka o pipeline (captureFromCamera/pickFromLibrary/compressPhoto) e a fila
 * offline (uploadQueue) para dirigir os estados: adicionar → comprimindo →
 * enfileirar → (via subscribeItem) enviando → enviado; erro de upload → retry;
 * remover → onChange sem a foto + remove() na fila.
 */

const mockCapture = jest.fn();
const mockPick = jest.fn();
jest.mock('@/services/camera/capturePhoto', () => {
    class CaptureCancelled extends Error {}
    class PermissionDeniedError extends Error {
        canAskAgain: boolean;
        constructor() {
            super('Permissão negada.');
            this.canAskAgain = true;
        }
    }
    return {
        captureFromCamera: (...a: unknown[]) => mockCapture(...a),
        pickFromLibrary: (...a: unknown[]) => mockPick(...a),
        CaptureCancelled,
        PermissionDeniedError,
    };
});

const mockCompress = jest.fn();
jest.mock('@/services/camera/compressPhoto', () => ({
    compressPhoto: (...a: unknown[]) => mockCompress(...a),
}));

// Fila offline simulada: cada item tem 1 listener (subscribeItem); os testes
// disparam transições chamando emit(id, patch). enqueue resolve e marca "queued".
const mockQueueListeners = new Map<string, (item: QueueItem | undefined) => void>();
const mockQueueState = new Map<string, QueueItem>();
const mockEnqueue = jest.fn();
const mockRetry = jest.fn();
const mockRemove = jest.fn();

function baseItem(id: string): QueueItem {
    return {
        id,
        localUri: `file:///queue/${id}.jpg`,
        mime: 'image/jpeg',
        name: 'photo.jpg',
        status: 'queued',
        attempts: 0,
        progress: 0,
        createdAt: Date.now(),
    };
}

/** Emite uma atualização de item para o listener inscrito (como faria a fila). */
function emit(id: string, patch: Partial<QueueItem>) {
    const current = mockQueueState.get(id) ?? baseItem(id);
    const next = { ...current, ...patch };
    mockQueueState.set(id, next);
    mockQueueListeners.get(id)?.(next);
}

jest.mock('@/services/upload/uploadQueue', () => ({
    enqueue: (...a: unknown[]) => mockEnqueue(...a),
    retry: (...a: unknown[]) => mockRetry(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
    subscribeItem: (id: string, listener: (item: QueueItem | undefined) => void) => {
        mockQueueListeners.set(id, listener);
        // entrega o estado atual (se houver) — como o serviço real faz após hydrate
        listener(mockQueueState.get(id));
        return () => mockQueueListeners.delete(id);
    },
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const original: LocalPhotoAsset = { uri: 'file:///orig.jpg', width: 4000, height: 3000 };
const compressed: LocalPhotoAsset = {
    uri: 'file:///comp.jpg',
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    name: 'photo.jpg',
};

/** Wrapper controlado: expõe o array de fotos atual para asserts. */
function Harness({ onPhotos }: { onPhotos: (p: Photo[]) => void }) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ConfirmProvider>
                    <PhotoCapture
                        value={photos}
                        onChange={(next) => {
                            setPhotos(next);
                            onPhotos(next);
                        }}
                        label="Fotos da O.S."
                        osDraftId="draft-1"
                    />
                </ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

let latest: Photo[] = [];
async function renderCapture() {
    latest = [];
    const utils = await render(<Harness onPhotos={(p) => (latest = p)} />);
    return utils;
}

/** Aciona "Adicionar foto" → escolhe Câmera. */
async function addFromCamera(utils: Awaited<ReturnType<typeof renderCapture>>) {
    await fireEvent.press(utils.getByLabelText('Adicionar foto'));
    await fireEvent.press(utils.getByText('Tirar foto'));
}

/** Id que o componente atribui à 1ª foto (capturado via enqueue). */
function firstEnqueuedId(): string {
    expect(mockEnqueue).toHaveBeenCalled();
    const opts = mockEnqueue.mock.calls[0][1] as { id: string };
    return opts.id;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockQueueListeners.clear();
    mockQueueState.clear();
    mockCapture.mockResolvedValue(original);
    mockPick.mockResolvedValue(original);
    mockCompress.mockResolvedValue(compressed);
    mockEnqueue.mockImplementation(async (_asset, opts: { id: string }) => opts.id);
    mockRetry.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
});

describe('PhotoCapture — fluxo feliz', () => {
    it('adiciona foto → comprime → enfileira; estado da fila reflete enviado', async () => {
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const id = firstEnqueuedId();
        // enqueue recebeu o comprimido e o osDraftId
        expect(mockEnqueue).toHaveBeenCalledWith(compressed, { id, osDraftId: 'draft-1' });
        expect(mockCompress).toHaveBeenCalledWith(original);

        // A fila reporta progresso e conclusão.
        await act(async () => {
            emit(id, { status: 'uploading', progress: 40 });
        });
        await waitFor(() => expect(latest[0]?.uploadProgress).toBe(40));

        await act(async () => {
            emit(id, { status: 'uploaded', progress: 100, url: 'https://cdn/aems/comp.jpg' });
        });
        await waitFor(() => {
            expect(latest[0]?.uploaded).toBe(true);
            expect(latest[0]?.url).toBe('https://cdn/aems/comp.jpg');
        });
    });

    it('escolher da galeria usa pickFromLibrary', async () => {
        const utils = await renderCapture();
        await act(async () => {
            await fireEvent.press(utils.getByLabelText('Adicionar foto'));
            await fireEvent.press(utils.getByText('Escolher da galeria'));
        });
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        expect(mockPick).toHaveBeenCalledTimes(1);
        expect(mockCapture).not.toHaveBeenCalled();
    });
});

describe('PhotoCapture — erros', () => {
    it('falha na compressão registra erro na foto (sem enfileirar)', async () => {
        mockCompress.mockRejectedValueOnce(new Error('Falha ao comprimir.'));
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });
        await waitFor(() => expect(latest[0]?.error).toBe('Falha ao comprimir.'));
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('erro de upload na fila mostra o overlay de retry', async () => {
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const id = firstEnqueuedId();

        await act(async () => {
            emit(id, { status: 'error', attempts: 1, error: 'Falha no envio.' });
        });
        await waitFor(() => expect(latest[0]?.error).toBe('Falha no envio.'));
        expect(utils.getByLabelText('Tentar enviar novamente')).toBeTruthy();
    });

    it('retry manual chama retry() da fila (sem recomprimir)', async () => {
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const id = firstEnqueuedId();

        await act(async () => {
            emit(id, { status: 'error', attempts: 1, error: 'Falha no envio.' });
        });
        await waitFor(() => expect(latest[0]?.error).toBe('Falha no envio.'));

        await act(async () => {
            await fireEvent.press(utils.getByLabelText('Tentar enviar novamente'));
        });
        expect(mockRetry).toHaveBeenCalledWith(id);
        expect(mockCompress).toHaveBeenCalledTimes(1); // não recomprime
    });

    it('cancelar a captura não adiciona foto', async () => {
        const { CaptureCancelled } = jest.requireMock('@/services/camera/capturePhoto');
        mockCapture.mockRejectedValueOnce(new CaptureCancelled());
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });
        expect(latest).toHaveLength(0);
        expect(mockCompress).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
    });
});

describe('PhotoCapture — remover', () => {
    it('remover a foto atualiza o array e remove da fila', async () => {
        const utils = await renderCapture();
        await act(async () => {
            await addFromCamera(utils);
        });
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const id = firstEnqueuedId();

        await act(async () => {
            await fireEvent.press(utils.getByLabelText('Remover foto'));
        });
        expect(latest).toHaveLength(0);
        expect(mockRemove).toHaveBeenCalledWith(id);
    });
});

describe('PhotoCapture — foto remota (cópia de O.S.)', () => {
    // Wrapper com um valor inicial FIXO de foto remota (não passa pelo pipeline).
    function RemoteHarness({ onPhotos }: { onPhotos: (p: Photo[]) => void }) {
        const [photos, setPhotos] = useState<Photo[]>([
            {
                id: 'remote_1',
                preview: 'https://srv/foto.jpg',
                uploaded: true,
                uploadProgress: 100,
                url: 'https://srv/foto.jpg',
                remote: true,
            },
        ]);
        return (
            <SafeAreaProvider initialMetrics={metrics}>
                <ThemeProvider>
                    <ConfirmProvider>
                        <PhotoCapture
                            value={photos}
                            onChange={(next) => {
                                setPhotos(next);
                                onPhotos(next);
                            }}
                            label="Fotos da O.S."
                        />
                    </ConfirmProvider>
                </ThemeProvider>
            </SafeAreaProvider>
        );
    }

    it('foto remota (url, remote) sem compressed NÃO mostra "Comprimindo" e aparece como enviada', async () => {
        const utils = await render(<RemoteHarness onPhotos={() => {}} />);
        // Sem overlay de compressão.
        expect(utils.queryByText('Comprimindo')).toBeNull();
        // Rotulada como enviada (a11yLabel do thumb).
        expect(utils.getByLabelText('Foto enviada')).toBeTruthy();
        // Não assina a fila (foto remota não está enfileirada).
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('remover foto remota não chama remove() da fila e some do array', async () => {
        let current: Photo[] = [];
        const utils = await render(<RemoteHarness onPhotos={(p) => (current = p)} />);

        await act(async () => {
            await fireEvent.press(utils.getByLabelText('Remover foto'));
        });
        expect(current).toHaveLength(0);
        expect(mockRemove).not.toHaveBeenCalled();
    });
});
