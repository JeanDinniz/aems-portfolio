import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PunchReceipt } from '@/components/time-clock/PunchReceipt';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/theme';
import { formatTimeBR } from '@/utils/formatDate';
import type { TimeClockReceipt } from '@/types/time-clock.types';

/**
 * PunchReceipt — comprovante de registro de ponto (REP-A).
 *
 * Cobre os dois modos:
 *  - DEFINITIVO: mostra o NSR real e baixa o PDF oficial ao tocar em
 *    "Salvar / Compartilhar" (via downloadAndSharePdf, mockado).
 *  - PROVISÓRIO: mostra o aviso do comprovante definitivo pós-sincronização.
 */

const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

function makeReceipt(over: Partial<TimeClockReceipt> = {}): TimeClockReceipt {
    return {
        nsr: 7,
        employer_name: 'EMPRESA EXEMPLO LTDA',
        employer_cnpj: '12345678000199',
        employee_name: 'Ana Silva',
        employee_cpf: '12345678901',
        type: 'in',
        recorded_at: '2026-09-01T07:00:00-03:00',
        is_offline_record: false,
        system_id: 'AEMS-REP-A',
        hash_short: 'abc12345',
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('PunchReceipt — modo definitivo', () => {
    it('mostra o NSR e os dados do comprovante quando há receipt', async () => {
        const { getByText } = await render(
            <Providers>
                <PunchReceipt receipt={makeReceipt()} />
            </Providers>
        );
        expect(getByText(/NSR: 7/)).toBeTruthy();
        expect(getByText('Comprovante de registro')).toBeTruthy();
        expect(getByText('Ana Silva')).toBeTruthy();
    });

    it('baixa o PDF oficial ao tocar em Salvar / Compartilhar', async () => {
        const { getByText } = await render(
            <Providers>
                <PunchReceipt receipt={makeReceipt({ nsr: 42 })} recordId={99} />
            </Providers>
        );

        await act(async () => {
            fireEvent.press(getByText('Salvar / Compartilhar'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/time-clock/records/99/receipt');
        expect(arg.params).toEqual({ format: 'pdf' });
        expect(arg.filename).toBe('comprovante_ponto_nsr42.pdf');
    });

    it('não mostra o botão de PDF sem recordId', async () => {
        const { queryByText } = await render(
            <Providers>
                <PunchReceipt receipt={makeReceipt()} />
            </Providers>
        );
        expect(queryByText('Salvar / Compartilhar')).toBeNull();
    });
});

describe('PunchReceipt — modo provisório', () => {
    it('mostra o aviso de comprovante definitivo pós-sincronização', async () => {
        // A hora é renderizada em fuso LOCAL (formatTimeBR). Deriva o esperado
        // pelo mesmo helper para não depender do timezone do runner (CI = UTC).
        const collectedAt = '2026-09-01T07:03:00-03:00';
        const { getByText } = await render(
            <Providers>
                <PunchReceipt provisional collectedAt={collectedAt} />
            </Providers>
        );
        expect(getByText(/comprovante definitivo após sincronização/i)).toBeTruthy();
        expect(getByText(new RegExp(formatTimeBR(collectedAt)))).toBeTruthy();
    });
});
