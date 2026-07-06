import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppointmentDetailScreen } from '@/screens/scheduling/AppointmentDetailScreen';
import { ThemeProvider } from '@/theme';
import type { Appointment } from '@/types/scheduling.types';

/**
 * AGD-05 — Ações do detalhe do agendamento (navegação).
 *
 * Cobre: Finalizar (O.S. vinculada) navega cross-stack para FinalizeOS com o
 * service_order_id; Gerar O.S. (sem O.S., agendado) navega p/ GenerateOS; o sheet
 * de cancelamento é apresentado ao tocar "Cancelar agendamento".
 */

// ─── Hooks de dados ──────────────────────────────────────────────────────────
let mockAppointment: Appointment | null = null;
jest.mock('@/hooks/useScheduling', () => ({
    useAppointment: () => ({
        data: mockAppointment,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
    useAppointmentHistory: () => ({ data: { items: [] }, isLoading: false }),
}));

// ─── Permissões (todas liberadas por padrão) ─────────────────────────────────
let mockCanEdit = true;
let mockCanDelete = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
    useCanDelete: () => mockCanDelete,
}));

// ─── CancelAppointmentSheet (test-double que expõe `present`) ─────────────────
const mockPresentCancel = jest.fn();
jest.mock('@/components/features/CancelAppointmentSheet', () => {
    const React = require('react');
    const CancelAppointmentSheet = React.forwardRef(
        (_props: unknown, ref: React.Ref<unknown>) => {
            React.useImperativeHandle(ref, () => ({
                present: mockPresentCancel,
                dismiss: jest.fn(),
            }));
            return null;
        }
    );
    CancelAppointmentSheet.displayName = 'CancelAppointmentSheet';
    return { __esModule: true, CancelAppointmentSheet };
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

async function renderScreen(id = 5) {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <AppointmentDetailScreen
                navigation={navigation as never}
                route={{ key: 'AppointmentDetail', name: 'AppointmentDetail', params: { id } } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

const base: Appointment = {
    id: 5,
    store_id: 1,
    store_name: 'Loja Centro',
    department: 'film',
    delivery_date: '2026-06-25',
    delivery_time: '14:30',
    external_os_number: 'OS-9',
    vehicle_plate: 'ABC1D23',
    vehicle_model: 'Corolla',
    vehicle_color: 'Preto',
    consultant_id: 77,
    consultant_name: 'João Consultor',
    service_ids: [42],
    service_names: ['Película Dianteira'],
    film_entries: null,
    notes: null,
    is_galpon: false,
    is_courtesy: false,
    is_return: false,
    film_type_id: null,
    film_tonality: null,
    status: 'scheduled',
    display_status: 'agendado',
    service_order_id: null,
    service_order_number: null,
    created_at: '2026-06-20T10:00:00Z',
    updated_at: '2026-06-20T10:00:00Z',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockCanEdit = true;
    mockCanDelete = true;
    mockAppointment = null;
});

describe('AppointmentDetailScreen — ações', () => {
    it('sem O.S. (agendado): mostra "Gerar O.S." e navega para GenerateOS', async () => {
        mockAppointment = { ...base, service_order_id: null, display_status: 'agendado' };
        const utils = await renderScreen(5);
        const { getByText, navigation } = utils;

        await act(async () => {
            fireEvent.press(getByText('Gerar O.S.'));
        });
        expect(navigation.navigate).toHaveBeenCalledWith('GenerateOS', { id: 5 });
    });

    it('com O.S. vinculada (em execução): "Finalizar O.S." navega cross-stack para FinalizeOS', async () => {
        mockAppointment = {
            ...base,
            service_order_id: 321,
            service_order_number: 'OS-2026-0042',
            display_status: 'em_execucao',
        };
        const utils = await renderScreen(5);
        const { getByText, navigation } = utils;

        // Sem O.S. para gerar → "Gerar O.S." não aparece.
        expect(() => getByText('Gerar O.S.')).toThrow();

        await act(async () => {
            fireEvent.press(getByText('Finalizar O.S.'));
        });
        expect(navigation.navigate).toHaveBeenCalledWith('ServiceOrders', {
            screen: 'FinalizeOS',
            params: { id: 321 },
        });
    });

    it('"Cancelar agendamento" apresenta o sheet de cancelamento', async () => {
        mockAppointment = { ...base, display_status: 'agendado' };
        const utils = await renderScreen(5);
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Cancelar agendamento'));
        });
        await waitFor(() => {
            expect(mockPresentCancel).toHaveBeenCalled();
        });
    });

    it('agendamento cancelado: nenhuma ação aparece', async () => {
        mockAppointment = {
            ...base,
            status: 'cancelled',
            display_status: 'cancelado',
        };
        const utils = await renderScreen(5);
        const { getByText } = utils;

        expect(() => getByText('Gerar O.S.')).toThrow();
        expect(() => getByText('Finalizar O.S.')).toThrow();
        expect(() => getByText('Editar')).toThrow();
        expect(() => getByText('Cancelar agendamento')).toThrow();
    });
});
