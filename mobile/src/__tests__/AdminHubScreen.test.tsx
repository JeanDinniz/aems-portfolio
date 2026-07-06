import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AdminHubScreen } from '@/screens/admin/AdminHubScreen';
import { ThemeProvider } from '@/theme';
import type { SubModule } from '@/types/accessProfile.types';

/**
 * Admin — Fatia 5a: gate de permissão do AdminHub. Cada atalho aparece só se o
 * submódulo é visível (`useCanView`). Sem nenhuma permissão → "Acesso restrito".
 * `useCanView` é mockado a partir de um conjunto controlável por teste.
 */
let mockVisibleSet = new Set<SubModule>();
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanView: (sub: SubModule) => mockVisibleSet.has(sub),
}));

// isOwner controlável por teste (gate de Fornecedores/Concessionárias na 5b).
let mockIsOwner = false;
jest.mock('@/stores/auth.store', () => ({
    useAuthStore: (selector: (s: { isOwner: () => boolean }) => unknown) =>
        selector({ isOwner: () => mockIsOwner }),
}));

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

async function renderHub() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <AdminHubScreen
                navigation={navigation as never}
                route={{ key: 'AdminHub', name: 'AdminHub' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVisibleSet = new Set<SubModule>();
    mockIsOwner = false;
});

describe('AdminHubScreen — gate de permissão', () => {
    it('mostra apenas os atalhos dos submódulos visíveis', async () => {
        mockVisibleSet = new Set<SubModule>(['users', 'stores']);
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Usuários')).toBeTruthy();
        expect(getByText('Lojas')).toBeTruthy();
        expect(queryByText('Funcionários')).toBeNull();
        expect(queryByText('Consultores')).toBeNull();
        expect(queryByText('Perfis de acesso')).toBeNull();
        expect(queryByText('Acesso restrito')).toBeNull();
    });

    it('sem nenhuma permissão mostra "Acesso restrito"', async () => {
        mockVisibleSet = new Set<SubModule>();
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Acesso restrito')).toBeTruthy();
        expect(queryByText('Usuários')).toBeNull();
    });

    it('todos os módulos visíveis renderizam os 5 atalhos', async () => {
        mockVisibleSet = new Set<SubModule>([
            'users',
            'employees',
            'consultants',
            'stores',
            'profiles',
        ]);
        const { getByText } = await renderHub();

        expect(getByText('Usuários')).toBeTruthy();
        expect(getByText('Funcionários')).toBeTruthy();
        expect(getByText('Consultores')).toBeTruthy();
        expect(getByText('Lojas')).toBeTruthy();
        expect(getByText('Perfis de acesso')).toBeTruthy();
    });
});

describe('AdminHubScreen — catálogos (Fatia 5b)', () => {
    it('mostra Marcas/Modelos/Serviços conforme useCanView', async () => {
        mockVisibleSet = new Set<SubModule>(['brands', 'models', 'services']);
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Marcas')).toBeTruthy();
        expect(getByText('Modelos')).toBeTruthy();
        expect(getByText('Serviços')).toBeTruthy();
        // Owner-only: sem isOwner, não aparecem.
        expect(queryByText('Fornecedores')).toBeNull();
        expect(queryByText('Concessionárias')).toBeNull();
    });

    it('Fornecedores e Concessionárias aparecem só para Owner', async () => {
        mockIsOwner = true;
        const { getByText } = await renderHub();

        expect(getByText('Fornecedores')).toBeTruthy();
        expect(getByText('Concessionárias')).toBeTruthy();
    });

    it('sem permissões e sem Owner, Fornecedores/Concessionárias ficam ocultos', async () => {
        mockVisibleSet = new Set<SubModule>();
        mockIsOwner = false;
        const { queryByText, getByText } = await renderHub();

        expect(queryByText('Fornecedores')).toBeNull();
        expect(queryByText('Concessionárias')).toBeNull();
        expect(getByText('Acesso restrito')).toBeTruthy();
    });

    it('Owner sozinho já libera o hub (não mostra "Acesso restrito")', async () => {
        mockVisibleSet = new Set<SubModule>();
        mockIsOwner = true;
        const { queryByText } = await renderHub();

        expect(queryByText('Acesso restrito')).toBeNull();
    });
});
