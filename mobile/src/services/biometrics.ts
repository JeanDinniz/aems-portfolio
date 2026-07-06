/**
 * Serviço de biometria (Sprint 7 — HARD-01).
 *
 * Wrapper fino sobre `expo-local-authentication` para o desbloqueio local do app.
 * Os tokens já vivem no Keychain/Keystore (ver doc 02 §5): a biometria apenas
 * DESBLOQUEIA o uso local sem novo login enquanto o refresh token for válido.
 *
 * Blindagem contra ambiente sem o módulo nativo (Expo Go): o binário
 * `ExpoLocalAuthentication` só existe em builds que o incluíram (dev build /
 * preview / produção). Um `import` estático no topo faz `requireNativeModule` na
 * carga e, se ausente, DERRUBA o app no boot. Por isso sondamos primeiro com
 * `requireOptionalNativeModule` (retorna null sem lançar) e só então carregamos
 * o wrapper JS — o mesmo padrão de `src/utils/exportShare.ts`.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type LocalAuthModule = typeof import('expo-local-authentication');

/**
 * Carrega `expo-local-authentication` de forma TARDIA e segura. Retorna null no
 * Expo Go (módulo nativo ausente) — o chamador degrada para "indisponível".
 */
function getLocalAuth(): LocalAuthModule | null {
    try {
        if (!requireOptionalNativeModule('ExpoLocalAuthentication')) return null;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-local-authentication') as LocalAuthModule;
    } catch {
        return null;
    }
}

/**
 * Há hardware biométrico E ao menos uma biometria cadastrada no aparelho?
 * Só nesse caso faz sentido oferecer/exigir o desbloqueio por biometria.
 */
export async function isBiometricAvailable(): Promise<boolean> {
    const LocalAuth = getLocalAuth();
    if (!LocalAuth) return false;
    try {
        const [hasHardware, isEnrolled] = await Promise.all([
            LocalAuth.hasHardwareAsync(),
            LocalAuth.isEnrolledAsync(),
        ]);
        return hasHardware && isEnrolled;
    } catch {
        return false;
    }
}

/** Rótulo amigável do tipo de biometria disponível (para legendas na UI). */
export type BiometricLabel = 'Digital' | 'Rosto' | 'Íris' | 'Biometria';

/**
 * Descobre o tipo de biometria suportado para compor legendas
 * ("Use sua digital", "Use o reconhecimento facial"...). Face tem prioridade
 * sobre digital quando ambos existem (é o mais visível ao usuário).
 */
export async function getBiometricLabel(): Promise<BiometricLabel> {
    const LocalAuth = getLocalAuth();
    if (!LocalAuth) return 'Biometria';
    try {
        const types = await LocalAuth.supportedAuthenticationTypesAsync();
        const T = LocalAuth.AuthenticationType;
        if (types.includes(T.FACIAL_RECOGNITION)) return 'Rosto';
        if (types.includes(T.FINGERPRINT)) return 'Digital';
        if (types.includes(T.IRIS)) return 'Íris';
        return 'Biometria';
    } catch {
        return 'Biometria';
    }
}

/**
 * Dispara o prompt nativo de biometria. Retorna `true` só em sucesso.
 *
 * `disableDeviceFallback: false` deixa o SO oferecer o PIN/senha do aparelho
 * como fallback (exigência de acessibilidade — nem todo mundo tem biometria
 * cadastrada no momento). Textos em PT-BR.
 */
export async function authenticate(reason: string): Promise<boolean> {
    const LocalAuth = getLocalAuth();
    if (!LocalAuth) return false;
    try {
        const result = await LocalAuth.authenticateAsync({
            promptMessage: reason,
            cancelLabel: 'Cancelar',
            fallbackLabel: 'Usar senha do aparelho',
            disableDeviceFallback: false,
        });
        return result.success === true;
    } catch {
        return false;
    }
}
