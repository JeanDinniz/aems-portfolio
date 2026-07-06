import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EditServiceOrderScreen } from '@/screens/service-orders/EditServiceOrderScreen';
import { ThemeProvider } from '@/theme';
import type { ServiceItemSelection } from '@/components/features/ServiceItemPicker';

/**
 * OS-07 — EditServiceOrderScreen (componente).
 *
 * Cobre: prefill a partir de useServiceOrder, submit chamando
 * useUpdateServiceOrder.mutateAsync com PATCH parcial, e o bloqueio quando a O.S.
 * está verificada ou foi criada há mais de 7 dias (regra do web `canEdit`).
 *
 * Espelha o padrão do CreateServiceOrderScreen.test: mocks dos hooks de dados,
 * test-doubles de Select/ServiceItemPicker. RNTL v14 → sempre await.
 */

// ─── Mutation de update + detalhe da O.S. ────────────────────────────────────
const mockUpdateMutateAsync = jest.fn();
let mockUpdateIsPending = false;

// Ordem retornada por useServiceOrder — mutável por teste.
let mockOrder: Record<string, unknown> | undefined;
let mockOrderLoading = false;

jest.mock('@/hooks/useServiceOrders', () => ({
    useServiceOrder: () => ({
        data: mockOrder,
        isLoading: mockOrderLoading,
        isError: false,
        refetch: jest.fn(),
    }),
    useUpdateServiceOrder: () => ({
        mutateAsync: mockUpdateMutateAsync,
        isPending: mockUpdateIsPending,
    }),
}));

// ─── Permissão de edição (useCanEdit) ────────────────────────────────────────
let mockCanEdit = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

// ─── Toast ───────────────────────────────────────────────────────────────────
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

// ─── Loja ─────────────────────────────────────────────────────────────────────
const mockStores = [
    { id: 1, name: 'Loja Centro', brand_id: 10, dealership_id: 100 },
    { id: 2, name: 'Loja Norte', brand_id: 20, dealership_id: 200 },
];
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({ stores: mockStores }),
}));

// ─── Pickers de veículo / consultor ──────────────────────────────────────────
jest.mock('@/hooks/useVehicleModels', () => ({
    useVehicleModels: () => ({
        data: [
            { id: 555, name: 'Corolla', brand_id: 10 },
            { id: 556, name: 'Hilux', brand_id: 10 },
        ],
        isLoading: false,
    }),
}));
jest.mock('@/hooks/useConsultants', () => ({
    useConsultants: () => ({
        consultants: [
            { id: 77, name: 'João Consultor' },
            { id: 88, name: 'Maria Consultora' },
        ],
        isLoading: false,
    }),
}));

// ─── Flags de galpão ─────────────────────────────────────────────────────────
let mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
jest.mock('@/navigation/guards', () => ({
    useGalponFlags: () => mockGalponFlags,
}));

// ─── api-error helper ────────────────────────────────────────────────────────
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// ─── Select (test-double, igual ao Create.test) ──────────────────────────────
jest.mock('@/components/ui/Select', () => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    const Select = React.forwardRef(
        (
            props: {
                options: { value: number | string; label: string }[];
                onChange: (v: unknown) => void;
                multiple?: boolean;
                value?: unknown;
            },
            ref: React.Ref<unknown>
        ) => {
            React.useImperativeHandle(ref, () => ({
                present: jest.fn(),
                dismiss: jest.fn(),
            }));
            return React.createElement(
                View,
                null,
                props.options.map((opt) =>
                    React.createElement(
                        Pressable,
                        {
                            key: String(opt.value),
                            accessibilityLabel: opt.label,
                            onPress: () => {
                                if (props.multiple) {
                                    const cur = (props.value as (number | string)[]) ?? [];
                                    const next = cur.includes(opt.value)
                                        ? cur.filter((v) => v !== opt.value)
                                        : [...cur, opt.value];
                                    props.onChange(next);
                                } else {
                                    props.onChange(opt.value);
                                }
                            },
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

// ─── Test-double: ServiceItemPicker ──────────────────────────────────────────
let mockServicesToInject: ServiceItemSelection[] = [];
jest.mock('@/components/features/ServiceItemPicker', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        ServiceItemPicker: ({
            onChange,
            error,
        }: {
            onChange: (v: unknown) => void;
            error?: string;
        }) =>
            React.createElement(
                React.Fragment,
                null,
                React.createElement(
                    Pressable,
                    {
                        accessibilityLabel: 'inject-services',
                        onPress: () => onChange(mockServicesToInject),
                    },
                    React.createElement(Text, null, 'inject-services')
                ),
                error ? React.createElement(Text, null, error) : null
            ),
    };
});

// ─── Providers / render ───────────────────────────────────────────────────────
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
            <EditServiceOrderScreen
                navigation={navigation as never}
                route={{ key: 'EditServiceOrder', name: 'EditServiceOrder', params: { id: 99 } } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

/** O.S. base: não verificada, criada agora (dentro da janela de 7 dias). */
function makeOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 99,
        order_number: 'OS-000099',
        status: 'waiting',
        department: 'film',
        plate: 'ABC1D23',
        vehicle_model: 'Corolla',
        vehicle_model_id: 555,
        vehicle_color: 'Preto',
        external_os_number: 'EXT-1',
        consultant_id: 77,
        location_id: 1,
        location_name: 'Loja Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        is_verified: false,
        notes: 'obs',
        service_date: '2026-06-10',
        entry_time: new Date().toISOString(),
        created_at: new Date().toISOString(),
        items: [{ service_id: 42, quantity: 1 }],
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateIsPending = false;
    mockCanEdit = true;
    mockOrderLoading = false;
    mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
    mockServicesToInject = [];
    mockOrder = makeOrder();
});

describe('EditServiceOrderScreen — prefill', () => {
    it('popula os campos com os valores atuais da O.S.', async () => {
        const utils = await renderScreen();
        const { getByPlaceholderText, getByText } = utils;

        await waitFor(() => {
            expect((getByPlaceholderText('ABC1D23').props as { value: string }).value).toBe(
                'ABC1D23'
            );
        });
        expect((getByPlaceholderText('Ex: Branco').props as { value: string }).value).toBe('Preto');
        expect((getByPlaceholderText('Ex: 12345').props as { value: string }).value).toBe('EXT-1');
        // Nº O.S. do sistema é exibido (read-only).
        expect(getByText('OS-000099')).toBeTruthy();
        // Loja read-only.
        expect(getByText('Loja Centro')).toBeTruthy();
    });
});

describe('EditServiceOrderScreen — submit', () => {
    it('salvar chama mutateAsync com PATCH parcial e navega de volta', async () => {
        mockUpdateMutateAsync.mockResolvedValueOnce({ id: 99 });
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText, navigation } = utils;

        // Prefill carregado.
        await waitFor(() => {
            expect((getByPlaceholderText('Ex: Branco').props as { value: string }).value).toBe(
                'Preto'
            );
        });

        // Altera a cor.
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Vermelho');
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar alterações'));
        });

        await waitFor(() => {
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });
        const call = mockUpdateMutateAsync.mock.calls[0][0];
        expect(call.id).toBe(99);
        expect(call.data).toMatchObject({
            plate: 'ABC1D23',
            department: 'film',
            vehicle_color: 'Vermelho',
            consultant_id: 77,
        });
        expect(call.data.items).toEqual([{ service_id: 42, quantity: 1 }]);
        // Não envia location_id (loja é read-only na edição).
        expect(call.data.location_id).toBeUndefined();
        expect(mockToastSuccess).toHaveBeenCalled();
        expect(navigation.goBack).toHaveBeenCalled();
    });
});

describe('EditServiceOrderScreen — bloqueio de edição', () => {
    it('bloqueia quando a O.S. já foi verificada (não chama mutateAsync)', async () => {
        mockOrder = makeOrder({ is_verified: true });
        const utils = await renderScreen();
        const { getByText } = utils;

        await waitFor(() => {
            expect(getByText('Edição indisponível')).toBeTruthy();
        });
        expect(getByText(/já foi conferida/i)).toBeTruthy();

        // Tentar salvar não dispara a mutation (botão desabilitado + guard no submit).
        await act(async () => {
            fireEvent.press(getByText('Salvar alterações'));
        });
        expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });

    it('bloqueia quando a O.S. foi criada há mais de 7 dias', async () => {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        mockOrder = makeOrder({ entry_time: eightDaysAgo, created_at: eightDaysAgo });
        const utils = await renderScreen();
        const { getByText } = utils;

        await waitFor(() => {
            expect(getByText('Edição indisponível')).toBeTruthy();
        });
        expect(getByText(/7 dias/i)).toBeTruthy();

        await act(async () => {
            fireEvent.press(getByText('Salvar alterações'));
        });
        expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });

    it('bloqueia quando o usuário não tem permissão de edição', async () => {
        mockCanEdit = false;
        const utils = await renderScreen();
        const { getByText } = utils;

        await waitFor(() => {
            expect(getByText(/não tem permissão/i)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(getByText('Salvar alterações'));
        });
        expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });
});
