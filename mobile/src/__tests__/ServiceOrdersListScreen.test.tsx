import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ServiceOrdersListScreen } from '@/screens/service-orders/ServiceOrdersListScreen';
import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/components/ui/Toast';
import type { ServiceOrder } from '@/types/service-order.types';

/**
 * OS-02 — ServiceOrdersListScreen (componente).
 * Mocka os hooks de dados (useServiceOrdersList) e de permissão (useCanEdit);
 * FlashList é mockado globalmente (jest.setup) para renderizar os itens.
 * Cobre estados Loading / Error / Empty / com itens, e a busca atualizando filtros.
 */

// Estado do hook de lista, controlável por teste.
const mockListState: {
    items: ServiceOrder[];
    total: number;
    isLoading: boolean;
    isError: boolean;
} = { items: [], total: 0, isLoading: false, isError: false };

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
let lastFilters: unknown = null;

jest.mock('@/hooks/useServiceOrders', () => ({
    useServiceOrdersList: (filters: unknown) => {
        lastFilters = filters;
        return {
            ...mockListState,
            refetch: mockRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
            isRefetching: false,
        };
    },
}));

let mockCanEdit = false;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

// ─── Resumo Diário (PDF): loja, permissões de perfil e exportShare ────────────
let mockStores: { id: number; name: string; is_galpon_store: boolean }[] = [];
let mockGlobalStoreId: number | null = null;
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: mockStores,
        selectedStoreId: mockGlobalStoreId,
        isMultiStore: mockStores.length > 1,
        selectStore: jest.fn(),
    }),
}));

let mockIsGalponProfile = false;
jest.mock('@/stores/auth.store', () => ({
    useAuthStore: (
        selector: (s: { effectivePermissions: { is_galpon_profile: boolean } | null }) => unknown
    ) => selector({ effectivePermissions: { is_galpon_profile: mockIsGalponProfile } }),
}));

const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: jest.fn(),
            error: mockToastError,
            info: jest.fn(),
            show: jest.fn(),
        }),
    };
});

jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

// Sheet (test-double: renderiza filhos inline).
jest.mock('@/components/ui/Sheet', () => {
    const React = require('react');
    const { View } = require('react-native');
    const Sheet = React.forwardRef(
        ({ children }: { children: React.ReactNode }, ref: React.Ref<unknown>) => {
            React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
            return React.createElement(View, null, children);
        }
    );
    Sheet.displayName = 'Sheet';
    return { __esModule: true, Sheet };
});

// Select (test-double: expõe cada opção como Pressable "opt-<label>").
jest.mock('@/components/ui/Select', () => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    const Select = React.forwardRef(
        (
            props: {
                options: { value: number | string; label: string }[];
                onChange: (v: unknown) => void;
            },
            ref: React.Ref<unknown>
        ) => {
            React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
            return React.createElement(
                View,
                null,
                props.options.map((opt) =>
                    React.createElement(
                        Pressable,
                        {
                            key: String(opt.value),
                            accessibilityLabel: `opt-${opt.label}`,
                            onPress: () => props.onChange(opt.value),
                        },
                        React.createElement(Text, null, opt.label)
                    )
                )
            );
        }
    );
    Select.displayName = 'Select';
    return { __esModule: true, Select };
});

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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <ServiceOrdersListScreen
                navigation={navigation as never}
                route={{ key: 'ServiceOrdersList', name: 'ServiceOrdersList' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makeOrder(over: Partial<ServiceOrder> = {}): ServiceOrder {
    return {
        id: 1,
        order_number: '#1001',
        status: 'waiting',
        plate: 'ABC1D23',
        department: 'film',
        service_type: '',
        entry_time: '2026-06-01T10:00:00Z',
        started_at: null,
        completed_at: null,
        technician_id: null,
        technician_name: null,
        consultant_id: null,
        consultant_name: null,
        photos: [],
        damage_photos: [],
        damage_map: null,
        invoice_number: null,
        location_id: 1,
        location_name: 'Loja Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        notes: null,
        service_date: null,
        is_verified: false,
        verified_at: null,
        elapsed_minutes: 0,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
        ...over,
    } as ServiceOrder;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockListState.items = [];
    mockListState.total = 0;
    mockListState.isLoading = false;
    mockListState.isError = false;
    mockCanEdit = false;
    lastFilters = null;
    mockStores = [
        { id: 1, name: 'Loja Centro', is_galpon_store: false },
        { id: 2, name: 'Loja Sul', is_galpon_store: false },
        { id: 9, name: 'Galpão Central', is_galpon_store: true },
    ];
    mockGlobalStoreId = null;
    mockIsGalponProfile = false;
});

function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
    ).padStart(2, '0')}`;
}

describe('ServiceOrdersListScreen — estados', () => {
    it('Loading: mostra subtítulo "Carregando..." (skeleton)', async () => {
        mockListState.isLoading = true;
        const { getByText } = await renderScreen();
        expect(getByText('Carregando...')).toBeTruthy();
    });

    it('Error: mostra o ErrorState e o botão de retry funciona', async () => {
        mockListState.isError = true;
        const { getByText } = await renderScreen();
        expect(getByText('Algo deu errado')).toBeTruthy();
        await fireEvent.press(getByText('Tentar novamente'));
        expect(mockRefetch).toHaveBeenCalled();
    });

    it('Empty: sem itens mostra o EmptyState', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Nenhuma O.S encontrada')).toBeTruthy();
    });

    it('com itens: renderiza os OSCards (placa e número da O.S.)', async () => {
        mockListState.items = [
            makeOrder({ id: 1, external_os_number: 'CONC-1001', plate: 'ABC1D23' }),
            makeOrder({ id: 2, external_os_number: 'CONC-1002', plate: 'XYZ9Z99' }),
        ];
        mockListState.total = 2;
        const { getByText } = await renderScreen();
        expect(getByText('OS CONC-1001')).toBeTruthy();
        expect(getByText('OS CONC-1002')).toBeTruthy();
        expect(getByText('ABC1D23')).toBeTruthy();
        expect(getByText('2 ordens cadastradas')).toBeTruthy();
    });

    it('card usa o nº de O.S. da concessionária (external_os_number)', async () => {
        mockListState.items = [
            makeOrder({ id: 1, order_number: '#1001', external_os_number: 'CONC-5050' }),
        ];
        mockListState.total = 1;
        const { getByText, queryByText } = await renderScreen();
        expect(getByText('OS CONC-5050')).toBeTruthy();
        expect(queryByText('OS #1001')).toBeNull();
    });

    it('sem nº da concessionária: card mostra "OS —", nunca o nº do sistema', async () => {
        mockListState.items = [
            makeOrder({ id: 1, order_number: '#1001', external_os_number: null }),
        ];
        mockListState.total = 1;
        const { getByText, queryByText } = await renderScreen();
        expect(getByText('OS —')).toBeTruthy();
        expect(queryByText('OS #1001')).toBeNull();
    });

    it('subtítulo no singular quando total = 1', async () => {
        mockListState.items = [makeOrder()];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('1 ordem cadastrada')).toBeTruthy();
    });
});

describe('ServiceOrdersListScreen — busca', () => {
    it('digitar na busca atualiza filters.search após o debounce', async () => {
        jest.useFakeTimers();
        const { getByPlaceholderText } = await renderScreen();

        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Buscar por placa ou O.S.'), 'ABC1D23');
        });
        // Avança o debounce (~400ms).
        await act(async () => {
            jest.advanceTimersByTime(500);
        });

        await waitFor(() => {
            expect(lastFilters).toMatchObject({ search: 'ABC1D23' });
        });
        jest.useRealTimers();
    });
});

describe('ServiceOrdersListScreen — permissões', () => {
    it('sem can_edit: não há FAB "Nova O.S"', async () => {
        mockCanEdit = false;
        const { queryByText } = await renderScreen();
        expect(queryByText('Nova O.S')).toBeNull();
    });

    it('com can_edit: mostra o FAB "Nova O.S"', async () => {
        mockCanEdit = true;
        mockListState.items = [makeOrder()];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('Nova O.S')).toBeTruthy();
    });
});

describe('ServiceOrdersListScreen — Resumo Diário (PDF)', () => {
    it('exige loja: sem loja selecionada, o botão desabilitado não baixa o PDF', async () => {
        mockGlobalStoreId = null; // "Todas as lojas" + várias lojas → sem pré-seleção
        const { getByLabelText, getByText } = await renderScreen();

        // Abre o sheet (test-double renderiza inline).
        await act(async () => {
            fireEvent.press(getByLabelText('Resumo Diário (PDF)'));
        });

        // Sem loja escolhida, o botão "Gerar PDF" fica desabilitado: pressioná-lo
        // não dispara o handler (nem download, nem toast).
        await act(async () => {
            fireEvent.press(getByText('Gerar PDF'));
        });
        expect(mockDownloadPdf).not.toHaveBeenCalled();
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('gera com store_id (loja global pré-selecionada) e only_completed', async () => {
        mockGlobalStoreId = 2; // pré-seleciona "Loja Sul"
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Resumo Diário (PDF)'));
        });
        // Marca "Apenas finalizadas".
        await act(async () => {
            fireEvent.press(getByLabelText('Apenas finalizadas'));
        });
        await act(async () => {
            fireEvent.press(getByText('Gerar PDF'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/service-orders/export/resumo-diario');
        expect(arg.params.store_id).toBe(2);
        expect(arg.params.date).toBe(todayYMD());
        expect(arg.params.only_completed).toBe(true);
        expect(arg.filename).toContain('resumo-diario-finalizados');
    });

    it('sem only_completed: não envia a flag e usa o nome padrão', async () => {
        mockGlobalStoreId = 1;
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Resumo Diário (PDF)'));
        });
        await act(async () => {
            fireEvent.press(getByText('Gerar PDF'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.params.store_id).toBe(1);
        expect(arg.params.only_completed).toBeUndefined();
        expect(arg.filename).toBe(`resumo-diario-${todayYMD()}.pdf`);
    });

    it('escolher loja no sheet (Todas as lojas) permite gerar', async () => {
        mockGlobalStoreId = null;
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Resumo Diário (PDF)'));
        });
        // Seleciona "Loja Centro" via Select-double.
        await act(async () => {
            fireEvent.press(getByLabelText('opt-Loja Centro'));
        });
        await act(async () => {
            fireEvent.press(getByText('Gerar PDF'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        expect(mockDownloadPdf.mock.calls[0][0].params.store_id).toBe(1);
    });

    it('perfil galpão só oferece a loja de galpão no seletor', async () => {
        mockGlobalStoreId = null;
        mockIsGalponProfile = true;
        const { getByLabelText, queryByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Resumo Diário (PDF)'));
        });
        expect(getByLabelText('opt-Galpão Central')).toBeTruthy();
        expect(queryByLabelText('opt-Loja Centro')).toBeNull();
    });
});
