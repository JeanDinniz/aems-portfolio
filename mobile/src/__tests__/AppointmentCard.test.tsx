import { render, fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppointmentCard } from '@/components/features/AppointmentCard';
import { ThemeProvider } from '@/theme';
import { APPOINTMENT_STATUS_CONFIG } from '@/constants/scheduling';
import type { Appointment } from '@/types/scheduling.types';

/**
 * AGD-02 — AppointmentCard (componente).
 * Cobre: placa + label do status (colorido por APPOINTMENT_STATUS_CONFIG),
 * chips de serviços (incl. "+N"), consultor/horário, badges de flags e o press.
 */

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

function makeAppointment(over: Partial<Appointment> = {}): Appointment {
    return {
        id: 1,
        store_id: 1,
        store_name: 'Loja Centro',
        department: 'film',
        delivery_date: '2026-06-21',
        delivery_time: '14:30:00',
        external_os_number: 'CONC-900',
        vehicle_plate: 'ABC1D23',
        vehicle_model: 'Corolla',
        vehicle_color: 'Preto',
        consultant_id: 5,
        consultant_name: 'Maria Souza',
        service_ids: [10, 11],
        service_names: ['Película G20', 'Parabrisa'],
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
        ...over,
    };
}

async function renderCard(appointment: Appointment, onPress = jest.fn()) {
    const utils = await render(
        <Providers>
            <AppointmentCard appointment={appointment} onPress={onPress} />
        </Providers>
    );
    return { ...utils, onPress };
}

describe('AppointmentCard', () => {
    it('mostra placa, status (label) e horário', async () => {
        const { getByText } = await renderCard(makeAppointment());
        expect(getByText('ABC1D23')).toBeTruthy();
        expect(getByText(APPOINTMENT_STATUS_CONFIG.agendado.label)).toBeTruthy();
        expect(getByText('14:30')).toBeTruthy();
    });

    it('usa o label do status correspondente a display_status', async () => {
        const { getByText } = await renderCard(makeAppointment({ display_status: 'atrasado' }));
        expect(getByText(APPOINTMENT_STATUS_CONFIG.atrasado.label)).toBeTruthy();
    });

    it('renderiza chips de serviços e o consultor', async () => {
        const { getByText } = await renderCard(makeAppointment());
        expect(getByText('Película G20')).toBeTruthy();
        expect(getByText('Parabrisa')).toBeTruthy();
        expect(getByText('Maria Souza')).toBeTruthy();
    });

    it('mostra "+N" quando há mais de 3 serviços', async () => {
        const { getByText } = await renderCard(
            makeAppointment({
                service_names: ['A', 'B', 'C', 'D', 'E'],
            })
        );
        expect(getByText('+2')).toBeTruthy();
    });

    it('exibe badges Galpão/Cortesia/Retorno quando marcados', async () => {
        const { getByText } = await renderCard(
            makeAppointment({ is_galpon: true, is_courtesy: true, is_return: true })
        );
        expect(getByText('Galpão')).toBeTruthy();
        expect(getByText('Cortesia')).toBeTruthy();
        expect(getByText('Retorno')).toBeTruthy();
    });

    it('sem consultor mostra "Sem consultor"', async () => {
        const { getByText } = await renderCard(makeAppointment({ consultant_name: null }));
        expect(getByText('Sem consultor')).toBeTruthy();
    });

    it('chama onPress ao tocar', async () => {
        const onPress = jest.fn();
        const { getByLabelText } = await renderCard(makeAppointment(), onPress);
        await fireEvent.press(getByLabelText(/Agendamento ABC1D23/));
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
