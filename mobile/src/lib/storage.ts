import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Wrappers de armazenamento nativo (Bloco B).
 *
 * - `secureStorage`: tokens de auth em expo-secure-store (Keychain/Keystore).
 *   NUNCA persistir tokens em AsyncStorage ou no estado em texto plano.
 * - `appStorage`: preferências e cache persistido (não-sensível) em AsyncStorage.
 */

const ACCESS_TOKEN_KEY = 'aems_access_token';
const REFRESH_TOKEN_KEY = 'aems_refresh_token';

export const secureStorage = {
    async getToken(): Promise<string | null> {
        return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    },

    async getRefreshToken(): Promise<string | null> {
        return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    },

    async setTokens(access: string, refresh: string): Promise<void> {
        await Promise.all([
            SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access),
            SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh),
        ]);
    },

    async clearTokens(): Promise<void> {
        await Promise.all([
            SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
            SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        ]);
    },
};

/**
 * Metadados não sensíveis do token (validade) — usados para checar expiração
 * no boot sem precisar decodificar o JWT. Ficam em AsyncStorage; o segredo
 * (o token em si) nunca sai do SecureStore.
 */
export const TOKEN_META_KEY = 'aems_token_meta';

/**
 * Token de push (ExponentPushToken) atualmente registrado no backend. Guardado
 * em AsyncStorage para permitir o `DELETE /push/devices/{token}` no logout. Não
 * é sensível (é um endereço de entrega, não uma credencial).
 */
export const PUSH_TOKEN_KEY = 'aems_push_token';

export interface TokenMeta {
    expiresIn: number; // segundos de validade do access token
    persistedAt: number; // epoch ms em que os tokens foram gravados
}

export const appStorage = {
    async get<T>(key: string): Promise<T | null> {
        const raw = await AsyncStorage.getItem(key);
        if (raw == null) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return null;
        }
    },

    async set(key: string, value: unknown): Promise<void> {
        await AsyncStorage.setItem(key, JSON.stringify(value));
    },

    async remove(key: string): Promise<void> {
        await AsyncStorage.removeItem(key);
    },
};
