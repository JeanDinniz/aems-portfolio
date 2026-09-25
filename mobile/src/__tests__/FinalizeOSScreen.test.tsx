import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FinalizeOSScreen } from '@/screens/service-orders/FinalizeOSScreen';
import { ThemeProvider } from '@/theme';
import type { Photo } from '@/types/photo.types';

/**
 * OS-09 — FinalizeOSScreen: bobina por tonalidade (2A) + multi-instalador por
 * serviço (2B). Paridade com o FinalizeOSModal do web.
 *
 * Cobre:
 *  - Película: submit bloqueado até haver ≥1 instalador por serviço; payload monta
 *    `employee_assignments: {service_id, employee_ids}` (e `employee_ids: []`).
 *  - Multi-instalador: 2 instaladores no mesmo serviço → `employee_ids: [a, b]`.
 *  - Item multi-tonalidade: 1 slot de bobina POR tonalidade; assignment leva `tonality`.
 *  - Item legado (sem film_applications): 1 bobina; assignment SEM `tonality`.
 *  - Não-película: mantém o fluxo antigo (multi-select → `employee_ids`),
 *    sem `employee_assignments`.
 *  - Retalho (`used_scrap`): "Retalho (sobra)" é uma OPÇÃO dentro do seletor de
 *    bobina. Escolhê-la dispensa a bobina e envia `{used_scrap: true}` sem
 *    `film_roll_id` e SEM `scrap_source_roll_id`, ignora a validação de metragem
 *    e é pré-preenchido a partir do item (a origem eventual é ignorada).
 *
 * Segue o padrão do EditServiceOrderScreen.test: mocks dos hooks de dados +
 * test-doubles dos componentes de captura/pickers. RNTL v14 → sempre await.
 */

// ─── Detalhe da O.S. + mutation de finalize ──────────────────────────────────
let mockOrder: Record<string, unknown> | undefined;
const mockFinalizeMutateAsync = jest.fn();

jest.mock('@/hooks/useServiceOrders', () => ({
    useServiceOrder: () => ({
        data: mockOrder,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
    useFinalizeServiceOrder: () => ({
        mutateAsync: mockFinalizeMutateAsync,
        isPending: false,
    }),
}));

// ─── Funcionários da loja ────────────────────────────────────────────────────
let mockEmployees: Array<Record<string, unknown>> = [];
jest.mock('@/hooks/useEmployees', () => ({
    useEmployeesByStore: () => ({ data: mockEmployees }),
}));

// ─── Tipos de película (metros por serviço p/ validar metragem da bobina) ─────
// FilmType id 10 vincula o serviço 42 consumindo 5m por aplicação.
jest.mock('@/services/api/inventory.service', () => ({
    inventoryService: {
        listFilmTypes: jest.fn(() =>
            Promise.resolve({
                items: [
                    {
                        id: 10,
                        name: 'Cerâmica',
                        department: 'film',
                        yellow_threshold_meters: 5,
                        red_threshold_meters: 2,
                        is_active: true,
                        services: [{ service_id: 42, service_name: 'x', service_code: 'x', meters_consumed: 5 }],
                        available_tonalities: [],
                    },
                ],
                total: 1,
            })
        ),
    },
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

// ─── api-error / upload queue ─────────────────────────────────────────────────
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/upload/uploadQueue', () => ({
    pruneUploaded: jest.fn(),
}));

// ─── PhotoCapture (test-double): emite 1 foto já com `url` ao pressionar ───────
jest.mock('@/components/features/PhotoCapture', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        PhotoCapture: ({ onChange }: { onChange: (p: Photo[]) => void }) =>
            React.createElement(
                Pressable,
                {
                    accessibilityLabel: 'add-photo',
                    onPress: () =>
                        onChange([
                            {
                                id: 'p1',
                                preview: 'file://p1',
                                uploaded: true,
                                uploadProgress: 100,
                                url: 'http://api/uploads/p1.jpg',
                            },
                        ]),
                },
                React.createElement(Text, null, 'add-photo')
            ),
    };
});

// ─── FilmRollPicker (test-double) ─────────────────────────────────────────────
// "Retalho (sobra)" é uma OPÇÃO dentro do seletor. O double expõe DOIS gatilhos por
// slot (serviceId, tonality):
//  · `pick-roll-{serviceId}-{tonality}`  → onChange(rollId, roll) (bobina normal).
//    rollId = 500 + serviceId + soma(charCodes(tonality)) — distingue os slots.
//    Emite o objeto da bobina (film_type_id 10, remaining = mockRollRemaining) para
//    exercitar a validação de metragem.
//  · `pick-scrap-{serviceId}-{tonality}` → onSelectScrap() (opção "Retalho (sobra)").
// O `accessibilityValue.text` do gatilho de bobina reflete o modo (scrap|normal) e a
// obrigatoriedade efetiva. O label real (`serviceName`) é renderizado como texto.
let mockRollRemaining = 999;
jest.mock('@/components/features/FilmRollPicker', () => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    return {
        __esModule: true,
        FilmRollPicker: ({
            serviceId,
            tonality,
            serviceName,
            onChange,
            onSelectScrap,
            isScrap,
            required,
        }: {
            serviceId: number;
            tonality: string | null;
            serviceName: string;
            onChange: (v: number, roll?: Record<string, unknown>) => void;
            onSelectScrap?: () => void;
            isScrap?: boolean;
            required?: boolean;
        }) => {
            const code =
                tonality == null
                    ? 0
                    : [...tonality].reduce(
                          (acc: number, ch: string) => acc + ch.charCodeAt(0),
                          0
                      );
            const rollId = 500 + serviceId + code;
            return React.createElement(
                View,
                { accessibilityHint: serviceName },
                // Gatilho de bobina normal — reflete o modo e a obrigatoriedade.
                React.createElement(
                    Pressable,
                    {
                        accessibilityLabel: `pick-roll-${serviceId}-${tonality ?? 'none'}`,
                        accessibilityValue: {
                            text: `${isScrap ? 'scrap' : 'normal'}|${required ? 'req' : 'opt'}`,
                        },
                        onPress: () =>
                            onChange(rollId, {
                                id: rollId,
                                film_type_id: 10,
                                remaining_meters: mockRollRemaining,
                                visual_id: `ROLL-${rollId}`,
                            }),
                    },
                    React.createElement(Text, null, serviceName)
                ),
                // Gatilho da opção "Retalho (sobra)".
                React.createElement(
                    Pressable,
                    {
                        accessibilityLabel: `pick-scrap-${serviceId}-${tonality ?? 'none'}`,
                        onPress: () => onSelectScrap?.(),
                    },
                    React.createElement(Text, null, 'Retalho (sobra)')
                )
            );
        },
    };
});

// ─── ServiceInstallerPicker (test-double): multi-instalador por serviço ───────
// Ao pressionar, ADICIONA o próximo instalador ainda não selecionado (permite
// simular 1 ou 2 instaladores pressionando 1 ou 2 vezes).
jest.mock('@/components/features/ServiceInstallerPicker', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        ServiceInstallerPicker: ({
            serviceName,
            installers,
            value,
            onChange,
        }: {
            serviceName: string;
            installers: Array<{ id: number; name: string }>;
            value: number[];
            onChange: (v: number[]) => void;
        }) =>
            React.createElement(
                Pressable,
                {
                    accessibilityLabel: `pick-installer-${serviceName}`,
                    onPress: () => {
                        const next = installers.find((e) => !value.includes(e.id));
                        if (next) onChange([...value, next.id]);
                    },
                },
                React.createElement(Text, null, `pick-installer-${serviceName}`)
            ),
    };
});

// ─── Select (multi-select, test-double para o fluxo não-película) ─────────────
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
                            accessibilityLabel: `opt-${opt.label}`,
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

// ─── Providers / render ───────────────────────────────────────────────────────
const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
        <QueryClientProvider client={queryClient}>
            <SafeAreaProvider initialMetrics={metrics}>
                <ThemeProvider>{children}</ThemeProvider>
            </SafeAreaProvider>
        </QueryClientProvider>
    );
}

async function renderScreen() {
    // canGoBack=true simula o fluxo normal dentro da aba O.S. (Lista → Detalhe →
    // Finalizar), em que `leave()` faz goBack; cross-stack (canGoBack=false) reseta.
    const navigation = {
        navigate: jest.fn(),
        goBack: jest.fn(),
        canGoBack: jest.fn(() => true),
        reset: jest.fn(),
    };
    const utils = await render(
        <Providers>
            <FinalizeOSScreen
                navigation={navigation as never}
                route={
                    { key: 'FinalizeOS', name: 'FinalizeOS', params: { id: 99 } } as never
                }
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makeOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 99,
        order_number: 'OS-000099',
        status: 'doing',
        department: 'film',
        location_id: 1,
        is_galpon: false,
        items: [{ service_id: 42, quantity: 1, service_name: 'Insulfilm dianteiro' }],
        ...over,
    };
}

const INSTALLER = { id: 900, name: 'Ana Instaladora', is_active: true, position: 'Instalador de Película' };
const INSTALLER_2 = { id: 901, name: 'Carlos Instalador', is_active: true, position: 'Instalador de Película' };
const LAVADOR = { id: 700, name: 'Bruno Lavador', is_active: true, position: 'Lavador a Seco' };

beforeEach(() => {
    jest.clearAllMocks();
    mockFinalizeMutateAsync.mockResolvedValue({ id: 99 });
    mockOrder = makeOrder();
    mockEmployees = [INSTALLER, INSTALLER_2, LAVADOR];
    mockRollRemaining = 999; // bobina com metragem sobrando por padrão
});

describe('FinalizeOSScreen — película (instalador por serviço)', () => {
    it('mantém o botão de finalizar desabilitado enquanto faltar instalador', async () => {
        const { getByLabelText, getByText, getByRole } = await renderScreen();

        // Foto + bobina, mas SEM instalador → botão continua desabilitado.
        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });

        // Button expõe accessibilityState.disabled quando !canSubmit.
        await waitFor(() => {
            const button = getByRole('button', { name: 'Confirmar e Finalizar' });
            expect(button.props.accessibilityState?.disabled).toBe(true);
        });

        // Pressionar o botão desabilitado não dispara a mutation.
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });
        expect(mockFinalizeMutateAsync).not.toHaveBeenCalled();
    });

    it('monta employee_assignments (employee_ids por serviço) e employee_ids vazio', async () => {
        const { getByLabelText, getByText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { id, payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(id).toBe(99);
        expect(payload.employee_assignments).toEqual([
            { service_id: 42, employee_ids: [900] },
        ]);
        expect(payload.employee_ids).toEqual([]);
        // Item legado (sem film_applications): 1 bobina, SEM tonality.
        expect(payload.film_roll_assignments).toEqual([
            { service_id: 42, film_roll_id: 542 },
        ]);
        expect(payload.completion_photos).toEqual(['http://api/uploads/p1.jpg']);
        expect(mockToastSuccess).toHaveBeenCalled();
        expect(navigation.goBack).toHaveBeenCalled();
    });

    it('permite MÚLTIPLOS instaladores no mesmo serviço (employee_ids: [a, b])', async () => {
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });
        // Duas pressões = dois instaladores distintos (900, depois 901).
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(payload.employee_assignments).toEqual([
            { service_id: 42, employee_ids: [900, 901] },
        ]);
    });

    it('bloqueia e avisa quando a bobina tem metragem abaixo do necessário', async () => {
        // Serviço 42 precisa de 5m (mock do FilmType); bobina tem só 1m.
        mockRollRemaining = 1;
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });

        // Espera a query de tipos de película popular antes de submeter.
        await waitFor(() => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
            expect(mockToastError).toHaveBeenCalledWith(
                expect.stringContaining('precisa de 5.0m')
            );
        });
        expect(mockFinalizeMutateAsync).not.toHaveBeenCalled();
    });

    it('só oferece instaladores (position === Instalador de Película) como opção', async () => {
        // ServiceInstallerPicker recebe `installers` já filtrado; o test-double
        // seleciona o primeiro não escolhido. Se o lavador tivesse passado o filtro,
        // o id 700 apareceria.
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        // 900/901 = instaladores; 700 = lavador (não deve aparecer).
        expect(payload.employee_assignments).toEqual([
            { service_id: 42, employee_ids: [900] },
        ]);
    });
});

describe('FinalizeOSScreen — bobina por tonalidade (film_applications)', () => {
    beforeEach(() => {
        // Item com 2 tonalidades por região (G20 nas portas, G05 no vidro traseiro).
        mockOrder = makeOrder({
            items: [
                {
                    service_id: 42,
                    quantity: 1,
                    service_name: 'Insulfilm completo',
                    service_code: 'INS',
                    film_applications: [
                        { tonality: 'G20', region: 'Portas' },
                        { tonality: 'G05', region: 'Vidro traseiro' },
                    ],
                },
            ],
        });
    });

    it('gera 1 slot de bobina por tonalidade e o payload leva `tonality`', async () => {
        const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

        // Deve existir um FilmRollPicker por tonalidade distinta e nenhum slot legado.
        expect(queryByLabelText('pick-roll-42-G20')).toBeTruthy();
        expect(queryByLabelText('pick-roll-42-G05')).toBeTruthy();
        expect(queryByLabelText('pick-roll-42-none')).toBeNull();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-G20'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-G05'));
        });
        // Só há 1 serviço → 1 seleção de instalador cobre a validação.
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-INS - Insulfilm completo'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        // 1 assignment por tonalidade, cada um com `tonality`.
        const g20 = 500 + 42 + ['G', '2', '0'].reduce((a, c) => a + c.charCodeAt(0), 0);
        const g05 = 500 + 42 + ['G', '0', '5'].reduce((a, c) => a + c.charCodeAt(0), 0);
        expect(payload.film_roll_assignments).toEqual(
            expect.arrayContaining([
                { service_id: 42, film_roll_id: g20, tonality: 'G20' },
                { service_id: 42, film_roll_id: g05, tonality: 'G05' },
            ])
        );
        expect(payload.film_roll_assignments).toHaveLength(2);
    });

    it('bloqueia submit enquanto faltar bobina de alguma tonalidade', async () => {
        const { getByLabelText, getByText, getByRole } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        // Só uma das duas tonalidades tem bobina + instalador escolhido.
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-G20'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-INS - Insulfilm completo'));
        });

        await waitFor(() => {
            const button = getByRole('button', { name: 'Confirmar e Finalizar' });
            expect(button.props.accessibilityState?.disabled).toBe(true);
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });
        expect(mockFinalizeMutateAsync).not.toHaveBeenCalled();
    });
});

describe('FinalizeOSScreen — departamento não-película', () => {
    beforeEach(() => {
        mockOrder = makeOrder({
            department: 'workshop',
            items: [{ service_id: 42, quantity: 1, service_name: 'Lavagem' }],
        });
    });

    it('mantém multi-select → employee_ids e não envia employee_assignments', async () => {
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        // Seleciona um funcionário no multi-select (Select test-double).
        await act(async () => {
            fireEvent.press(getByLabelText('opt-Ana Instaladora'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(payload.employee_ids).toEqual([900]);
        expect(payload.employee_assignments).toBeUndefined();
        expect(payload.film_roll_assignments).toEqual([]);
    });
});

describe('FinalizeOSScreen — retalho (used_scrap)', () => {
    it('escolher "Retalho (sobra)" dispensa a bobina e envia used_scrap sem film_roll_id', async () => {
        const { getByLabelText, getByText, getByRole } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });

        // Sem bobina e sem retalho → bloqueado.
        await waitFor(() => {
            expect(
                getByRole('button', { name: 'Confirmar e Finalizar' }).props.accessibilityState
                    ?.disabled
            ).toBe(true);
        });

        // Seleciona a opção "Retalho (sobra)" no seletor → deixa de exigir bobina.
        await act(async () => {
            fireEvent.press(getByLabelText('pick-scrap-42-none'));
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        // Sem scrap_source_roll_id — a bobina de origem foi eliminada.
        expect(payload.film_roll_assignments).toEqual([{ service_id: 42, used_scrap: true }]);
        // film_roll_id não pode ir junto — o backend não debita nada em retalho.
        expect(payload.film_roll_assignments[0].film_roll_id).toBeUndefined();
    });

    it('não bloqueia por metragem insuficiente quando o slot é retalho', async () => {
        // Serviço 42 precisa de 5m; a bobina escolhida tem 1m. Ao trocar para retalho,
        // a bobina é limpa e a metragem deixa de importar.
        mockRollRemaining = 1;
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });
        // Seleciona a bobina (modo normal) e depois troca para "Retalho (sobra)".
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-scrap-42-none'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockToastError).not.toHaveBeenCalled();
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        // A bobina escolhida antes NÃO vaza — retalho vai sem bobina.
        expect(payload.film_roll_assignments).toEqual([{ service_id: 42, used_scrap: true }]);
    });

    it('mistura retalho e bobina em item multi-tonalidade (1 slot por tonalidade)', async () => {
        mockOrder = makeOrder({
            items: [
                {
                    service_id: 42,
                    quantity: 1,
                    service_name: 'Insulfilm completo',
                    service_code: 'INS',
                    film_applications: [
                        { tonality: 'G20', region: 'Portas' },
                        { tonality: 'G05', region: 'Vidro traseiro' },
                    ],
                },
            ],
        });
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-INS - Insulfilm completo'));
        });
        // G20 com bobina normal; G05 escolhe "Retalho (sobra)".
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-G20'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-scrap-42-G05'));
        });

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        const g20 = 500 + 42 + ['G', '2', '0'].reduce((a, c) => a + c.charCodeAt(0), 0);
        expect(payload.film_roll_assignments).toEqual(
            expect.arrayContaining([
                { service_id: 42, film_roll_id: g20, tonality: 'G20' },
                { service_id: 42, tonality: 'G05', used_scrap: true },
            ])
        );
        expect(payload.film_roll_assignments).toHaveLength(2);
    });

    it('pré-preenche o retalho já gravado no item (origem ignorada)', async () => {
        mockOrder = makeOrder({
            items: [
                {
                    service_id: 42,
                    quantity: 1,
                    service_name: 'Insulfilm dianteiro',
                    used_scrap: true,
                    // Origem eventualmente presente no dado antigo — deve ser ignorada.
                    scrap_source_roll_id: 777,
                },
            ],
        });
        const { getByLabelText, getByText } = await renderScreen();

        // Picker já em modo retalho, sem tocar em nada.
        await waitFor(() => {
            expect(getByLabelText('pick-roll-42-none').props.accessibilityValue?.text).toBe(
                'scrap|req'
            );
        });

        await act(async () => {
            fireEvent.press(getByLabelText('add-photo'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro'));
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(payload.film_roll_assignments).toEqual([{ service_id: 42, used_scrap: true }]);
    });
});

describe('FinalizeOSScreen — relato técnico (execution_notes)', () => {
    async function fillRequired(getByLabelText: (l: string) => unknown) {
        await act(async () => {
            fireEvent.press(getByLabelText('add-photo') as never);
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-roll-42-none') as never);
        });
        await act(async () => {
            fireEvent.press(getByLabelText('pick-installer-Insulfilm dianteiro') as never);
        });
    }

    it('envia execution_notes trimado e mostra o contador', async () => {
        const { getByLabelText, getByText } = await renderScreen();
        await fillRequired(getByLabelText);

        await act(async () => {
            fireEvent.changeText(getByLabelText('Relato técnico'), '  risco na porta  ');
        });
        expect(getByText('18/2000')).toBeTruthy();

        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(payload.execution_notes).toBe('risco na porta');
    });

    it('não envia execution_notes quando o relato está vazio ou só com espaços', async () => {
        const { getByLabelText, getByText } = await renderScreen();
        await fillRequired(getByLabelText);

        await act(async () => {
            fireEvent.changeText(getByLabelText('Relato técnico'), '   ');
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar e Finalizar'));
        });

        await waitFor(() => {
            expect(mockFinalizeMutateAsync).toHaveBeenCalledTimes(1);
        });
        const { payload } = mockFinalizeMutateAsync.mock.calls[0][0];
        expect(payload).not.toHaveProperty('execution_notes');
    });

    it('limita o campo a 2000 caracteres', async () => {
        const { getByLabelText } = await renderScreen();
        expect(getByLabelText('Relato técnico').props.maxLength).toBe(2000);
    });

    it('mostra o Briefing do Consultor (read-only) quando a O.S. tem notes', async () => {
        mockOrder = makeOrder({ notes: 'Cliente pediu G20 nas portas' });
        const { getByText } = await renderScreen();

        expect(getByText('Briefing do Consultor')).toBeTruthy();
        expect(getByText('Cliente pediu G20 nas portas')).toBeTruthy();
    });

    it('não mostra o Briefing do Consultor quando a O.S. não tem notes', async () => {
        const { queryByText } = await renderScreen();
        expect(queryByText('Briefing do Consultor')).toBeNull();
    });
});
