import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CreateAppointmentScreen } from '@/screens/scheduling/CreateAppointmentScreen';
import { EditAppointmentScreen } from '@/screens/scheduling/EditAppointmentScreen';
import { ThemeProvider } from '@/theme';
import type { Appointment } from '@/types/scheduling.types';

/**
 * AGD-03 / AGD-04 — Form de Agendamento (Create + Edit).
 *
 * Mocka os hooks de dados (useStores/useVehicleModels/useConsultants/
 * useServices/useFilmTypes), capacidade, flags de galpão, store de loja e as
 * mutations (useCreateAppointment/useUpdateAppointment/useAppointment). O
 * `Select` é substituído por um test-double que renderiza as opções inline como
 * Pressables (rotuladas pelo label), permitindo dirigir a seleção por texto.
 *
 * Cobre: tipo obrigatório, consultor obrigatório (não-galpão), ≥1 serviço, placa
 * inválida, montagem de film_entries (depto película) e edição permitindo
 * desmarcar is_galpon.
 */

// ─── Mutations ───────────────────────────────────────────────────────────────
const mockCreateMutate = jest.fn();
const mockCreateCombinedMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockAddDepartmentsMutate = jest.fn();
let mockCreatePending = false;
let mockCreateCombinedPending = false;
let mockUpdatePending = false;
let mockAddDepartmentsPending = false;
let mockAppointment: Appointment | null = null;

jest.mock('@/hooks/useScheduling', () => ({
    useCreateAppointment: () => ({ mutate: mockCreateMutate, isPending: mockCreatePending }),
    useCreateCombinedAppointment: () => ({
        mutate: mockCreateCombinedMutate,
        isPending: mockCreateCombinedPending,
    }),
    useUpdateAppointment: () => ({ mutate: mockUpdateMutate, isPending: mockUpdatePending }),
    useAddDepartments: () => ({
        mutate: mockAddDepartmentsMutate,
        isPending: mockAddDepartmentsPending,
    }),
    useAppointment: () => ({
        data: mockAppointment,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
    useAppointmentCapacity: () => ({ data: 0 }),
}));

// ─── Loja ────────────────────────────────────────────────────────────────────
const mockStores = [
    { id: 1, name: 'Loja Centro', brand_id: 10, dealership_id: 100 },
    { id: 2, name: 'Loja Norte', brand_id: 20, dealership_id: 200 },
];
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({ stores: mockStores }),
}));
let mockSelectedStoreId: number | null = 1;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));

// ─── Pickers de dados ────────────────────────────────────────────────────────
jest.mock('@/hooks/useVehicleModels', () => ({
    useVehicleModels: () => ({
        data: [{ id: 555, name: 'Corolla', brand_id: 10 }],
        isLoading: false,
    }),
}));
jest.mock('@/hooks/useConsultants', () => ({
    useConsultants: () => ({
        consultants: [{ id: 77, name: 'João Consultor' }],
        isLoading: false,
    }),
}));
jest.mock('@/hooks/useServices', () => ({
    useServices: () => ({
        data: [
            { id: 42, name: 'Película Dianteira', code: 'PD', department: 'film' },
            { id: 43, name: 'Funilaria Geral', code: 'FG', department: 'bodywork' },
        ],
        isLoading: false,
    }),
}));
jest.mock('@/hooks/useInventory', () => ({
    useFilmTypes: () => ({ data: [{ id: 9, name: 'XPEL Ultimate' }] }),
}));

// ─── Flags de galpão ─────────────────────────────────────────────────────────
let mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
jest.mock('@/navigation/guards', () => ({
    useGalponFlags: () => mockGalponFlags,
}));

// ─── DateTimePicker (test-double) ────────────────────────────────────────────
// O picker nativo não roda no jsdom; substituímos por um Pressable que dispara
// onChange com uma data fixa (mode date/time). Rotulado por `dtp-${mode}`.
jest.mock('@react-native-community/datetimepicker', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    const FIXED = new Date(2026, 5, 25, 14, 30, 0); // 25/06/2026 14:30
    const DateTimePicker = ({
        mode,
        onChange,
    }: {
        mode?: string;
        onChange: (e: { type: string }, d?: Date) => void;
    }) =>
        React.createElement(
            Pressable,
            {
                accessibilityLabel: `dtp-${mode}`,
                onPress: () => onChange({ type: 'set' }, FIXED),
            },
            React.createElement(Text, null, `dtp-${mode}`)
        );
    return { __esModule: true, default: DateTimePicker };
});

// ─── Select (test-double: opções inline como Pressables) ─────────────────────
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

async function renderCreate() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <CreateAppointmentScreen
                navigation={navigation as never}
                route={{ key: 'CreateAppointment', name: 'CreateAppointment' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

async function renderEdit(id = 5) {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <EditAppointmentScreen
                navigation={navigation as never}
                route={{ key: 'EditAppointment', name: 'EditAppointment', params: { id } } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

// Preenche placa/cor (campos de texto sempre presentes).
async function fillVehicle(
    utils: Awaited<ReturnType<typeof renderCreate>>,
    plate: string
) {
    await act(async () => {
        fireEvent.changeText(utils.getByPlaceholderText('ABC1D23'), plate);
    });
    await act(async () => {
        fireEvent.changeText(utils.getByPlaceholderText('Ex: Prata'), 'Prata');
    });
}

async function pickOption(utils: Awaited<ReturnType<typeof renderCreate>>, label: string) {
    await act(async () => {
        fireEvent.press(utils.getByLabelText(`opt-${label}`));
    });
}

// Abre o picker de horário e confirma o valor fixo (14:30) via DateTimePicker mock.
async function setTime(utils: Awaited<ReturnType<typeof renderCreate>>) {
    // PickerField "Horário" é um Pressable (não TextInput) com accessibilityLabel
    // igual ao placeholder quando vazio.
    await act(async () => {
        fireEvent.press(utils.getByLabelText('HH:MM'));
    });
    await act(async () => {
        fireEvent.press(utils.getByLabelText('dtp-time'));
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCreatePending = false;
    mockCreateCombinedPending = false;
    mockUpdatePending = false;
    mockSelectedStoreId = 1;
    mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
    mockAppointment = null;
});

describe('CreateAppointmentScreen — validações', () => {
    it('tipo (Normal/Cortesia/Retorno) obrigatório bloqueia submit', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Funilaria'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await pickOption(utils, 'FG — Funilaria Geral');

        // SEM escolher o tipo.
        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(getByText('Selecione o tipo')).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('placa inválida bloqueia submit', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Funilaria'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, '!!!'); // inválida
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await pickOption(utils, 'FG — Funilaria Geral');

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(getByText(/Formato inválido/i)).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('consultor obrigatório quando NÃO é galpão bloqueia submit', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Funilaria'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'FG — Funilaria Geral');
        // SEM consultor.

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(getByText('Consultor obrigatório')).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('sem nenhum serviço bloqueia submit (mensagem de ≥1 serviço)', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Funilaria'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await setTime(utils);
        // SEM serviços.

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(getByText(/ao menos 1 serviço/i)).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('depto película não adiciona película sem tonalidade e bloqueia submit', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');

        // Seleciona o serviço de película mas NÃO a tonalidade.
        await pickOption(utils, 'PD — Película Dianteira');
        await act(async () => {
            fireEvent.press(getByText('Adicionar película'));
        });
        await setTime(utils);

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        // A película não foi adicionada → cai na validação de ≥1 serviço.
        await waitFor(() => {
            expect(getByText(/ao menos 1 serviço/i)).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });
});

describe('CreateAppointmentScreen — caminho feliz + film_entries', () => {
    it('depto película monta film_entries com tonalidade e chama create', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        // Depto Película → usa o picker de película (film_entries).
        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');

        // Seleciona o serviço de película (abre o sheet de serviço de película).
        await pickOption(utils, 'PD — Película Dianteira');
        // Tonalidade aparece após escolher o serviço.
        await pickOption(utils, 'G20');
        // Adiciona a película.
        await act(async () => {
            fireEvent.press(getByText('Adicionar película'));
        });
        await setTime(utils);

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(mockCreateMutate).toHaveBeenCalledTimes(1);
        });
        const payload = mockCreateMutate.mock.calls[0][0];
        expect(payload).toMatchObject({
            store_id: 1,
            department: 'film',
            vehicle_plate: 'ABC1D23',
            consultant_id: 77,
        });
        expect(payload.film_entries).toEqual([
            { service_id: 42, tonality: 'G20', film_roll_id: undefined, film_type_id: undefined },
        ]);
        expect(payload.service_ids).toEqual([42]);
    });

    // Renderiza o Create e adiciona uma película (serviço PD + tonalidade G20).
    async function addFilmEntryG20() {
        const utils = await renderCreate();
        const { getByText } = utils;
        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await pickOption(utils, 'PD — Película Dianteira');
        await pickOption(utils, 'G20');
        await act(async () => {
            fireEvent.press(getByText('Adicionar película'));
        });
        await setTime(utils);
        return utils;
    }

    it('detalhar por região cria 2 aplicações e bloqueia submit sem tonalidade em todas', async () => {
        const utils = await addFilmEntryG20();
        const { getByText, queryByText } = utils;

        // Antes de detalhar, o link de regiões aparece; ao clicar, vira lista de
        // aplicações (2, a 2ª sem tonalidade) → submit bloqueado.
        await act(async () => {
            fireEvent.press(getByText('Tonalidades diferentes por região do carro?'));
        });
        // O link some (agora está no modo "por região").
        expect(queryByText('Tonalidades diferentes por região do carro?')).toBeNull();

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(getByText(/incluindo cada região adicionada/i)).toBeTruthy();
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('remover a última aplicação volta para tonalidade única e permite submit', async () => {
        const utils = await addFilmEntryG20();
        const { getByText, getByLabelText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Tonalidades diferentes por região do carro?'));
        });
        // Remove a 2ª aplicação (vazia): next.length <= 1 → colapsa p/ tonalidade única.
        await act(async () => {
            fireEvent.press(getByLabelText('Remover região 2'));
        });

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(mockCreateMutate).toHaveBeenCalledTimes(1);
        });
        const payload = mockCreateMutate.mock.calls[0][0];
        expect(payload.film_entries).toEqual([
            {
                service_id: 42,
                tonality: 'G20',
                film_roll_id: undefined,
                film_type_id: undefined,
                applications: undefined,
            },
        ]);
    });

    it('detalhar por região envia applications (tonalidade + região) no payload', async () => {
        const utils = await addFilmEntryG20();
        const { getByText, getByLabelText, getAllByLabelText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Tonalidades diferentes por região do carro?'));
        });

        // Região da 1ª aplicação (já com G20).
        await act(async () => {
            fireEvent.changeText(
                getAllByLabelText('Região do carro')[0],
                'Para-brisa'
            );
        });

        // Seleciona a tonalidade da 2ª aplicação: abre a sheet do card (activeAppIndex=1)
        // e escolhe G05. O card renderiza antes da sheet pendente → índice 0 é o do card.
        await act(async () => {
            fireEvent.press(getByLabelText('Selecionar tonalidade da região'));
        });
        await act(async () => {
            fireEvent.press(getAllByLabelText('opt-G05')[0]);
        });
        // Região da 2ª aplicação.
        await act(async () => {
            fireEvent.changeText(
                getAllByLabelText('Região do carro')[1],
                'Portas dianteiras'
            );
        });

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(mockCreateMutate).toHaveBeenCalledTimes(1);
        });
        const payload = mockCreateMutate.mock.calls[0][0];
        expect(payload.film_entries).toHaveLength(1);
        expect(payload.film_entries[0]).toMatchObject({
            service_id: 42,
            applications: [
                { tonality: 'G20', region: 'Para-brisa' },
                { tonality: 'G05', region: 'Portas dianteiras' },
            ],
        });
    });

    it('depto não-película monta service_ids e chama create', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Funilaria'));
        });
        await act(async () => {
            fireEvent.press(getByText('Normal'));
        });
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await pickOption(utils, 'FG — Funilaria Geral');
        await setTime(utils);

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(mockCreateMutate).toHaveBeenCalledTimes(1);
        });
        const payload = mockCreateMutate.mock.calls[0][0];
        expect(payload.service_ids).toEqual([43]);
        expect(payload.film_entries).toBeUndefined();
        expect(payload.delivery_time).toBe('14:30');
    });
});

describe('CreateAppointmentScreen — agendamento combinado (2C)', () => {
    // Liga o toggle "Combinado" (switch por accessibilityLabel).
    async function toggleCombined(utils: Awaited<ReturnType<typeof renderCreate>>) {
        await act(async () => {
            fireEvent.press(utils.getByLabelText('Combinado (múltiplos departamentos)'));
        });
    }

    // Pressiona um chip de departamento por texto (Chip usa o label como texto).
    async function pressDept(utils: Awaited<ReturnType<typeof renderCreate>>, label: string) {
        await act(async () => {
            fireEvent.press(utils.getByText(label));
        });
    }

    it('toggle combinado não aparece no modo edição', async () => {
        mockAppointment = {
            id: 5,
            store_id: 1,
            store_name: 'Loja Centro',
            department: 'bodywork',
            delivery_date: '2026-06-25',
            delivery_time: '14:30',
            external_os_number: null,
            vehicle_plate: 'XYZ1A23',
            vehicle_model: 'Corolla',
            vehicle_color: 'Preto',
            consultant_id: 77,
            consultant_name: 'João Consultor',
            service_ids: [43],
            service_names: ['Funilaria Geral'],
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
        const utils = await renderEdit(5);
        await waitFor(() => {
            expect(
                (utils.getByPlaceholderText('ABC1D23').props as { value: string }).value
            ).toBe('XYZ1A23');
        });
        expect(utils.queryByLabelText('Combinado (múltiplos departamentos)')).toBeNull();
    });

    it('mostra o preview com N departamentos e a placa', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await pressDept(utils, 'Normal');
        await toggleCombined(utils);
        // Chips de departamento (multi-seleção): Funilaria + PPF.
        await pressDept(utils, 'Funilaria');
        await pressDept(utils, 'PPF');
        await fillVehicle(utils, 'ABC1D23');

        await waitFor(() => {
            expect(
                getByText(/Serão criados 2 agendamentos: 1 de Funilaria \+ 1 de PPF/)
            ).toBeTruthy();
        });
        expect(getByText(/mesmo carro ABC1D23/)).toBeTruthy();
        // O botão de submit reflete a contagem.
        expect(getByText('Criar 2 agendamentos')).toBeTruthy();
    });

    it('bloqueia submit quando um departamento combinado está sem serviço', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await pressDept(utils, 'Normal');
        await toggleCombined(utils);
        await pressDept(utils, 'Funilaria');
        await pressDept(utils, 'PPF');
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await setTime(utils);
        // NENHUM serviço adicionado em nenhum departamento.

        await act(async () => {
            fireEvent.press(getByText('Criar 2 agendamentos'));
        });

        await waitFor(() => {
            expect(getByText(/Adicione ao menos 1 serviço/i)).toBeTruthy();
        });
        expect(mockCreateCombinedMutate).not.toHaveBeenCalled();
    });

    it('monta departments[] (película + funilaria) e chama createCombined', async () => {
        const utils = await renderCreate();
        const { getByText, getAllByLabelText } = utils;

        await pressDept(utils, 'Normal');
        await toggleCombined(utils);
        // Combina Película + Funilaria (ordem importa p/ indexar as seções).
        await pressDept(utils, 'Película');
        await pressDept(utils, 'Funilaria');
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await setTime(utils);

        // Seção 1 (Película): o mock de useServices devolve as 2 mesmas opções em
        // AMBAS as seções; a 1ª seção (Película) é a de índice 0 do serviço PD.
        await act(async () => {
            fireEvent.press(getAllByLabelText('opt-PD — Película Dianteira')[0]);
        });
        // Tonalidade da seção Película (índice 0).
        await act(async () => {
            fireEvent.press(getAllByLabelText('opt-G20')[0]);
        });
        await act(async () => {
            // Só a seção de película renderiza "Adicionar película".
            fireEvent.press(getByText('Adicionar película'));
        });

        // Seção 2 (Funilaria): multi-select de serviços — escolhe FG na 2ª ocorrência.
        await act(async () => {
            fireEvent.press(getAllByLabelText('opt-FG — Funilaria Geral')[1]);
        });

        await act(async () => {
            fireEvent.press(getByText('Criar 2 agendamentos'));
        });

        await waitFor(() => {
            expect(mockCreateCombinedMutate).toHaveBeenCalledTimes(1);
        });
        expect(mockCreateMutate).not.toHaveBeenCalled();

        const payload = mockCreateCombinedMutate.mock.calls[0][0];
        expect(payload).toMatchObject({
            store_id: 1,
            vehicle_plate: 'ABC1D23',
            consultant_id: 77,
            delivery_time: '14:30',
        });
        expect(payload.department).toBeUndefined(); // combinado não envia department de topo
        expect(payload.departments).toHaveLength(2);

        const filmDept = payload.departments.find(
            (d: { department: string }) => d.department === 'film'
        );
        expect(filmDept.service_ids).toEqual([42]);
        expect(filmDept.film_entries).toEqual([
            { service_id: 42, tonality: 'G20', film_roll_id: undefined, film_type_id: undefined },
        ]);

        const bodyworkDept = payload.departments.find(
            (d: { department: string }) => d.department === 'bodywork'
        );
        expect(bodyworkDept.service_ids).toEqual([43]);
        expect(bodyworkDept.film_entries).toBeUndefined();
    });

    it('desligar o toggle volta ao modo simples (1 depto, create normal)', async () => {
        const utils = await renderCreate();
        const { getByText } = utils;

        await pressDept(utils, 'Normal');
        await toggleCombined(utils);
        await pressDept(utils, 'Funilaria');
        await pressDept(utils, 'PPF');
        // Desliga: volta ao modo simples (chips viram seleção única).
        await toggleCombined(utils);

        // Agora escolhe UM departamento e cria via fluxo normal.
        await pressDept(utils, 'Funilaria');
        await fillVehicle(utils, 'ABC1D23');
        await pickOption(utils, 'Corolla');
        await pickOption(utils, 'João Consultor');
        await pickOption(utils, 'FG — Funilaria Geral');
        await setTime(utils);

        await act(async () => {
            fireEvent.press(getByText('Criar agendamento'));
        });

        await waitFor(() => {
            expect(mockCreateMutate).toHaveBeenCalledTimes(1);
        });
        expect(mockCreateCombinedMutate).not.toHaveBeenCalled();
        const payload = mockCreateMutate.mock.calls[0][0];
        expect(payload.department).toBe('bodywork');
        expect(payload.service_ids).toEqual([43]);
    });
});

describe('EditAppointmentScreen — edição', () => {
    const baseAppointment: Appointment = {
        id: 5,
        store_id: 1,
        store_name: 'Loja Centro',
        department: 'bodywork',
        delivery_date: '2026-06-25',
        delivery_time: '14:30',
        external_os_number: 'OS-9',
        vehicle_plate: 'XYZ1A23',
        vehicle_model: 'Corolla',
        vehicle_color: 'Preto',
        consultant_id: 77,
        consultant_name: 'João Consultor',
        service_ids: [43],
        service_names: ['Funilaria Geral'],
        film_entries: null,
        notes: 'obs',
        is_galpon: true,
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

    it('popula os campos do agendamento (placa/cor)', async () => {
        mockAppointment = { ...baseAppointment };
        const utils = await renderEdit(5);

        await waitFor(() => {
            expect(
                (utils.getByPlaceholderText('ABC1D23').props as { value: string }).value
            ).toBe('XYZ1A23');
        });
        expect((utils.getByPlaceholderText('Ex: Prata').props as { value: string }).value).toBe(
            'Preto'
        );
    });

    it('usuário galpão PODE desmarcar is_galpon e salvar via update (PATCH)', async () => {
        // Perfil galpão: no EDIT o toggle Galpão NÃO fica travado.
        mockGalponFlags = { isGalponProfile: true, hideGalponOption: false };
        mockAppointment = { ...baseAppointment, is_galpon: true };
        const utils = await renderEdit(5);
        const { getByText } = utils;

        // Aguarda popular (is_galpon=true → chip Galpão ativo).
        await waitFor(() => {
            expect(
                (utils.getByPlaceholderText('ABC1D23').props as { value: string }).value
            ).toBe('XYZ1A23');
        });

        // Desmarca Galpão (permitido na edição mesmo sendo perfil galpão).
        await act(async () => {
            fireEvent.press(getByText('Galpão'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar alterações'));
        });

        await waitFor(() => {
            expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
        });
        const { id, payload } = mockUpdateMutate.mock.calls[0][0];
        expect(id).toBe(5);
        expect(payload.is_galpon).toBe(false);
    });
});
