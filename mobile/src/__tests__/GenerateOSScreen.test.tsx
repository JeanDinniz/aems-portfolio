import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GenerateOSScreen } from '@/screens/scheduling/GenerateOSScreen';
import { ThemeProvider } from '@/theme';
import type { Photo } from '@/types/photo.types';

/**
 * AGD-05 — GenerateOSScreen (componente).
 *
 * Mocka useGenerateOS, Toast, uploadQueue e PhotoCapture (test-double que injeta
 * fotos controladas). Cobre: bloqueio do submit sem foto / sem url; submit com
 * foto pronta chamando generateOS com `photos`; navegação ao detalhe da O.S.
 */

// ─── Mutation de geração (captura o mutateAsync) ─────────────────────────────
const mockGenerateMutateAsync = jest.fn();
let mockGeneratePending = false;
jest.mock('@/hooks/useScheduling', () => ({
    useGenerateOS: () => ({
        mutateAsync: mockGenerateMutateAsync,
        isPending: mockGeneratePending,
    }),
}));

// ─── Toast ───────────────────────────────────────────────────────────────────
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastShow = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            show: mockToastShow,
            info: jest.fn(),
        }),
    };
});

// ─── Fila de upload ──────────────────────────────────────────────────────────
const mockPruneUploaded = jest.fn();
jest.mock('@/services/upload/uploadQueue', () => ({
    pruneUploaded: (...args: unknown[]) => mockPruneUploaded(...args),
}));

// ─── api-error helper ────────────────────────────────────────────────────────
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// ─── PhotoCapture (test-double) ──────────────────────────────────────────────
// Injeta `mockPhotosToInject` ao tocar no botão "inject-photos".
let mockPhotosToInject: Photo[] = [];
jest.mock('@/components/features/PhotoCapture', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        PhotoCapture: ({ onChange }: { onChange: (v: unknown) => void }) =>
            React.createElement(
                Pressable,
                {
                    accessibilityLabel: 'inject-photos',
                    onPress: () => onChange(mockPhotosToInject),
                },
                React.createElement(Text, null, 'inject-photos')
            ),
    };
});

// ─── Providers / render ──────────────────────────────────────────────────────
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

async function renderScreen(id = 7) {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() };
    const utils = await render(
        <Providers>
            <GenerateOSScreen
                navigation={navigation as never}
                route={{ key: 'GenerateOS', name: 'GenerateOS', params: { id } } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makePhoto(over: Partial<Photo> = {}): Photo {
    return {
        id: 'photo_1',
        preview: 'file:///p.jpg',
        uploaded: true,
        uploadProgress: 100,
        url: 'https://srv/p.jpg',
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGeneratePending = false;
    mockPhotosToInject = [];
});

describe('GenerateOSScreen — gate de fotos', () => {
    it('sem foto: submit bloqueado, mutateAsync não é chamado', async () => {
        const utils = await renderScreen();
        const { getByRole } = utils;

        // O botão fica desabilitado sem foto; tentar pressionar não dispara.
        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Gerar O.S.' }));
        });

        expect(mockGenerateMutateAsync).not.toHaveBeenCalled();
    });

    it('foto sem url (ainda enviando): submit desabilitado, sem mutateAsync', async () => {
        const utils = await renderScreen();
        const { getAllByRole } = utils;

        mockPhotosToInject = [makePhoto({ url: undefined, uploaded: false, uploadProgress: 40 })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        // O botão de ação fica desabilitado (upload pendente, mostra spinner).
        const disabled = getAllByRole('button').filter(
            (b) => b.props.accessibilityState?.disabled === true
        );
        expect(disabled.length).toBeGreaterThanOrEqual(1);

        // Mesmo pressionando o botão desabilitado, o submit não dispara.
        await act(async () => {
            fireEvent.press(disabled[0]);
        });
        expect(mockGenerateMutateAsync).not.toHaveBeenCalled();
    });
});

describe('GenerateOSScreen — caminho feliz', () => {
    it('foto com url → generateOS com {id, photos} e volta para a lista de Agendamentos', async () => {
        mockGenerateMutateAsync.mockResolvedValueOnce({
            service_order_id: 321,
            order_number: 'OS-2026-0042',
        });
        const utils = await renderScreen(7);
        const { navigation } = utils;

        mockPhotosToInject = [makePhoto({ url: 'https://srv/foto.jpg' })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(utils.getByRole('button', { name: 'Gerar O.S.' }));
        });

        await waitFor(() => {
            expect(mockGenerateMutateAsync).toHaveBeenCalledTimes(1);
        });
        const arg = mockGenerateMutateAsync.mock.calls[0][0];
        expect(arg.id).toBe(7);
        expect(arg.payload.photos).toEqual(['https://srv/foto.jpg']);

        // Sucesso mostra o order_number e volta para a lista de Agendamentos
        // (popToTop) — NÃO redireciona para a aba O.S.
        expect(mockToastSuccess).toHaveBeenCalledWith(
            expect.stringContaining('OS-2026-0042')
        );
        expect(navigation.popToTop).toHaveBeenCalledTimes(1);
        expect(navigation.navigate).not.toHaveBeenCalled();
        expect(mockPruneUploaded).toHaveBeenCalledWith(['photo_1']);
    });

    it('inclui notes quando preenchidas', async () => {
        mockGenerateMutateAsync.mockResolvedValueOnce({
            service_order_id: 9,
            order_number: 'OS-1',
        });
        const utils = await renderScreen();
        const { getByPlaceholderText } = utils;

        mockPhotosToInject = [makePhoto({ url: 'https://srv/foto.jpg' })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Notas adicionais...'), 'check ok');
        });

        await act(async () => {
            fireEvent.press(utils.getByRole('button', { name: 'Gerar O.S.' }));
        });

        await waitFor(() => {
            expect(mockGenerateMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockGenerateMutateAsync.mock.calls[0][0].payload.notes).toBe('check ok');
    });
});
