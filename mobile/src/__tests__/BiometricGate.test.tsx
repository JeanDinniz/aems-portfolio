import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import * as LocalAuth from 'expo-local-authentication';

import { BiometricGate } from '@/components/BiometricGate';
import { ThemeProvider } from '@/theme';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';

declare const global: {
    mockBiometrics: {
        hasHardware: boolean;
        isEnrolled: boolean;
        supportedTypes: number[];
        authenticateResult: { success: boolean };
    };
};

/**
 * BiometricGate (HARD-01). Cobre: overlay bloqueado quando biometria ligada +
 * sessão; desbloqueio via authenticate; "Entrar com senha" → clearAuth; e
 * passthrough dos filhos quando a biometria está desligada.
 *
 * O gate dispara authenticate() automaticamente ao montar bloqueado; usamos
 * global.mockBiometrics.authenticateResult para forçar sucesso/falha.
 */

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CHILD = 'conteudo-protegido';

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
    );
}

async function renderGate() {
    return render(
        <Providers>
            <BiometricGate>
                <Text>{CHILD}</Text>
            </BiometricGate>
        </Providers>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    global.mockBiometrics = {
        hasHardware: true,
        isEnrolled: true,
        supportedTypes: [1],
        authenticateResult: { success: true },
    };
    useSettingsStore.setState({ biometricEnabled: false });
    useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe('BiometricGate — passthrough', () => {
    it('sem biometria ligada renderiza os filhos direto', async () => {
        useSettingsStore.setState({ biometricEnabled: false });
        useAuthStore.setState({ isAuthenticated: true });
        const { getByText, queryByLabelText } = await renderGate();
        expect(getByText(CHILD)).toBeTruthy();
        expect(queryByLabelText('Desbloquear com biometria')).toBeNull();
    });

    it('biometria ligada mas SEM sessão não bloqueia', async () => {
        useSettingsStore.setState({ biometricEnabled: true });
        useAuthStore.setState({ isAuthenticated: false });
        const { queryByLabelText } = await renderGate();
        expect(queryByLabelText('Desbloquear com biometria')).toBeNull();
    });
});

describe('BiometricGate — bloqueio e desbloqueio', () => {
    it('biometria ligada + sessão → dispara o prompt e desbloqueia no sucesso', async () => {
        global.mockBiometrics.authenticateResult = { success: true };
        useSettingsStore.setState({ biometricEnabled: true });
        useAuthStore.setState({ isAuthenticated: true, user: { id: 1 } as never });

        const { getByText, queryByLabelText } = await renderGate();
        // Estado bloqueado no mount dispara o auto-prompt de biometria. (A presença
        // do overlay enquanto bloqueado é coberta de forma determinística pelo teste
        // do caminho de falha abaixo — aqui o sucesso o dispensa rápido demais para
        // uma asserção síncrona confiável.)
        await waitFor(() =>
            expect(LocalAuth.authenticateAsync as jest.Mock).toHaveBeenCalled()
        );
        // Sucesso → overlay some e o conteúdo protegido fica visível.
        await waitFor(() => expect(queryByLabelText('Desbloquear com biometria')).toBeNull());
        expect(getByText(CHILD)).toBeTruthy();
    });

    it('falha no auto-prompt mantém o overlay; botão desbloquear reautentica', async () => {
        global.mockBiometrics.authenticateResult = { success: false };
        useSettingsStore.setState({ biometricEnabled: true });
        useAuthStore.setState({ isAuthenticated: true, user: { id: 1 } as never });

        const { getByLabelText, queryByLabelText } = await renderGate();
        // Aguarda o auto-prompt (que falha) resolver — overlay permanece.
        await waitFor(() =>
            expect((LocalAuth.authenticateAsync as jest.Mock)).toHaveBeenCalled()
        );
        expect(getByLabelText('Desbloquear com biometria')).toBeTruthy();

        // Agora sucesso ao tocar em "Desbloquear".
        global.mockBiometrics.authenticateResult = { success: true };
        fireEvent.press(getByLabelText('Desbloquear com biometria'));
        await waitFor(() => expect(queryByLabelText('Desbloquear com biometria')).toBeNull());
    });

    it('"Entrar com senha" chama clearAuth', async () => {
        global.mockBiometrics.authenticateResult = { success: false };
        useSettingsStore.setState({ biometricEnabled: true });
        useAuthStore.setState({ isAuthenticated: true, user: { id: 1 } as never });
        const clearSpy = jest.spyOn(useAuthStore.getState(), 'clearAuth');

        const { getByLabelText } = await renderGate();
        await waitFor(() =>
            expect((LocalAuth.authenticateAsync as jest.Mock)).toHaveBeenCalled()
        );
        fireEvent.press(getByLabelText('Entrar com senha'));
        expect(clearSpy).toHaveBeenCalled();
    });
});
