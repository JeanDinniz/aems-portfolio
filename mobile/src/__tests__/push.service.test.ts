/**
 * PUSH-01 — push.service (registro/desregistro de device).
 *
 * Mocka o apiClient (POST/DELETE) e usa os mocks globais de expo-notifications /
 * expo-device (jest.setup) via `global.mockPush` e `global.mockIsDevice`.
 * Cobre: device guard, permissão negada, sucesso (POST), Expo Go (token lança),
 * e o desregistro (DELETE) idempotente.
 */
import {
    registerForPushNotificationsAsync,
    unregisterPushNotificationsAsync,
} from '@/services/push/push.service';
import { appStorage, PUSH_TOKEN_KEY } from '@/lib/storage';

const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        post: (...args: unknown[]) => mockPost(...args),
        delete: (...args: unknown[]) => mockDelete(...args),
    },
}));

// projectId precisa existir para `getExpoPushTokenAsync`.
jest.mock('expo-constants', () => ({
    __esModule: true,
    default: {
        expoConfig: {
            version: '1.0.0',
            extra: { eas: { projectId: 'test-project-id' } },
        },
    },
}));

declare const global: {
    mockIsDevice: boolean;
    mockPush: {
        permission: { granted: boolean };
        requestResult: { granted: boolean };
        token: { data: string };
        getTokenThrows: boolean;
    };
};

beforeEach(async () => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
    // Reset dos mocks globais para o "happy path".
    global.mockIsDevice = true;
    global.mockPush.permission = { granted: true } as never;
    global.mockPush.requestResult = { granted: true } as never;
    global.mockPush.token = { data: 'ExponentPushToken[abc123]' };
    global.mockPush.getTokenThrows = false;
    await appStorage.remove(PUSH_TOKEN_KEY);
});

describe('registerForPushNotificationsAsync', () => {
    it('retorna null em emulador (Device.isDevice false) sem chamar a API', async () => {
        global.mockIsDevice = false;
        const token = await registerForPushNotificationsAsync();
        expect(token).toBeNull();
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('retorna null quando a permissão é negada (sem POST)', async () => {
        global.mockPush.permission = { granted: false } as never;
        global.mockPush.requestResult = { granted: false } as never;
        const token = await registerForPushNotificationsAsync();
        expect(token).toBeNull();
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('no sucesso registra via POST /push/devices e devolve o token', async () => {
        const token = await registerForPushNotificationsAsync();
        expect(token).toBe('ExponentPushToken[abc123]');
        expect(mockPost).toHaveBeenCalledWith('/push/devices', {
            token: 'ExponentPushToken[abc123]',
            platform: expect.stringMatching(/^(ios|android)$/),
            app_version: '1.0.0',
        });
        // Persistiu o token para o DELETE no logout.
        await expect(appStorage.get(PUSH_TOKEN_KEY)).resolves.toBe('ExponentPushToken[abc123]');
    });

    it('degrada para null quando getExpoPushTokenAsync lança (Expo Go)', async () => {
        global.mockPush.getTokenThrows = true;
        const token = await registerForPushNotificationsAsync();
        expect(token).toBeNull();
        expect(mockPost).not.toHaveBeenCalled();
    });
});

describe('unregisterPushNotificationsAsync', () => {
    it('faz DELETE /push/devices/{token} (encoded) e limpa o token salvo', async () => {
        await appStorage.set(PUSH_TOKEN_KEY, 'ExponentPushToken[abc123]');
        await unregisterPushNotificationsAsync();
        expect(mockDelete).toHaveBeenCalledWith(
            `/push/devices/${encodeURIComponent('ExponentPushToken[abc123]')}`
        );
        await expect(appStorage.get(PUSH_TOKEN_KEY)).resolves.toBeNull();
    });

    it('não chama DELETE quando não há token salvo', async () => {
        await unregisterPushNotificationsAsync();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('não propaga erro do DELETE e ainda limpa o token salvo', async () => {
        await appStorage.set(PUSH_TOKEN_KEY, 'ExponentPushToken[abc123]');
        mockDelete.mockRejectedValueOnce(new Error('network'));
        await expect(unregisterPushNotificationsAsync()).resolves.toBeUndefined();
        await expect(appStorage.get(PUSH_TOKEN_KEY)).resolves.toBeNull();
    });
});
