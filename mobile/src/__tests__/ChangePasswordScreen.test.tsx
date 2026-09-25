import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ChangePasswordScreen } from '@/screens/auth/ChangePasswordScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';

const mockLogout = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ logout: mockLogout, isLoggingOut: false }),
}));

const mockChangePassword = jest.fn();
jest.mock('@/services/api/auth.service', () => ({
    authService: { changePassword: (...args: unknown[]) => mockChangePassword(...args) },
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const baseUser: User = {
    id: 1,
    full_name: 'Maria Silva',
    email: 'maria@aems.com',
    role: 'owner',
    is_active: true,
    must_change_password: false,
    created_at: '2024-01-01',
    updated_at: null,
};

function setUser(mustChange: boolean) {
    useAuthStore.setState({
        user: { ...baseUser, must_change_password: mustChange },
        tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 1800 },
        isAuthenticated: true,
        isLoading: false,
        effectivePermissions: null,
    });
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const utils = await render(
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ConfirmProvider>
                    <QueryClientProvider client={qc}>
                        <ChangePasswordScreen
                            navigation={navigation as never}
                            route={{ key: 'ChangePassword', name: 'ChangePassword' } as never}
                        />
                    </QueryClientProvider>
                </ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
    return { ...utils, navigation };
}

type Fill = { current: string; next: string; confirm: string };
async function fillForm(
    getAllByPlaceholderText: (t: string) => { length: number }[] | unknown[],
    { current, next, confirm }: Fill
) {
    const inputs = getAllByPlaceholderText('••••••••') as Parameters<typeof fireEvent.changeText>[0][];
    await fireEvent.changeText(inputs[0], current);
    await fireEvent.changeText(inputs[1], next);
    await fireEvent.changeText(inputs[2], confirm);
}

describe('ChangePasswordScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('1º acesso: troca com sucesso → aviso "Senha definida" e logout', async () => {
        setUser(true);
        mockChangePassword.mockResolvedValueOnce(undefined);
        const { getByText, findByText, getAllByPlaceholderText } = await renderScreen();

        expect(getByText('Defina sua senha')).toBeTruthy();
        await fillForm(getAllByPlaceholderText, {
            current: 'oldpass1',
            next: 'newpass1',
            confirm: 'newpass1',
        });
        // Sem await: o handler fica suspenso no alert() até o OK ser pressionado.
        fireEvent.press(getByText('Salvar nova senha'));

        await waitFor(() => {
            expect(mockChangePassword).toHaveBeenCalledWith('oldpass1', 'newpass1');
        });
        // O aviso "Senha definida" aparece; ao confirmar (OK), dispara o logout.
        await findByText('Senha definida');
        fireEvent.press(getByText('OK'));
        await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    });

    it('logado: troca com sucesso → aviso "Senha alterada" e volta', async () => {
        setUser(false);
        mockChangePassword.mockResolvedValueOnce(undefined);
        const { getByText, findByText, getAllByPlaceholderText, navigation } = await renderScreen();

        expect(getByText('Alterar senha')).toBeTruthy();
        await fillForm(getAllByPlaceholderText, {
            current: 'oldpass1',
            next: 'newpass1',
            confirm: 'newpass1',
        });
        // Sem await: o handler fica suspenso no alert() até o OK ser pressionado.
        fireEvent.press(getByText('Salvar nova senha'));

        await waitFor(() => {
            expect(mockChangePassword).toHaveBeenCalled();
        });
        // O aviso "Senha alterada" aparece; ao confirmar (OK), volta.
        await findByText('Senha alterada');
        fireEvent.press(getByText('OK'));
        await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
        expect(mockLogout).not.toHaveBeenCalled();
    });

    it('valida nova senha fraca e não chama o backend', async () => {
        setUser(false);
        const { getByText, getAllByPlaceholderText } = await renderScreen();

        await fillForm(getAllByPlaceholderText, { current: 'oldpass1', next: 'abc', confirm: 'abc' });
        await fireEvent.press(getByText('Salvar nova senha'));

        await waitFor(() => {
            expect(getByText('Mínimo de 8 caracteres')).toBeTruthy();
        });
        expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it('exibe erro quando o backend recusa a troca', async () => {
        setUser(false);
        mockChangePassword.mockRejectedValueOnce(
            Object.assign(new Error('400'), {
                isAxiosError: true,
                response: { status: 400, data: { detail: 'Senha atual incorreta' } },
            })
        );
        const { getByText, findByText, getAllByPlaceholderText } = await renderScreen();

        await fillForm(getAllByPlaceholderText, {
            current: 'wrongpass1',
            next: 'newpass1',
            confirm: 'newpass1',
        });
        // Sem await: o handler fica suspenso no alert() de erro até o OK.
        fireEvent.press(getByText('Salvar nova senha'));

        // Aviso de erro exibido no ConfirmDialog (título "Erro" + mensagem do backend).
        await findByText('Erro');
        expect(getByText('Senha atual incorreta')).toBeTruthy();
    });
});
