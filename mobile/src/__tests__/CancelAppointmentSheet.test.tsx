import { useRef, useEffect, type ReactNode } from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
    CancelAppointmentSheet,
    type CancelAppointmentSheetRef,
} from '@/components/features/CancelAppointmentSheet';
import { ThemeProvider } from '@/theme';

/**
 * AGD-05 — CancelAppointmentSheet (componente).
 *
 * Mocka useCancelAppointment, Toast e api-error. O global de @gorhom/bottom-sheet
 * (jest.setup) renderiza o conteúdo do sheet inline, então conseguimos preencher
 * o motivo e confirmar. Cobre: cancel com motivo e cancel sem motivo (undefined).
 */

// ─── Mutation de cancelamento ────────────────────────────────────────────────
const mockCancelMutateAsync = jest.fn();
let mockCancelPending = false;
jest.mock('@/hooks/useScheduling', () => ({
    useCancelAppointment: () => ({
        mutateAsync: mockCancelMutateAsync,
        isPending: mockCancelPending,
    }),
}));

// ─── Toast ───────────────────────────────────────────────────────────────────
const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: jest.fn(),
            error: mockToastError,
            show: jest.fn(),
            info: jest.fn(),
        }),
    };
});

// ─── api-error helper ────────────────────────────────────────────────────────
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// ─── Host que apresenta o sheet no mount ─────────────────────────────────────
function Host({
    appointmentId,
    onCancelled,
}: {
    appointmentId: number;
    onCancelled?: () => void;
}) {
    const ref = useRef<CancelAppointmentSheetRef>(null);
    useEffect(() => {
        ref.current?.present();
    }, []);
    return (
        <CancelAppointmentSheet
            ref={ref}
            appointmentId={appointmentId}
            onCancelled={onCancelled}
        />
    );
}

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

async function renderSheet(appointmentId = 12) {
    const onCancelled = jest.fn();
    const utils = await render(
        <Providers>
            <Host appointmentId={appointmentId} onCancelled={onCancelled} />
        </Providers>
    );
    return { ...utils, onCancelled };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCancelPending = false;
});

describe('CancelAppointmentSheet', () => {
    it('confirma com o motivo digitado → cancel({id, reason})', async () => {
        mockCancelMutateAsync.mockResolvedValueOnce({});
        const utils = await renderSheet(12);
        const { getByText, getByPlaceholderText, onCancelled } = utils;

        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Descreva o motivo...'), 'cliente desistiu');
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar cancelamento'));
        });

        await waitFor(() => {
            expect(mockCancelMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockCancelMutateAsync).toHaveBeenCalledWith({
            id: 12,
            reason: 'cliente desistiu',
        });
        await waitFor(() => {
            expect(onCancelled).toHaveBeenCalled();
        });
    });

    it('confirma sem motivo → reason undefined', async () => {
        mockCancelMutateAsync.mockResolvedValueOnce({});
        const utils = await renderSheet(99);
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Confirmar cancelamento'));
        });

        await waitFor(() => {
            expect(mockCancelMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockCancelMutateAsync).toHaveBeenCalledWith({ id: 99, reason: undefined });
    });
});
