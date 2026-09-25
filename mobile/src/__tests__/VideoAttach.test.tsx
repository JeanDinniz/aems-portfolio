import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { VideoAttach } from '@/components/features/service-orders/VideoAttach';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';

/**
 * VID-02 — VideoAttach (componente).
 * Mocka ImagePicker, uploadVideo e validateVideoSize para testar:
 *   - Estado inicial (sem vídeo): botão "Adicionar vídeo" visível.
 *   - Captura → upload → onChange chamado com URL.
 *   - Validação de tamanho: alerta quando fileSize > 50 MB e NÃO chama uploadVideo.
 *   - Cancelamento (ImagePicker.canceled): sem mudança de estado.
 *   - Retry após erro: uploadVideo chamado novamente.
 *   - onUploadingChange notificado durante o upload.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockRequestCamera = jest.fn();
const mockRequestLibrary = jest.fn();

jest.mock('expo-image-picker', () => ({
    launchCameraAsync: (...a: unknown[]) => mockLaunchCamera(...a),
    launchImageLibraryAsync: (...a: unknown[]) => mockLaunchLibrary(...a),
    requestCameraPermissionsAsync: (...a: unknown[]) => mockRequestCamera(...a),
    requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockRequestLibrary(...a),
    UIImagePickerControllerQualityType: { Medium: 1 },
}));

const mockUploadVideo = jest.fn();
const mockValidateVideoSize = jest.fn();

jest.mock('@/services/upload/uploadVideo', () => {
    class UploadVideoError extends Error {
        status?: number;
        constructor(message: string, status?: number) {
            super(message);
            this.name = 'UploadVideoError';
            this.status = status;
        }
    }
    return {
        uploadVideo: (...a: unknown[]) => mockUploadVideo(...a),
        validateVideoSize: (...a: unknown[]) => mockValidateVideoSize(...a),
        UploadVideoError,
    };
});

jest.mock('@/services/biometrics', () => ({
    suppressAppLock: jest.fn(),
    releaseAppLock: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
    impactAsync: jest.fn(),
    notificationAsync: jest.fn(),
    ImpactFeedbackStyle: { Light: 'Light' },
    NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function makePickerResult(uri: string, fileSize = 5 * 1024 * 1024) {
    return {
        canceled: false,
        assets: [{ uri, fileName: 'video.mp4', mimeType: 'video/mp4', fileSize }],
    };
}

const canceledResult = { canceled: true, assets: [] };

interface HarnessProps {
    initialValue?: string | null;
    onChangeSpy?: (url: string | null) => void;
    onUploadingSpy?: (uploading: boolean) => void;
}

function Harness({ initialValue = null, onChangeSpy, onUploadingSpy }: HarnessProps) {
    const [value, setValue] = useState<string | null>(initialValue);
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ConfirmProvider>
                    <VideoAttach
                        value={value}
                        onChange={(url) => {
                            setValue(url);
                            onChangeSpy?.(url);
                        }}
                        onUploadingChange={onUploadingSpy}
                    />
                </ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    // Permissões concedidas por padrão
    mockRequestCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockRequestLibrary.mockResolvedValue({ granted: true, canAskAgain: true });
    // validateVideoSize não lança por padrão (tamanho ok)
    mockValidateVideoSize.mockImplementation(() => undefined);
    // Upload bem-sucedido por padrão
    mockUploadVideo.mockResolvedValue('https://cdn/aems/video.mp4');
});

// Helpers para pressionar o botão principal "Adicionar vídeo" e os itens do sheet.
// Usamos getAllByText(...)[0] pois o Sheet também renderiza o mesmo título na árvore.
function pressAddVideo(utils: Awaited<ReturnType<typeof render>>) {
    return fireEvent.press(utils.getAllByText('Adicionar vídeo')[0]);
}

// ─── Estado inicial ───────────────────────────────────────────────────────────

describe('VideoAttach — estado inicial', () => {
    it('exibe o botão "Adicionar vídeo" quando value é null', async () => {
        const utils = await render(<Harness />);
        expect(utils.getAllByText('Adicionar vídeo').length).toBeGreaterThan(0);
    });

    it('exibe preview com "Vídeo anexado" quando value tem URL', async () => {
        const utils = await render(<Harness initialValue="https://cdn/aems/video.mp4" />);
        expect(utils.getByText('Vídeo anexado')).toBeTruthy();
        // Botão adicionar não aparece quando já há vídeo
        expect(utils.queryByText('Gravar vídeo')).toBeNull();
    });
});

// ─── Upload bem-sucedido ──────────────────────────────────────────────────────

describe('VideoAttach — upload bem-sucedido', () => {
    it('após captura e upload, onChange é chamado com a URL', async () => {
        const onChangeSpy = jest.fn();
        mockLaunchCamera.mockResolvedValue(makePickerResult('file:///video.mp4'));

        const utils = await render(<Harness onChangeSpy={onChangeSpy} />);

        // Abre o sheet (botão principal) e escolhe câmera
        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => {
            expect(mockUploadVideo).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(onChangeSpy).toHaveBeenCalledWith('https://cdn/aems/video.mp4');
        });
    });

    it('após galeria e upload, onChange é chamado com a URL', async () => {
        const onChangeSpy = jest.fn();
        mockLaunchLibrary.mockResolvedValue(makePickerResult('file:///video.mp4'));

        const utils = await render(<Harness onChangeSpy={onChangeSpy} />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Escolher da galeria'));
        });

        await waitFor(() => {
            expect(onChangeSpy).toHaveBeenCalledWith('https://cdn/aems/video.mp4');
        });
    });

    it('onUploadingChange é chamado com true durante upload e false após', async () => {
        const onUploadingSpy = jest.fn();
        let resolveUpload!: (url: string) => void;
        mockUploadVideo.mockReturnValue(new Promise<string>((res) => (resolveUpload = res)));
        mockLaunchCamera.mockResolvedValue(makePickerResult('file:///video.mp4'));

        const utils = await render(<Harness onUploadingSpy={onUploadingSpy} />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => expect(onUploadingSpy).toHaveBeenCalledWith(true));

        // Resolve o upload
        await act(async () => {
            resolveUpload('https://cdn/aems/video.mp4');
        });

        await waitFor(() => expect(onUploadingSpy).toHaveBeenCalledWith(false));
    });
});

// ─── Cancelamento ─────────────────────────────────────────────────────────────

describe('VideoAttach — cancelamento', () => {
    it('cancelar o picker não chama uploadVideo nem onChange', async () => {
        const onChangeSpy = jest.fn();
        mockLaunchCamera.mockResolvedValue(canceledResult);

        const utils = await render(<Harness onChangeSpy={onChangeSpy} />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
        expect(mockUploadVideo).not.toHaveBeenCalled();
        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

// ─── Validação de tamanho ─────────────────────────────────────────────────────

describe('VideoAttach — validação de tamanho', () => {
    it('quando validateVideoSize lança, NÃO chama uploadVideo', async () => {
        const { UploadVideoError } = jest.requireMock(
            '@/services/upload/uploadVideo'
        ) as { UploadVideoError: new (msg: string) => Error };
        mockValidateVideoSize.mockImplementation(() => {
            throw new UploadVideoError('Vídeo muito grande (55.0 MB). O limite é 50 MB.');
        });
        mockLaunchCamera.mockResolvedValue(makePickerResult('file:///big.mp4', 55 * 1024 * 1024));

        const onChangeSpy = jest.fn();
        const utils = await render(<Harness onChangeSpy={onChangeSpy} />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
        expect(mockUploadVideo).not.toHaveBeenCalled();
        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});

// ─── Erro de upload ───────────────────────────────────────────────────────────

describe('VideoAttach — erro de upload', () => {
    it('exibe estado de erro quando o upload falha', async () => {
        mockUploadVideo.mockRejectedValue(new Error('Falha na rede'));
        mockLaunchCamera.mockResolvedValue(makePickerResult('file:///video.mp4'));

        const utils = await render(<Harness />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => {
            expect(utils.getByText('Erro ao enviar vídeo')).toBeTruthy();
        });
    });

    it('botão "Tentar de novo" chama uploadVideo novamente', async () => {
        mockUploadVideo
            .mockRejectedValueOnce(new Error('Falha na rede'))
            .mockResolvedValueOnce('https://cdn/aems/video.mp4');
        mockLaunchCamera.mockResolvedValue(makePickerResult('file:///video.mp4'));

        const onChangeSpy = jest.fn();
        const utils = await render(<Harness onChangeSpy={onChangeSpy} />);

        await act(async () => {
            pressAddVideo(utils);
        });
        await act(async () => {
            fireEvent.press(utils.getByText('Gravar vídeo'));
        });

        await waitFor(() => {
            expect(utils.getByText('Tentar de novo')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(utils.getByText('Tentar de novo'));
        });

        await waitFor(() => {
            expect(mockUploadVideo).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(onChangeSpy).toHaveBeenCalledWith('https://cdn/aems/video.mp4');
        });
    });
});
