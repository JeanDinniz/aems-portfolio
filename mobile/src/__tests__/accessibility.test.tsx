/**
 * QA-07 — Acessibilidade (a11y) dos componentes/telas-chave.
 *
 * Verifica que elementos de toque têm role + nome acessível e que o STATUS nunca
 * é comunicado só por cor (sempre há rótulo textual + ícone). Cobre:
 *   - Button / PrimaryButton: role "button", nome pelo texto, accessibilityState
 *     (disabled/busy) coerente.
 *   - OSStatusBadge / Badge: role "text" + accessibilityLabel = rótulo do status
 *     (texto presente além da cor).
 *   - OSCard: expõe placa e rótulo de status como texto; botões acessíveis.
 *   - LoginScreen: botão "Entrar" com role button + rótulo; link "Esqueci..."
 *     com role button.
 *
 * NativeWind (className) é no-op nos testes (ver jest.setup.js); as asserções são
 * sobre props de acessibilidade e texto, não sobre estilos.
 */
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { OSStatusBadge } from '@/components/ui/OSStatusBadge';
import { OSCard } from '@/components/features/OSCard';
import { ThemeProvider } from '@/theme';
import type { ServiceOrder } from '@/types/service-order.types';

// LoginScreen usa useAuth (react-query useMutation). Mockamos o hook para não
// depender de QueryClientProvider — o foco aqui é a11y, não o fluxo de login.
jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ login: jest.fn() }),
}));
// eslint-disable-next-line import/first
import { LoginScreen } from '@/screens/auth/LoginScreen';

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

afterEach(cleanup);

function withProviders(node: React.ReactElement) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>{node}</ThemeProvider>
        </SafeAreaProvider>
    );
}

const baseOrder: ServiceOrder = {
    id: 42,
    order_number: 1001,
    external_os_number: 'A-777',
    plate: 'ABC1D23',
    status: 'doing',
    department: 'film',
    location_name: 'Loja Centro',
    vehicle_model: 'Corolla',
    vehicle_color: 'Prata',
    service_date: '2026-06-30',
    entry_time: '2026-06-30T08:00:00',
    is_galpon: true,
    is_return: false,
    is_courtesy: false,
} as unknown as ServiceOrder;

describe('Button — a11y', () => {
    it('tem role "button" e nome acessível pelo título', async () => {
        const { getByRole } = await render(withProviders(<Button title="Salvar" onPress={() => {}} />));
        const btn = getByRole('button', { name: 'Salvar' });
        expect(btn).toBeTruthy();
    });

    it('reflete disabled/busy no accessibilityState quando loading', async () => {
        const { getByRole } = await render(
            withProviders(<Button title="Enviando" loading onPress={() => {}} />)
        );
        const btn = getByRole('button');
        expect(btn.props.accessibilityState.disabled).toBe(true);
        expect(btn.props.accessibilityState.busy).toBe(true);
    });

    it('atende área de toque mínima (>=44pt) via classe min-h', async () => {
        // O contrato de tamanho é declarado por className (min-h-[44px]/[48px]).
        // Como o className é no-op no teste, validamos a presença do contrato no
        // markup renderizado (props.className), garantindo que não houve regressão.
        const { getByRole } = await render(withProviders(<Button title="Ok" size="sm" onPress={() => {}} />));
        const btn = getByRole('button');
        expect(String(btn.props.className)).toContain('min-h-[44px]');
    });
});

describe('PrimaryButton — a11y', () => {
    it('tem role "button" e nome pelo título; min 48pt', async () => {
        const { getByRole } = await render(<PrimaryButton title="Entrar" onPress={() => {}} />);
        const btn = getByRole('button', { name: 'Entrar' });
        expect(btn).toBeTruthy();
        expect(String(btn.props.className)).toContain('min-h-[48px]');
    });
});

describe('OSStatusBadge / Badge — status nunca só por cor', () => {
    it('expõe o rótulo textual do status como accessibilityLabel (role text)', async () => {
        // O status `ready` é rotulado "Pronto" no badge (STATUS_LABELS).
        const { getByText, getByLabelText } = await render(
            withProviders(<OSStatusBadge status="ready" />)
        );
        // O texto "Pronto" está presente (não é só cor).
        expect(getByText('Pronto')).toBeTruthy();
        // E é exposto como rótulo acessível (o container Badge tem role "text" + label).
        const badge = getByLabelText('Pronto');
        expect(badge.props.accessibilityRole).toBe('text');
    });

    it.each([
        ['waiting', 'Aguardando'],
        ['doing', 'Fazendo'],
        ['ready', 'Pronto'],
        ['wrong', 'Lançado Errado'],
        ['duplicate', 'Duplicado'],
    ] as const)('status %s tem rótulo textual "%s" (não é só cor)', async (status, label) => {
        const { getByText } = await render(withProviders(<OSStatusBadge status={status} />));
        expect(getByText(label)).toBeTruthy();
    });
});

describe('OSCard — a11y', () => {
    it('expõe placa e rótulo de status como texto', async () => {
        const { getByText, getByLabelText } = await render(
            withProviders(
                <OSCard order={baseOrder} onPressView={() => {}} onPressEdit={() => {}} canEdit />
            )
        );
        expect(getByText('ABC1D23')).toBeTruthy(); // placa como texto
        expect(getByText('OS A-777')).toBeTruthy(); // nº externo
        // status via badge (rótulo textual + role text, não só cor)
        expect(getByLabelText('Fazendo').props.accessibilityRole).toBe('text');
    });

    it('botão Visualizar é acessível (role button) e dispara onPressView', async () => {
        const onView = jest.fn();
        const { getByText, getAllByRole } = await render(
            withProviders(<OSCard order={baseOrder} onPressView={onView} />)
        );
        // Há exatamente um botão (Visualizar) — Editar só aparece com canEdit.
        const buttons = getAllByRole('button');
        expect(buttons).toHaveLength(1);
        fireEvent.press(getByText('Visualizar'));
        expect(onView).toHaveBeenCalled();
    });

    it('com canEdit renderiza Visualizar + Editar como botões', async () => {
        const { getAllByRole, getByText } = await render(
            withProviders(
                <OSCard order={baseOrder} onPressView={() => {}} onPressEdit={() => {}} canEdit />
            )
        );
        expect(getAllByRole('button')).toHaveLength(2);
        expect(getByText('Editar')).toBeTruthy();
    });
});

describe('LoginScreen — a11y', () => {
    function renderLogin() {
        const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
        return render(
            <SafeAreaProvider initialMetrics={metrics}>
                <LoginScreen navigation={navigation} route={{ key: 'Login', name: 'Login' } as never} />
            </SafeAreaProvider>
        );
    }

    it('todos os alvos de toque têm role button e rótulos textuais', async () => {
        const { getByText, getAllByRole } = await renderLogin();
        // Botão Entrar + link "Esqueci minha senha" — ambos são botões acessíveis.
        await waitFor(() => expect(getByText('Entrar')).toBeTruthy());
        expect(getByText('Esqueci minha senha')).toBeTruthy();
        const buttons = getAllByRole('button');
        // >= 2: PrimaryButton "Entrar" + Pressable "Esqueci minha senha".
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        buttons.forEach((b) => expect(b.props.accessibilityRole).toBe('button'));
    });
});
