import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DayAbsencesScreen } from '@/screens/admin/DayAbsencesScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import type { DayStatusResponse, EmployeeDayStatusItem } from '@/types/employee.types';
import type { Photo } from '@/types/photo.types';

/**
 * Faltas do Dia (Admin) — render + ações principais.
 *
 * Mocka os hooks de day-status/mutations, StoreSelector, permissão, PhotoCapture
 * e Select (test-doubles inline). Cobre: exige loja; contadores/lista; marcar
 * falta (Sheet → tipo via Select → registrar com attachment_url da foto enviada);
 * desfazer falta (Alert destrutivo).
 */

// ─── day-status query + mutations ────────────────────────────────────────────
let mockDayData: DayStatusResponse | undefined;
const mockMarkMutate = jest.fn();
const mockDeleteMutate = jest.fn();
const mockReturnMutate = jest.fn();

jest.mock('@/hooks/useEmployees', () => ({
    useDayStatus: () => ({
        data: mockDayData,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
    useMarkFault: () => ({ mutate: mockMarkMutate, isPending: false }),
    useDeleteFault: () => ({ mutate: mockDeleteMutate, isPending: false }),
    useReturnFromAbsence: () => ({ mutate: mockReturnMutate, isPending: false }),
}));

// ─── loja ────────────────────────────────────────────────────────────────────
let mockSelectedStoreId: number | null = 3;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [{ id: 3, name: 'Loja Centro' }],
        selectedStoreId: mockSelectedStoreId,
        isMultiStore: false,
        selectStore: jest.fn(),
    }),
}));

// ─── permissão ────────────────────────────────────────────────────────────────
let mockCanEdit = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

// ─── Toast ────────────────────────────────────────────────────────────────────
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            info: mockToastInfo,
            show: jest.fn(),
        }),
    };
});

// ─── exportShare ──────────────────────────────────────────────────────────────
const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

// ─── Select (test-double) ─────────────────────────────────────────────────────
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

// ─── Sheet (test-double: renderiza filhos inline) ─────────────────────────────
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

// ─── PhotoCapture (test-double: injeta foto já enviada) ───────────────────────
let mockPhotosToInject: Photo[] = [];
jest.mock('@/components/features/PhotoCapture', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        PhotoCapture: ({ onChange }: { onChange: (v: unknown) => void }) =>
            React.createElement(
                Pressable,
                {
                    accessibilityLabel: 'inject-attachment',
                    onPress: () => onChange(mockPhotosToInject),
                },
                React.createElement(Text, null, 'inject-attachment')
            ),
    };
});

// api-error: repassa fallback
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
jest.mock('@/lib/resolveMediaUrl', () => ({
    resolveMediaUrl: (u: string) => u,
}));

// ─── helpers ──────────────────────────────────────────────────────────────────
const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ConfirmProvider>{children}</ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}
function makeItem(over: Partial<EmployeeDayStatusItem> = {}): EmployeeDayStatusItem {
    return {
        employee_id: 1,
        name: 'Ana Silva',
        position: 'Higienizador',
        status: 'presente',
        reason: null,
        fault_movement_id: null,
        attachment_url: null,
        needs_return: false,
        ...over,
    };
}
function makeData(items: EmployeeDayStatusItem[]): DayStatusResponse {
    return {
        items,
        present: items.filter((i) => i.status === 'presente').length,
        faults: items.filter((i) => i.status === 'falta').length,
        vacations: items.filter((i) => i.status === 'ferias').length,
        absences: items.filter((i) => i.status === 'afastado').length,
    };
}
async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <DayAbsencesScreen
                navigation={navigation as never}
                route={{ key: 'DayAbsencesAdmin', name: 'DayAbsencesAdmin' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDayData = makeData([makeItem()]);
    mockSelectedStoreId = 3;
    mockCanEdit = true;
    mockPhotosToInject = [];
});

describe('DayAbsencesScreen — estados', () => {
    it('exige loja: sem loja mostra o estado vazio de seleção de loja', async () => {
        mockSelectedStoreId = null;
        const { getByText } = await renderScreen();
        expect(
            getByText('Escolha uma loja no seletor acima para ver o status do dia.')
        ).toBeTruthy();
    });

    it('renderiza contadores e a lista de funcionários', async () => {
        mockDayData = makeData([
            makeItem({ employee_id: 1, name: 'Ana Silva', status: 'presente' }),
            makeItem({ employee_id: 2, name: 'Bruno Costa', status: 'falta', fault_movement_id: 9 }),
        ]);
        const { getByText } = await renderScreen();
        expect(getByText('Ana Silva')).toBeTruthy();
        expect(getByText('Bruno Costa')).toBeTruthy();
        expect(getByText('Presentes')).toBeTruthy();
        expect(getByText('Faltas')).toBeTruthy();
    });
});

describe('DayAbsencesScreen — marcar falta', () => {
    it('registra falta com attachment_url da foto enviada', async () => {
        mockPhotosToInject = [
            { id: 'p1', preview: 'x', uploaded: true, uploadProgress: 100, url: 'https://srv/a.jpg' },
        ];
        const { getByLabelText, getByText } = await renderScreen();

        // Abre o sheet (renderizado inline pelo test-double).
        await act(async () => {
            fireEvent.press(getByText('Marcar falta'));
        });

        // Injeta a foto já enviada e escolhe o tipo de falta via Select-double.
        await act(async () => {
            fireEvent.press(getByLabelText('inject-attachment'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('opt-Atestado'));
        });

        // Submete.
        await act(async () => {
            fireEvent.press(getByText('Registrar falta'));
        });

        await waitFor(() => expect(mockMarkMutate).toHaveBeenCalledTimes(1));
        const arg = mockMarkMutate.mock.calls[0][0];
        expect(arg.employeeId).toBe(1);
        expect(arg.payload.type).toBe('fault');
        expect(arg.payload.attachment_url).toBe('https://srv/a.jpg');
        expect(arg.payload.movement_data.fault_type).toBe('atestado');
    });

    it('bloqueia submit enquanto a foto ainda está enviando', async () => {
        mockPhotosToInject = [
            { id: 'p1', preview: 'x', uploaded: false, uploadProgress: 40 },
        ];
        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByText('Marcar falta'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('inject-attachment'));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('opt-Injustificada'));
        });
        await act(async () => {
            fireEvent.press(getByText('Registrar falta'));
        });

        expect(mockMarkMutate).not.toHaveBeenCalled();
        expect(mockToastInfo).toHaveBeenCalled();
    });
});

describe('DayAbsencesScreen — desfazer falta', () => {
    it('abre o diálogo e só muta ao confirmar', async () => {
        mockDayData = makeData([
            makeItem({ status: 'falta', fault_movement_id: 55, name: 'Bruno Costa' }),
        ]);
        const { getByText, findByText, getAllByText } = await renderScreen();

        // Botão "Desfazer" do card abre o ConfirmDialog.
        await act(async () => {
            fireEvent.press(getByText('Desfazer'));
        });

        await findByText('Desfazer falta');
        // Confirma no botão "Desfazer" do diálogo (o último da árvore).
        const desfazer = getAllByText('Desfazer');
        await act(async () => {
            fireEvent.press(desfazer[desfazer.length - 1]);
        });

        expect(mockDeleteMutate).toHaveBeenCalledWith(
            { employeeId: 1, movementId: 55 },
            expect.anything()
        );
    });

    it('sem can_edit não mostra ações', async () => {
        mockCanEdit = false;
        const { queryByText } = await renderScreen();
        expect(queryByText('Marcar falta')).toBeNull();
    });
});
