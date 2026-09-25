import { render, fireEvent } from '@testing-library/react-native';
import { CalendarMonthView } from '@/components/features/scheduling/CalendarMonthView';
import type { Appointment } from '@/types/scheduling.types';

const appt = {
    id: 1,
    delivery_date: '2026-08-15',
    vehicle_model: 'Corolla',
    vehicle_plate: 'ABC1D23',
    department: 'film',
    display_status: 'agendado',
} as unknown as Appointment;

async function setup(over: Partial<React.ComponentProps<typeof CalendarMonthView>> = {}) {
    const onNavigate = jest.fn();
    const onDayPress = jest.fn();
    const onCardPress = jest.fn();
    // RTL 14 + React 19: `render` é assíncrono neste projeto (padrão dos demais
    // testes usa `await render`). O plano escreveu `setup` síncrono — adaptado.
    const utils = await render(
        <CalendarMonthView
            appointments={[appt]}
            currentDate={new Date(2026, 7, 1)}
            onNavigate={onNavigate}
            onDayPress={onDayPress}
            onCardPress={onCardPress}
            {...over}
        />
    );
    return { ...utils, onNavigate, onDayPress, onCardPress };
}

describe('CalendarMonthView', () => {
    it('exibe o título Agosto 2026', async () => {
        const { getByText } = await setup();
        expect(getByText('Agosto 2026')).toBeTruthy();
    });

    it('mostra o mini-card do agendamento no dia 15', async () => {
        const { getByText } = await setup();
        expect(getByText('Corolla')).toBeTruthy();
    });

    it('navega para o mês anterior', async () => {
        const { getByLabelText, onNavigate } = await setup();
        fireEvent.press(getByLabelText('Mês anterior'));
        expect(onNavigate).toHaveBeenCalledWith(new Date(2026, 6, 1));
    });

    it('dispara onCardPress ao tocar no mini-card', async () => {
        const { getByText, onCardPress } = await setup();
        fireEvent.press(getByText('Corolla'));
        expect(onCardPress).toHaveBeenCalledWith(appt);
    });

    it('dispara onDayPress ao tocar no número do dia do mês corrente', async () => {
        const { getByLabelText, onDayPress } = await setup();
        fireEvent.press(getByLabelText('Dia 15'));
        expect(onDayPress).toHaveBeenCalledWith('2026-08-15');
    });
});
