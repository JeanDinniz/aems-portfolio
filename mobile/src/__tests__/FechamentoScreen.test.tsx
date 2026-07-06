import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FechamentoScreen } from '@/screens/service-orders/FechamentoScreen';
import { ThemeProvider } from '@/theme';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import type { ServiceOrder } from '@/types/service-order.types';

/**
 * CONF-02/03 — FechamentoScreen (componente).
 *
 * Mocka `serviceOrdersService.getFiltered` (devolvendo as duas listas
 * — verificadas e canceladas — conforme os filtros), os helpers de export, a
 * loja, permissão (useCanView), Toast e api-error. Verifica: agrupamento
 * (Oficina em 3, retorno e canceladas à parte), contagem/receita por grupo, o
 * export por card com os params certos e o gate "Acesso restrito".
 *
 * `useQuery` é mockado para chamar o `queryFn` síncronamente e expor `data`.
 */

// ─── react-query: roda o queryFn (Promise) e expõe data quando resolve ───────
jest.mock('@tanstack/react-query', () => {
    const React = jest.requireActual('react');
    const useQuery = (opts: { queryFn: () => Promise<unknown> }) => {
        const [data, setData] = React.useState(undefined);
        React.useEffect(() => {
            let active = true;
            Promise.resolve(opts.queryFn()).then((d) => {
                if (active) setData(d);
            });
            return () => {
                active = false;
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return { data, isLoading: false, isError: false, refetch: jest.fn() };
    };
    return { useQuery };
});

// ─── Service (getFiltered + helpers de export) ───────────────────────────────
jest.mock('@/services/api/service-orders.service', () => ({
    serviceOrdersService: {
        getFiltered: jest.fn(),
        exportFechamento: jest.fn(() => Promise.resolve()),
        exportFechamentoResumo: jest.fn(() => Promise.resolve()),
    },
}));

// ─── Permissão / loja / toast / api-error ────────────────────────────────────
let mockCanView = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanView: () => mockCanView,
}));
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (
        selector: (s: {
            selectedStoreId: number | null;
            availableStores: { id: number; name: string }[];
        }) => unknown
    ) => selector({ selectedStoreId: 1, availableStores: [{ id: 1, name: 'Loja Centro' }] }),
}));
// StoreSelector consome useStores; stub para o teste.
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [{ id: 1, name: 'Loja Centro' }],
        selectedStoreId: 1,
        isMultiStore: false,
        selectStore: jest.fn(),
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
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const getFilteredMock = serviceOrdersService.getFiltered as jest.Mock;
const exportFechamentoMock = serviceOrdersService.exportFechamento as jest.Mock;
const exportResumoMock = serviceOrdersService.exportFechamentoResumo as jest.Mock;

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

function makeOrder(over: Partial<ServiceOrder> = {}): ServiceOrder {
    return {
        id: 1,
        order_number: 'LJ-1',
        plate: 'ABC1D23',
        department: 'film',
        status: 'ready',
        location_id: 1,
        location_name: 'Loja Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        is_verified: true,
        photos: [],
        damage_photos: [],
        items: [{ service_id: 1, quantity: 1, unit_price: 100, service_name: 'Aplicação' }],
        ...over,
    } as ServiceOrder;
}

// Configura o getFiltered para devolver verificadas vs canceladas conforme params.
function setupData(verified: ServiceOrder[], cancelled: ServiceOrder[]) {
    getFilteredMock.mockImplementation((params: { is_verified?: boolean; status?: string }) => {
        if (params.status === 'cancelled') {
            return Promise.resolve({ items: cancelled, total: cancelled.length });
        }
        return Promise.resolve({ items: verified, total: verified.length });
    });
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <FechamentoScreen
                navigation={navigation as never}
                route={{ key: 'Fechamento', name: 'Fechamento' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCanView = true;
});

describe('FechamentoScreen', () => {
    it('gate: sem permissão mostra "Acesso restrito"', async () => {
        mockCanView = false;
        setupData([], []);
        const { getByText, queryByLabelText } = await renderScreen();

        expect(getByText('Acesso restrito')).toBeTruthy();
        expect(queryByLabelText('Exportar completo')).toBeNull();
    });

    it('agrupa Oficina em 3 (serviços/lavagem/cortesia) + retorno + canceladas separados', async () => {
        const verified = [
            // Oficina serviços
            makeOrder({
                id: 1,
                department: 'workshop',
                items: [{ service_id: 1, quantity: 1, unit_price: 50, service_name: 'Polimento' }],
            }),
            // Oficina lavagem simples
            makeOrder({
                id: 2,
                department: 'workshop',
                items: [
                    { service_id: 2, quantity: 1, unit_price: 30, service_name: 'Lavagem Simples Premium' },
                ],
            }),
            // Oficina cortesia
            makeOrder({
                id: 3,
                department: 'workshop',
                is_courtesy: true,
                items: [{ service_id: 3, quantity: 1, unit_price: 0, service_name: 'Cortesia' }],
            }),
            // Película (depto normal)
            makeOrder({
                id: 4,
                department: 'film',
                items: [{ service_id: 4, quantity: 2, unit_price: 100, service_name: 'Película' }],
            }),
            // Retorno
            makeOrder({
                id: 5,
                department: 'film',
                is_return: true,
                items: [{ service_id: 5, quantity: 1, unit_price: 80, service_name: 'Retrabalho' }],
            }),
        ];
        const cancelled = [makeOrder({ id: 6, status: 'cancelled', department: 'film' })];
        setupData(verified, cancelled);

        const { getByText } = await renderScreen();

        // Os 5 grupos esperados aparecem com seus rótulos.
        expect(getByText('Oficina Serviços')).toBeTruthy();
        expect(getByText('Oficina Lavagem Simples')).toBeTruthy();
        expect(getByText('Oficina Cortesia')).toBeTruthy();
        expect(getByText('Película')).toBeTruthy();
        expect(getByText('Retorno')).toBeTruthy();
        expect(getByText('Canceladas')).toBeTruthy();

        // Receita do grupo Película = 2 * 100 = R$ 200,00.
        expect(getByText('R$ 200,00')).toBeTruthy();

        // Total geral exclui retorno e canceladas: 50 + 30 + 0 + 200 = 280; 4 O.S.
        expect(getByText('TOTAL GERAL — 4 O.S')).toBeTruthy();
        expect(getByText('R$ 280,00')).toBeTruthy();
    });

    it('O.S. workshop mista: lavagem e serviços em cards separados, sem dupla contagem', async () => {
        // Uma única O.S. workshop não-cortesia com um item Lavagem Simples (R$30)
        // e um item Polimento (R$100). Deve aparecer nos DOIS grupos com o valor
        // apenas dos itens pertinentes; o TOTAL GERAL soma R$130 e conta 1 O.S.
        const verified = [
            makeOrder({
                id: 42,
                department: 'workshop',
                is_courtesy: false,
                items: [
                    { service_id: 1, quantity: 1, unit_price: 30, service_name: 'Lavagem Simples' },
                    { service_id: 2, quantity: 1, unit_price: 100, service_name: 'Polimento' },
                ],
            }),
        ];
        setupData(verified, []);

        const { getByText } = await renderScreen();

        // Ambos os cards presentes.
        expect(getByText('Oficina Lavagem Simples')).toBeTruthy();
        expect(getByText('Oficina Serviços')).toBeTruthy();

        // Valores por item (cada card com apenas os seus).
        expect(getByText('R$ 30,00')).toBeTruthy(); // card Lavagem
        expect(getByText('R$ 100,00')).toBeTruthy(); // card Serviços

        // TOTAL GERAL: soma R$130 e conta a O.S. UMA vez.
        expect(getByText('TOTAL GERAL — 1 O.S')).toBeTruthy();
        expect(getByText('R$ 130,00')).toBeTruthy();
    });

    it('O.S. cortesia com Lavagem Simples: item lavagem vai ao card Lavagem, resto ao card Cortesia', async () => {
        // Cortesia mista: Lavagem Simples (R$30) + Higienização (R$100).
        // A lavagem vai SEMPRE para "Oficina Lavagem Simples" (mesma regra do
        // resumo Excel); o resto fica em "Oficina Cortesia". 1 O.S. única.
        const verified = [
            makeOrder({
                id: 7,
                department: 'workshop',
                is_courtesy: true,
                items: [
                    { service_id: 1, quantity: 1, unit_price: 30, service_name: 'Lavagem Simples' },
                    { service_id: 2, quantity: 1, unit_price: 100, service_name: 'Higienização' },
                ],
            }),
        ];
        setupData(verified, []);

        const { getByText } = await renderScreen();

        expect(getByText('Oficina Lavagem Simples')).toBeTruthy();
        expect(getByText('Oficina Cortesia')).toBeTruthy();

        // Valores particionados por item.
        expect(getByText('R$ 30,00')).toBeTruthy(); // card Lavagem
        expect(getByText('R$ 100,00')).toBeTruthy(); // card Cortesia

        // TOTAL GERAL soma R$130 e conta a O.S. UMA vez.
        expect(getByText('TOTAL GERAL — 1 O.S')).toBeTruthy();
        expect(getByText('R$ 130,00')).toBeTruthy();
    });

    it('card Oficina Lavagem Simples aparece mesmo sem nenhuma lavagem no período', async () => {
        const verified = [
            makeOrder({
                id: 8,
                department: 'workshop',
                items: [{ service_id: 1, quantity: 1, unit_price: 50, service_name: 'Polimento' }],
            }),
        ];
        setupData(verified, []);

        const { getByText } = await renderScreen();

        expect(getByText('Oficina Serviços')).toBeTruthy();
        expect(getByText('Oficina Lavagem Simples')).toBeTruthy(); // sempre visível
    });

    it('export do card Oficina Serviços exclui Lavagem Simples (service_name_not_contains)', async () => {
        const verified = [
            makeOrder({
                id: 1,
                department: 'workshop',
                is_courtesy: false,
                items: [{ service_id: 1, quantity: 1, unit_price: 100, service_name: 'Polimento' }],
            }),
        ];
        setupData(verified, []);

        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Exportar Oficina Serviços'));
        });

        expect(exportFechamentoMock).toHaveBeenCalledTimes(1);
        expect(exportFechamentoMock.mock.calls[0][0]).toMatchObject({
            store_id: 1,
            loja: 'Loja Centro',
            department: 'workshop',
            is_courtesy: false,
            service_name_not_contains: 'Lavagem Simples',
            is_return: false,
        });
    });

    it('export do card Oficina Lavagem inclui só Lavagem Simples (service_name_contains, SEM filtro de cortesia)', async () => {
        const verified = [
            makeOrder({
                id: 1,
                department: 'workshop',
                is_courtesy: false,
                items: [
                    { service_id: 1, quantity: 1, unit_price: 30, service_name: 'Lavagem Simples' },
                ],
            }),
        ];
        setupData(verified, []);

        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Exportar Oficina Lavagem Simples'));
        });

        expect(exportFechamentoMock).toHaveBeenCalledTimes(1);
        const arg = exportFechamentoMock.mock.calls[0][0];
        expect(arg).toMatchObject({
            department: 'workshop',
            service_name_contains: 'Lavagem Simples',
            is_return: false,
        });
        // Sem filtro de cortesia: lavagens simples cortesia entram no card.
        expect(arg.is_courtesy).toBeUndefined();
    });

    it('export de um card chama exportFechamento com os params do grupo', async () => {
        const verified = [
            makeOrder({
                id: 1,
                department: 'workshop',
                is_courtesy: true,
                items: [{ service_id: 1, quantity: 1, unit_price: 0, service_name: 'Cortesia' }],
            }),
        ];
        setupData(verified, []);

        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Exportar Oficina Cortesia'));
        });

        expect(exportFechamentoMock).toHaveBeenCalledTimes(1);
        const arg = exportFechamentoMock.mock.calls[0][0];
        expect(arg).toMatchObject({
            store_id: 1,
            loja: 'Loja Centro',
            department: 'workshop',
            is_courtesy: true,
            service_name_not_contains: 'Lavagem Simples',
            is_return: false,
        });
        expect(mockToastSuccess).toHaveBeenCalledWith('Excel gerado.');
    });

    it('botão "Exportar resumo" chama exportFechamentoResumo', async () => {
        setupData([makeOrder({ id: 1 })], []);
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Exportar resumo'));
        });

        expect(exportResumoMock).toHaveBeenCalledTimes(1);
        expect(exportResumoMock.mock.calls[0][0]).toMatchObject({ store_id: 1, loja: 'Loja Centro' });
    });

    it('canceladas viram card próprio com a contagem', async () => {
        setupData([], [makeOrder({ id: 9, status: 'cancelled' })]);
        const { getByText, getByLabelText } = await renderScreen();

        expect(getByText('Canceladas')).toBeTruthy();
        expect(getByLabelText('Exportar Canceladas')).toBeTruthy();
    });
});
