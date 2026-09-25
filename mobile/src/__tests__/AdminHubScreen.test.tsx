import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AdminHubScreen } from '@/screens/admin/AdminHubScreen';
import { ThemeProvider } from '@/theme';
import type { SubModule } from '@/types/accessProfile.types';

/**
 * Admin — gate do AdminHub. Cada atalho aparece se o submódulo é visível
 * (`useCanView`). Além disso, os CADASTROS PUROS (Usuários, Funcionários,
 * Consultores, Lojas, Perfis, Marcas, Modelos, Serviços, Fornecedores,
 * Concessionárias, Auditoria) exigem a flag `ADMIN_CADASTROS_ENABLED` (default
 * OFF). Faltas do Dia, Feriados e Espelho de Ponto NÃO usam a flag — seguem só
 * por permissão. `useCanView` e a flag são mockados por teste.
 */
let mockVisibleSet = new Set<SubModule>();
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanView: (sub: SubModule) => mockVisibleSet.has(sub),
}));

// isOwner controlável por teste (gate de Fornecedores/Concessionárias/Auditoria).
let mockIsOwner = false;
jest.mock('@/stores/auth.store', () => ({
    useAuthStore: (selector: (s: { isOwner: () => boolean }) => unknown) =>
        selector({ isOwner: () => mockIsOwner }),
}));

// Flag de cadastros puros (default OFF em produção). Getter → mutável por teste.
let mockAdminCadastros = false;
jest.mock('@/constants/features', () => ({
    get ADMIN_CADASTROS_ENABLED() {
        return mockAdminCadastros;
    },
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
    mockAdminCadastros = false;
});

describe('AdminHubScreen — cadastros puros (flag ADMIN_CADASTROS_ENABLED)', () => {
    it('com a flag ligada, mostra apenas os cadastros dos submódulos visíveis', async () => {
        mockAdminCadastros = true;
        mockVisibleSet = new Set<SubModule>(['users', 'stores']);
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Usuários')).toBeTruthy();
        expect(getByText('Lojas')).toBeTruthy();
        expect(queryByText('Funcionários')).toBeNull();
        expect(queryByText('Consultores')).toBeNull();
        expect(queryByText('Perfis de acesso')).toBeNull();
        expect(queryByText('Acesso restrito')).toBeNull();
    });

    it('com a flag ligada e todos os submódulos, renderiza os 5 cadastros', async () => {
        mockAdminCadastros = true;
        mockVisibleSet = new Set<SubModule>(['users', 'employees', 'consultants', 'stores', 'profiles']);
        const { getByText } = await renderHub();

        expect(getByText('Usuários')).toBeTruthy();
        expect(getByText('Funcionários')).toBeTruthy();
        expect(getByText('Consultores')).toBeTruthy();
        expect(getByText('Lojas')).toBeTruthy();
        expect(getByText('Perfis de acesso')).toBeTruthy();
    });

    it('com a flag DESLIGADA, os cadastros somem mesmo com permissão', async () => {
        mockAdminCadastros = false;
        mockVisibleSet = new Set<SubModule>(['users', 'consultants', 'profiles']);
        const { queryByText } = await renderHub();

        expect(queryByText('Usuários')).toBeNull();
        expect(queryByText('Consultores')).toBeNull();
        expect(queryByText('Perfis de acesso')).toBeNull();
    });
});

describe('AdminHubScreen — itens mantidos (sem flag)', () => {
    it('Faltas do Dia, Feriados e Espelho aparecem por permissão mesmo com cadastros OFF', async () => {
        mockAdminCadastros = false;
        mockVisibleSet = new Set<SubModule>(['employees', 'stores', 'time_clock_mirror']);
        const { getByText, queryByText } = await renderHub();

        // Mantidos (sem flag):
        expect(getByText('Faltas do Dia')).toBeTruthy();
        expect(getByText('Feriados')).toBeTruthy();
        expect(getByText('Espelho de Ponto')).toBeTruthy();
        // Cadastros que compartilham a mesma permissão continuam ocultos (flag OFF):
        expect(queryByText('Funcionários')).toBeNull();
        expect(queryByText('Lojas')).toBeNull();
        expect(queryByText('Acesso restrito')).toBeNull();
    });
});

describe('AdminHubScreen — catálogos e owner-only (flag ligada)', () => {
    it('mostra Marcas/Modelos/Serviços conforme useCanView', async () => {
        mockAdminCadastros = true;
        mockVisibleSet = new Set<SubModule>(['brands', 'models', 'services']);
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Marcas')).toBeTruthy();
        expect(getByText('Modelos')).toBeTruthy();
        expect(getByText('Serviços')).toBeTruthy();
        expect(queryByText('Fornecedores')).toBeNull();
        expect(queryByText('Concessionárias')).toBeNull();
    });

    it('Fornecedores e Concessionárias aparecem só para Owner com a flag ligada', async () => {
        mockAdminCadastros = true;
        mockIsOwner = true;
        const { getByText } = await renderHub();

        expect(getByText('Fornecedores')).toBeTruthy();
        expect(getByText('Concessionárias')).toBeTruthy();
    });

    it('Owner com a flag ligada libera o hub (não mostra "Acesso restrito")', async () => {
        mockAdminCadastros = true;
        mockVisibleSet = new Set<SubModule>();
        mockIsOwner = true;
        const { queryByText } = await renderHub();

        expect(queryByText('Acesso restrito')).toBeNull();
    });
});

describe('AdminHubScreen — acesso restrito', () => {
    it('sem permissões, sem Owner e cadastros OFF mostra "Acesso restrito"', async () => {
        mockAdminCadastros = false;
        mockVisibleSet = new Set<SubModule>();
        mockIsOwner = false;
        const { getByText, queryByText } = await renderHub();

        expect(getByText('Acesso restrito')).toBeTruthy();
        expect(queryByText('Usuários')).toBeNull();
    });
});
