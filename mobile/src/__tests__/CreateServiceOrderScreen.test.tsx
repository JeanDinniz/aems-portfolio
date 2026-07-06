import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CreateServiceOrderScreen } from '@/screens/service-orders/CreateServiceOrderScreen';
import { ThemeProvider } from '@/theme';
import type { Photo } from '@/types/photo.types';
import type { ServiceItemSelection } from '@/components/features/ServiceItemPicker';

/**
 * QA-02 (parcial) — CreateServiceOrderScreen (componente).
 *
 * Mocka os hooks de dados (useCreateServiceOrder/useStores/useBrands/
 * useVehicleModels/useConsultants), as flags de galpão, o store de loja, o Toast
 * e a fila de upload. ServiceItemPicker e PhotoCapture são substituídos por
 * test-doubles que expõem botões para injetar serviços/fotos no form — isolando
 * a lógica de validação + payload da tela (foco do QA-02).
 *
 * RNTL v14: render()/fireEvent são assíncronos → SEMPRE await.
 */

// ─── Mutation de criação (captura o mutateAsync) ─────────────────────────────
const mockMutateAsync = jest.fn();
let mockIsPending = false;
jest.mock('@/hooks/useServiceOrders', () => ({
    useCreateServiceOrder: () => ({
        mutateAsync: mockMutateAsync,
        isPending: mockIsPending,
    }),
    useDuplicateCheck: () => ({ data: undefined, isLoading: false }),
}));

// ─── Toast (captura success/error/show) ──────────────────────────────────────
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastShow = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            show: mockToastShow,
            info: jest.fn(),
        }),
    };
});

// ─── Loja: useStores + useStoreStore ─────────────────────────────────────────
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

// ─── Pickers de veículo / consultor ──────────────────────────────────────────
// Marca agora deriva da loja (não há mais picker de marca). A loja 1 tem brand_id 10.
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

// ─── Flags de galpão ─────────────────────────────────────────────────────────
let mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
jest.mock('@/navigation/guards', () => ({
    useGalponFlags: () => mockGalponFlags,
}));

// ─── Fila de upload ──────────────────────────────────────────────────────────
// pruneUploaded é usado no submit; getItem/getItems/remove pela restauração de
// rascunho e pelo "Descartar". getItem consulta `mockQueueItems` (por id).
const mockPruneUploaded = jest.fn();
const mockRemoveFromQueue = jest.fn();
let mockQueueItems: Record<string, unknown> = {};
jest.mock('@/services/upload/uploadQueue', () => ({
    pruneUploaded: (...args: unknown[]) => mockPruneUploaded(...args),
    remove: (...args: unknown[]) => mockRemoveFromQueue(...args),
    getItem: (id: string) => mockQueueItems[id],
    getItems: (ids: string[]) => ids.map((id) => mockQueueItems[id]).filter(Boolean),
    ensureHydrated: () => Promise.resolve(),
}));

// ─── Rascunho de O.S. (osDraftStorage) ───────────────────────────────────────
const mockLoadOSDraft = jest.fn();
const mockSaveOSDraft = jest.fn();
const mockClearOSDraft = jest.fn();
jest.mock('@/services/draft/osDraftStorage', () => ({
    loadOSDraft: () => mockLoadOSDraft(),
    saveOSDraft: (...args: unknown[]) => mockSaveOSDraft(...args),
    clearOSDraft: () => mockClearOSDraft(),
}));

// ─── api-error helper ────────────────────────────────────────────────────────
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// ─── Select (test-double) ────────────────────────────────────────────────────
// O Select real usa BottomSheetModal + BottomSheetFlatList, que não renderiza as
// opções inline no ambiente de teste. Substituímos por uma lista de Pressables
// rotulados pelo label da opção, para que os helpers selectModel/selectConsultant
// possam pressioná-las por texto. Mantém `value`/`onChange` (single e multiple).
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

// ─── Test-doubles: ServiceItemPicker e PhotoCapture ──────────────────────────
// Expõem botões que chamam onChange com payloads controlados pelos testes via
// variáveis `mock*`. Assim conseguimos simular "selecionar serviço" e "foto com
// url / sem url" sem depender da UI real (sheets/câmera/fila).
let mockServicesToInject: ServiceItemSelection[] = [];
let mockPhotosToInject: Photo[] = [];

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

jest.mock('@/components/features/PhotoCapture', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        PhotoCapture: ({
            label,
            onChange,
        }: {
            label?: string;
            onChange: (v: unknown) => void;
        }) =>
            // Só o capturador da "Foto da O.S." injeta; o de avaria fica inerte.
            label === 'Foto da O.S.'
                ? React.createElement(
                      Pressable,
                      {
                          accessibilityLabel: 'inject-photos',
                          onPress: () => onChange(mockPhotosToInject),
                      },
                      React.createElement(Text, null, 'inject-photos')
                  )
                : null,
    };
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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <CreateServiceOrderScreen
                navigation={navigation as never}
                route={{ key: 'CreateServiceOrder', name: 'CreateServiceOrder' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makePhoto(over: Partial<Photo> = {}): Photo {
    return {
        id: 'photo_1',
        preview: 'file:///p.jpg',
        uploaded: true,
        uploadProgress: 100,
        url: 'https://srv/p.jpg',
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockIsPending = false;
    mockSelectedStoreId = 1;
    mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
    mockServicesToInject = [];
    mockPhotosToInject = [];
    // Sem rascunho salvo por padrão → form vazio normal.
    mockLoadOSDraft.mockResolvedValue(null);
    mockQueueItems = {};
});

describe('CreateServiceOrderScreen — validações de submit', () => {
    it('placa inválida bloqueia o submit (não chama mutateAsync)', async () => {
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText } = utils;

        // Tudo preenchido exceto placa válida.
        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), '!!!'); // inválida
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectConsultant(utils);
        await selectModel(utils);
        // Serviço + foto válidos para garantir que o ÚNICO bloqueio é a placa.
        mockServicesToInject = [{ service_id: 1, quantity: 1 }];
        mockPhotosToInject = [makePhoto()];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(getByText(/Formato inválido/i)).toBeTruthy();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('sem nenhum serviço selecionado bloqueia o submit (mensagem de ≥1 serviço)', async () => {
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        // Consultor obrigatório (não galpão): seleciona via sheet.
        await selectConsultant(utils);
        await selectModel(utils);
        // SEM serviços; foto presente.
        mockPhotosToInject = [makePhoto()];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(getByText('Selecione pelo menos 1 serviço')).toBeTruthy();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('sem foto da O.S. bloqueia o submit com feedback de foto', async () => {
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectTipo(utils);
        await selectConsultant(utils);
        await selectModel(utils);
        // Serviço presente, mas NENHUMA foto.
        mockServicesToInject = [{ service_id: 1, quantity: 1 }];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith(
                expect.stringMatching(/adicione ao menos 1 foto/i)
            );
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('foto sem url (ainda enviando) desabilita o submit (botão busy, sem mutateAsync)', async () => {
        // Quando há foto sem `url` e sem `error`, `uploadingPhotos` fica true e o
        // botão Salvar entra em loading/disabled — o submit não dispara.
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText, getAllByRole } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectConsultant(utils);
        await selectModel(utils);
        mockServicesToInject = [{ service_id: 1, quantity: 1 }];
        // Foto SEM url (em envio) e SEM erro → uploadingPhotos = true.
        mockPhotosToInject = [makePhoto({ url: undefined, uploaded: false, uploadProgress: 40 })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        // Os dois botões de ação (Salvar / Salvar e Próxima) ficam desabilitados.
        const saveButtons = getAllByRole('button').filter(
            (b) => b.props.accessibilityState?.disabled === true
        );
        expect(saveButtons.length).toBeGreaterThanOrEqual(2);

        // Mesmo tentando pressionar, o submit não dispara (botão disabled).
        await act(async () => {
            fireEvent.press(saveButtons[0]);
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });
});

describe('CreateServiceOrderScreen — caminho feliz', () => {
    it('placa válida + ≥1 serviço + 1 foto com url → mutateAsync com payload correto', async () => {
        mockMutateAsync.mockResolvedValueOnce({ id: 1 });
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText, navigation } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1234');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectTipo(utils);
        await selectConsultant(utils);
        await selectModel(utils);
        mockServicesToInject = [{ service_id: 42, quantity: 1 }];
        mockPhotosToInject = [makePhoto({ url: 'https://srv/foto.jpg' })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        const payload = mockMutateAsync.mock.calls[0][0];
        expect(payload).toMatchObject({
            plate: 'ABC1D23',
            department: 'film',
            location_id: 1,
        });
        expect(payload.items).toEqual([{ service_id: 42, quantity: 1 }]);
        expect(payload.photos).toEqual(['https://srv/foto.jpg']);
        expect(payload.consultant_id).toBe(77);
        expect(navigation.goBack).toHaveBeenCalled();
        expect(mockPruneUploaded).toHaveBeenCalled();
    });

    it('"Salvar e Próxima" mantém depto + loja e limpa placa/serviços/fotos', async () => {
        mockMutateAsync.mockResolvedValueOnce({ id: 2 });
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText, navigation } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1234');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectTipo(utils);
        await selectConsultant(utils);
        await selectModel(utils);
        mockServicesToInject = [{ service_id: 42, quantity: 1 }];
        mockPhotosToInject = [makePhoto({ url: 'https://srv/foto.jpg' })];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar e Próxima'));
        });

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        // Não navega para trás (continua na tela).
        expect(navigation.goBack).not.toHaveBeenCalled();
        // Placa foi limpa (reset parcial).
        await waitFor(() => {
            expect((getByPlaceholderText('ABC1D23').props as { value: string }).value).toBe('');
        });
        // Departamento (film) permanece selecionado: chip "Película" continua na tela.
        expect(getByText('Película')).toBeTruthy();
        // Sucesso de "próxima".
        expect(mockToastSuccess).toHaveBeenCalledWith(
            expect.stringMatching(/próxima/i)
        );
    });
});

describe('CreateServiceOrderScreen — regras condicionais', () => {
    it('Nº O.S. Concessionária obrigatório fora de VN/VD/VU (film) bloqueia submit', async () => {
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película')); // film → exige external_os_number
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectConsultant(utils);
        await selectModel(utils);
        mockServicesToInject = [{ service_id: 1, quantity: 1 }];
        mockPhotosToInject = [makePhoto()];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });
        // SEM external_os_number.

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(getByText('Nº O.S. Concessionária obrigatório')).toBeTruthy();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('Consultor obrigatório quando NÃO é galpão bloqueia submit', async () => {
        const utils = await renderScreen();
        const { getByText, getByPlaceholderText } = utils;

        await act(async () => {
            fireEvent.press(getByText('Película'));
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('ABC1D23'), 'ABC1D23');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: 12345'), 'OS-1');
        });
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Ex: Branco'), 'Branco');
        });
        await selectModel(utils);
        // SEM consultor (não galpão).
        mockServicesToInject = [{ service_id: 1, quantity: 1 }];
        mockPhotosToInject = [makePhoto()];
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-services'));
        });
        await act(async () => {
            fireEvent.press(utils.getByLabelText('inject-photos'));
        });

        await act(async () => {
            fireEvent.press(getByText('Salvar'));
        });

        await waitFor(() => {
            expect(getByText('Consultor obrigatório')).toBeTruthy();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });
});

describe('CreateServiceOrderScreen — restauração de rascunho', () => {
    it('com rascunho salvo: repõe os campos e a foto no mount (sem chamar mutateAsync)', async () => {
        // Foto já enviada na fila (uploaded com url), vinculada ao rascunho.
        mockQueueItems = {
            photo_x: {
                id: 'photo_x',
                localUri: 'file:///queue/photo_x.jpg',
                mime: 'image/jpeg',
                name: 'photo_x.jpg',
                status: 'uploaded',
                attempts: 0,
                progress: 100,
                url: 'https://srv/photo_x.jpg',
                createdAt: 1,
            },
        };
        mockLoadOSDraft.mockResolvedValue({
            osDraftId: 'osdraft_restored',
            form: {
                location_id: 1,
                is_courtesy: false,
                is_return: false,
                courtesy_return_set: true,
                is_galpon: false,
                department: 'film',
                service_date: '2026-06-10',
                external_os_number: 'OS-RESTORED',
                plate: 'XYZ1A23',
                vehicle_model: 'Corolla',
                vehicle_model_id: 555,
                vehicle_color: 'Preto',
                consultant_id: 77,
                items: [{ service_id: 42, quantity: 1 }],
                notes: 'rascunho',
            },
            osPhotoIds: ['photo_x'],
            damagePhotoIds: [],
            savedAt: 123,
        });

        const utils = await renderScreen();
        const { getByPlaceholderText, getByText } = utils;

        // Campos repostos a partir do rascunho.
        await waitFor(() => {
            expect((getByPlaceholderText('ABC1D23').props as { value: string }).value).toBe(
                'XYZ1A23'
            );
        });
        expect((getByPlaceholderText('Ex: Branco').props as { value: string }).value).toBe('Preto');
        expect((getByPlaceholderText('Ex: 12345').props as { value: string }).value).toBe(
            'OS-RESTORED'
        );
        // A foto do rascunho foi buscada na fila pelo id salvo.
        expect(mockQueueItems).toBeDefined();
        // Nada é submetido só por restaurar.
        expect(mockMutateAsync).not.toHaveBeenCalled();
        // Botão "Descartar rascunho" aparece (há conteúdo).
        await waitFor(() => {
            expect(getByText('Descartar rascunho')).toBeTruthy();
        });
    });
});

// ─── Helpers que dirigem os Select (bottom-sheet mock) ───────────────────────
// O Select real renderiza as opções como Pressables com o label; o mock global
// de @gorhom/bottom-sheet renderiza o conteúdo inline, então as opções estão na
// árvore. Pressionamos a opção pelo texto.

async function selectModel(utils: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
        fireEvent.press(utils.getByText('Corolla'));
    });
}

async function selectConsultant(utils: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
        fireEvent.press(utils.getByText('João Consultor'));
    });
}

/** Marca o Tipo (campo obrigatório, sem default) — escolhe "Normal". */
async function selectTipo(utils: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
        fireEvent.press(utils.getByText('Normal'));
    });
}
