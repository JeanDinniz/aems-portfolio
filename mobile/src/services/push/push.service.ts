/**
 * push.service (PUSH-01) — registro/desregistro do device de push.
 *
 * Fluxo:
 *  - `registerForPushNotificationsAsync()`: pede permissão, cria o canal Android,
 *    obtém o ExponentPushToken e o registra no backend (`POST /push/devices`).
 *    Guarda o token localmente para o desregistro no logout.
 *  - `unregisterPushNotificationsAsync()`: lê o token salvo e faz
 *    `DELETE /push/devices/{token}` (idempotente). Chamado ANTES de limpar o auth.
 *
 * Degradação graciosa (CRÍTICO):
 *  - Expo Go (SDK 53+) NÃO entrega push remoto e `getExpoPushTokenAsync` LANÇA.
 *  - Emulador/simulador não recebe push (`Device.isDevice === false`).
 *  - Permissão pode ser negada.
 *  Em TODOS esses casos retornamos `null` sem crashar (try/catch + guards).
 *  Só será de fato validável num dev build EAS.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { apiClient } from '@/services/api/client';
import { appStorage, PUSH_TOKEN_KEY } from '@/lib/storage';

/** Cor da marca (AEMS) para o LED/acento do canal Android. */
const BRAND_COLOR = '#F5B800';
/** Nome do canal default (Android). */
const ANDROID_CHANNEL_ID = 'default';

type PushPlatform = 'ios' | 'android';

/** Plataforma normalizada para o backend (`Literal['ios','android']`). */
function resolvePlatform(): PushPlatform {
    return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** projectId do EAS — obrigatório para `getExpoPushTokenAsync`. */
function getProjectId(): string | undefined {
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    return extra?.eas?.projectId;
}

/** Versão do app (para telemetria do device no backend). */
function getAppVersion(): string | undefined {
    return Constants.expoConfig?.version;
}

/**
 * Cria/atualiza o canal Android "default" com importância alta (necessário para
 * banners/heads-up no Android 8+). No-op em iOS.
 */
async function ensureAndroidChannel(): Promise<void> {
    if (Platform.OS !== 'android') return;
    try {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
            name: 'Geral',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: BRAND_COLOR,
        });
    } catch (e) {
        // Canal é best-effort; não deve impedir o registro do token.
        console.warn('[push] falha ao criar canal Android', e);
    }
}

/**
 * Garante permissão de notificação. Retorna `true` se concedida.
 * Não força nova solicitação se já houver decisão (respeita `getPermissions`).
 */
async function ensurePermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    // `canAskAgain === false` → o SO não exibirá o prompt; pedir mesmo assim é
    // inofensivo (retorna o status atual). A UI explicativa fica a cargo da tela.
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
}

/**
 * Registra o device para push e persiste o token localmente.
 *
 * @returns o ExponentPushToken registrado, ou `null` se não aplicável
 *          (emulador, Expo Go, permissão negada, sem projectId, erro de rede).
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
    // Push remoto só funciona em device físico (e dev build).
    if (!Device.isDevice) {
        return null;
    }

    try {
        await ensureAndroidChannel();

        const granted = await ensurePermission();
        if (!granted) {
            console.warn('[push] permissão de notificação não concedida');
            return null;
        }

        const projectId = getProjectId();
        if (!projectId) {
            console.warn('[push] projectId do EAS ausente — não é possível obter o token');
            return null;
        }

        // EM EXPO GO (SDK 53+) ESTA CHAMADA LANÇA — degradamos para null.
        const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
        const token = tokenResponse.data;
        if (!token) return null;

        // Registra no backend (upsert por token).
        await apiClient.post('/push/devices', {
            token,
            platform: resolvePlatform(),
            app_version: getAppVersion(),
        });

        // Guarda o token para o DELETE no logout (precisa dele com o Bearer válido).
        await appStorage.set(PUSH_TOKEN_KEY, token);

        return token;
    } catch (e) {
        // Expo Go, sem rede, permissão negada em runtime, etc. — nunca crashar.
        console.warn('[push] registro de push falhou (degradação graciosa)', e);
        return null;
    }
}

/**
 * Desregistra o device de push no backend e limpa o token local.
 * DEVE ser chamado ANTES de limpar o auth (precisa do access token válido).
 * Idempotente: silencioso se não houver token salvo ou se o DELETE falhar.
 */
export async function unregisterPushNotificationsAsync(): Promise<void> {
    try {
        const token = await appStorage.get<string>(PUSH_TOKEN_KEY);
        if (!token) return;

        // O token contém colchetes (ExponentPushToken[...]) e o endpoint usa
        // `{token:path}`; encode para não quebrar o path.
        await apiClient.delete(`/push/devices/${encodeURIComponent(token)}`);
    } catch (e) {
        // DELETE é idempotente no backend; logout não deve falhar por causa disso.
        console.warn('[push] desregistro de push falhou (ignorado)', e);
    } finally {
        // Limpa o token local mesmo se o DELETE falhar (evita lixo no próximo login).
        await appStorage.remove(PUSH_TOKEN_KEY);
    }
}
