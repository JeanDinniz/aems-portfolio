import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Store de preferências do app (Sprint 7 — HARD-04).
 *
 * Espelha o padrão de `store.store.ts` (persist com AsyncStorage + partialize).
 * Todos os campos são persistidos sob a chave `aems-settings`.
 *
 * - `themePreference`: consumido pelo `ThemeProvider`, que chama
 *   `setColorScheme(themePreference)` do NativeWind. `'system'` volta a seguir o SO.
 * - `pushEnabled`: preferência de notificações push. Por ora apenas persistida;
 *   a integração de registro/des-registro do token virá depois (ver PushProvider).
 * - `biometricEnabled`: só persistência agora; o gate real vem na Fatia 1b.
 * - `defaultStoreId`: loja padrão aplicada ao selecionar; `null` = "Perguntar/Todas".
 */
export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
    themePreference: ThemePreference;
    pushEnabled: boolean;
    biometricEnabled: boolean;
    defaultStoreId: number | null;
    setThemePreference: (preference: ThemePreference) => void;
    setPushEnabled: (enabled: boolean) => void;
    setBiometricEnabled: (enabled: boolean) => void;
    setDefaultStoreId: (id: number | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            themePreference: 'system',
            pushEnabled: true,
            biometricEnabled: false,
            defaultStoreId: null,

            setThemePreference: (themePreference) => set({ themePreference }),
            setPushEnabled: (pushEnabled) => set({ pushEnabled }),
            setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
            setDefaultStoreId: (defaultStoreId) => set({ defaultStoreId }),
        }),
        {
            name: 'aems-settings',
            storage: createJSONStorage(() => AsyncStorage),
            // Persistir TODOS os campos de preferência.
            partialize: (state) => ({
                themePreference: state.themePreference,
                pushEnabled: state.pushEnabled,
                biometricEnabled: state.biometricEnabled,
                defaultStoreId: state.defaultStoreId,
            }),
        }
    )
);
