import { render, fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RollCard } from '@/components/features/RollCard';
import { ThemeProvider } from '@/theme';
import type { FilmRoll, FilmRollColor } from '@/services/api/inventory.service';

/**
 * INV-02 — RollCard (componente). Cobre o mapeamento cor→rótulo de status
 * (cor vem do backend, o app não recalcula) + dados básicos e o press.
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

function makeRoll(over: Partial<FilmRoll> = {}): FilmRoll {
    return {
        id: 1,
        store_id: 1,
        store_name: 'Loja Centro',
        film_type_id: 10,
        film_type_name: 'PS4 Nano',
        tonality: 'G20',
        supplier: null,
        supplier_id: null,
        supplier_name: 'Fornecedor X',
        nfe_number: '12345',
        total_meters: 30,
        remaining_meters: 12,
        receipt_date: '2026-06-01',
        status: 'em_uso',
        visual_id: 'PS4-G20-202606-001',
        color: 'blue',
        created_at: '2026-06-01T10:00:00Z',
        cost: '500.00',
        lot_number: 'L1',
        ...over,
    };
}

async function renderCard(roll: FilmRoll, onPress = jest.fn()) {
    const utils = await render(
        <Providers>
            <RollCard roll={roll} onPress={onPress} />
        </Providers>
    );
    return { ...utils, onPress };
}

describe('RollCard', () => {
    it('mostra visual_id, película·tonalidade, loja e metragem', async () => {
        const { getByText } = await renderCard(makeRoll());
        expect(getByText('PS4-G20-202606-001')).toBeTruthy();
        expect(getByText('PS4 Nano · G20')).toBeTruthy();
        expect(getByText('Loja Centro')).toBeTruthy();
        expect(getByText('12.0m / 30.0m')).toBeTruthy();
    });

    it('mapeia a cor do backend para o rótulo de status', async () => {
        const cases: [FilmRollColor, string][] = [
            ['blue', 'Em Estoque'],
            ['green', 'Em Uso'],
            ['yellow', 'Alerta'],
            ['red', 'Esgotado'],
        ];
        for (const [color, label] of cases) {
            const { getByText } = await renderCard(makeRoll({ color }));
            expect(getByText(label)).toBeTruthy();
        }
    });

    it('chama onPress ao tocar', async () => {
        const { getByLabelText, onPress } = await renderCard(makeRoll());
        fireEvent.press(getByLabelText(/Bobina PS4-G20-202606-001/));
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
