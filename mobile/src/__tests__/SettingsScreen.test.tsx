import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SettingsScreen } from '@/screens/SettingsScreen';
import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/components/ui';
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
 * SettingsScreen (HARD-04). Mocka useStores para controlar as lojas; os setters
 * do settings.store são espionados. Cobre: seções, troca de tema, toggle push,
 * escolha de loja padrão (selectStore + setDefaultStoreId) e versão exibida.
 */

const mockSelectStore = jest.fn();
const mockUseStoresState: {
    stores: { id: number; name: string }[];
    isMultiStore: boolean;
} = { stores: [], isMultiStore: false };

jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: mockUseStoresState.stores,
        isMultiStore: mockUseStoresState.isMultiStore,
        selectStore: mockSelectStore,
        selectedStoreId: null,
        allStores: mockUseStoresState.stores,
    }),
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <SettingsScreen
                navigation={navigation as never}
                route={{ key: 'Settings', name: 'Settings' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUseStoresState.stores = [];
    mockUseStoresState.isMultiStore = false;
    global.mockBiometrics = {
        hasHardware: true,
        isEnrolled: true,
        supportedTypes: [1],
        authenticateResult: { success: true },
    };
    useSettingsStore.setState({
        themePreference: 'system',
        pushEnabled: true,
        biometricEnabled: false,
        defaultStoreId: null,
    });
});

describe('SettingsScreen — seções e versão', () => {
    it('renderiza as seções principais e a versão', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Configurações')).toBeTruthy();
        expect(getByText('Aparência')).toBeTruthy();
        expect(getByText('Notificações')).toBeTruthy();
        expect(getByText('Segurança')).toBeTruthy();
        expect(getByText('Sobre')).toBeTruthy();
        expect(getByText('1.0.0')).toBeTruthy();
    });

    it('não mostra "Loja padrão" quando o usuário tem apenas uma loja', async () => {
        mockUseStoresState.isMultiStore = false;
        const { queryByText } = await renderScreen();
        expect(queryByText('Loja padrão')).toBeNull();
    });
});

describe('SettingsScreen — tema', () => {
    it('escolher "Escuro" grava a preferência', async () => {
        const spy = jest.spyOn(useSettingsStore.getState(), 'setThemePreference');
        const { getByLabelText } = await renderScreen();
        fireEvent.press(getByLabelText('Tema Escuro'));
        expect(spy).toHaveBeenCalledWith('dark');
    });

    it('escolher "Sistema" grava a preferência', async () => {
        const spy = jest.spyOn(useSettingsStore.getState(), 'setThemePreference');
        const { getByLabelText } = await renderScreen();
        fireEvent.press(getByLabelText('Tema Sistema'));
        expect(spy).toHaveBeenCalledWith('system');
    });
});

describe('SettingsScreen — push', () => {
    it('desligar push chama setPushEnabled(false)', async () => {
        const spy = jest.spyOn(useSettingsStore.getState(), 'setPushEnabled');
        const { getByLabelText } = await renderScreen();
        fireEvent(getByLabelText('Notificações push'), 'valueChange', false);
        expect(spy).toHaveBeenCalledWith(false);
    });
});

describe('SettingsScreen — biometria', () => {
    it('quando disponível, o switch fica habilitado após a checagem', async () => {
        const { getByLabelText } = await renderScreen();
        const sw = getByLabelText('Desbloqueio por biometria');
        await waitFor(() => expect(sw.props.accessibilityState.disabled).toBe(false));
    });

    it('ligar com biometria confirmada grava biometricEnabled(true)', async () => {
        global.mockBiometrics.authenticateResult = { success: true };
        const spy = jest.spyOn(useSettingsStore.getState(), 'setBiometricEnabled');
        const { getByLabelText } = await renderScreen();
        const sw = getByLabelText('Desbloqueio por biometria');
        await waitFor(() => expect(sw.props.accessibilityState.disabled).toBe(false));
        fireEvent(sw, 'valueChange', true);
        await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
    });

    it('ligar com biometria RECUSADA não grava', async () => {
        global.mockBiometrics.authenticateResult = { success: false };
        const spy = jest.spyOn(useSettingsStore.getState(), 'setBiometricEnabled');
        const { getByLabelText } = await renderScreen();
        const sw = getByLabelText('Desbloqueio por biometria');
        await waitFor(() => expect(sw.props.accessibilityState.disabled).toBe(false));
        fireEvent(sw, 'valueChange', true);
        await waitFor(() => expect(global.mockBiometrics.authenticateResult.success).toBe(false));
        expect(spy).not.toHaveBeenCalledWith(true);
    });

    it('indisponível: switch desabilitado e ligar não grava', async () => {
        global.mockBiometrics.hasHardware = false;
        const spy = jest.spyOn(useSettingsStore.getState(), 'setBiometricEnabled');
        const { getByLabelText, getByText } = await renderScreen();
        const sw = getByLabelText('Desbloqueio por biometria');
        await waitFor(() => expect(sw.props.accessibilityState.disabled).toBe(true));
        expect(getByText('Não disponível neste aparelho')).toBeTruthy();
        // valueChange direto (Switch ignora quando disabled, mas garantimos a regra)
        fireEvent(sw, 'valueChange', true);
        expect(spy).not.toHaveBeenCalledWith(true);
    });

    it('desligar grava biometricEnabled(false)', async () => {
        useSettingsStore.setState({ biometricEnabled: true });
        const spy = jest.spyOn(useSettingsStore.getState(), 'setBiometricEnabled');
        const { getByLabelText } = await renderScreen();
        const sw = getByLabelText('Desbloqueio por biometria');
        await waitFor(() => expect(sw.props.accessibilityState.disabled).toBe(false));
        fireEvent(sw, 'valueChange', false);
        await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    });
});

describe('SettingsScreen — loja padrão', () => {
    beforeEach(() => {
        mockUseStoresState.isMultiStore = true;
        mockUseStoresState.stores = [
            { id: 1, name: 'Loja Centro' },
            { id: 2, name: 'Loja Norte' },
        ];
    });

    it('mostra a seção e as opções quando há múltiplas lojas', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Loja padrão')).toBeTruthy();
        expect(getByText('Todas as Lojas')).toBeTruthy();
        expect(getByText('Loja Centro')).toBeTruthy();
        expect(getByText('Loja Norte')).toBeTruthy();
    });

    it('escolher uma loja chama setDefaultStoreId e selectStore', async () => {
        const spy = jest.spyOn(useSettingsStore.getState(), 'setDefaultStoreId');
        const { getByLabelText } = await renderScreen();
        fireEvent.press(getByLabelText('Loja padrão: Loja Norte'));
        expect(spy).toHaveBeenCalledWith(2);
        expect(mockSelectStore).toHaveBeenCalledWith(2);
    });

    it('escolher "Todas as Lojas" aplica null', async () => {
        const spy = jest.spyOn(useSettingsStore.getState(), 'setDefaultStoreId');
        const { getByLabelText } = await renderScreen();
        fireEvent.press(getByLabelText('Loja padrão: Todas as Lojas'));
        expect(spy).toHaveBeenCalledWith(null);
        expect(mockSelectStore).toHaveBeenCalledWith(null);
    });
});
