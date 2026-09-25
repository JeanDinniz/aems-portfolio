import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TimeClockScreen } from '@/screens/time-clock/TimeClockScreen';
import { ThemeProvider } from '@/theme';
import type { TimeClockMe } from '@/types/time-clock.types';

/**
 * TimeClockScreen — estados e fluxo de batida.
 *
 * Mocka: useTimeClockMe/usePunch (hooks), Toast, e o pipeline
 * (getCurrentLocation / captureFromCamera / compressPhoto / uploadPhoto) +
 * NetInfo. Cobre: sem vínculo, botão Entrada (last_type null), botão Saída
 * (last_type 'in'), erro 409 (mensagem da API), fora do raio.
 */

// ─── Hooks de dados ──────────────────────────────────────────────────────────
let mockMe: TimeClockMe | undefined;
let mockMeLoading = false;
let mockMeError = false;
const mockRefetch = jest.fn();
const mockPunchMutateAsync = jest.fn();
let mockPunchPending = false;

let mockPendingItems: { id: string }[] = [];
const mockRetryPending = jest.fn();
const mockRemovePending = jest.fn();

jest.mock('@/hooks/useTimeClock', () => ({
    useTimeClockMe: () => ({
        data: mockMe,
        isLoading: mockMeLoading,
        isError: mockMeError,
        refetch: mockRefetch,
        isRefetching: false,
    }),
    usePunch: () => ({
        mutateAsync: mockPunchMutateAsync,
        isPending: mockPunchPending,
    }),
    usePunchQueue: () => ({
        items: mockPendingItems,
        pendingCount: mockPendingItems.length,
        retry: mockRetryPending,
        remove: mockRemovePending,
    }),
}));

// Fila offline de batida — mockada (o comportamento é testado em punchQueue.test.ts).
const mockPunchEnqueue = jest.fn();
jest.mock('@/services/time-clock/punchQueue', () => ({
    enqueue: (...args: unknown[]) => mockPunchEnqueue(...args),
    getItems: () => [],
    startLifecycle: jest.fn(),
    processQueue: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
    retry: jest.fn(),
    remove: jest.fn(),
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

// ─── Pipeline (localização / câmera / compressão / upload) ───────────────────
const mockGetCurrentLocation = jest.fn();
jest.mock('@/services/location/getCurrentLocation', () => {
    const actual = jest.requireActual('@/services/location/getCurrentLocation');
    return {
        ...actual,
        getCurrentLocation: (...args: unknown[]) => mockGetCurrentLocation(...args),
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

const mockCompressPhoto = jest.fn();
jest.mock('@/services/camera/compressPhoto', () => ({
    compressPhoto: (...args: unknown[]) => mockCompressPhoto(...args),
}));

const mockUploadPhoto = jest.fn();
jest.mock('@/services/upload/uploadPhoto', () => ({
    uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
}));

// api-error helper: devolve o detail do erro (para o teste do 409).
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (err: { response?: { data?: { detail?: string } } }, fallback: string) =>
        err?.response?.data?.detail ?? fallback,
}));

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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <TimeClockScreen
                navigation={navigation as never}
                route={{ key: 'TimeClock', name: 'TimeClock' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makeMe(over: Partial<TimeClockMe> = {}): TimeClockMe {
    return {
        employee_id: 3,
        employee_name: 'João da Silva',
        store_name: 'Loja Centro',
        work_start_time: '08:00:00',
        work_end_time: '18:00:00',
        last_type: null,
        face_enrolled: false,
        today: [],
        recent: [],
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMe = makeMe();
    mockMeLoading = false;
    mockMeError = false;
    mockPunchPending = false;
    mockPendingItems = [];
    mockPunchEnqueue.mockResolvedValue('punch_1');
    // Padrão dos testes existentes: online (NetInfo.fetch resolve isConnected:true).
    const NetInfo = require('@react-native-community/netinfo').default;
    NetInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    mockGetCurrentLocation.mockResolvedValue({ latitude: -23.5, longitude: -46.6, accuracy_m: 12 });
    mockCaptureFromCamera.mockResolvedValue({ uri: 'file:///selfie.jpg', width: 1000, height: 1000 });
    mockCompressPhoto.mockResolvedValue({ uri: 'file:///selfie.jpg', mime: 'image/jpeg', name: 'p.jpg' });
    mockUploadPhoto.mockResolvedValue('https://srv/selfie.jpg');
    mockPunchMutateAsync.mockResolvedValue({
        id: 1,
        type: 'in',
        recorded_at: '2026-07-13T08:00:00',
        photo_url: 'https://srv/selfie.jpg',
        distance_m: 5,
        is_within_radius: true,
    });
});

describe('TimeClockScreen — estados', () => {
    it('sem vínculo (employee_id null) mostra a mensagem para falar com o administrador', async () => {
        mockMe = makeMe({ employee_id: null, employee_name: null });
        const { getByText, queryByText } = await renderScreen();

        expect(getByText('Sem vínculo de funcionário')).toBeTruthy();
        expect(
            getByText(/não está vinculado a um funcionário/i)
        ).toBeTruthy();
        // Não há botão de bater ponto neste estado.
        expect(queryByText('Bater Entrada')).toBeNull();
        expect(queryByText('Bater Saída')).toBeNull();
    });

    it('erro de carregamento mostra retry', async () => {
        mockMe = undefined;
        mockMeError = true;
        const { getByText } = await renderScreen();
        expect(getByText('Tentar novamente')).toBeTruthy();
    });
});

describe('TimeClockScreen — rótulo do botão por last_type', () => {
    it('last_type null → "Bater Entrada"', async () => {
        mockMe = makeMe({ last_type: null });
        const { getByText } = await renderScreen();
        expect(getByText('Bater Entrada')).toBeTruthy();
    });

    it("last_type 'in' → \"Bater Saída\"", async () => {
        mockMe = makeMe({ last_type: 'in' });
        const { getByText } = await renderScreen();
        expect(getByText('Bater Saída')).toBeTruthy();
    });

    it("last_type 'out' → \"Bater Entrada\"", async () => {
        mockMe = makeMe({ last_type: 'out' });
        const { getByText } = await renderScreen();
        expect(getByText('Bater Entrada')).toBeTruthy();
    });
});

describe('TimeClockScreen — fluxo de batida', () => {
    it('entrada: roda pipeline → punch com type "in" e mostra sucesso', async () => {
        mockMe = makeMe({ last_type: null });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Entrada'));
        });

        await waitFor(() => {
            expect(mockPunchMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockGetCurrentLocation).toHaveBeenCalled();
        expect(mockCaptureFromCamera).toHaveBeenCalledWith('front');
        expect(mockCompressPhoto).toHaveBeenCalled();
        expect(mockUploadPhoto).toHaveBeenCalled();

        const arg = mockPunchMutateAsync.mock.calls[0][0];
        expect(arg).toMatchObject({
            type: 'in',
            photo_url: 'https://srv/selfie.jpg',
            latitude: -23.5,
            longitude: -46.6,
            accuracy_m: 12,
        });
        // MTP 671: mesmo online, envia o horário do relógio do aparelho (ISO c/ fuso).
        expect(arg.client_reported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
        expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Entrada'));
    });

    it('offline: NÃO chama punch; enfileira a batida e avisa que será enviada depois', async () => {
        mockMe = makeMe({ last_type: null });
        const NetInfo = require('@react-native-community/netinfo').default;
        NetInfo.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Entrada'));
        });

        await waitFor(() => {
            expect(mockPunchEnqueue).toHaveBeenCalledTimes(1);
        });
        // A batida NÃO foi ao servidor (offline) — mas foi capturada e enfileirada.
        expect(mockPunchMutateAsync).not.toHaveBeenCalled();
        const enq = mockPunchEnqueue.mock.calls[0][0];
        expect(enq).toMatchObject({ type: 'in', latitude: -23.5, longitude: -46.6 });
        expect(enq.client_reported_at).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
        );
        expect(mockToastShow).toHaveBeenCalledWith(
            expect.stringContaining('será enviada quando houver conexão'),
            { variant: 'info' }
        );
    });

    it('falha de REDE no punch (sem response): enfileira em vez de descartar', async () => {
        mockMe = makeMe({ last_type: null });
        // AxiosError de rede = sem `response`.
        mockPunchMutateAsync.mockRejectedValueOnce({ message: 'Network Error', response: undefined });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Entrada'));
        });

        await waitFor(() => {
            expect(mockPunchEnqueue).toHaveBeenCalledTimes(1);
        });
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('indicador de pendentes: mostra a contagem quando há batidas na fila', async () => {
        mockPendingItems = [{ id: 'punch_1' }, { id: 'punch_2' }];
        const { getByText } = await renderScreen();
        expect(getByText('2 batidas aguardando envio')).toBeTruthy();
    });

    it('Meu Espelho: navega para a tela de autoatendimento', async () => {
        const { getByText, navigation } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Meu Espelho'));
        });
        expect(navigation.navigate).toHaveBeenCalledWith('MyTimeClockMirror');
    });

    it('saída: punch com type "out" quando last_type é "in"', async () => {
        mockMe = makeMe({ last_type: 'in' });
        mockPunchMutateAsync.mockResolvedValueOnce({
            id: 2,
            type: 'out',
            recorded_at: '2026-07-13T18:00:00',
            photo_url: 'https://srv/s.jpg',
            distance_m: 3,
            is_within_radius: true,
        });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Saída'));
        });

        await waitFor(() => {
            expect(mockPunchMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockPunchMutateAsync.mock.calls[0][0].type).toBe('out');
        expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Saída'));
    });

    it('erro 409 exibe o detail da API', async () => {
        mockMe = makeMe({ last_type: null });
        mockPunchMutateAsync.mockRejectedValueOnce({
            response: { status: 409, data: { detail: 'A primeira batida do dia deve ser entrada.' } },
        });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Entrada'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith(
                'A primeira batida do dia deve ser entrada.'
            );
        });
    });

    it('face_enrolled=false: mostra CTA "Cadastrar rosto" e navega para FaceEnroll', async () => {
        mockMe = makeMe({ face_enrolled: false });
        const { getByText, navigation } = await renderScreen();

        const cta = getByText('Cadastrar rosto');
        expect(cta).toBeTruthy();
        expect(getByText('Cadastre seu rosto')).toBeTruthy();

        await act(async () => {
            fireEvent.press(cta);
        });
        expect(navigation.navigate).toHaveBeenCalledWith('FaceEnroll');
    });

    it('face_enrolled=true: mostra "Rosto cadastrado" e esconde o CTA', async () => {
        mockMe = makeMe({ face_enrolled: true });
        const { getByText, queryByText } = await renderScreen();

        expect(getByText('Rosto cadastrado')).toBeTruthy();
        expect(queryByText('Cadastrar rosto')).toBeNull();
    });

    it('fora do raio: aviso âmbar em vez de sucesso', async () => {
        mockMe = makeMe({ last_type: null });
        mockPunchMutateAsync.mockResolvedValueOnce({
            id: 3,
            type: 'in',
            recorded_at: '2026-07-13T08:00:00',
            photo_url: 'https://srv/s.jpg',
            distance_m: 900,
            is_within_radius: false,
        });
        const { getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Bater Entrada'));
        });

        await waitFor(() => {
            expect(mockToastShow).toHaveBeenCalledWith(
                'Batida registrada fora do raio da loja.',
                { variant: 'warning' }
            );
        });
        expect(mockToastSuccess).not.toHaveBeenCalled();
    });
});
