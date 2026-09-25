import {
    authenticate,
    getBiometricLabel,
    isBiometricAvailable,
    suppressAppLock,
    releaseAppLock,
    isAppLockSuppressed,
} from '@/services/biometrics';

declare const global: {
    mockOptionalNativeModule: { available: boolean };
    mockBiometrics: {
        hasHardware: boolean;
        isEnrolled: boolean;
        supportedTypes: number[];
        authenticateResult: { success: boolean };
    };
};

/**
 * Serviço de biometria (HARD-01). O módulo nativo expo-local-authentication é
 * mockado no jest.setup.js; `global.mockBiometrics` controla o comportamento.
 * O probe `requireOptionalNativeModule` retorna truthy por padrão
 * (global.mockOptionalNativeModule.available).
 */

beforeEach(() => {
    jest.clearAllMocks();
    global.mockOptionalNativeModule = { available: true };
    global.mockBiometrics = {
        hasHardware: true,
        isEnrolled: true,
        supportedTypes: [1], // FINGERPRINT
        authenticateResult: { success: true },
    };
});

describe('isBiometricAvailable', () => {
    it('true quando há hardware E biometria cadastrada', async () => {
        await expect(isBiometricAvailable()).resolves.toBe(true);
    });

    it('false quando não há hardware', async () => {
        global.mockBiometrics.hasHardware = false;
        await expect(isBiometricAvailable()).resolves.toBe(false);
    });

    it('false quando não há biometria cadastrada', async () => {
        global.mockBiometrics.isEnrolled = false;
        await expect(isBiometricAvailable()).resolves.toBe(false);
    });

    it('false quando o módulo nativo está ausente (Expo Go)', async () => {
        global.mockOptionalNativeModule = { available: false };
        await expect(isBiometricAvailable()).resolves.toBe(false);
    });
});

describe('getBiometricLabel', () => {
    it('"Digital" para FINGERPRINT', async () => {
        global.mockBiometrics.supportedTypes = [1];
        await expect(getBiometricLabel()).resolves.toBe('Digital');
    });

    it('"Rosto" para FACIAL_RECOGNITION (prioridade sobre digital)', async () => {
        global.mockBiometrics.supportedTypes = [1, 2];
        await expect(getBiometricLabel()).resolves.toBe('Rosto');
    });

    it('"Biometria" quando o módulo nativo está ausente', async () => {
        global.mockOptionalNativeModule = { available: false };
        await expect(getBiometricLabel()).resolves.toBe('Biometria');
    });
});

describe('authenticate', () => {
    it('true quando o prompt sucede', async () => {
        global.mockBiometrics.authenticateResult = { success: true };
        await expect(authenticate('Desbloqueie')).resolves.toBe(true);
    });

    it('false quando o prompt falha/cancela', async () => {
        global.mockBiometrics.authenticateResult = { success: false };
        await expect(authenticate('Desbloqueie')).resolves.toBe(false);
    });

    it('false quando o módulo nativo está ausente (Expo Go)', async () => {
        global.mockOptionalNativeModule = { available: false };
        await expect(authenticate('Desbloqueie')).resolves.toBe(false);
    });
});

describe('supressão do app-lock (câmera/galeria)', () => {
    afterEach(() => {
        // Garante que o flag não vaze entre testes.
        releaseAppLock(0);
        jest.useRealTimers();
    });

    it('suppress ativa e release desativa só após o delay', () => {
        jest.useFakeTimers();
        expect(isAppLockSuppressed()).toBe(false);

        suppressAppLock();
        expect(isAppLockSuppressed()).toBe(true);

        releaseAppLock(1000);
        // Ainda suprimido antes do delay (cobre a corrida com o evento `active`).
        expect(isAppLockSuppressed()).toBe(true);

        jest.advanceTimersByTime(1000);
        expect(isAppLockSuppressed()).toBe(false);
    });

    it('um novo suppress cancela o release pendente', () => {
        jest.useFakeTimers();
        suppressAppLock();
        releaseAppLock(1000);
        // Reabrir a câmera antes do release não pode destravar no meio.
        suppressAppLock();
        jest.advanceTimersByTime(1000);
        expect(isAppLockSuppressed()).toBe(true);
    });
});
