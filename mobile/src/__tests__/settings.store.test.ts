import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettingsStore } from '@/stores/settings.store';

/**
 * settings.store (HARD-04) — defaults, setters e persistência.
 * O persist usa o mock oficial do AsyncStorage (jest.setup).
 */

function resetStore() {
    useSettingsStore.setState({
        themePreference: 'system',
        pushEnabled: true,
        biometricEnabled: false,
        defaultStoreId: null,
    });
}

beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
});

describe('settings.store — defaults', () => {
    it('tem os valores padrão esperados', () => {
        const s = useSettingsStore.getState();
        expect(s.themePreference).toBe('system');
        expect(s.pushEnabled).toBe(true);
        expect(s.biometricEnabled).toBe(false);
        expect(s.defaultStoreId).toBeNull();
    });
});

describe('settings.store — setters', () => {
    it('setThemePreference altera o tema', () => {
        useSettingsStore.getState().setThemePreference('dark');
        expect(useSettingsStore.getState().themePreference).toBe('dark');
        useSettingsStore.getState().setThemePreference('light');
        expect(useSettingsStore.getState().themePreference).toBe('light');
        useSettingsStore.getState().setThemePreference('system');
        expect(useSettingsStore.getState().themePreference).toBe('system');
    });

    it('setPushEnabled alterna a preferência de push', () => {
        useSettingsStore.getState().setPushEnabled(false);
        expect(useSettingsStore.getState().pushEnabled).toBe(false);
        useSettingsStore.getState().setPushEnabled(true);
        expect(useSettingsStore.getState().pushEnabled).toBe(true);
    });

    it('setBiometricEnabled persiste a preferência', () => {
        useSettingsStore.getState().setBiometricEnabled(true);
        expect(useSettingsStore.getState().biometricEnabled).toBe(true);
    });

    it('setDefaultStoreId grava o id e aceita null', () => {
        useSettingsStore.getState().setDefaultStoreId(7);
        expect(useSettingsStore.getState().defaultStoreId).toBe(7);
        useSettingsStore.getState().setDefaultStoreId(null);
        expect(useSettingsStore.getState().defaultStoreId).toBeNull();
    });
});

describe('settings.store — persistência', () => {
    it('persiste TODOS os campos via AsyncStorage', async () => {
        useSettingsStore.getState().setThemePreference('dark');
        useSettingsStore.getState().setPushEnabled(false);
        useSettingsStore.getState().setBiometricEnabled(true);
        useSettingsStore.getState().setDefaultStoreId(3);

        // Aguarda o flush assíncrono do persist.
        await Promise.resolve();
        const raw = await AsyncStorage.getItem('aems-settings');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw as string);
        expect(parsed.state).toMatchObject({
            themePreference: 'dark',
            pushEnabled: false,
            biometricEnabled: true,
            defaultStoreId: 3,
        });
    });
});
