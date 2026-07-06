import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoginScreen } from '@/screens/auth/LoginScreen';

const mockLogin = jest.fn();

jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ login: mockLogin }),
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// RNTL v14: render() é assíncrono.
function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
    return render(
        <SafeAreaProvider initialMetrics={metrics}>
            <LoginScreen navigation={navigation} route={{ key: 'Login', name: 'Login' } as never} />
        </SafeAreaProvider>
    );
}

describe('LoginScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renderiza o formulário de login', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('AEMS')).toBeTruthy();
        expect(getByText('Entrar')).toBeTruthy();
    });

    it('valida campos vazios e não chama login', async () => {
        const { getByText } = await renderScreen();
        await fireEvent.press(getByText('Entrar'));
        await waitFor(() => {
            expect(getByText('Informe o e-mail')).toBeTruthy();
        });
        expect(mockLogin).not.toHaveBeenCalled();
    });

    it('submete credenciais válidas', async () => {
        mockLogin.mockResolvedValueOnce(undefined);
        const { getByText, getByPlaceholderText } = await renderScreen();
        await fireEvent.changeText(getByPlaceholderText('seu@email.com'), 'a@b.com');
        await fireEvent.changeText(getByPlaceholderText('••••••••'), 'segredo123');
        await fireEvent.press(getByText('Entrar'));
        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith({ email: 'a@b.com', password: 'segredo123' });
        });
    });

    it('exibe mensagem amigável em erro 401', async () => {
        const err = Object.assign(new Error('401'), {
            isAxiosError: true,
            response: { status: 401, data: {} },
        });
        mockLogin.mockRejectedValueOnce(err);
        const { getByText, getByPlaceholderText } = await renderScreen();
        await fireEvent.changeText(getByPlaceholderText('seu@email.com'), 'a@b.com');
        await fireEvent.changeText(getByPlaceholderText('••••••••'), 'segredo123');
        await fireEvent.press(getByText('Entrar'));
        await waitFor(() => {
            expect(getByText('E-mail ou senha inválidos.')).toBeTruthy();
        });
    });
});
