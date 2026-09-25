import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FaceEnrollScreen } from '@/screens/time-clock/FaceEnrollScreen';
import { ThemeProvider } from '@/theme';

/**
 * FaceEnrollScreen — consentimento LGPD + cadastro do rosto.
 *
 * Mocka: useEnrollFace (mutation), Toast, captureFromCamera e
 * generateFaceEmbedding. Cobre: aceite obrigatório (botão bloqueado sem consent),
 * fluxo feliz (captura → embedding → enroll → sucesso → goBack), erro sem rosto,
 * cancelamento da câmera (silencioso).
 */

const mockEnrollMutateAsync = jest.fn();
let mockEnrollPending = false;
jest.mock('@/hooks/useTimeClock', () => ({
    useEnrollFace: () => ({
        mutateAsync: mockEnrollMutateAsync,
        isPending: mockEnrollPending,
    }),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            show: jest.fn(),
            info: jest.fn(),
        }),
    };
});

const mockCaptureFromCamera = jest.fn();
jest.mock('@/services/camera/capturePhoto', () => {
    const actual = jest.requireActual('@/services/camera/capturePhoto');
    return {
        ...actual,
        captureFromCamera: (...args: unknown[]) => mockCaptureFromCamera(...args),
    };
});

const mockGenerateFaceEmbedding = jest.fn();
jest.mock('@/services/face/faceEmbedding', () => {
    const actual = jest.requireActual('@/services/face/faceEmbedding');
    return {
        ...actual,
        generateFaceEmbedding: (...args: unknown[]) => mockGenerateFaceEmbedding(...args),
    };
});

jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (err: { response?: { data?: { detail?: string } } }, fallback: string) =>
        err?.response?.data?.detail ?? fallback,
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
    );
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <FaceEnrollScreen
                navigation={navigation as never}
                route={{ key: 'FaceEnroll', name: 'FaceEnroll' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnrollPending = false;
    mockCaptureFromCamera.mockResolvedValue({ uri: 'file:///selfie.jpg', width: 1000, height: 1000 });
    mockGenerateFaceEmbedding.mockResolvedValue(new Array(512).fill(0.1));
    mockEnrollMutateAsync.mockResolvedValue({
        enrolled: true,
        enrolled_at: '2026-07-28T10:00:00',
        dimension: 512,
    });
});

describe('FaceEnrollScreen', () => {
    it('sem aceite, o botão não dispara o cadastro', async () => {
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Aceito e cadastrar'));
        });

        expect(mockCaptureFromCamera).not.toHaveBeenCalled();
        expect(mockEnrollMutateAsync).not.toHaveBeenCalled();
    });

    it('fluxo feliz: aceita → captura → embedding → enroll → sucesso → goBack', async () => {
        const { getByText, navigation } = await renderScreen();

        // Marca o aceite (toca no card de consentimento).
        await act(async () => {
            fireEvent(
                getByText('Li e concordo com o uso do reconhecimento facial no ponto.'),
                'touchEnd'
            );
        });

        await act(async () => {
            fireEvent.press(getByText('Aceito e cadastrar'));
        });

        await waitFor(() => {
            expect(mockEnrollMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockCaptureFromCamera).toHaveBeenCalledWith('front');
        expect(mockGenerateFaceEmbedding).toHaveBeenCalledWith('file:///selfie.jpg', 1000, 1000);
        const arg = mockEnrollMutateAsync.mock.calls[0][0];
        expect(arg.consent).toBe(true);
        expect(arg.embedding).toHaveLength(512);
        expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('cadastrado'));
        expect(navigation.goBack).toHaveBeenCalled();
    });

    it('sem rosto detectado: exibe o erro e NÃO cadastra', async () => {
        const { FaceEmbeddingError } = jest.requireActual('@/services/face/faceEmbedding');
        mockGenerateFaceEmbedding.mockRejectedValueOnce(
            new FaceEmbeddingError('Nenhum rosto detectado, tente novamente.')
        );
        const { getByText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent(
                getByText('Li e concordo com o uso do reconhecimento facial no ponto.'),
                'touchEnd'
            );
        });
        await act(async () => {
            fireEvent.press(getByText('Aceito e cadastrar'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('Nenhum rosto detectado, tente novamente.');
        });
        expect(mockEnrollMutateAsync).not.toHaveBeenCalled();
        expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('cancelamento da câmera é silencioso (sem toast de erro)', async () => {
        const { CaptureCancelled } = jest.requireActual('@/services/camera/capturePhoto');
        mockCaptureFromCamera.mockRejectedValueOnce(new CaptureCancelled());
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent(
                getByText('Li e concordo com o uso do reconhecimento facial no ponto.'),
                'touchEnd'
            );
        });
        await act(async () => {
            fireEvent.press(getByText('Aceito e cadastrar'));
        });

        await waitFor(() => {
            expect(mockCaptureFromCamera).toHaveBeenCalled();
        });
        expect(mockToastError).not.toHaveBeenCalled();
        expect(mockEnrollMutateAsync).not.toHaveBeenCalled();
    });
});
