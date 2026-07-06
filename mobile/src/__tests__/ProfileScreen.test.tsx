import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfileScreen } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';

const mockLogout = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ logout: mockLogout, isLoggingOut: false }),
}));

const mockUpdateProfile = jest.fn();
jest.mock('@/services/api/auth.service', () => ({
    authService: { updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) },
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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const utils = await render(
        <SafeAreaProvider initialMetrics={metrics}>
            <QueryClientProvider client={qc}>
                <ProfileScreen
                    navigation={navigation as never}
                    route={{ key: 'Profile', name: 'Profile' } as never}
                />
            </QueryClientProvider>
        </SafeAreaProvider>
    );
    return { ...utils, navigation };
}

describe('ProfileScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useAuthStore.setState({
            user: baseUser,
            tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 1800 },
            isAuthenticated: true,
            isLoading: false,
            effectivePermissions: null,
        });
        jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
            const btn = buttons?.find((b) => b.onPress && b.style !== 'cancel');
            btn?.onPress?.();
        });
    });

    it('renderiza e-mail e nome, sem campo de telefone', async () => {
        const { getByText, getByDisplayValue, queryByText } = await renderScreen();
        expect(getByText('Perfil')).toBeTruthy();
        expect(getByText('maria@aems.com')).toBeTruthy();
        expect(getByDisplayValue('Maria Silva')).toBeTruthy();
        // Telefone foi removido (backend não persiste phone).
        expect(queryByText('Telefone')).toBeNull();
    });

    it('edita o nome e salva com sucesso', async () => {
        mockUpdateProfile.mockResolvedValueOnce({ full_name: 'Maria Souza' });
        const { getByText, getByDisplayValue } = await renderScreen();

        await fireEvent.changeText(getByDisplayValue('Maria Silva'), 'Maria Souza');
        await fireEvent.press(getByText('Salvar alterações'));

        await waitFor(() => {
            expect(mockUpdateProfile).toHaveBeenCalledWith({ full_name: 'Maria Souza' });
        });
        expect(getByText('Perfil atualizado.')).toBeTruthy();
        expect(useAuthStore.getState().user?.full_name).toBe('Maria Souza');
    });

    it('valida nome vazio e não chama o backend', async () => {
        const { getByText, getByDisplayValue } = await renderScreen();

        await fireEvent.changeText(getByDisplayValue('Maria Silva'), '');
        await fireEvent.press(getByText('Salvar alterações'));

        await waitFor(() => {
            expect(getByText('Informe o nome')).toBeTruthy();
        });
        expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it('logout pede confirmação e dispara o logout', async () => {
        const { getByText } = await renderScreen();
        await fireEvent.press(getByText('Sair'));
        expect(Alert.alert).toHaveBeenCalledWith('Sair', expect.any(String), expect.anything());
        expect(mockLogout).toHaveBeenCalled();
    });
});
