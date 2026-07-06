import {
    authenticate,
    getBiometricLabel,
    isBiometricAvailable,
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
