import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FilmTypesScreen } from '@/screens/inventory/FilmTypesScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import type { FilmType } from '@/services/api/inventory.service';

/**
 * INV-06 — FilmTypesScreen (smoke).
 *
 * Mocka useFilmTypes (lista), useDeleteFilmType e a permissão (useCanEdit). O
 * FilmTypeFormSheet é mockado (passthrough) para isolar a lista. Cobre: render
 * dos tipos com limiares/contagem, navegação para serviços ao tocar e estado
 * vazio.
 */

let mockTypes: FilmType[] = [];
let mockLoading = false;
const mockDeleteMutate = jest.fn();
jest.mock('@/hooks/useInventory', () => ({
    useFilmTypes: () => ({
        data: mockTypes,
        isLoading: mockLoading,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
    useDeleteFilmType: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));

let mockCanEdit = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

// FilmTypeFormSheet: passthrough vazio (a lista é o foco do smoke).
jest.mock('@/components/features/FilmTypeFormSheet', () => ({
    FilmTypeFormSheet: () => null,
}));

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

function makeType(over: Partial<FilmType> = {}): FilmType {
    return {
        id: 1,
        name: 'Fumê 3M',
        department: 'film',
        yellow_threshold_meters: 10,
        red_threshold_meters: 5,
        is_active: true,
        services: [],
        ...over,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <FilmTypesScreen
                navigation={navigation as never}
                route={{ key: 'FilmTypes', name: 'FilmTypes' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockTypes = [];
    mockLoading = false;
    mockCanEdit = true;
});

describe('FilmTypesScreen', () => {
    it('Empty: sem tipos mostra EmptyState', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Nenhum tipo cadastrado')).toBeTruthy();
    });

    it('renderiza o tipo com limiares e contagem de serviços', async () => {
        mockTypes = [
            makeType({
                id: 1,
                name: 'Fumê 3M',
                services: [
                    { service_id: 9, service_name: 'Aplicação', service_code: 'AP', meters_consumed: 2 },
                ],
            }),
        ];
        const { getByText } = await renderScreen();
        expect(getByText('Fumê 3M')).toBeTruthy();
        expect(getByText('10m')).toBeTruthy();
        expect(getByText('5m')).toBeTruthy();
        expect(getByText('1 serviço(s)')).toBeTruthy();
    });

    it('tocar no tipo navega para FilmTypeServices com o id', async () => {
        mockTypes = [makeType({ id: 77, name: 'PPF X', department: 'ppf' })];
        const { getByLabelText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Tipo PPF X'));
        });
        expect(navigation.navigate).toHaveBeenCalledWith('FilmTypeServices', { id: 77 });
    });

    it('sem can_edit: não mostra ações de editar/excluir', async () => {
        mockCanEdit = false;
        mockTypes = [makeType({ id: 1, name: 'Fumê 3M' })];
        const { queryByLabelText } = await renderScreen();
        expect(queryByLabelText('Editar Fumê 3M')).toBeNull();
        expect(queryByLabelText('Excluir Fumê 3M')).toBeNull();
    });
});
